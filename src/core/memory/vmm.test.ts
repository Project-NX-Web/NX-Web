import { describe, it, expect } from 'vitest';
import { VirtualMemoryManager, MemoryPermission, MemoryFault, PAGE_SIZE } from './vmm';

describe('VirtualMemoryManager', () => {
  it('maps and reads/writes memory correctly', () => {
    const vmm = new VirtualMemoryManager();
    const addr = 0x10000000n;

    vmm.mapMemory(addr, PAGE_SIZE, MemoryPermission.ReadWrite);

    vmm.write32(addr, 0xdeadbeef);
    expect(vmm.read32(addr)).toBe(0xdeadbeef);

    vmm.write8(addr + 4n, 0x42);
    expect(vmm.read8(addr + 4n)).toBe(0x42);

    vmm.write16(addr + 6n, 0x1234);
    expect(vmm.read16(addr + 6n)).toBe(0x1234);
  });

  it('handles 64-bit read/write', () => {
    const vmm = new VirtualMemoryManager();
    const addr = 0x48000000n;

    vmm.mapMemory(addr, PAGE_SIZE, MemoryPermission.ReadWrite);

    const value = 0x123456789abcdef0n;
    vmm.write64(addr, value);
    expect(vmm.read64(addr)).toBe(value);
  });

  it('throws MemoryFault on unmapped access', () => {
    const vmm = new VirtualMemoryManager();
    const addr = 0x99000000n;

    expect(() => vmm.read32(addr)).toThrow(MemoryFault);
  });

  it('unmaps memory correctly', () => {
    const vmm = new VirtualMemoryManager();
    const addr = 0x20000000n;

    vmm.mapMemory(addr, PAGE_SIZE, MemoryPermission.ReadWrite);
    expect(vmm.isAddressMapped(addr)).toBe(true);

    vmm.unmapMemory(addr, PAGE_SIZE);
    expect(vmm.isAddressMapped(addr)).toBe(false);
    expect(() => vmm.read32(addr)).toThrow(MemoryFault);
  });

  it('maps multiple pages for large allocations', () => {
    const vmm = new VirtualMemoryManager();
    const addr = 0x30000000n;
    const size = PAGE_SIZE * 4;

    vmm.mapMemory(addr, size, MemoryPermission.ReadWrite);

    // Write to first and last page
    vmm.write32(addr, 0x11111111);
    vmm.write32(addr + BigInt(size - 4), 0x22222222);

    expect(vmm.read32(addr)).toBe(0x11111111);
    expect(vmm.read32(addr + BigInt(size - 4))).toBe(0x22222222);
  });

  it('writes and reads byte arrays', () => {
    const vmm = new VirtualMemoryManager();
    const addr = 0x40000000n;

    vmm.mapMemory(addr, PAGE_SIZE, MemoryPermission.ReadWrite);

    const data = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    vmm.writeBytes(addr, data);

    const read = vmm.readBytes(addr, 8);
    expect(read).toEqual(data);
  });
});
