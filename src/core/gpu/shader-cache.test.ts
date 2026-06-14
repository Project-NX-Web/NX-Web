import { describe, expect, it } from 'vitest';
import { MemoryShaderStorage, SyntheticShaderCache, hashShaderBinary, shaderCacheKey } from './shader-cache';

describe('SyntheticShaderCache', () => {
  it('stores and retrieves WGSL by title id and shader hash', async () => {
    const storage = new MemoryShaderStorage();
    const cache = new SyntheticShaderCache(storage, '0100000000001000');
    const binary = new Uint8Array([1, 2, 3, 4]);

    await cache.set(binary, 'fn main() {}');
    const entry = await cache.get(binary);

    expect(entry).toMatchObject({
      titleId: '0100000000001000',
      shaderHash: hashShaderBinary(binary),
      wgsl: 'fn main() {}',
    });
    expect(entry?.key).toBe(shaderCacheKey('0100000000001000', hashShaderBinary(binary)));
  });

  it('deletes cached WGSL', async () => {
    const storage = new MemoryShaderStorage();
    const cache = new SyntheticShaderCache(storage, '0100000000001000');
    const binary = new Uint8Array([9, 9, 9]);

    await cache.set(binary, 'fn deleted() {}');
    await cache.delete(binary);

    expect(await cache.get(binary)).toBeNull();
    expect(storage.size).toBe(0);
  });
});
