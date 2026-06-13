// PFS0 (Partition File System) parser — used inside NSP containers
// Structure: "PFS0" magic | file count | string table size | padding | file entries | string table | file data

export interface Pfs0Entry {
  name: string;
  offset: number;    // Relative to data start
  size: number;
}

export interface Pfs0 {
  files: Pfs0Entry[];
  dataOffset: number;  // Absolute offset where file data begins
  raw: Uint8Array;     // Reference to original buffer for data extraction
}

export function parsePfs0(data: Uint8Array): Pfs0 {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

  const magic = String.fromCharCode(data[0], data[1], data[2], data[3]);
  if (magic !== 'PFS0') {
    throw new Error(`Invalid PFS0 magic: expected "PFS0", got "${magic}"`);
  }

  const fileCount = view.getUint32(0x04, true);
  const stringTableSize = view.getUint32(0x08, true);
  // 4 bytes padding at 0x0C

  const FILE_ENTRY_SIZE = 0x18; // 8 (offset) + 8 (size) + 4 (string offset) + 4 (padding)
  const entriesOffset = 0x10;
  const stringTableOffset = entriesOffset + fileCount * FILE_ENTRY_SIZE;
  const dataOffset = stringTableOffset + stringTableSize;

  const files: Pfs0Entry[] = [];

  for (let i = 0; i < fileCount; i++) {
    const entryBase = entriesOffset + i * FILE_ENTRY_SIZE;
    const fileOffset = Number(view.getBigUint64(entryBase, true));
    const fileSize = Number(view.getBigUint64(entryBase + 0x08, true));
    const nameOffset = view.getUint32(entryBase + 0x10, true);

    // Read null-terminated name from string table
    let nameEnd = stringTableOffset + nameOffset;
    while (nameEnd < dataOffset && data[nameEnd] !== 0) {
      nameEnd++;
    }
    const name = new TextDecoder().decode(data.slice(stringTableOffset + nameOffset, nameEnd));

    files.push({ name, offset: fileOffset, size: fileSize });
  }

  return { files, dataOffset, raw: data };
}

export function extractPfs0File(pfs0: Pfs0, entry: Pfs0Entry): Uint8Array {
  const start = pfs0.dataOffset + entry.offset;
  return pfs0.raw.slice(start, start + entry.size);
}
