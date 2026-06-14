// Synthetic WGSL shader cache scaffolding for Phase 7.
//
// This module models OPFS-backed shader cache persistence without requiring a
// real OPFS handle in unit tests. It hashes shader binaries deterministically and
// stores WGSL text through a small storage adapter interface.

export interface ShaderStorage {
  read(key: string): Promise<string | null>;
  write(key: string, wgsl: string): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface ShaderCacheEntry {
  key: string;
  titleId: string;
  shaderHash: string;
  wgsl: string;
}

export class SyntheticShaderCache {
  constructor(private readonly storage: ShaderStorage, private readonly titleId: string) {}

  async get(shaderBinary: Uint8Array): Promise<ShaderCacheEntry | null> {
    const hash = hashShaderBinary(shaderBinary);
    const key = shaderCacheKey(this.titleId, hash);
    const wgsl = await this.storage.read(key);
    if (!wgsl) {
      return null;
    }
    return { key, titleId: this.titleId, shaderHash: hash, wgsl };
  }

  async set(shaderBinary: Uint8Array, wgsl: string): Promise<ShaderCacheEntry> {
    const hash = hashShaderBinary(shaderBinary);
    const key = shaderCacheKey(this.titleId, hash);
    await this.storage.write(key, wgsl);
    return { key, titleId: this.titleId, shaderHash: hash, wgsl };
  }

  async delete(shaderBinary: Uint8Array): Promise<void> {
    const hash = hashShaderBinary(shaderBinary);
    await this.storage.delete(shaderCacheKey(this.titleId, hash));
  }
}

export class MemoryShaderStorage implements ShaderStorage {
  private readonly entries = new Map<string, string>();

  async read(key: string): Promise<string | null> {
    return this.entries.get(key) ?? null;
  }

  async write(key: string, wgsl: string): Promise<void> {
    this.entries.set(key, wgsl);
  }

  async delete(key: string): Promise<void> {
    this.entries.delete(key);
  }

  get size(): number {
    return this.entries.size;
  }
}

export function shaderCacheKey(titleId: string, shaderHash: string): string {
  return `shader-cache/${titleId}/${shaderHash}.wgsl`;
}

export function hashShaderBinary(shaderBinary: Uint8Array): string {
  let hash = 0x811c9dc5;
  for (const byte of shaderBinary) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}
