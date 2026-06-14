import { describe, it, expect } from 'vitest';
import {
  BOOT_REGIONS,
  DEFAULT_BOOT_REGION_SIZES,
  MemoryFault,
  MemoryPermission,
  PAGE_SIZE,
  VirtualMemoryManager,
} from './vmm';

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

  it('enforces page permissions for read, write, and execute access', () => {
    const vmm = new VirtualMemoryManager();
    const readAddr = 0x10000000n;
    const writeAddr = 0x10001000n;
    const execAddr = 0x10002000n;

    vmm.mapMemory(readAddr, PAGE_SIZE, MemoryPermission.Read);
    vmm.mapMemory(writeAddr, PAGE_SIZE, MemoryPermission.Write);
    vmm.mapMemory(execAddr, PAGE_SIZE, MemoryPermission.Execute);

    expect(vmm.read32(readAddr)).toBe(0);
    expect(() => vmm.write32(readAddr, 1)).toThrow(MemoryFault);

    vmm.write32(writeAddr, 1);
    expect(() => vmm.read32(writeAddr)).toThrow(MemoryFault);

    expect(() => vmm.checkExecute(execAddr)).not.toThrow();
    expect(() => vmm.read32(execAddr)).toThrow(MemoryFault);
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

  it('maps all pages touched by an unaligned range', () => {
    const vmm = new VirtualMemoryManager();
    const addr = 0x10000001n;

    vmm.mapMemory(addr, PAGE_SIZE + 1, MemoryPermission.ReadWrite);

    expect(vmm.isAddressMapped(0x10000000n)).toBe(true);
    expect(vmm.isAddressMapped(0x10001000n)).toBe(true);
    vmm.writeBytes(addr, new Uint8Array(PAGE_SIZE + 1));
  });

  it('reads and writes across page boundaries', () => {
    const vmm = new VirtualMemoryManager();
    const addr = 0x10000ff0n;

    vmm.mapMemory(addr, PAGE_SIZE * 2, MemoryPermission.ReadWrite);
    vmm.write32(addr, 0x11111111);
    vmm.write32(addr + 4092n, 0x22222222);

    expect(vmm.read32(addr)).toBe(0x11111111);
    expect(vmm.read32(addr + 4092n)).toBe(0x22222222);
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

  it('provides Switch boot-region helpers', () => {
    const vmm = new VirtualMemoryManager();

    vmm.mapDefaultBootRegions();

    expect(vmm.isAddressMapped(BOOT_REGIONS.MainExecutable)).toBe(true);
    expect(vmm.getPagePermissions(BOOT_REGIONS.MainExecutable)).toBe(MemoryPermission.ReadExecute);
    expect(vmm.isAddressMapped(BOOT_REGIONS.Heap)).toBe(true);
    expect(vmm.getPagePermissions(BOOT_REGIONS.Heap)).toBe(MemoryPermission.ReadWrite);
    expect(vmm.isAddressMapped(BOOT_REGIONS.NroModule)).toBe(true);
    expect(vmm.getPagePermissions(BOOT_REGIONS.NroModule)).toBe(MemoryPermission.ReadExecute);
    expect(vmm.isAddressMapped(BOOT_REGIONS.Stack - 1n)).toBe(true);
    expect(vmm.getPagePermissions(BOOT_REGIONS.Stack - 1n)).toBe(MemoryPermission.ReadWrite);
    expect(DEFAULT_BOOT_REGION_SIZES.Stack).toBeGreaterThan(0);
  });

  it('grows the stack downward when lower stack pages are touched', () => {
    const vmm = new VirtualMemoryManager();
    const stackTop = BOOT_REGIONS.Stack - 1n;

    vmm.mapStack(PAGE_SIZE);
    expect(vmm.isAddressMapped(stackTop)).toBe(true);

    const lowerStackPage = BOOT_REGIONS.Stack - BigInt(PAGE_SIZE * 2);
    vmm.ensureStack(lowerStackPage, 1);

    expect(vmm.isAddressMapped(lowerStackPage)).toBe(true);
    expect(vmm.getPagePermissions(lowerStackPage)).toBe(MemoryPermission.ReadWrite);
    expect(() => vmm.ensureStack(0x10000000n, 1)).toThrow(MemoryFault);
  });

  it('throws execute faults for non-executable and unmapped pages', () => {
    const vmm = new VirtualMemoryManager();
    const dataPage = 0x48000000n;

    vmm.mapMemory(dataPage, PAGE_SIZE, MemoryPermission.ReadWrite);

    expect(() => vmm.checkExecute(dataPage)).toThrow(MemoryFault);
    expect(() => vmm.checkExecute(0x48001000n)).toThrow(MemoryFault);
  });
});
