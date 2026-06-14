// Phase 5 GPU command ingestion.
//
// NvGPU submissions arrive as GPFIFO entries: a guest command-buffer pointer
// plus a byte size. This module keeps parsing deterministic and synthetic-test
// friendly while leaving command interpretation to the Maxwell/NV2A parser.

export interface GpfifoEntry {
  pointer: bigint;
  size: number;
}

export interface GpfifoParseOptions {
  maxEntries?: number;
}

export class GpfifoParseError extends Error {
  constructor(message: string) {
    super(message);
  }
}

export function parseGpfifo(data: Uint8Array, options: GpfifoParseOptions = {}): GpfifoEntry[] {
  if (data.byteLength % 8 !== 0) {
    throw new GpfifoParseError(`GPFIFO byte length must be a multiple of 8, got ${data.byteLength}`);
  }

  const maxEntries = options.maxEntries ?? Math.floor(data.byteLength / 8);
  const entryCount = Math.min(maxEntries, Math.floor(data.byteLength / 8));
  const entries: GpfifoEntry[] = [];

  for (let offset = 0; offset < entryCount * 8; offset += 8) {
    const low = readU32(data, offset);
    const high = readU32(data, offset + 4);

    // Synthetic Phase 5 contract: low 32 bits are the guest command-buffer
    // pointer, high 32 bits are the byte size. Real NvGPU encodings can be
    // richer, but this keeps the first parser stable and testable.
    entries.push({
      pointer: BigInt(low),
      size: high,
    });
  }

  return entries;
}

export function readU32(data: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 4 > data.byteLength) {
    throw new GpfifoParseError(`readU32 out of bounds: offset=${offset}, length=${data.byteLength}`);
  }
  return (
    data[offset] |
    (data[offset + 1] << 8) |
    (data[offset + 2] << 16) |
    (data[offset + 3] << 24)
  ) >>> 0;
}

export function readU64(data: Uint8Array, offset: number): bigint {
  const low = BigInt(readU32(data, offset));
  const high = BigInt(readU32(data, offset + 4));
  return (high << 32n) | low;
}
