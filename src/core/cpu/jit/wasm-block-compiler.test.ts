import { describe, expect, it } from 'vitest';
import { MemoryPermission, VirtualMemoryManager } from '../../memory/vmm';
import { splitBasicBlock } from './block-ir';
import { WasmBlockCompiler } from './wasm-block-compiler';

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

function ret(reg = 30): number {
  return 0xd65f0000 | (reg << 5) | 0x20;
}

function regs(values: Record<number, bigint> = {}, sp = 0n): bigint[] {
  const out = Array.from({ length: 31 }, () => 0n);
  for (const [reg, value] of Object.entries(values)) {
    out[Number(reg)] = value;
  }
  return [...out, sp];
}

describe('WasmBlockCompiler', () => {
  it('compiles and executes a safe integer-immediate block', () => {
    const vmm = new VirtualMemoryManager();
    vmm.mapMemory(PC, 12, MemoryPermission.ReadWriteExecute);
    vmm.write32(PC, movz(0, 1));
    vmm.write32(PC + 4n, add(0, 0, 2));
    vmm.write32(PC + 8n, sub(0, 0, 1));

    const compiler = new WasmBlockCompiler();
    const compiled = compiler.compileOrGet(splitBasicBlock(vmm, PC));

    expect(compiled).toBeDefined();
    expect(compiled!.run(regs(), 0n)[0]).toBe(2n);
    expect(compiler.size).toBe(1);
  });

  it('compiles multi-register integer-immediate blocks', () => {
    const vmm = new VirtualMemoryManager();
    vmm.mapMemory(PC, 16, MemoryPermission.ReadWriteExecute);
    vmm.write32(PC, movz(1, 0x1234));
    vmm.write32(PC + 4n, movk(1, 0xabcd, 1));
    vmm.write32(PC + 8n, add(2, 1, 3));
    vmm.write32(PC + 12n, sub(3, 2, 1));

    const compiler = new WasmBlockCompiler();
    const compiled = compiler.compileOrGet(splitBasicBlock(vmm, PC));

    expect(compiled).toBeDefined();
    const out = compiled!.run(regs(), 0n);
    expect(out[1]).toBe(0xabcd1234n);
    expect(out[2]).toBe(0xabcd1237n);
    expect(out[3]).toBe(0xabcd1236n);
  });

  it('zero-extends 32-bit writes into 64-bit registers', () => {
    const vmm = new VirtualMemoryManager();
    vmm.mapMemory(PC, 4, MemoryPermission.ReadWriteExecute);
    vmm.write32(PC, movz(0, 0xffff, 0, 0));

    const compiler = new WasmBlockCompiler();
    const compiled = compiler.compileOrGet(splitBasicBlock(vmm, PC));

    expect(compiled).toBeDefined();
    expect(compiled!.run(regs(), 0n)[0]).toBe(0xffffn);
  });

  it('uses OR semantics for MOVK', () => {
    const vmm = new VirtualMemoryManager();
    vmm.mapMemory(PC, 8, MemoryPermission.ReadWriteExecute);
    vmm.write32(PC, movz(0, 0x1234));
    vmm.write32(PC + 4n, movk(0, 0xabcd, 1));

    const compiler = new WasmBlockCompiler();
    const compiled = compiler.compileOrGet(splitBasicBlock(vmm, PC));

    expect(compiled!.run(regs(), 0n)[0]).toBe(0xabcd1234n);
  });

  it('returns cached instances for unchanged blocks', () => {
    const vmm = new VirtualMemoryManager();
    vmm.mapMemory(PC, 4, MemoryPermission.ReadWriteExecute);
    vmm.write32(PC, movz(0, 1));

    const compiler = new WasmBlockCompiler();
    const first = compiler.compileOrGet(splitBasicBlock(vmm, PC));
    const second = compiler.compileOrGet(splitBasicBlock(vmm, PC));

    expect(first).toBe(second);
    expect(compiler.size).toBe(1);
  });

  it('invalidates cached blocks for a PC', () => {
    const vmm = new VirtualMemoryManager();
    vmm.mapMemory(PC, 4, MemoryPermission.ReadWriteExecute);
    vmm.write32(PC, movz(0, 1));

    const compiler = new WasmBlockCompiler();
    expect(compiler.compileOrGet(splitBasicBlock(vmm, PC))).toBeDefined();
    compiler.invalidate(PC);

    expect(compiler.size).toBe(0);
  });

  it('returns undefined for unsupported blocks instead of compiling them', () => {
    const vmm = new VirtualMemoryManager();
    vmm.mapMemory(PC, 4, MemoryPermission.ReadWriteExecute);
    vmm.write32(PC, ret());

    const compiler = new WasmBlockCompiler();
    expect(compiler.compileOrGet(splitBasicBlock(vmm, PC))).toBeUndefined();
    expect(compiler.size).toBe(0);
  });
});
