// RomFS parser — reads the RomFS filesystem embedded in NCAs
// RomFS uses a header + directory/file metadata tables + file data region

export interface RomFsHeader {
  headerSize: bigint;
  dirHashTableOffset: bigint;
  dirHashTableSize: bigint;
  dirMetaTableOffset: bigint;
  dirMetaTableSize: bigint;
  fileHashTableOffset: bigint;
  fileHashTableSize: bigint;
  fileMetaTableOffset: bigint;
  fileMetaTableSize: bigint;
  dataOffset: bigint;
}

export interface RomFsEntry {
  path: string;
  offset: number;
  size: number;
}

export function parseRomFs(data: Uint8Array): Map<string, Uint8Array> {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const files = new Map<string, Uint8Array>();

  const header: RomFsHeader = {
    headerSize: view.getBigUint64(0x00, true),
    dirHashTableOffset: view.getBigUint64(0x08, true),
    dirHashTableSize: view.getBigUint64(0x10, true),
    dirMetaTableOffset: view.getBigUint64(0x18, true),
    dirMetaTableSize: view.getBigUint64(0x20, true),
    fileHashTableOffset: view.getBigUint64(0x28, true),
    fileHashTableSize: view.getBigUint64(0x30, true),
    fileMetaTableOffset: view.getBigUint64(0x38, true),
    fileMetaTableSize: view.getBigUint64(0x40, true),
    dataOffset: view.getBigUint64(0x48, true),
  };

  const dirMetaOffset = Number(header.dirMetaTableOffset);
  const fileMetaOffset = Number(header.fileMetaTableOffset);
  const fileDataOffset = Number(header.dataOffset);

  // Build directory name map
  const dirNames = new Map<number, string>(); // offset → full path
  parseDirTable(data, dirMetaOffset, Number(header.dirMetaTableSize), dirNames);

  // Parse file table. Some minimal fixtures omit fileMetaTableSize; infer it from the data region.
  const fileMetaTableSize = Number(header.fileMetaTableSize) || Math.max(0, fileDataOffset - fileMetaOffset);
  parseFileTable(data, fileMetaOffset, fileMetaTableSize, fileDataOffset, dirNames, files);

  return files;
}

function parseDirTable(
  data: Uint8Array,
  tableOffset: number,
  tableSize: number,
  dirNames: Map<number, string>
): void {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let offset = 0;

  // Root directory
  dirNames.set(0, '');

  while (offset < tableSize) {
    const absOffset = tableOffset + offset;
    if (absOffset + 0x18 > data.length) break;

    const parentOffset = view.getUint32(absOffset + 0x00, true);
    // sibling at +0x04, childDir at +0x08, childFile at +0x0C
    // hash next at +0x10
    const nameLen = view.getUint32(absOffset + 0x14, true);

    let name = '';
    if (nameLen > 0 && absOffset + 0x18 + nameLen <= data.length) {
      name = new TextDecoder().decode(data.slice(absOffset + 0x18, absOffset + 0x18 + nameLen));
    }

    if (offset > 0) {
      const parentPath = dirNames.get(parentOffset) ?? '';
      dirNames.set(offset, parentPath ? `${parentPath}/${name}` : name);
    }

    // Advance to next entry (aligned to 4 bytes)
    const entrySize = 0x18 + nameLen;
    offset += (entrySize + 3) & ~3;
  }
}

function parseFileTable(
  data: Uint8Array,
  tableOffset: number,
  tableSize: number,
  fileDataOffset: number,
  dirNames: Map<number, string>,
  files: Map<string, Uint8Array>
): void {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let offset = 0;

  while (offset < tableSize) {
    const absOffset = tableOffset + offset;
    if (absOffset + 0x20 > data.length) break;

    const parentDirOffset = view.getUint32(absOffset + 0x00, true);
    // sibling at +0x04, dataOffset at +0x08 (8 bytes), dataSize at +0x10 (8 bytes), hash at +0x18
    const fileOffset = Number(view.getBigUint64(absOffset + 0x08, true));
    const fileSize = Number(view.getBigUint64(absOffset + 0x10, true));
    // hash next at +0x18
    const nameLen = view.getUint32(absOffset + 0x1C, true);

    let name = '';
    if (nameLen > 0 && absOffset + 0x20 + nameLen <= data.length) {
      name = new TextDecoder().decode(data.slice(absOffset + 0x20, absOffset + 0x20 + nameLen));
    }

    if (name) {
      const dirPath = dirNames.get(parentDirOffset) ?? '';
      const fullPath = dirPath ? `${dirPath}/${name}` : name;
      const absDataStart = fileDataOffset + fileOffset;

      if (absDataStart + fileSize <= data.length) {
        files.set(fullPath, data.slice(absDataStart, absDataStart + fileSize));
      }
    }

    const entrySize = 0x20 + nameLen;
    offset += (entrySize + 3) & ~3;
  }
}
