import { describe, expect, it } from 'vitest';
import { Cpu, CpuExecutionError, UnimplementedInstruction } from './cpu';
import { MemoryFault, MemoryPermission, PAGE_SIZE, VirtualMemoryManager } from '../memory/vmm';
import { HorizonKernel, HorizonResult, HorizonSVC } from '../kernel/horizon';

const CODE_BASE = 0x10000000n;
const HEAP_BASE = 0x48000000n;
const STACK_BASE = 0xff80000000n;

function cpuWithCode(instructions: number[], stackSize = PAGE_SIZE): Cpu {
  const vmm = new VirtualMemoryManager();
  vmm.mapMemory(CODE_BASE, instructions.length * 4, MemoryPermission.ReadWriteExecute);
  vmm.mapMemory(HEAP_BASE, PAGE_SIZE * 2, MemoryPermission.ReadWrite);
  vmm.mapMemory(STACK_BASE - BigInt(stackSize), stackSize, MemoryPermission.ReadWrite);

  instructions.forEach((instruction, index) => vmm.write32(CODE_BASE + BigInt(index * 4), instruction));

  const cpu = new Cpu(vmm);
  cpu.state.pc = CODE_BASE;
  cpu.state.sp = STACK_BASE - 0x100n;
  return cpu;
}

function movz(reg: number, imm16: number, hw = 0, sf = 1): number {
  return (sf << 31) | 0x52800000 | (hw << 21) | (imm16 << 5) | reg;
}

function movn(reg: number, imm16: number, hw = 0, sf = 1): number {
  return (sf << 31) | 0x12800000 | (hw << 21) | (imm16 << 5) | reg;
}

function movk(reg: number, imm16: number, hw = 0, sf = 1): number {
  return (sf << 31) | 0x72800000 | (hw << 21) | (imm16 << 5) | reg;
}

function add(regRd: number, regRn: number, imm: number, sf = 1, setFlags = false): number {
  return (sf << 31) | (setFlags ? 0x20000000 : 0) | 0x11000000 | (imm << 10) | (regRn << 5) | regRd;
}

function sub(regRd: number, regRn: number, imm: number, sf = 1, setFlags = false): number {
  return (sf << 31) | (setFlags ? 0x20000000 : 0) | 0x51000000 | (imm << 10) | (regRn << 5) | regRd;
}

function cmp(regRn: number, imm: number, sf = 1): number {
  return sub(31, regRn, imm, sf, true);
}

function tst(regRn: number, imm: number, sf = 1): number {
  return (sf ? 0xF2400000 : 0x72400000) | (imm << 5) | (regRn << 5) | 31;
}

function b(immWords: number): number {
  return 0x14000000 | (immWords & 0x03ffffff);
}

function bl(immWords: number): number {
  return 0x94000000 | (immWords & 0x03ffffff);
}

function ret(reg = 30): number {
  return 0xd65f0000 | (reg << 5) | 0x20;
}

function cbz(reg: number, immWords: number, sf = 1): number {
  return (sf << 31) | 0x34000000 | (immWords << 5) | reg;
}

function cbnz(reg: number, immWords: number, sf = 1): number {
  return (sf << 31) | 0x35000000 | (immWords << 5) | reg;
}

function str(rt: number, rn: number, imm = 0, sf = 1): number {
  return (sf ? 0xF9000000 : 0xB9000000) | (imm << 10) | (rn << 5) | rt;
}

function ldr(rt: number, rn: number, imm = 0, sf = 1): number {
  return (sf ? 0xF9400000 : 0xB9400000) | (imm << 10) | (rn << 5) | rt;
}

function nop(): number {
  return 0xd503201f;
}

function svc(imm = 0): number {
  return (0xd4000000 | ((imm & 0xffff) << 5)) >>> 0;
}

describe('Cpu', () => {
  it('treats XZR as zero and advances PC for NOP', () => {
    const cpu = cpuWithCode([
      movz(0, 0, 1),
      movk(0, 0x4800, 1),
      movz(1, 5),
      str(1, 0, 0, 1),
      str(31, 0, 8, 1),
      nop(),
    ]);

    cpu.run(4);

    expect(cpu.state.getX(0)).toBe(HEAP_BASE);
    expect(cpu.memory.read64(HEAP_BASE)).toBe(5n);
    expect(cpu.memory.read64(HEAP_BASE + 8n)).toBe(0n);
    expect(cpu.state.pc).toBe(CODE_BASE + 16n);
  });

  it('keeps SP as the X31 alias and preserves X30 as LR', () => {
    const cpu = cpuWithCode([nop()]);
    cpu.state.sp = 0xabcdef00n;
    cpu.state.setX(30, 0x12345678n);

    expect(cpu.state.getX(31)).toBe(cpu.state.sp);
    expect(cpu.state.getX(30)).toBe(0x12345678n);
  });

  it('zero-extends W-register writes into X registers', () => {
    const cpu = cpuWithCode([
      movz(0, 0x1234, 0, 0),
      add(1, 0, 0, 0),
    ]);

    cpu.run(2);

    expect(cpu.state.getW(0)).toBe(0x1234);
    expect(cpu.state.getX(0)).toBe(0x1234n);
    expect(cpu.state.getX(1)).toBe(0x1234n);
  });

  it('executes MOVZ, MOVN, and MOVK immediate instructions', () => {
    const cpu = cpuWithCode([
      movz(0, 0x1234),
      movk(0, 0xabcd, 1),
      movn(1, 0),
      movz(2, 0x5678, 0, 0),
      movk(2, 0x1111, 1, 0),
    ]);

    cpu.run(5);

    expect(cpu.state.getX(0)).toBe(0xabcd1234n);
    expect(cpu.state.getX(1)).toBe(0xffffffffffffffffn);
    expect(cpu.state.getX(2)).toBe(0x11115678n);
  });

  it('executes ADD, SUB, CMP, and TST immediate instructions with flags', () => {
    const cpu = cpuWithCode([
      movz(0, 3),
      add(1, 0, 2),
      sub(2, 1, 1),
      cmp(2, 1),
      tst(2, 4),
    ]);

    cpu.run(5);

    expect(cpu.state.getX(1)).toBe(5n);
    expect(cpu.state.getX(2)).toBe(4n);
    expect(cpu.state.c).toBe(true);
    expect(cpu.state.overflow).toBe(false);
    expect(cpu.state.z).toBe(true);
  });

  it('executes B, BL, RET, CBZ, and CBNZ branches', () => {
    const cpu = cpuWithCode([
      bl(2),        // 0: link to 8
      movz(0, 0),   // 4: skipped
      movz(1, 0x0010), // 8: return target low halfword
      movk(1, 0x1000, 1), // 12: return target high halfword
      ret(1),       // 16: return to CODE_BASE + 16
      nop(),        // 16: LR return target
      cbz(1, 2),    // 20: not taken
      movz(4, 2),   // 24: skipped
      movz(2, 9),   // 28: after cbz
      cbnz(2, 1),   // 32: taken to 36
      movz(3, 1),   // 36: skipped
      svc(0),       // 40: stop
    ]);

    const result = cpu.run();

    expect(result.reason).toBe('syscall');
    expect(cpu.state.lr).toBe(CODE_BASE + 4n);
    expect(cpu.state.getX(0)).toBe(0n);
    expect(cpu.state.getX(1)).toBe(CODE_BASE + 16n);
    expect(cpu.state.getX(2)).toBe(9n);
    expect(cpu.state.pc).toBe(CODE_BASE + 44n);
  });

  it('loads and stores through the VMM', () => {
    const cpu = cpuWithCode([
      movz(0, 0x1000),
      movk(0, 0x4800, 1),
      movz(1, 0x1234),
      movk(1, 0xabcd, 1),
      str(1, 0, 0, 1),
      ldr(2, 0, 0, 1),
    ]);

    cpu.run(6);

    expect(cpu.memory.read64(HEAP_BASE + 0x1000n)).toBe(0xabcd1234n);
    expect(cpu.state.getX(2)).toBe(0xabcd1234n);
  });

  it('faults when instruction fetch is not executable', () => {
    const vmm = new VirtualMemoryManager();
    vmm.mapMemory(CODE_BASE, 4, MemoryPermission.ReadWrite);
    vmm.write32(CODE_BASE, nop());

    const cpu = new Cpu(vmm);
    cpu.state.pc = CODE_BASE;

    expect(() => cpu.step()).toThrow(CpuExecutionError);
  });

  it('dispatches SVC #0 to a kernel hook', () => {
    const cpu = cpuWithCode([svc(0)]);
    const kernel = new HorizonKernel();
    cpu.setSyscallHandler(kernel);

    const result = cpu.run();

    expect(result.halted).toBe(true);
    expect(result.reason).toBe('syscall');
    expect(cpu.state.getX(0)).toBe(0n);
    expect(kernel.getTlsPointer(cpu)).toBe(0x1f85c00n);
  });

  it('observes a HorizonKernel result from an ARM64 SVC #0 program', () => {
    const cpu = cpuWithCode([
      movz(0, 0x2000),
      svc(0),
    ]);
    const kernel = new HorizonKernel();
    cpu.setSyscallHandler(kernel);

    const result = cpu.run();

    expect(result.halted).toBe(true);
    expect(result.reason).toBe('syscall');
    expect(cpu.state.getX(0)).toBe(BigInt(HorizonResult.Success));
    expect(kernel.process.heapSize).toBe(0x2000n);
  });

  it('returns a structured error for invalid syscall guest pointers without crashing', () => {
    const cpu = cpuWithCode([
      movz(1, 1),
      svc(HorizonSVC.OutputDebugString),
    ]);
    const kernel = new HorizonKernel();
    cpu.setSyscallHandler(kernel);

    const result = cpu.run();

    expect(result.halted).toBe(true);
    expect(result.reason).toBe('syscall');
    expect(cpu.state.getX(0)).toBe(BigInt(HorizonResult.InvalidAddress));
  });

  it('stubs unknown SVC numbers without corrupting unrelated registers', () => {
    const cpu = cpuWithCode([
      movz(7, 0x1234),
      svc(0x1234),
    ]);
    const kernel = new HorizonKernel();
    cpu.setSyscallHandler(kernel);

    const result = cpu.run();

    expect(result.halted).toBe(true);
    expect(result.reason).toBe('syscall');
    expect(cpu.state.getX(0)).toBe(BigInt(HorizonResult.Success));
    expect(cpu.state.getX(7)).toBe(0x1234n);
  });

  it('keeps unknown instructions structured', () => {
    const cpu = cpuWithCode([0xffffffff]);

    expect(() => cpu.step()).toThrow(UnimplementedInstruction);
  });

  it('surfaces read/write memory faults from handlers', () => {
    const cpu = cpuWithCode([
      movz(0, 0, 0, 1),
      ldr(1, 0, 0, 1),
    ]);

    expect(() => cpu.run()).toThrow(MemoryFault);
  });

  it('records synthetic profiling counters', () => {
    const cpu = cpuWithCode([
      movz(0, 1),
      add(0, 0, 2),
      svc(0),
    ]);
    const kernel = new HorizonKernel();
    cpu.setSyscallHandler(kernel);

    cpu.run();

    const profile = cpu.getProfileSnapshot();
    expect(profile.instructions).toBe(3);
    expect(profile.svc).toBe(1);
    expect(Object.values(profile.byOpcode).reduce((sum, count) => sum + count, 0)).toBe(3);
  });

  it('executes safe compiled WASM blocks in JIT mode', () => {
    const cpu = cpuWithCode([
      movz(0, 1),
      add(0, 0, 2),
      svc(0),
    ]);
    cpu.setSyscallHandler({ handle: () => {} });
    cpu.setExecutionMode('jit');

    const result = cpu.run();

    expect(result.reason).toBe('syscall');
    expect(cpu.state.getX(0)).toBe(3n);
    expect(cpu.getProfileSnapshot().jitBlocks).toBe(1);
  });

  it('profiles every instruction inside a compiled JIT block', () => {
    const cpu = cpuWithCode([
      movz(1, 1),
      add(2, 1, 2),
      svc(0),
    ]);
    const kernel = new HorizonKernel();
    cpu.setSyscallHandler(kernel);
    cpu.setExecutionMode('jit');

    cpu.run();

    const profile = cpu.getProfileSnapshot();
    expect(profile.instructions).toBe(3);
    expect(profile.svc).toBe(1);
    expect(Object.values(profile.byOpcode).reduce((sum, count) => sum + count, 0)).toBe(3);
  });

  it('falls back to the interpreter without corrupting state when JIT has no compiled block', () => {
    const cpu = cpuWithCode([0xffffffff]);
    cpu.state.setX(0, 0x1234n);
    cpu.setExecutionMode('jit');

    expect(() => cpu.step()).toThrow(UnimplementedInstruction);
    expect(cpu.state.getX(0)).toBe(0x1234n);
    expect(cpu.getProfileSnapshot().jitFallbacks).toBe(1);
  });
});
