import { describe, expect, it } from 'vitest';
import {
  astcBlockCount,
  AstcBlockSize,
  decodeSyntheticAstc4x4,
  getAstcBlockInfo,
  TextureCache,
  TextureFormat,
} from './texture';

describe('texture cache and ASTC scaffolding', () => {
  it('caches, retrieves, and invalidates texture data by guest range', () => {
    const cache = new TextureCache();
    const key = { address: 0x48000000n, size: 16, format: TextureFormat.RGBA8, width: 4, height: 4 };
    const data = new Uint8Array([1, 2, 3, 4]);

    cache.set(key, data);
    expect(cache.get(key)).toEqual(data);
    expect(cache.size).toBe(1);

    expect(cache.invalidateRange(0x4800000fn, 1)).toBe(1);
    expect(cache.get(key)).toBeUndefined();
  });

  it('reports ASTC block metadata and block counts', () => {
    expect(getAstcBlockInfo(AstcBlockSize.A6x6)).toEqual({
      blockSize: AstcBlockSize.A6x6,
      width: 6,
      height: 6,
      bytesPerBlock: 16,
    });
    expect(astcBlockCount(10, 10, AstcBlockSize.A6x6)).toEqual({ x: 2, y: 2, totalBlocks: 4 });
  });

  it('decodes a synthetic ASTC 4x4 block to RGBA8 pixels', () => {
    const block = new Uint8Array(16);
    for (let index = 0; index < block.length; index++) {
      block[index] = index * 17;
    }

    const rgba = decodeSyntheticAstc4x4(block);

    expect(rgba.byteLength).toBe(4 * 4 * 4);
    expect(rgba[3]).toBe(0xff);
    expect(rgba[rgba.byteLength - 1]).toBe(0xff);
  });
});
