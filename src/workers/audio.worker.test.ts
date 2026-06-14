import { describe, expect, it } from 'vitest';
import { handleAudioWorkerMessage } from './audio.worker';

describe('audio worker scaffold', () => {
  it('handles init/start/update/stop messages without throwing', () => {
    expect(handleAudioWorkerMessage({ type: 'init', sampleRate: 48000, channels: 2 })).toMatchObject({ type: 'ready' });
    expect(handleAudioWorkerMessage({ type: 'start' })).toMatchObject({ type: 'started' });
    expect(handleAudioWorkerMessage({ type: 'update', frames: 128 })).toMatchObject({ type: 'updated', availableFrames: 128 });
    expect(handleAudioWorkerMessage({ type: 'stop' })).toMatchObject({ type: 'stopped' });
  });
});
