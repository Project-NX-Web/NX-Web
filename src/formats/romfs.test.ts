import { describe, expect, it } from 'vitest';
import { parseRomFs } from './romfs';

function align4(value: number): number {
  return (value + 3) & ~3;
}

function encodeText(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

interface DirInfo {
  path: string;
  parentPath: string;
  name: string;
}

function buildDirInfos(files: { path: string; data: Uint8Array }[]): DirInfo[] {
  const dirs = new Map<string, DirInfo>([['', { path: '', parentPath: '', name: '' }]]);

  for (const file of files) {
    const parts = file.path.split('/').filter(Boolean);
    let parentPath = '';
    for (const part of parts.slice(0, -1)) {
      const dirPath = parentPath ? `${parentPath}/${part}` : part;
      if (!dirs.has(dirPath)) {
        dirs.set(dirPath, {
          path: dirPath,
          parentPath,
          name: part,
        });
      }
      parentPath = dirPath;
    }
  }

  return Array.from(dirs.values()).sort((a, b) => a.path.length - b.path.length);
}

function buildRomFsFixture(files: { path: string; data: Uint8Array }[]): Uint8Array {
  const dirMetaOffset = 0x50;
  const fileMetaOffset = 0x100;
  const dataOffset = 0x200;
  const dirInfos = buildDirInfos(files);
  const dirOffsets = new Map<string, number>();

  let dirOffset = 0;
  for (const dir of dirInfos) {
    dirOffsets.set(dir.path, dirOffset);
    dirOffset += align4(0x18 + dir.name.length);
  }

  const fileEntries = files.map((file) => {
    const parts = file.path.split('/').filter(Boolean);
    return {
      ...file,
      name: parts[parts.length - 1],
      parentDirOffset: dirOffsets.get(parts.slice(0, -1).join('/')) ?? 0,
    };
  });

  const fileEntrySize = (name: string) => align4(0x20 + name.length);
  const fileTableSize = fileEntries.reduce((sum, file) => sum + fileEntrySize(file.name), 0);
  if (fileMetaOffset + fileTableSize > dataOffset) {
    throw new Error('Fixture metadata table exceeds data offset');
  }

  const buffer = new Uint8Array(dataOffset + files.reduce((sum, file) => sum + file.data.length, 0));
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);

  view.setBigUint64(0x00, BigInt(0x30), true);
  view.setBigUint64(0x08, 0n, true);
  view.setBigUint64(0x10, 0n, true);
  view.setBigUint64(0x18, BigInt(dirMetaOffset), true);
  view.setBigUint64(0x20, BigInt(dirOffset), true);
  view.setBigUint64(0x28, 0n, true);
  view.setBigUint64(0x30, 0n, true);
  view.setBigUint64(0x38, BigInt(fileMetaOffset), true);
  view.setBigUint64(0x40, BigInt(fileTableSize), true);
  view.setBigUint64(0x48, BigInt(dataOffset), true);

  for (const dir of dirInfos) {
    const entryOffset = dirMetaOffset + (dirOffsets.get(dir.path) ?? 0);
    view.setUint32(entryOffset + 0x00, dirOffsets.get(dir.parentPath) ?? 0, true);
    view.setUint32(entryOffset + 0x04, 0, true);
    view.setUint32(entryOffset + 0x08, 0, true);
    view.setUint32(entryOffset + 0x0C, 0, true);
    view.setUint32(entryOffset + 0x10, 0, true);
    view.setUint32(entryOffset + 0x14, dir.name.length, true);
    buffer.set(encodeText(dir.name), entryOffset + 0x18);
  }

  let fileOffset = fileMetaOffset;
  let dataWriteOffset = dataOffset;
  for (const file of fileEntries) {
    view.setUint32(fileOffset + 0x00, file.parentDirOffset, true);
    view.setUint32(fileOffset + 0x04, 0, true);
    view.setBigUint64(fileOffset + 0x08, BigInt(dataWriteOffset - dataOffset), true);
    view.setBigUint64(fileOffset + 0x10, BigInt(file.data.length), true);
    view.setUint32(fileOffset + 0x18, 0, true);
    view.setUint32(fileOffset + 0x1C, file.name.length, true);
    buffer.set(encodeText(file.name), fileOffset + 0x20);

    buffer.set(file.data, dataWriteOffset);
    dataWriteOffset += file.data.length;
    fileOffset += fileEntrySize(file.name);
  }

  return buffer;
}

describe('RomFS parser', () => {
  it('parses nested files from a RomFS fixture', () => {
    const files = parseRomFs(buildRomFsFixture([
      { path: 'data/a.txt', data: new Uint8Array([1, 2, 3]) },
      { path: 'data/sub/b.bin', data: new Uint8Array([4, 5]) },
    ]));

    expect(Array.from(files.keys()).sort()).toEqual(['data/a.txt', 'data/sub/b.bin']);
    expect(files.get('data/a.txt')).toEqual(new Uint8Array([1, 2, 3]));
    expect(files.get('data/sub/b.bin')).toEqual(new Uint8Array([4, 5]));
  });

  it('includes zero-size files', () => {
    const files = parseRomFs(buildRomFsFixture([
      { path: 'empty.txt', data: new Uint8Array(0) },
    ]));

    expect(files.has('empty.txt')).toBe(true);
    expect(files.get('empty.txt')).toEqual(new Uint8Array(0));
  });
});
