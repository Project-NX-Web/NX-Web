// Synthetic voice mixer for Phase 6.

import type { AudioVoice } from './audio-voice';
import { AudioSampleFormat } from './audio-voice';
import { decodeAudioBuffer } from './decoders';
import type { AudioMixState } from './audio-mix-state';
import { PcmRingBuffer } from './ring-buffer';

export interface VoiceSampleSource {
  voice: AudioVoice;
  samples: Int16Array;
}

export interface MixOptions {
  voices: Iterable<VoiceSampleSource>;
  mixState: AudioMixState;
  ringBuffer: PcmRingBuffer;
  frames: number;
}

export function mixVoicesToRingBuffer(options: MixOptions): { framesMixed: number; underruns: number } {
  const output = new Int16Array(options.frames * options.ringBuffer.channels);
  let underruns = 0;

  for (const source of options.voices) {
    const state = options.mixState.voices.get(source.voice.id) ?? {
      voiceId: source.voice.id,
      gain: source.voice.volume,
      pan: 0,
      cursor: 0,
    };
    options.mixState.voices.set(source.voice.id, state);

    if (source.voice.state !== 'playing' || source.samples.length === 0) {
      continue;
    }

    const channels = Math.max(1, source.voice.channels);
    const requestedFrames = Math.min(options.frames, Math.floor(source.samples.length / channels));
    const left = state.pan < 0 ? 1 + state.pan : 1;
    const right = state.pan > 0 ? 1 - state.pan : 1;
    const gain = Math.max(0, Math.min(1, state.gain));

    for (let frame = 0; frame < requestedFrames; frame++) {
      for (let channel = 0; channel < options.ringBuffer.channels; channel++) {
        const sourceChannel = channels === 1 ? 0 : Math.min(channels - 1, channel);
        const sample = source.samples[state.cursor * channels + sourceChannel] ?? 0;
        const channelGain = gain * (channel === 0 ? left : right);
        output[frame * options.ringBuffer.channels + channel] = clampInt16(
          output[frame * options.ringBuffer.channels + channel] + Math.trunc(sample * channelGain),
        );
      }
      state.cursor = (state.cursor + 1) % Math.max(1, Math.floor(source.samples.length / channels));
    }
  }

  const written = options.ringBuffer.write(output);
  if (written < options.frames) {
    underruns++;
    options.mixState.underruns++;
  }
  options.mixState.framesProduced += written;

  return { framesMixed: written, underruns };
}

export function voiceToSamples(cpuMemory: { readBytes(address: bigint, length: number): Uint8Array }, voice: AudioVoice): Int16Array {
  const bytes = cpuMemory.readBytes(voice.sampleDataPointer, voice.sampleCount * 2);
  if (voice.format === AudioSampleFormat.Adpcm) {
    return decodeAudioBuffer(bytes, voice.format, voice.channels);
  }
  return decodeAudioBuffer(bytes, voice.format, voice.channels);
}

function clampInt16(value: number): number {
  return Math.max(-0x8000, Math.min(0x7fff, value));
}
