// Horizon OS HLE Kernel — Service Manager (sm)
// Handles service registration and lookup.

export interface ServiceSession {
  id: number;
  name: string;
}

export class ServiceManager {
  private services: Map<string, number> = new Map();
  private nextHandle = 1;

  registerService(name: string): number {
    const handle = this.nextHandle++;
    this.services.set(name, handle);
    return handle;
  }

  getService(name: string): number | null {
    return this.services.get(name) ?? null;
  }

  hasService(name: string): boolean {
    return this.services.has(name);
  }
}
