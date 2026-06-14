import { afterEach, describe, expect, it } from 'vitest';
import { StorageManager } from './storage-manager';

class FakeFile {
  constructor(private readonly data: Uint8Array) {}

  async arrayBuffer(): Promise<ArrayBuffer> {
    const copy = new Uint8Array(this.data);
    return copy.buffer as ArrayBuffer;
  }
}

class FakeWritable {
  private chunks: Uint8Array[] = [];

  constructor(private readonly file: FakeFileHandle) {}

  async write(data: BufferSource): Promise<void> {
    this.chunks.push(new Uint8Array(data as ArrayBuffer));
  }

  async close(): Promise<void> {
    const length = this.chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const data = new Uint8Array(length);
    let offset = 0;
    for (const chunk of this.chunks) {
      data.set(chunk, offset);
      offset += chunk.length;
    }
    this.file.data = data;
  }
}

class FakeFileHandle {
  data: Uint8Array;

  constructor(data: Uint8Array = new Uint8Array()) {
    this.data = data;
  }

  async getFile(): Promise<FakeFile> {
    return new FakeFile(this.data);
  }

  async createWritable(): Promise<FakeWritable> {
    return new FakeWritable(this);
  }
}

class FakeDirectoryHandle {
  readonly files = new Map<string, FakeFileHandle>();
  readonly directories = new Map<string, FakeDirectoryHandle>();

  async getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<FakeDirectoryHandle> {
    const existing = this.directories.get(name);
    if (existing) return existing;
    if (options?.create) {
      const created = new FakeDirectoryHandle();
      this.directories.set(name, created);
      return created;
    }
    throw new Error(`Missing directory: ${name}`);
  }

  async getFileHandle(name: string, options?: { create?: boolean }): Promise<FakeFileHandle> {
    const existing = this.files.get(name);
    if (existing) return existing;
    if (options?.create) {
      const created = new FakeFileHandle();
      this.files.set(name, created);
      return created;
    }
    throw new Error(`Missing file: ${name}`);
  }

  async removeEntry(name: string): Promise<void> {
    this.files.delete(name);
    this.directories.delete(name);
  }

  async *entries(): AsyncIterableIterator<[string, unknown]> {
    for (const name of this.directories.keys()) yield [name, {}];
    for (const name of this.files.keys()) yield [name, {}];
  }
}

class FakeStorageManager {
  constructor(readonly root: FakeDirectoryHandle) {}

  async getDirectory(): Promise<FakeDirectoryHandle> {
    return this.root;
  }
}

describe('StorageManager OPFS wrapper', () => {
  const originalNavigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');

  afterEach(() => {
    if (originalNavigatorDescriptor) {
      Object.defineProperty(globalThis, 'navigator', originalNavigatorDescriptor);
    } else {
      delete (globalThis as { navigator?: Navigator }).navigator;
    }
  });

  it('round-trips files through the OPFS namespace API', async () => {
    const root = new FakeDirectoryHandle();
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { storage: new FakeStorageManager(root) },
    });
    const storage = new StorageManager();
    await storage.init();

    const data = new Uint8Array([1, 2, 3, 4, 5]);
    await storage.writeFile('saves/0100000000000001', 'progress.sav', data);

    expect(await storage.readFile('saves/0100000000000001', 'progress.sav')).toEqual(data);
    expect(await storage.listDir('saves/0100000000000001', '')).toContain('progress.sav');

    await storage.deleteFile('saves/0100000000000001', 'progress.sav');
    expect(await storage.readFile('saves/0100000000000001', 'progress.sav')).toBeNull();
  });

  it('creates nested OPFS paths for writes and lists nested directories', async () => {
    const root = new FakeDirectoryHandle();
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { storage: new FakeStorageManager(root) },
    });
    const storage = new StorageManager();
    await storage.init();

    const data = new Uint8Array([9, 8, 7]);
    await storage.writeFile('saves/0100000000000001', 'slots/slot-0/save.dat', data);

    expect(await storage.readFile('saves/0100000000000001', 'slots/slot-0/save.dat')).toEqual(data);
    expect(await storage.listDir('saves/0100000000000001', 'slots')).toEqual(['slot-0']);
    expect(await storage.listDir('saves/0100000000000001', 'slots/slot-0')).toEqual(['save.dat']);

    await storage.deleteFile('saves/0100000000000001', 'slots/slot-0/save.dat');
    expect(await storage.readFile('saves/0100000000000001', 'slots/slot-0/save.dat')).toBeNull();
  });

  it('rejects path traversal in OPFS paths', async () => {
    const root = new FakeDirectoryHandle();
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { storage: new FakeStorageManager(root) },
    });
    const storage = new StorageManager();
    await storage.init();

    await expect(storage.writeFile('saves/0100000000000001', '../secret.dat', new Uint8Array([1]))).rejects.toThrow('Invalid path traversal');
  });
});
