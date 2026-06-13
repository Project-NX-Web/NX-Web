import { describe, it, expect } from 'vitest';
import { parseXci } from './xci';

describe('XCI Parser', () => {
  it('rejects invalid magic', () => {
    const data = new Uint8Array(0x10000);
    data[0x100] = 0x00; // Not "HEAD"
    expect(() => parseXci(data)).toThrow('Invalid XCI magic');
  });

  it('parses valid XCI header', () => {
    const data = new Uint8Array(0x10000);
    // "HEAD" at 0x100
    data[0x100] = 0x48; data[0x101] = 0x45; data[0x102] = 0x41; data[0x103] = 0x44;

    // Set package ID at 0x120
    const view = new DataView(data.buffer);
    view.setBigUint64(0x120, 0x0123456789ABCDEFn, true);

    const xci = parseXci(data);
    expect(xci.header.magic).toBe('HEAD');
    expect(xci.header.packageId).toBe(0x0123456789ABCDEFn);
  });
});
