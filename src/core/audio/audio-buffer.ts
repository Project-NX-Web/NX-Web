// Synthetic audio buffer metadata.

import { AudioSampleFormat } from './audio-voice';

export interface AudioBuffer {
  id: number;
  pointer: bigint;
  size: number;
  format: AudioSampleFormat;
  sampleRate: number;
  channels: number;
}

export function createAudioBuffer(id: number, overrides: Partial<AudioBuffer> = {}): AudioBuffer {
  return {
    id,
    pointer: 0n,
    size: 0,
    format: AudioSampleFormat.Pcm16,
    sampleRate: 48000,
    channels: 2,
    ...overrides,
  };
}
