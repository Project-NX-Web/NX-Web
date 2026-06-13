// NCA (Nintendo Content Archive) parser
// NCA is the container format for all Switch game content.
// Structure: Header (0x400 encrypted with header key) → FS entries → Section data

export enum NcaContentType {
  Program = 0,
  Meta = 1,
  Control = 2,
  Manual = 3,
  Data = 4,
  PublicData = 5,
}

export enum NcaDistributionType {
  Download = 0,
  GameCard = 1,
}

export enum NcaFsType {
  RomFS = 0,
  PFS0 = 1,
}

export enum NcaEncryptionType {
  Auto = 0,
  None = 1,
  AesXts = 2,
  AesCtr = 3,
  AesCtrEx = 4,
}

export interface NcaFsEntry {
  startOffset: number;  // In media units (0x200 bytes)
  endOffset: number;
  fsType: NcaFsType;
  encryptionType: NcaEncryptionType;
  generation: number;
}

export interface NcaHeader {
  magic: string;          // "NCA3" or "NCA2" or "NCA0"
  distributionType: NcaDistributionType;
  contentType: NcaContentType;
  keyGeneration: number;
  keyAreaEncryptionKeyIndex: number;
  contentSize: bigint;
  titleId: bigint;
  sdkVersion: number;
  fsEntries: NcaFsEntry[];
  rightsId: Uint8Array;   // 16 bytes — non-zero means titlekey crypto
}

export interface NcaParsed {
  header: NcaHeader;
  encrypted: boolean;
  raw: Uint8Array;
}

const MEDIA_UNIT = 0x200;

export function parseNcaHeader(data: Uint8Array, decryptedHeader: Uint8Array): NcaParsed {
  // decryptedHeader is the first 0x400 bytes already decrypted with the header key
  const view = new DataView(decryptedHeader.buffer, decryptedHeader.byteOffset, decryptedHeader.byteLength);

  const magic = String.fromCharCode(
    decryptedHeader[0x200], decryptedHeader[0x201],
    decryptedHeader[0x202], decryptedHeader[0x203]
  );

  if (magic !== 'NCA3' && magic !== 'NCA2' && magic !== 'NCA0') {
    throw new Error(`Invalid NCA magic: "${magic}"`);
  }

  const header: NcaHeader = {
    magic,
    distributionType: decryptedHeader[0x204] as NcaDistributionType,
    contentType: decryptedHeader[0x205] as NcaContentType,
    keyGeneration: decryptedHeader[0x206],
    keyAreaEncryptionKeyIndex: decryptedHeader[0x207],
    contentSize: view.getBigUint64(0x208, true),
    titleId: view.getBigUint64(0x210, true),
    sdkVersion: view.getUint32(0x21C, true),
    rightsId: decryptedHeader.slice(0x230, 0x240),
    fsEntries: [],
  };

  // Parse FS entries (4 entries starting at offset 0x240)
  for (let i = 0; i < 4; i++) {
    const entryOffset = 0x240 + i * 0x10;
    const startOffset = view.getUint32(entryOffset, true);
    const endOffset = view.getUint32(entryOffset + 0x04, true);

    if (startOffset === 0 && endOffset === 0) continue;

    // FS header is at 0x400 + i * 0x200 in the full decrypted header
    const fsHeaderOffset = 0x400 + i * 0x200;
    let fsType = NcaFsType.RomFS;
    let encryptionType = NcaEncryptionType.Auto;
    let generation = 0;

    if (fsHeaderOffset + 0x10 <= decryptedHeader.length) {
      const fsView = new DataView(
        decryptedHeader.buffer,
        decryptedHeader.byteOffset + fsHeaderOffset,
        Math.min(0x200, decryptedHeader.byteLength - fsHeaderOffset)
      );
      // Version at 0x00, FsType at 0x02, EncryptionType at 0x04
      fsType = fsView.getUint8(0x02) as NcaFsType;
      encryptionType = fsView.getUint8(0x04) as NcaEncryptionType;
      generation = fsView.getUint8(0x05);
    }

    header.fsEntries.push({
      startOffset: startOffset * MEDIA_UNIT,
      endOffset: endOffset * MEDIA_UNIT,
      fsType,
      encryptionType,
      generation,
    });
  }

  const hasRightsId = header.rightsId.some(b => b !== 0);

  return { header, encrypted: hasRightsId, raw: data };
}

export function getNcaTitleId(header: NcaHeader): string {
  return header.titleId.toString(16).padStart(16, '0');
}
