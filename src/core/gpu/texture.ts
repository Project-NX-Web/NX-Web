// Phase 5 texture cache and ASTC metadata.
//
// This module defines the texture path that WebGPU rendering will consume. The
// ASTC decoder is intentionally synthetic for Phase 5 startup: it proves the
// cache/invalidation path and block metadata without claiming a production ASTC
// decompressor.

export enum TextureFormat {
  RGBA8 = 'rgba8-unorm',
  ASTC4x4 = 'astc-4x4-unorm',
  ASTC5x4 = 'astc-5x4-unorm',
  ASTC5x5 = 'astc-5x5-unorm',
  ASTC6x5 = 'astc-6x5-unorm',
  ASTC6x6 = 'astc-6x6-unorm',
  ASTC8x8 = 'astc-8x8-unorm',
}

export enum AstcBlockSize {
  A4x4 = '4x4',
  A5x4 = '5x4',
  A5x5 = '5x5',
  A6x5 = '6x5',
  A6x6 = '6x6',
  A8x8 = '8x8',
}

export interface TextureKey {
  address: bigint;
  size: number;
  format: TextureFormat;
  width: number;
  height: number;
}

export interface TextureCacheEntry {
  key: TextureKey;
  data: Uint8Array;
  lastUsed: number;
}

export interface AstcBlockInfo {
  blockSize: AstcBlockSize;
  width: number;
  height: number;
  bytesPerBlock: 16;
}

export class TextureCache {
  private entries = new Map<string, TextureCacheEntry>();
  private clock = 0;

  get(key: TextureKey): Uint8Array | undefined {
    const entry = this.entries.get(textureKeyString(key));
    if (!entry) {
      return undefined;
    }
    entry.lastUsed = ++this.clock;
    return entry.data;
  }

  set(key: TextureKey, data: Uint8Array): void {
    this.entries.set(textureKeyString(key), {
      key: { ...key },
      data: new Uint8Array(data),
      lastUsed: ++this.clock,
    });
  }

  invalidateRange(address: bigint, size: number): number {
    const start = address;
    const end = address + BigInt(size);
    let invalidated = 0;

    for (const [keyString, entry] of [...this.entries.entries()]) {
      const entryStart = entry.key.address;
      const entryEnd = entryStart + BigInt(entry.key.size);
      if (entryStart < end && entryEnd > start) {
        this.entries.delete(keyString);
        invalidated++;
      }
    }

    return invalidated;
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }
}

export function getAstcBlockInfo(blockSize: AstcBlockSize): AstcBlockInfo {
  switch (blockSize) {
    case AstcBlockSize.A4x4:
      return { blockSize, width: 4, height: 4, bytesPerBlock: 16 };
    case AstcBlockSize.A5x4:
      return { blockSize, width: 5, height: 4, bytesPerBlock: 16 };
    case AstcBlockSize.A5x5:
      return { blockSize, width: 5, height: 5, bytesPerBlock: 16 };
    case AstcBlockSize.A6x5:
      return { blockSize, width: 6, height: 5, bytesPerBlock: 16 };
    case AstcBlockSize.A6x6:
      return { blockSize, width: 6, height: 6, bytesPerBlock: 16 };
    case AstcBlockSize.A8x8:
      return { blockSize, width: 8, height: 8, bytesPerBlock: 16 };
  }
}

export function astcBlockCount(width: number, height: number, blockSize: AstcBlockSize): { x: number; y: number; totalBlocks: number } {
  const info = getAstcBlockInfo(blockSize);
  const x = Math.ceil(width / info.width);
  const y = Math.ceil(height / info.height);
  return { x, y, totalBlocks: x * y };
}

export function decodeSyntheticAstc4x4(block: Uint8Array): Uint8Array {
  if (block.byteLength !== 16) {
    throw new Error(`Synthetic ASTC 4x4 block must be 16 bytes, got ${block.byteLength}`);
  }

  const rgba = new Uint8Array(4 * 4 * 4);
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      const pixel = y * 4 + x;
      const seed = block[pixel % block.length];
      rgba[pixel * 4 + 0] = seed;
      rgba[pixel * 4 + 1] = block[(pixel * 3) % block.length];
      rgba[pixel * 4 + 2] = block[(pixel * 5 + 7) % block.length];
      rgba[pixel * 4 + 3] = 0xff;
    }
  }
  return rgba;
}

function textureKeyString(key: TextureKey): string {
  return `${key.address.toString(16)}:${key.size}:${key.format}:${key.width}x${key.height}`;
}
