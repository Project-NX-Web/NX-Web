import { describe, expect, it } from 'vitest';
import { AudioRenderer } from './audio-renderer';
import { AudioSampleFormat, AudioVoiceState } from './audio-voice';
import { AudioResult } from './result-codes';

describe('AudioRenderer', () => {
  it('starts, mixes a PCM16 voice, and reports ring-buffer fill', () => {
    const renderer = new AudioRenderer(1, { channels: 2, ringBufferFrames: 8 });
    const voiceId = renderer.openVoice({
      sampleDataPointer: 0n,
      sampleCount: 4,
      format: AudioSampleFormat.Pcm16,
      channels: 2,
      volume: 1,
      state: AudioVoiceState.Playing,
    });
    const memory = {
      readBytes: () => new Uint8Array([0x00, 0x10, 0x00, 0x10, 0x00, 0x10, 0x00, 0x10]),
    };

    expect(renderer.start()).toBe(AudioResult.Success);
    expect(renderer.update(memory, 4)).toBe(AudioResult.Success);
    expect(renderer.getVoice(voiceId)).toBeDefined();
    expect(renderer.ringBuffer.availableFrames).toBeGreaterThan(0);
    expect(renderer.stop()).toBe(AudioResult.Success);
  });
});
