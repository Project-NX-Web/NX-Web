import { describe, it, expect } from 'vitest';
import { VirtualFileSystem } from './vfs';

describe('VirtualFileSystem', () => {
  it('mounts RomFS and enumerates files', () => {
    const vfs = new VirtualFileSystem();
    const files = new Map<string, Uint8Array>();
    files.set('data/config.ini', new Uint8Array([1, 2, 3]));
    files.set('data/levels/level1.bin', new Uint8Array([4, 5, 6, 7]));
    files.set('icon.png', new Uint8Array([8, 9]));

    vfs.mountRomFs(files);

    expect(vfs.exists('romfs')).toBe(true);
    expect(vfs.exists('romfs/data')).toBe(true);
    expect(vfs.exists('romfs/data/config.ini')).toBe(true);
    expect(vfs.exists('romfs/icon.png')).toBe(true);
  });

  it('opens, reads, and closes files', () => {
    const vfs = new VirtualFileSystem();
    const files = new Map<string, Uint8Array>();
    const testData = new Uint8Array([10, 20, 30, 40, 50]);
    files.set('test.bin', testData);

    vfs.mountRomFs(files);

    const fd = vfs.open('romfs/test.bin');
    expect(fd).toBeGreaterThan(0);

    const data = vfs.read(fd, 3);
    expect(data).toEqual(new Uint8Array([10, 20, 30]));

    const rest = vfs.read(fd, 10);
    expect(rest).toEqual(new Uint8Array([40, 50]));

    expect(vfs.close(fd)).toBe(true);
  });

  it('mounts zero-size RomFS files for enumeration', () => {
    const vfs = new VirtualFileSystem();
    const files = new Map<string, Uint8Array>();
    files.set('empty.txt', new Uint8Array(0));

    vfs.mountRomFs(files);

    expect(vfs.exists('romfs/empty.txt')).toBe(true);
    const fd = vfs.open('romfs/empty.txt');
    expect(vfs.getSize(fd)).toBe(0);
    expect(vfs.read(fd, 1)).toEqual(new Uint8Array(0));
  });

  it('writes to save data files', () => {
    const vfs = new VirtualFileSystem();
    vfs.mountSaveData('0100000000000001');

    vfs.createFile('save_0100000000000001/progress.sav', new Uint8Array(0));

    const fd = vfs.open('save_0100000000000001/progress.sav');
    expect(fd).toBeGreaterThan(0);

    const saveData = new Uint8Array([0xDE, 0xAD, 0xBE, 0xEF]);
    const written = vfs.write(fd, saveData);
    expect(written).toBe(4);

    vfs.seek(fd, 0);
    const read = vfs.read(fd, 4);
    expect(read).toEqual(saveData);

    vfs.close(fd);
  });

  it('lists directory contents', () => {
    const vfs = new VirtualFileSystem();
    const files = new Map<string, Uint8Array>();
    files.set('a.txt', new Uint8Array([1]));
    files.set('b.txt', new Uint8Array([2]));
    files.set('sub/c.txt', new Uint8Array([3]));

    vfs.mountRomFs(files);

    const rootContents = vfs.listDirectory('romfs');
    expect(rootContents).toContain('a.txt');
    expect(rootContents).toContain('b.txt');
    expect(rootContents).toContain('sub');
  });

  it('returns -1 for non-existent file open', () => {
    const vfs = new VirtualFileSystem();
    const fd = vfs.open('nonexistent/path');
    expect(fd).toBe(-1);
  });

  it('rejects writes to directories and negative seeks', () => {
    const vfs = new VirtualFileSystem();
    const files = new Map<string, Uint8Array>();
    files.set('file.bin', new Uint8Array([1]));
    vfs.mountRomFs(files);

    const directoryFd = vfs.open('romfs');
    expect(directoryFd).toBeGreaterThan(0);
    expect(vfs.write(directoryFd, new Uint8Array([1]))).toBe(-1);

    const fileFd = vfs.open('romfs/file.bin');
    expect(fileFd).toBeGreaterThan(0);
    expect(vfs.seek(fileFd, -1)).toBe(false);
  });

  it('reports file size correctly', () => {
    const vfs = new VirtualFileSystem();
    const files = new Map<string, Uint8Array>();
    files.set('large.bin', new Uint8Array(1024));
    vfs.mountRomFs(files);

    const fd = vfs.open('romfs/large.bin');
    expect(vfs.getSize(fd)).toBe(1024);
    vfs.close(fd);
  });
});
