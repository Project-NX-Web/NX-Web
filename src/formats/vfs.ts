// Virtual Filesystem — presents a unified view of RomFS, SaveData, and SdCard
// Each file has a numeric handle (INode-style addressing).

export enum VfsEntryType {
  File = 0,
  Directory = 1,
}

export interface VfsEntry {
  name: string;
  type: VfsEntryType;
  size: number;
  data: Uint8Array | null;    // null for directories
  children: Map<string, number>; // name → handle (for directories)
  parent: number;             // parent handle, -1 for root
}

export class VirtualFileSystem {
  private entries: Map<number, VfsEntry> = new Map();
  private nextHandle = 1;
  private openHandles: Map<number, { entryHandle: number; position: number }> = new Map();
  private nextFd = 100;

  constructor() {
    // Create root directory
    this.entries.set(0, {
      name: '/',
      type: VfsEntryType.Directory,
      size: 0,
      data: null,
      children: new Map(),
      parent: -1,
    });
  }

  mountRomFs(files: Map<string, Uint8Array>): number {
    const romfsHandle = this.createDirectory(0, 'romfs');

    for (const [path, data] of files) {
      this.createFileAtPath(romfsHandle, path, data);
    }

    return romfsHandle;
  }

  mountSaveData(titleId: string): number {
    return this.createDirectory(0, `save_${titleId}`);
  }

  private createDirectory(parentHandle: number, name: string): number {
    const parent = this.entries.get(parentHandle);
    if (!parent || parent.type !== VfsEntryType.Directory) {
      throw new Error(`Parent handle ${parentHandle} is not a directory`);
    }

    // Return existing if already mounted
    const existing = parent.children.get(name);
    if (existing !== undefined) return existing;

    const handle = this.nextHandle++;
    const entry: VfsEntry = {
      name,
      type: VfsEntryType.Directory,
      size: 0,
      data: null,
      children: new Map(),
      parent: parentHandle,
    };

    this.entries.set(handle, entry);
    parent.children.set(name, handle);
    return handle;
  }

  private createFileAtPath(rootHandle: number, path: string, data: Uint8Array): number {
    const parts = path.split('/').filter(p => p.length > 0);
    const fileName = parts.pop();
    if (!fileName) throw new Error('Empty file path');

    let currentHandle = rootHandle;
    for (const dir of parts) {
      const current = this.entries.get(currentHandle)!;
      const existing = current.children.get(dir);
      if (existing !== undefined) {
        currentHandle = existing;
      } else {
        currentHandle = this.createDirectory(currentHandle, dir);
      }
    }

    const handle = this.nextHandle++;
    const entry: VfsEntry = {
      name: fileName,
      type: VfsEntryType.File,
      size: data.length,
      data,
      children: new Map(),
      parent: currentHandle,
    };

    this.entries.set(handle, entry);
    const parent = this.entries.get(currentHandle)!;
    parent.children.set(fileName, handle);
    return handle;
  }

  open(path: string): number {
    const handle = this.resolvePath(path);
    if (handle === null) return -1;

    const fd = this.nextFd++;
    this.openHandles.set(fd, { entryHandle: handle, position: 0 });
    return fd;
  }

  close(fd: number): boolean {
    return this.openHandles.delete(fd);
  }

  read(fd: number, length: number): Uint8Array | null {
    const handle = this.openHandles.get(fd);
    if (!handle) return null;

    const entry = this.entries.get(handle.entryHandle);
    if (!entry || !entry.data) return null;

    const available = Math.min(length, entry.size - handle.position);
    if (available <= 0) return new Uint8Array(0);

    const result = entry.data.slice(handle.position, handle.position + available);
    handle.position += available;
    return result;
  }

  write(fd: number, data: Uint8Array): number {
    const handle = this.openHandles.get(fd);
    if (!handle) return -1;

    const entry = this.entries.get(handle.entryHandle);
    if (!entry) return -1;

    // Expand file if needed
    const newSize = Math.max(entry.size, handle.position + data.length);
    const newData = new Uint8Array(newSize);
    if (entry.data) newData.set(entry.data);
    newData.set(data, handle.position);

    entry.data = newData;
    entry.size = newSize;
    handle.position += data.length;
    return data.length;
  }

  seek(fd: number, offset: number): boolean {
    const handle = this.openHandles.get(fd);
    if (!handle) return false;
    handle.position = offset;
    return true;
  }

  getSize(fd: number): number {
    const handle = this.openHandles.get(fd);
    if (!handle) return -1;
    const entry = this.entries.get(handle.entryHandle);
    return entry?.size ?? -1;
  }

  listDirectory(path: string): string[] {
    const handle = this.resolvePath(path);
    if (handle === null) return [];

    const entry = this.entries.get(handle);
    if (!entry || entry.type !== VfsEntryType.Directory) return [];

    return Array.from(entry.children.keys());
  }

  exists(path: string): boolean {
    return this.resolvePath(path) !== null;
  }

  private resolvePath(path: string): number | null {
    const parts = path.split('/').filter(p => p.length > 0);
    let current = 0; // root

    for (const part of parts) {
      const entry = this.entries.get(current);
      if (!entry || entry.type !== VfsEntryType.Directory) return null;

      const childHandle = entry.children.get(part);
      if (childHandle === undefined) return null;
      current = childHandle;
    }

    return current;
  }

  createFile(path: string, data: Uint8Array): number {
    const parts = path.split('/').filter(p => p.length > 0);
    const fileName = parts.pop();
    if (!fileName) return -1;

    let currentHandle = 0;
    for (const dir of parts) {
      const current = this.entries.get(currentHandle)!;
      const existing = current.children.get(dir);
      if (existing !== undefined) {
        currentHandle = existing;
      } else {
        currentHandle = this.createDirectory(currentHandle, dir);
      }
    }

    return this.createFileAtPath(currentHandle, fileName, data);
  }
}
