import { describe, expect, it } from 'vitest';
import { MemoryPermission, VirtualMemoryManager } from '../../memory/vmm';
import { splitBasicBlock } from './block-ir';

const PC = 0x10000000n;

function movz(reg: number, imm16: number, hw = 0, sf = 1): number {
  return (sf << 31) | 0x52800000 | (hw << 21) | (imm16 << 5) | reg;
}

function movk(reg: number, imm16: number, hw = 0, sf = 1): number {
  return (sf << 31) | 0x72800000 | (hw << 21) | (imm16 << 5) | reg;
}

function add(regRd: number, regRn: number, imm: number, sf = 1): number {
  return (sf << 31) | 0x11000000 | (imm << 10) | (regRn << 5) | regRd;
}

function sub(regRd: number, regRn: number, imm: number, sf = 1): number {
  return (sf << 31) | 0x51000000 | (imm << 10) | (regRn << 5) | regRd;
}

function b(immWords: number): number {
  return 0x14000000 | (immWords & 0x03ffffff);
}

function svc(imm = 0): number {
  return 0xd4000000 | (imm << 5);
}

describe('splitBasicBlock', () => {
  it('splits linear integer-immediate instructions until SVC', () => {
    const vmm = new VirtualMemoryManager();
    vmm.mapMemory(PC, 20, MemoryPermission.ReadWriteExecute);
    vmm.write32(PC, movz(0, 1));
    vmm.write32(PC + 4n, movk(0, 2, 1));
    vmm.write32(PC + 8n, add(0, 0, 3));
    vmm.write32(PC + 12n, svc(0));

    const block = splitBasicBlock(vmm, PC);

    expect(block.rawInstructions).toHaveLength(4);
    expect(block.terminal.opcode).toBe('halt');
    expect(block.instructions.map((instruction) => instruction.opcode)).toEqual(['movz', 'movk', 'addImm', 'halt']);
  });

  it('stops at unconditional branches and records branch targets', () => {
    const vmm = new VirtualMemoryManager();
    vmm.mapMemory(PC, 12, MemoryPermission.ReadWriteExecute);
    vmm.write32(PC, add(1, 0, 1));
    vmm.write32(PC + 4n, b(1));

    const block = splitBasicBlock(vmm, PC);

    expect(block.terminal.opcode).toBe('branch');
    expect(block.terminal.target).toBe(PC + 8n);
    expect(block.instructions.map((instruction) => instruction.opcode)).toEqual(['addImm', 'branch']);
  });

  it('honors the max instruction limit for long linear blocks', () => {
    const vmm = new VirtualMemoryManager();
    const instructions = Array.from({ length: 4 }, (_, index) => add(index, 0, 1));
    vmm.mapMemory(PC, instructions.length * 4, MemoryPermission.ReadWriteExecute);
    instructions.forEach((instruction, index) => vmm.write32(PC + BigInt(index * 4), instruction));

    const block = splitBasicBlock(vmm, PC, { maxInstructions: 3 });

    expect(block.rawInstructions).toHaveLength(3);
    expect(block.terminal.opcode).toBe('addImm');
  });

  it('tracks 32-bit and 64-bit register widths', () => {
    const vmm = new VirtualMemoryManager();
    vmm.mapMemory(PC, 8, MemoryPermission.ReadWriteExecute);
    vmm.write32(PC, movz(0, 1, 0, 0));
    vmm.write32(PC + 4n, sub(1, 0, 1));

    const block = splitBasicBlock(vmm, PC);

    expect(block.instructions[0]?.width).toBe(32);
    expect(block.instructions[1]?.width).toBe(64);
  });
});
