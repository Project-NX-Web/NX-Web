// Per-voice mix state for synthetic Phase 6 audio rendering.

export interface AudioMixVoiceState {
  voiceId: number;
  gain: number;
  pan: number;
  cursor: number;
}

export interface AudioMixState {
  voices: Map<number, AudioMixVoiceState>;
  framesProduced: number;
  underruns: number;
}

export function createAudioMixState(): AudioMixState {
  return {
    voices: new Map(),
    framesProduced: 0,
    underruns: 0,
  };
}
