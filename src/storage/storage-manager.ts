export class StorageManager {
  private root: FileSystemDirectoryHandle | null = null;

  async init(): Promise<void> {
    this.root = await navigator.storage.getDirectory();
  }

  private async getNamespaceDir(namespace: string): Promise<FileSystemDirectoryHandle> {
    if (!this.root) throw new Error('StorageManager not initialized');
    const parts = namespace.split('/');
    let dir = this.root;
    for (const part of parts) {
      dir = await dir.getDirectoryHandle(part, { create: true });
    }
    return dir;
  }

  async readFile(namespace: string, path: string): Promise<Uint8Array | null> {
    try {
      const dir = await this.getNamespaceDir(namespace);
      const fileHandle = await dir.getFileHandle(path);
      const file = await fileHandle.getFile();
      const buffer = await file.arrayBuffer();
      return new Uint8Array(buffer);
    } catch {
      return null;
    }
  }

  async writeFile(namespace: string, path: string, data: Uint8Array): Promise<void> {
    const dir = await this.getNamespaceDir(namespace);
    const fileHandle = await dir.getFileHandle(path, { create: true });
    const writable = await fileHandle.createWritable();
    // Copy into a plain ArrayBuffer to satisfy strict TS typing (Uint8Array<ArrayBufferLike> vs ArrayBuffer)
    const copy = new Uint8Array(data.length);
    copy.set(data);
    await writable.write(copy.buffer as ArrayBuffer);
    await writable.close();
  }

  async listDir(namespace: string, path: string): Promise<string[]> {
    try {
      let dir = await this.getNamespaceDir(namespace);
      if (path) {
        const parts = path.split('/');
        for (const part of parts) {
          dir = await dir.getDirectoryHandle(part);
        }
      }
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
      const dir = await this.getNamespaceDir(namespace);
      await dir.removeEntry(path);
    } catch {
      // File doesn't exist — no-op
    }
  }
}
