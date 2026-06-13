// Virtual Memory Manager — Software TLB for mapping Switch's 64-bit address space
// into the browser's limited WASM linear memory.

export const PAGE_SIZE = 4096;
export const PHYSICAL_RAM_SIZE = 256 * 1024 * 1024; // 256MB physical RAM pool

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
    const pageCount = Math.ceil(size / PAGE_SIZE);
    const basePageAddr = virtualAddr & ~BigInt(PAGE_SIZE - 1);

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

  unmapMemory(virtualAddr: bigint, size: number): void {
    const pageCount = Math.ceil(size / PAGE_SIZE);
    const basePageAddr = virtualAddr & ~BigInt(PAGE_SIZE - 1);

    for (let i = 0; i < pageCount; i++) {
      const pageAddr = basePageAddr + BigInt(i * PAGE_SIZE);
      this.pageTable.delete(pageAddr);
    }
  }

  translateAddress(virtualAddr: bigint): number {
    const pageAddr = virtualAddr & ~BigInt(PAGE_SIZE - 1);
    const pageOffset = Number(virtualAddr & BigInt(PAGE_SIZE - 1));
    const page = this.pageTable.get(pageAddr);

    if (!page) {
      throw new MemoryFault(virtualAddr, 'read');
    }

    return page.offset + pageOffset;
  }

  read8(addr: bigint): number {
    return this.physicalView[this.translateAddress(addr)];
  }

  read16(addr: bigint): number {
    const offset = this.translateAddress(addr);
    return this.physicalView[offset] | (this.physicalView[offset + 1] << 8);
  }

  read32(addr: bigint): number {
    const offset = this.translateAddress(addr);
    const dv = new DataView(this.physicalMemory, offset, 4);
    return dv.getUint32(0, true);
  }

  read64(addr: bigint): bigint {
    const offset = this.translateAddress(addr);
    const dv = new DataView(this.physicalMemory, offset, 8);
    return dv.getBigUint64(0, true);
  }

  write8(addr: bigint, value: number): void {
    this.physicalView[this.translateAddress(addr)] = value & 0xff;
  }

  write16(addr: bigint, value: number): void {
    const offset = this.translateAddress(addr);
    this.physicalView[offset] = value & 0xff;
    this.physicalView[offset + 1] = (value >> 8) & 0xff;
  }

  write32(addr: bigint, value: number): void {
    const offset = this.translateAddress(addr);
    const dv = new DataView(this.physicalMemory, offset, 4);
    dv.setUint32(0, value, true);
  }

  write64(addr: bigint, value: bigint): void {
    const offset = this.translateAddress(addr);
    const dv = new DataView(this.physicalMemory, offset, 8);
    dv.setBigUint64(0, value, true);
  }

  writeBytes(addr: bigint, data: Uint8Array): void {
    const offset = this.translateAddress(addr);
    this.physicalView.set(data, offset);
  }

  readBytes(addr: bigint, length: number): Uint8Array {
    const offset = this.translateAddress(addr);
    return this.physicalView.slice(offset, offset + length);
  }

  isAddressMapped(addr: bigint): boolean {
    const pageAddr = addr & ~BigInt(PAGE_SIZE - 1);
    return this.pageTable.has(pageAddr);
  }

  get physicalBuffer(): ArrayBuffer {
    return this.physicalMemory;
  }
}
