// Virtual Memory Manager — software TLB for mapping Switch's 64-bit virtual
// address space into a browser-sized WASM physical RAM pool.

export const PAGE_SIZE = 4096;
export const PHYSICAL_RAM_SIZE = 256 * 1024 * 1024; // 256MB physical RAM pool

export const BOOT_REGIONS = {
  MainExecutable: 0x10000000n,
  Heap: 0x48000000n,
  NroModule: 0x7100000000n,
  Stack: 0xFF80000000n,
} as const;

export const DEFAULT_BOOT_REGION_SIZES = {
  MainExecutable: 32 * 1024 * 1024,
  Heap: 128 * 1024 * 1024,
  NroModule: 64 * 1024 * 1024,
  Stack: 8 * 1024 * 1024,
} as const;

export enum MemoryPermission {
  None = 0,
  Read = 1,
  Write = 2,
  Execute = 4,
  ReadWrite = 3,
  ReadExecute = 5,
  ReadWriteExecute = 7,
}

export interface PhysicalPage {
  offset: number; // Offset into the physical RAM ArrayBuffer
  permissions: MemoryPermission;
}

export class MemoryFault extends Error {
  constructor(
    public readonly virtualAddress: bigint,
    public readonly accessType: 'read' | 'write' | 'execute',
  ) {
    super(`Memory fault at 0x${virtualAddress.toString(16)} (${accessType})`);
  }
}

export class VirtualMemoryManager {
  private pageTable: Map<bigint, PhysicalPage> = new Map();
  private physicalMemory: ArrayBuffer;
  private physicalView: Uint8Array;
  private nextFreeOffset = 0;

  constructor() {
    this.physicalMemory = new ArrayBuffer(PHYSICAL_RAM_SIZE);
    this.physicalView = new Uint8Array(this.physicalMemory);
  }

  mapMemory(virtualAddr: bigint, size: number, perms: MemoryPermission): void {
    if (size <= 0) {
      return;
    }

    const basePageAddr = alignDown(virtualAddr);
    const endPageAddr = alignUp(virtualAddr + BigInt(size));
    const pageCount = Number((endPageAddr - basePageAddr) / BigInt(PAGE_SIZE));

    for (let i = 0; i < pageCount; i++) {
      const pageAddr = basePageAddr + BigInt(i * PAGE_SIZE);
      if (this.nextFreeOffset + PAGE_SIZE > PHYSICAL_RAM_SIZE) {
        throw new Error('Physical memory exhausted');
      }
      this.pageTable.set(pageAddr, {
        offset: this.nextFreeOffset,
        permissions: perms,
      });
      this.nextFreeOffset += PAGE_SIZE;
    }
  }

  mapDefaultBootRegions(): void {
    this.mapMemory(BOOT_REGIONS.MainExecutable, DEFAULT_BOOT_REGION_SIZES.MainExecutable, MemoryPermission.ReadExecute);
    this.mapMemory(BOOT_REGIONS.Heap, DEFAULT_BOOT_REGION_SIZES.Heap, MemoryPermission.ReadWrite);
    this.mapMemory(BOOT_REGIONS.NroModule, DEFAULT_BOOT_REGION_SIZES.NroModule, MemoryPermission.ReadExecute);
    this.mapStack(DEFAULT_BOOT_REGION_SIZES.Stack);
  }

  mapMainExecutable(size = DEFAULT_BOOT_REGION_SIZES.MainExecutable): void {
    this.mapMemory(BOOT_REGIONS.MainExecutable, size, MemoryPermission.ReadExecute);
  }

  mapHeap(size = DEFAULT_BOOT_REGION_SIZES.Heap): void {
    this.mapMemory(BOOT_REGIONS.Heap, size, MemoryPermission.ReadWrite);
  }

  mapNroModule(size = DEFAULT_BOOT_REGION_SIZES.NroModule): void {
    this.mapMemory(BOOT_REGIONS.NroModule, size, MemoryPermission.ReadExecute);
  }

  mapStack(size = DEFAULT_BOOT_REGION_SIZES.Stack, perms = MemoryPermission.ReadWrite): void {
    if (size <= 0) {
      throw new Error('Stack size must be positive');
    }
    this.mapMemory(BOOT_REGIONS.Stack - BigInt(size), size, perms);
  }

  ensureStack(address: bigint, size = 1, perms = MemoryPermission.ReadWrite): void {
    if (address < BOOT_REGIONS.Stack - BigInt(DEFAULT_BOOT_REGION_SIZES.Stack) || address >= BOOT_REGIONS.Stack) {
      throw new MemoryFault(address, 'write');
    }

    const lowestMapped = this.lowestMappedStackPage();
    const neededBase = alignDown(address);
    if (lowestMapped === undefined || neededBase < lowestMapped) {
      const growSize = Number(lowestMapped === undefined
        ? BOOT_REGIONS.Stack - neededBase
        : lowestMapped - neededBase);
      this.mapMemory(neededBase, growSize, perms);
    }

    const touchedEnd = alignUp(address + BigInt(size));
    if (touchedEnd > BOOT_REGIONS.Stack) {
      throw new MemoryFault(address + BigInt(size), 'write');
    }
  }

  unmapMemory(virtualAddr: bigint, size: number): void {
    if (size <= 0) {
      return;
    }

    const basePageAddr = alignDown(virtualAddr);
    const endPageAddr = alignUp(virtualAddr + BigInt(size));

    for (let pageAddr = basePageAddr; pageAddr < endPageAddr; pageAddr += BigInt(PAGE_SIZE)) {
      this.pageTable.delete(pageAddr);
    }
  }

  private resolvePage(virtualAddr: bigint, accessType: 'read' | 'write' | 'execute'): PhysicalPage {
    const pageAddr = virtualAddr & ~BigInt(PAGE_SIZE - 1);
    const page = this.pageTable.get(pageAddr);

    if (!page) {
      throw new MemoryFault(virtualAddr, accessType);
    }

    const requiredPermission = accessType === 'read'
      ? MemoryPermission.Read
      : accessType === 'write'
        ? MemoryPermission.Write
        : MemoryPermission.Execute;

    if ((page.permissions & requiredPermission) === 0) {
      throw new MemoryFault(virtualAddr, accessType);
    }

    return page;
  }

  translateAddress(virtualAddr: bigint): number {
    const page = this.resolvePage(virtualAddr, 'read');
    return page.offset + Number(virtualAddr & BigInt(PAGE_SIZE - 1));
  }

  checkExecute(addr: bigint): void {
    this.resolvePage(addr, 'execute');
  }

  read8(addr: bigint): number {
    return this.readBytes(addr, 1)[0];
  }

  read16(addr: bigint): number {
    const dv = new DataView(this.readBytes(addr, 2).buffer as ArrayBuffer);
    return dv.getUint16(0, true);
  }

  read32(addr: bigint): number {
    const dv = new DataView(this.readBytes(addr, 4).buffer as ArrayBuffer);
    return dv.getUint32(0, true);
  }

  read64(addr: bigint): bigint {
    const dv = new DataView(this.readBytes(addr, 8).buffer as ArrayBuffer);
    return dv.getBigUint64(0, true);
  }

  write8(addr: bigint, value: number): void {
    this.writeBytes(addr, new Uint8Array([value & 0xff]));
  }

  write16(addr: bigint, value: number): void {
    const data = new Uint8Array(2);
    new DataView(data.buffer as ArrayBuffer).setUint16(0, value, true);
    this.writeBytes(addr, data);
  }

  write32(addr: bigint, value: number): void {
    const data = new Uint8Array(4);
    new DataView(data.buffer as ArrayBuffer).setUint32(0, value, true);
    this.writeBytes(addr, data);
  }

  write64(addr: bigint, value: bigint): void {
    const data = new Uint8Array(8);
    new DataView(data.buffer as ArrayBuffer).setBigUint64(0, value, true);
    this.writeBytes(addr, data);
  }

  writeBytes(addr: bigint, data: Uint8Array): void {
    if (data.length === 0) {
      return;
    }

    let remaining = data.length;
    let cursor = addr;
    let written = 0;

    while (remaining > 0) {
      const pageAddr = cursor & ~BigInt(PAGE_SIZE - 1);
      const pageOffset = Number(cursor & BigInt(PAGE_SIZE - 1));
      const page = this.resolvePage(cursor, 'write');
      const chunkSize = Math.min(PAGE_SIZE - pageOffset, remaining);
      this.physicalView.set(data.subarray(written, written + chunkSize), page.offset + pageOffset);

      written += chunkSize;
      remaining -= chunkSize;
      cursor += BigInt(chunkSize);
    }
  }

  readBytes(addr: bigint, length: number): Uint8Array {
    if (length < 0) {
      throw new Error('Read length must not be negative');
    }
    if (length === 0) {
      return new Uint8Array(0);
    }

    const result = new Uint8Array(length);
    let remaining = length;
    let cursor = addr;
    let copied = 0;

    while (remaining > 0) {
      const pageOffset = Number(cursor & BigInt(PAGE_SIZE - 1));
      const page = this.resolvePage(cursor, 'read');
      const chunkSize = Math.min(PAGE_SIZE - pageOffset, remaining);
      result.set(this.physicalView.subarray(page.offset + pageOffset, page.offset + pageOffset + chunkSize), copied);

      copied += chunkSize;
      remaining -= chunkSize;
      cursor += BigInt(chunkSize);
    }

    return result;
  }

  isAddressMapped(addr: bigint): boolean {
    const pageAddr = addr & ~BigInt(PAGE_SIZE - 1);
    return this.pageTable.has(pageAddr);
  }

  getPagePermissions(addr: bigint): MemoryPermission | undefined {
    const pageAddr = addr & ~BigInt(PAGE_SIZE - 1);
    return this.pageTable.get(pageAddr)?.permissions;
  }

  private lowestMappedStackPage(): bigint | undefined {
    let lowest: bigint | undefined;
    const stackBase = alignDown(BOOT_REGIONS.Stack);
    const stackLimit = alignDown(BOOT_REGIONS.Stack - BigInt(DEFAULT_BOOT_REGION_SIZES.Stack));

    for (const pageAddr of this.pageTable.keys()) {
      if (pageAddr < stackLimit || pageAddr >= stackBase) {
        continue;
      }
      if (lowest === undefined || pageAddr < lowest) {
        lowest = pageAddr;
      }
    }

    return lowest;
  }

  get physicalBuffer(): ArrayBuffer {
    return this.physicalMemory;
  }
}

function alignDown(value: bigint): bigint {
  return value & ~BigInt(PAGE_SIZE - 1);
}

function alignUp(value: bigint): bigint {
  return (value + BigInt(PAGE_SIZE - 1)) & ~BigInt(PAGE_SIZE - 1);
}
