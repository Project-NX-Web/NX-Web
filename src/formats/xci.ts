// XCI (Nintendo Cartridge Image) parser
// Structure: XCI header → HFS0 partitions (update, normal, secure)
// The secure partition contains NCAs in PFS0/HFS0 format.

import { parsePfs0, type Pfs0 } from './pfs0';

export interface XciHeader {
  magic: string;           // "HEAD"
  secureOffset: number;
  secureSize: number;
  normalOffset: number;
  normalSize: number;
  updateOffset: number;
  updateSize: number;
  packageId: bigint;
  cartSize: number;
}

export interface XciFile {
  header: XciHeader;
  securePartition: Pfs0 | null;
  raw: Uint8Array;
}

export function parseXci(data: Uint8Array): XciFile {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

  const magic = String.fromCharCode(data[0x100], data[0x101], data[0x102], data[0x103]);
  if (magic !== 'HEAD') {
    throw new Error(`Invalid XCI magic: expected "HEAD", got "${magic}"`);
  }

  const secureOffset = Number(view.getBigUint64(0x104, true));
  // Back up offset is at 0x10C
  const titleKeyAreaOffset = Number(view.getBigUint64(0x110, true));
  const cartSize = view.getUint8(0x10D);
  // Header version at 0x10E
  const packageId = view.getBigUint64(0x120, true);

  // The Game Card Header Region (root HFS0) starts at 0xF000
  const rootHfs0Offset = 0xF000;

  const header: XciHeader = {
    magic,
    secureOffset,
    secureSize: 0, // Calculated from partition
    normalOffset: 0,
    normalSize: 0,
    updateOffset: 0,
    updateSize: 0,
    packageId,
    cartSize,
  };

  // Parse root HFS0 partition table to find the secure partition
  let securePartition: Pfs0 | null = null;

  if (rootHfs0Offset < data.length) {
    try {
      const rootPfs = parsePfs0(data.slice(rootHfs0Offset));

      // Find the "secure" partition
      for (const entry of rootPfs.files) {
        if (entry.name.toLowerCase() === 'secure') {
          const secureData = data.slice(
            rootHfs0Offset + rootPfs.dataOffset + entry.offset,
            rootHfs0Offset + rootPfs.dataOffset + entry.offset + entry.size
          );
          securePartition = parsePfs0(secureData);
          header.secureOffset = rootHfs0Offset + rootPfs.dataOffset + entry.offset;
          header.secureSize = entry.size;
        } else if (entry.name.toLowerCase() === 'normal') {
          header.normalOffset = rootHfs0Offset + rootPfs.dataOffset + entry.offset;
          header.normalSize = entry.size;
        } else if (entry.name.toLowerCase() === 'update') {
          header.updateOffset = rootHfs0Offset + rootPfs.dataOffset + entry.offset;
          header.updateSize = entry.size;
        }
      }
    } catch {
      // Root HFS0 parsing failed — may be an unusual XCI layout
    }
  }

  // If root HFS0 didn't parse, fall back to raw secure offset
  if (!securePartition && secureOffset > 0 && secureOffset < data.length) {
    try {
      securePartition = parsePfs0(data.slice(secureOffset));
    } catch {
      // Secure partition is likely encrypted
    }
  }

  return { header, securePartition, raw: data };
}
