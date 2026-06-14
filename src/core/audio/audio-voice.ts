// Audio voice domain model for synthetic Phase 6 HLE.

export enum AudioSampleFormat {
  Pcm16 = 'pcm16',
  Adpcm = 'adpcm',
}

export enum AudioVoiceState {
  Stopped = 'stopped',
  Playing = 'playing',
}

export interface AudioVoice {
  id: number;
  sampleDataPointer: bigint;
  sampleCount: number;
  loopStart: number;
  loopEnd: number;
  pitch: number;
  volume: number;
  state: AudioVoiceState;
  format: AudioSampleFormat;
  channels: number;
  sampleRate: number;
}

export function createAudioVoice(id: number, overrides: Partial<AudioVoice> = {}): AudioVoice {
  return {
    id,
    sampleDataPointer: 0n,
    sampleCount: 0,
    loopStart: 0,
    loopEnd: 0,
    pitch: 1,
    volume: 1,
    state: AudioVoiceState.Stopped,
    format: AudioSampleFormat.Pcm16,
    channels: 2,
    sampleRate: 48000,
    ...overrides,
  };
}
