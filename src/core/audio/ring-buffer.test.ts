import { describe, expect, it } from 'vitest';
import { PcmRingBuffer } from './ring-buffer';

describe('PcmRingBuffer', () => {
  it('wraps reads and writes across capacity', () => {
    const ring = new PcmRingBuffer(4, 2);

    expect(ring.write(Int16Array.from([1, 2, 3, 4]))).toBe(2);
    expect(ring.availableFrames).toBe(2);

    const out = new Int16Array(4);
    expect(ring.read(out)).toBe(2);
    expect([...out]).toEqual([1, 2, 3, 4]);
    expect(ring.availableFrames).toBe(0);

    expect(ring.write(Int16Array.from([5, 6, 7, 8, 9, 10, 11, 12]))).toBe(4);
    expect(ring.write(Int16Array.from([13, 14, 15, 16]))).toBe(0);
    expect(ring.freeFrames).toBe(0);

    const wrapped = new Int16Array(8);
    expect(ring.read(wrapped)).toBe(4);
    expect([...wrapped.slice(0, 8)]).toEqual([5, 6, 7, 8, 9, 10, 11, 12]);
  });

  it('outputs silence on underrun without corrupting state', () => {
    const ring = new PcmRingBuffer(2, 2);
    expect(ring.write(Int16Array.from([1, 2]))).toBe(1);

    const out = new Int16Array(4);
    const result = ring.readOrSilence(out);

    expect(result).toEqual({ framesRead: 1, underrun: true });
    expect([...out]).toEqual([1, 2, 0, 0]);
    expect(ring.availableFrames).toBe(0);
  });

  it('reports partial writes when the producer overfills the buffer', () => {
    const ring = new PcmRingBuffer(1, 1);
    expect(ring.write(Int16Array.from([1, 2]))).toBe(1);
    expect(ring.availableFrames).toBe(1);
  });
});
