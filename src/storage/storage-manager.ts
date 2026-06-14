export class StorageManager {
  private root: FileSystemDirectoryHandle | null = null;

  async init(): Promise<void> {
    this.root = await navigator.storage.getDirectory();
  }

  private async getNamespaceDir(namespace: string): Promise<FileSystemDirectoryHandle> {
    if (!this.root) throw new Error('StorageManager not initialized');
    const parts = this.normalizePath(namespace);
    let dir = this.root;
    for (const part of parts) {
      dir = await dir.getDirectoryHandle(part, { create: true });
    }
    return dir;
  }

  private normalizePath(path: string): string[] {
    const parts = path.split('/').filter((part) => part.length > 0);
    if (parts.includes('..')) {
      throw new Error(`Invalid path traversal in "${path}"`);
    }
    return parts;
  }

  private async getDirectoryAtPath(
    root: FileSystemDirectoryHandle,
    path: string,
    create = false
  ): Promise<FileSystemDirectoryHandle> {
    const parts = this.normalizePath(path);
    let dir = root;
    for (const part of parts) {
      dir = await dir.getDirectoryHandle(part, { create });
    }
    return dir;
  }

  private async getFileHandleAtPath(
    namespace: string,
    path: string,
    create = false
  ): Promise<FileSystemFileHandle> {
    const parts = this.normalizePath(path);
    if (parts.length === 0) throw new Error('File path must not be empty');

    const fileName = parts[parts.length - 1];
    const directoryPath = parts.slice(0, -1).join('/');
    const dir = await this.getDirectoryAtPath(await this.getNamespaceDir(namespace), directoryPath, create);
    return dir.getFileHandle(fileName, { create });
  }

  async readFile(namespace: string, path: string): Promise<Uint8Array | null> {
    try {
      const fileHandle = await this.getFileHandleAtPath(namespace, path);
      const file = await fileHandle.getFile();
      const buffer = await file.arrayBuffer();
      return new Uint8Array(buffer);
    } catch {
      return null;
    }
  }

  async writeFile(namespace: string, path: string, data: Uint8Array): Promise<void> {
    const fileHandle = await this.getFileHandleAtPath(namespace, path, true);
    const writable = await fileHandle.createWritable();
    // Copy into a plain ArrayBuffer to satisfy strict TS typing (Uint8Array<ArrayBufferLike> vs ArrayBuffer).
    const copy = new Uint8Array(data.length);
    copy.set(data);
    await writable.write(copy.buffer as ArrayBuffer);
    await writable.close();
  }

  async listDir(namespace: string, path: string): Promise<string[]> {
    try {
      const dir = await this.getDirectoryAtPath(await this.getNamespaceDir(namespace), path);
      const entries: string[] = [];
      for await (const [name] of (dir as any).entries()) {
        entries.push(name);
      }
      return entries;
    } catch {
      return [];
    }
  }

  async deleteFile(namespace: string, path: string): Promise<void> {
    try {
      const parts = this.normalizePath(path);
      if (parts.length === 0) throw new Error('File path must not be empty');

      const fileName = parts[parts.length - 1];
      const directoryPath = parts.slice(0, -1).join('/');
      const dir = await this.getDirectoryAtPath(await this.getNamespaceDir(namespace), directoryPath);
      await dir.removeEntry(fileName);
    } catch {
      // File doesn't exist — no-op
    }
  }
}
