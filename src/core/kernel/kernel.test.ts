import { describe, it, expect } from 'vitest';
import { ServiceManager } from './services/sm';

describe('ServiceManager', () => {
  it('registers and retrieves services', () => {
    const sm = new ServiceManager();

    const handle = sm.registerService('fsp-srv');
    expect(handle).toBeGreaterThan(0);

    const retrieved = sm.getService('fsp-srv');
    expect(retrieved).toBe(handle);
  });

  it('returns null for unknown services', () => {
    const sm = new ServiceManager();
    expect(sm.getService('unknown')).toBeNull();
  });

  it('assigns unique handles to different services', () => {
    const sm = new ServiceManager();

    const h1 = sm.registerService('sm');
    const h2 = sm.registerService('fsp-srv');
    const h3 = sm.registerService('hid');

    expect(h1).not.toBe(h2);
    expect(h2).not.toBe(h3);
    expect(h1).not.toBe(h3);
  });

  it('reports service existence', () => {
    const sm = new ServiceManager();
    sm.registerService('time');

    expect(sm.hasService('time')).toBe(true);
    expect(sm.hasService('missing')).toBe(false);
  });

  it('returns stable service records and lists registered services', () => {
    const sm = new ServiceManager();
    const first = sm.registerService('time');
    const duplicate = sm.registerService('time');
    const second = sm.registerService('hid');

    expect(duplicate).toBe(first);
    expect(sm.getServiceRecord('time')?.id).toBe(first);
    expect(sm.getServiceRecord('time')?.name).toBe('time');
    expect(sm.listServices().map((service) => service.id)).toEqual([first, second]);
  });
});
