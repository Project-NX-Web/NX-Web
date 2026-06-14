// Synthetic Audio Renderer domain object for Phase 6 HLE.

import { AudioResult } from './result-codes';
import { createAudioMixState, type AudioMixState } from './audio-mix-state';
import { PcmRingBuffer } from './ring-buffer';
import { createAudioVoice, type AudioVoice } from './audio-voice';
import { createAudioBuffer, type AudioBuffer } from './audio-buffer';
import { mixVoicesToRingBuffer, voiceToSamples, type VoiceSampleSource } from './mixer';

export enum AudioRendererStatus {
  Stopped = 'stopped',
  Running = 'running',
  Updating = 'updating',
}

export interface AudioRendererConfig {
  sampleRate: number;
  channels: number;
  ringBufferFrames: number;
}

export interface AudioRendererSnapshot {
  handle: number;
  status: AudioRendererStatus;
  voices: AudioVoice[];
  ringBufferAvailableFrames: number;
  mixState: AudioMixState;
}

export class AudioRenderer {
  readonly handle: number;
  readonly config: Required<AudioRendererConfig>;
  readonly ringBuffer: PcmRingBuffer;
  readonly mixState = createAudioMixState();

  private readonly voices = new Map<number, AudioVoice>();
  private readonly buffers = new Map<number, AudioBuffer>();
  private status = AudioRendererStatus.Stopped;
  private nextVoiceId = 1;
  private nextBufferId = 1;

  constructor(handle: number, config: Partial<AudioRendererConfig> = {}) {
    this.handle = handle;
    this.config = {
      sampleRate: config.sampleRate ?? 48000,
      channels: config.channels ?? 2,
      ringBufferFrames: config.ringBufferFrames ?? 1024,
    };
    this.ringBuffer = new PcmRingBuffer(this.config.ringBufferFrames, this.config.channels);
  }

  openVoice(overrides: Partial<AudioVoice> = {}): number {
    const voice = createAudioVoice(this.nextVoiceId++, overrides);
    this.voices.set(voice.id, voice);
    this.mixState.voices.set(voice.id, {
      voiceId: voice.id,
      gain: voice.volume,
      pan: 0,
      cursor: 0,
    });
    return voice.id;
  }

  closeVoice(id: number): AudioResult {
    return this.voices.delete(id) ? AudioResult.Success : AudioResult.InvalidHandle;
  }

  getVoice(id: number): AudioVoice | undefined {
    return this.voices.get(id);
  }

  start(): AudioResult {
    if (this.status === AudioRendererStatus.Running) {
      return AudioResult.Success;
    }
    this.status = AudioRendererStatus.Running;
    return AudioResult.Success;
  }

  stop(): AudioResult {
    this.status = AudioRendererStatus.Stopped;
    return AudioResult.Success;
  }

  update(cpuMemory: { readBytes(address: bigint, length: number): Uint8Array }, frames = 256): AudioResult {
    if (this.status !== AudioRendererStatus.Running) {
      return AudioResult.InvalidState;
    }

    const previousStatus = this.status;
    this.status = AudioRendererStatus.Updating;
    try {
      const voiceSources: VoiceSampleSource[] = [];
      for (const voice of this.voices.values()) {
        voiceSources.push({ voice, samples: voiceToSamples(cpuMemory, voice) });
      }

      mixVoicesToRingBuffer({
        voices: voiceSources,
        mixState: this.mixState,
        ringBuffer: this.ringBuffer,
        frames,
      });
      return AudioResult.Success;
    } finally {
      this.status = previousStatus;
    }
  }

  registerBuffer(overrides: Partial<AudioBuffer> = {}): number {
    const buffer = createAudioBuffer(this.nextBufferId++, overrides);
    this.buffers.set(buffer.id, buffer);
    return buffer.id;
  }

  getBuffer(id: number): AudioBuffer | undefined {
    return this.buffers.get(id);
  }

  snapshot(): AudioRendererSnapshot {
    return {
      handle: this.handle,
      status: this.status,
      voices: [...this.voices.values()],
      ringBufferAvailableFrames: this.ringBuffer.availableFrames,
      mixState: this.mixState,
    };
  }
}

export function audioResultToNumber(result: AudioResult): number {
  return result;
}
