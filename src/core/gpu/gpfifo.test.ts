import { describe, expect, it } from 'vitest';
import { GpfifoParseError, parseGpfifo, readU64 } from './gpfifo';

function u32(value: number): Uint8Array {
  const data = new Uint8Array(4);
  new DataView(data.buffer).setUint32(0, value, true);
  return data;
}

describe('GPFIFO parser', () => {
  it('parses pointer/size entries from a synthetic GPFIFO buffer', () => {
    const data = new Uint8Array([
      ...u32(0x48001000),
      ...u32(0x200),
      ...u32(0x48002000),
      ...u32(0x400),
    ]);

    const entries = parseGpfifo(data);

    expect(entries).toEqual([
      { pointer: 0x48001000n, size: 0x200 },
      { pointer: 0x48002000n, size: 0x400 },
    ]);
  });

  it('rejects malformed GPFIFO buffers', () => {
    expect(() => parseGpfifo(new Uint8Array([1, 2, 3]))).toThrow(GpfifoParseError);
  });

  it('honors max entry limits', () => {
    const data = new Uint8Array([
      ...u32(0x1000),
      ...u32(0x20),
      ...u32(0x2000),
      ...u32(0x40),
    ]);

    expect(parseGpfifo(data, { maxEntries: 1 })).toEqual([{ pointer: 0x1000n, size: 0x20 }]);
  });

  it('reads little-endian 64-bit GPFIFO words', () => {
    const data = new Uint8Array(8);
    new DataView(data.buffer).setBigUint64(0, 0x0000004000001234n, true);

    expect(readU64(data, 0)).toBe(0x0000004000001234n);
  });
});
