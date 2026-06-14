import { describe, expect, it } from 'vitest';
import { FramePacer } from './frame-pacing';

describe('FramePacer', () => {
  it('tracks frame time and dropped frames against a mocked budget', () => {
    let now = 0;
    const pacer = new FramePacer({ targetFps: 60, now: () => now });

    const start = pacer.beginFrame();
    now = 10;
    expect(pacer.endFrame(start).droppedFrames).toBe(0);

    const slowStart = pacer.beginFrame();
    now = 30;
    expect(pacer.endFrame(slowStart).droppedFrames).toBe(1);
    expect(pacer.snapshot().averageFrameTimeMs).toBe(15);
  });

  it('returns remaining frame budget or zero', () => {
    let now = 0;
    const pacer = new FramePacer({ targetFps: 60, now: () => now });
    const start = pacer.beginFrame();

    now = 5;
    expect(pacer.waitUntilNextFrame(start)).toBeGreaterThan(11);

    now = 30;
    expect(pacer.waitUntilNextFrame(start)).toBe(0);
  });
});
