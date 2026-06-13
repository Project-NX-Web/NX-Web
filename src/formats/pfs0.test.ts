import { describe, it, expect } from 'vitest';
import { parsePfs0, extractPfs0File } from './pfs0';

function buildPfs0Buffer(files: { name: string; data: Uint8Array }[]): Uint8Array {
  // Build string table
  let stringTable = '';
  const stringOffsets: number[] = [];
  for (const file of files) {
    stringOffsets.push(stringTable.length);
    stringTable += file.name + '\0';
  }
  const stringTableBytes = new TextEncoder().encode(stringTable);

  const FILE_ENTRY_SIZE = 0x18;
  const headerSize = 0x10 + files.length * FILE_ENTRY_SIZE + stringTableBytes.length;

  // Calculate total data size
  let totalData = 0;
  for (const f of files) totalData += f.data.length;

  const buffer = new Uint8Array(headerSize + totalData);
  const view = new DataView(buffer.buffer);

  // Magic
  buffer[0] = 0x50; buffer[1] = 0x46; buffer[2] = 0x53; buffer[3] = 0x30; // "PFS0"
  view.setUint32(0x04, files.length, true);
  view.setUint32(0x08, stringTableBytes.length, true);
  // 0x0C: padding

  // File entries
  let dataOffset = 0;
  for (let i = 0; i < files.length; i++) {
    const entryBase = 0x10 + i * FILE_ENTRY_SIZE;
    view.setBigUint64(entryBase, BigInt(dataOffset), true);         // offset
    view.setBigUint64(entryBase + 0x08, BigInt(files[i].data.length), true); // size
    view.setUint32(entryBase + 0x10, stringOffsets[i], true);       // string offset
    dataOffset += files[i].data.length;
  }

  // String table
  buffer.set(stringTableBytes, 0x10 + files.length * FILE_ENTRY_SIZE);

  // File data
  let writeOffset = headerSize;
  for (const f of files) {
    buffer.set(f.data, writeOffset);
    writeOffset += f.data.length;
  }

  return buffer;
}

describe('PFS0 Parser', () => {
  it('parses a PFS0 with multiple files', () => {
    const testFiles = [
      { name: 'test.nca', data: new Uint8Array([1, 2, 3, 4]) },
      { name: 'title.tik', data: new Uint8Array([5, 6, 7]) },
      { name: 'cert.cert', data: new Uint8Array([8, 9]) },
    ];

    const buffer = buildPfs0Buffer(testFiles);
    const pfs0 = parsePfs0(buffer);

    expect(pfs0.files.length).toBe(3);
    expect(pfs0.files[0].name).toBe('test.nca');
    expect(pfs0.files[0].size).toBe(4);
    expect(pfs0.files[1].name).toBe('title.tik');
    expect(pfs0.files[1].size).toBe(3);
    expect(pfs0.files[2].name).toBe('cert.cert');
    expect(pfs0.files[2].size).toBe(2);
  });

  it('extracts file data correctly', () => {
    const testFiles = [
      { name: 'a.bin', data: new Uint8Array([0xAA, 0xBB, 0xCC]) },
      { name: 'b.bin', data: new Uint8Array([0xDD, 0xEE]) },
    ];

    const buffer = buildPfs0Buffer(testFiles);
    const pfs0 = parsePfs0(buffer);

    const aData = extractPfs0File(pfs0, pfs0.files[0]);
    expect(aData).toEqual(new Uint8Array([0xAA, 0xBB, 0xCC]));

    const bData = extractPfs0File(pfs0, pfs0.files[1]);
    expect(bData).toEqual(new Uint8Array([0xDD, 0xEE]));
  });

  it('rejects invalid magic', () => {
    const buffer = new Uint8Array(64);
    buffer[0] = 0x00;
    expect(() => parsePfs0(buffer)).toThrow('Invalid PFS0 magic');
  });

  it('handles empty PFS0', () => {
    const buffer = buildPfs0Buffer([]);
    const pfs0 = parsePfs0(buffer);
    expect(pfs0.files.length).toBe(0);
  });
});
