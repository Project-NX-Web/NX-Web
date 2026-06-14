import { describe, expect, it } from 'vitest';
import { Cpu } from './cpu';
import { HorizonKernel } from '../kernel/horizon';
import { MemoryPermission, PAGE_SIZE, VirtualMemoryManager } from '../memory/vmm';

const CODE_BASE = 0x10000000n;
const HEAP_BASE = 0x48000000n;
const STACK_BASE = 0xff80000000n;
const MAIN_MARKER = 0x4d41494e; // "MAIN" in little-endian memory.

function u32(value: number): number {
  return value >>> 0;
}

function movz(reg: number, imm16: number, hw = 0, sf = 1): number {
  return u32((sf << 31) | 0x52800000 | (hw << 21) | (imm16 << 5) | reg);
}

function movk(reg: number, imm16: number, hw = 0, sf = 1): number {
  return u32((sf << 31) | 0x72800000 | (hw << 21) | (imm16 << 5) | reg);
}

function str(rt: number, rn: number, imm = 0, sf = 1): number {
  return u32((sf ? 0xF9000000 : 0xB9000000) | (imm << 10) | (rn << 5) | rt);
}

function ldr(rt: number, rn: number, imm = 0, sf = 1): number {
  return u32((sf ? 0xF9400000 : 0xB9400000) | (imm << 10) | (rn << 5) | rt);
}

function cbnz(reg: number, immWords: number, sf = 1): number {
  return u32((sf << 31) | 0x35000000 | (immWords << 5) | reg);
}

function svc(imm = 0): number {
  return 0xd4000000 | (imm << 5);
}

describe('synthetic homebrew entrypoint verification', () => {
  it('runs a homebrew-style ARM64 fixture to a known MAIN marker', () => {
    const vmm = new VirtualMemoryManager();
    const instructions = [
      movz(0, 0x0000),
      movk(0, 0x4800, 1),       // x0 = HEAP_BASE
      movz(1, 0x5678),
      movk(1, 0x1234, 1),       // x1 = 0x12345678
      str(1, 0, 0, 1),          // store word to heap
      ldr(2, 0, 0, 0),          // load word back
      cbnz(2, 4, 0),            // skip BAD marker if heap load is non-zero
      movz(3, 0xBAD),           // BAD marker
      str(3, 0, 8, 0),
      svc(0),
      movz(3, 0x494E),
      movk(3, 0x4D41, 1),       // x3 = 0x4D41494E
      str(3, 0, 8, 0),
      svc(0),
    ];

    vmm.mapMemory(CODE_BASE, instructions.length * 4, MemoryPermission.ReadWriteExecute);
    vmm.mapMemory(HEAP_BASE, PAGE_SIZE, MemoryPermission.ReadWrite);
    vmm.mapMemory(STACK_BASE - BigInt(PAGE_SIZE), PAGE_SIZE, MemoryPermission.ReadWrite);

    instructions.forEach((instruction, index) => {
      vmm.write32(CODE_BASE + BigInt(index * 4), instruction);
    });

    const cpu = new Cpu(vmm, new HorizonKernel());
    cpu.state.pc = CODE_BASE;
    cpu.state.sp = STACK_BASE - 0x100n;

    const result = cpu.run();

    expect(result.halted).toBe(true);
    expect(result.reason).toBe('syscall');
    expect(cpu.memory.read32(HEAP_BASE)).toBe(0x12345678);
    expect(cpu.memory.read32(HEAP_BASE + 8n)).toBe(MAIN_MARKER);
  });
});
