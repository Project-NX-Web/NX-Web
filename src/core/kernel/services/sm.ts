// Horizon OS HLE Kernel — Service Manager (sm)
// Handles service registration and lookup.

import type { ServiceCommandHandler } from './types';

export interface ServiceSession {
  id: number;
  name: string;
}

export interface RegisteredService extends ServiceSession {
  registeredAt: number;
  handler?: ServiceCommandHandler;
}

export class ServiceManager {
  private services = new Map<string, RegisteredService>();
  private nextId = 1;
  private nextSessionId = 1;

  registerService(name: string, handler?: ServiceCommandHandler): number {
    const existing = this.services.get(name);
    if (existing) {
      if (handler !== undefined) {
        existing.handler = handler;
      }
      return existing.id;
    }

    const id = this.nextId++;
    this.services.set(name, {
      id,
      name,
      registeredAt: this.nextSessionId++,
      handler,
    });
    return id;
  }

  getService(name: string): number | null {
    return this.services.get(name)?.id ?? null;
  }

  getServiceRecord(name: string): RegisteredService | undefined {
    return this.services.get(name);
  }

  hasService(name: string): boolean {
    return this.services.has(name);
  }

  listServices(): RegisteredService[] {
    return [...this.services.values()];
  }
}
