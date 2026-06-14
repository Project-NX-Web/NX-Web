// ARM64 interpreter facade for Phase 3. The dispatch table is indexed by the
// top 10 opcode bits, while exact masks keep unimplemented instructions
// structured instead of silently corrupting CPU state.

import { VirtualMemoryManager, MemoryFault } from '../memory/vmm';
import { decodeInstruction, InstructionGroup } from './decoder';
import { CpuState } from './state';
import { splitBasicBlock } from './jit/block-ir';
import { WasmBlockCompiler, type CompiledWasmBlock } from './jit/wasm-block-compiler';

export interface SyscallHandler {
  handle(cpu: Cpu, svcNumber: number): void;
}

export interface InstructionHandler {
  execute(cpu: Cpu, instruction: number): void;
}

export class UnimplementedInstruction extends Error {
  constructor(public readonly instruction: number) {
    super(`Unimplemented ARM64 instruction 0x${instruction.toString(16).padStart(8, '0')}`);
  }
}

export class CpuExecutionError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
  }
}

export type CpuHaltReason = 'step-limit' | 'halted' | 'syscall' | 'break' | 'error';

export interface CpuRunResult {
  instructions: number;
  halted: boolean;
  reason?: CpuHaltReason;
}

export type CpuExecutionMode = 'interpreter' | 'jit' | 'hybrid';

export interface CpuProfileSnapshot {
  instructions: number;
  branches: number;
  loads: number;
  stores: number;
  svc: number;
  jitBlocks: number;
  jitFallbacks: number;
  byOpcode: Record<string, number>;
}

interface DispatchEntry {
  mask: number;
  value: number;
  handler: InstructionHandler;
}

export class Cpu {
  readonly state = new CpuState();

  private readonly vmm: VirtualMemoryManager;
  private readonly dispatchTable: DispatchEntry[][] = Array.from({ length: 1024 }, () => []);
  private readonly unimplementedHandler: InstructionHandler;
  private readonly jitCompiler = new WasmBlockCompiler();
  private executionMode: CpuExecutionMode = 'interpreter';
  private profile: CpuProfileSnapshot = createCpuProfileSnapshot();
  public syscallHandler?: SyscallHandler;
  public halted = false;
  public haltReason?: CpuHaltReason;

  constructor(vmm: VirtualMemoryManager, syscallHandler?: SyscallHandler) {
    this.vmm = vmm;
    this.syscallHandler = syscallHandler;
    this.unimplementedHandler = {
      execute: (_cpu, instruction) => {
        throw new UnimplementedInstruction(instruction);
      },
    };
    this.installDispatchTable();
  }

  get memory(): VirtualMemoryManager {
    return this.vmm;
  }

  get isHalted(): boolean {
    return this.halted;
  }

  get lastHaltReason(): CpuHaltReason | undefined {
    return this.haltReason;
  }

  setSyscallHandler(handler: SyscallHandler | undefined): void {
    this.syscallHandler = handler;
  }

  getExecutionMode(): CpuExecutionMode {
    return this.executionMode;
  }

  setExecutionMode(mode: CpuExecutionMode): void {
    this.executionMode = mode;
    if (mode === 'interpreter') {
      this.jitCompiler.clear();
    }
  }

  getJitCompiler(): WasmBlockCompiler {
    return this.jitCompiler;
  }

  getProfileSnapshot(): CpuProfileSnapshot {
    return { ...this.profile, byOpcode: { ...this.profile.byOpcode } };
  }

  resetProfiler(): void {
    this.profile = createCpuProfileSnapshot();
  }

  reset(): void {
    this.state.pc = 0n;
    this.state.sp = 0n;
    this.state.x.fill(0n);
    this.state.n = false;
    this.state.z = false;
    this.state.c = false;
    this.state.overflow = false;
    this.profile = createCpuProfileSnapshot();
    this.halted = false;
    this.haltReason = undefined;
  }

  halt(reason: CpuHaltReason = 'halted'): void {
    this.halted = true;
    this.haltReason = reason;
  }

  step(): number {
    if (this.halted) {
      return 0;
    }

    const pc = this.state.pc;
    const instruction = this.fetchInstruction(pc);

    if (this.executionMode !== 'interpreter') {
      try {
        const block = splitBasicBlock(this.vmm, pc);
        const compiled = this.jitCompiler.compileOrGet(block);
        if (compiled) {
          this.executeCompiledBlock(compiled);
          this.recordInstructions(compiled.rawInstructions);
          this.profile.jitBlocks++;
          return 1;
        }
        this.profile.jitFallbacks++;
      } catch {
        this.profile.jitFallbacks++;
      }
    }

    this.recordInstruction(instruction);
    const handler = this.getHandler(instruction);
    handler.execute(this, instruction);

    if (!this.halted && this.state.pc === pc) {
      this.state.pc += 4n;
    }

    return 1;
  }

  run(maxInstructions = Number.POSITIVE_INFINITY): CpuRunResult {
    let instructions = 0;

    while (!this.halted && instructions < maxInstructions) {
      this.step();
      instructions++;
    }

    return {
      instructions,
      halted: this.halted,
      reason: this.haltReason ?? (instructions >= maxInstructions ? 'step-limit' : undefined),
    };
  }

  fetchInstruction(pc: bigint): number {
    try {
      this.vmm.checkExecute(pc);
      return this.vmm.read32(pc);
    } catch (error) {
      if (error instanceof MemoryFault) {
        throw new CpuExecutionError(`Instruction fetch fault at 0x${pc.toString(16)}`, error);
      }
      throw error;
    }
  }

  private executeCompiledBlock(compiled: CompiledWasmBlock): void {
    const registers = compiled.run(this.state.x, this.state.sp);
    for (let reg = 0; reg < 31; reg++) {
      this.state.setX(reg, registers[reg]);
    }
    this.state.sp = registers[31];
    this.state.pc += BigInt(compiled.rawInstructions.length * 4);
  }

  private recordInstruction(instruction: number): void {
    this.recordInstructions([instruction]);
  }

  private recordInstructions(instructions: number[]): void {
    for (const instruction of instructions) {
      this.profile.instructions++;
      const key = `0x${(instruction >>> 22).toString(16)}`;
      this.profile.byOpcode[key] = (this.profile.byOpcode[key] ?? 0) + 1;

      if (((instruction & 0xffe0001f) >>> 0) === 0xd4000000) {
        this.profile.svc++;
      } else {
        const group = decodeInstruction(instruction).group;
        if (group === InstructionGroup.Branch) {
          this.profile.branches++;
        } else if (group === InstructionGroup.LoadStore) {
          if ((instruction & 0x08000000) !== 0) {
            this.profile.stores++;
          } else {
            this.profile.loads++;
          }
        }
      }
    }
  }

  private getHandler(instruction: number): InstructionHandler {
    const entries = this.dispatchTable[(instruction >>> 22) & 0x3ff];
    for (const entry of entries) {
      if ((instruction & (entry.mask | 0)) >>> 0 === entry.value >>> 0) {
        return entry.handler;
      }
    }
    return this.unimplementedHandler;
  }

  private installDispatchTable(): void {
    this.register(0xFFFFFFFF, 0xD503201F, { execute: executeNop });
    this.register(0x7F800000, 0x12800000, { execute: executeMovn });
    this.register(0x7F800000, 0x52800000, { execute: executeMovz });
    this.register(0x7F800000, 0x72800000, { execute: executeMovk });
    this.register(0x7F800000, 0x92800000, { execute: executeMovn });
    this.register(0x7F800000, 0xF2800000, { execute: executeMovk });

    this.register(0xFF000000, 0x11000000, { execute: executeAddImmediate });
    this.register(0xFF000000, 0x91000000, { execute: executeAddImmediate });
    this.register(0xFF000000, 0x51000000, { execute: executeSubImmediate });
    this.register(0xFF000000, 0xD1000000, { execute: executeSubImmediate });
    this.register(0xFF000000, 0xB1000000, { execute: executeAddsImmediate });
    this.register(0xFF000000, 0xF1000000, { execute: executeSubsImmediate });

    this.register(0xFF000000, 0x12000000, { execute: executeAndsImmediate });
    this.register(0xFF000000, 0x12400000, { execute: executeAndsImmediate });
    this.register(0xFF000000, 0x72000000, { execute: executeAndsImmediate });
    this.register(0xFF000000, 0x72400000, { execute: executeAndsImmediate });
    this.register(0xFF000000, 0x92000000, { execute: executeAndsImmediate });
    this.register(0xFF000000, 0x92400000, { execute: executeAndsImmediate });
    this.register(0xFF000000, 0xF2000000, { execute: executeAndsImmediate });
    this.register(0xFF000000, 0xF2400000, { execute: executeAndsImmediate });
    this.register(0xFF000000, 0x32000000, { execute: executeOrrImmediate });
    this.register(0xFF000000, 0x32400000, { execute: executeOrrImmediate });
    this.register(0xFF000000, 0xB2000000, { execute: executeOrrImmediate });
    this.register(0xFF000000, 0xB2400000, { execute: executeOrrImmediate });
    this.register(0xFF000000, 0x52000000, { execute: executeEorImmediate });
    this.register(0xFF000000, 0x52400000, { execute: executeEorImmediate });
    this.register(0xFF000000, 0xD2000000, { execute: executeEorImmediate });
    this.register(0xFF000000, 0xD2400000, { execute: executeEorImmediate });

    this.register(0xFC000000, 0x14000000, { execute: executeBranch });
    this.register(0xFC000000, 0x94000000, { execute: executeBranchLink });
    this.register(0xFFF00000, 0x34000000, { execute: executeCbz });
    this.register(0xFFF00000, 0xB4000000, { execute: executeCbz });
    this.register(0xFFF00000, 0x35000000, { execute: executeCbnz });
    this.register(0xFFF00000, 0xB5000000, { execute: executeCbnz });
    this.register(0xFFFFFC1F, 0xD65F0000, { execute: executeRet });
    this.register(0xFFFFFC1F, 0xD61F0000, { execute: executeBr });
    this.register(0xFFFFFC1F, 0xD63F0000, { execute: executeBlr });

    this.register(0xFFE00000, 0x38800000, { execute: executeStoreRegisterImmediate });
    this.register(0xFFE00000, 0x78800000, { execute: executeStoreRegisterImmediate });
    this.register(0xFFE00000, 0xB8800000, { execute: executeStoreRegisterImmediate });
    this.register(0xFFC00000, 0xF8800000, { execute: executeStoreRegisterImmediate });
    this.register(0xFFC00000, 0xF9000000, { execute: executeStoreRegisterImmediate });
    this.register(0xFFC00000, 0xB9000000, { execute: executeStoreRegisterImmediate });
    this.register(0xFFC00000, 0x79000000, { execute: executeStoreRegisterImmediate });
    this.register(0xFFC00000, 0x39000000, { execute: executeStoreRegisterImmediate });

    this.register(0xFFE00000, 0x38C00000, { execute: executeLoadRegisterImmediate });
    this.register(0xFFE00000, 0x78C00000, { execute: executeLoadRegisterImmediate });
    this.register(0xFFE00000, 0xB8C00000, { execute: executeLoadRegisterImmediate });
    this.register(0xFFE00000, 0x39C00000, { execute: executeLoadRegisterImmediate });
    this.register(0xFFE00000, 0x79C00000, { execute: executeLoadRegisterImmediate });
    this.register(0xFFE00000, 0xB9C00000, { execute: executeLoadRegisterImmediate });
    this.register(0xFFC00000, 0xF8C00000, { execute: executeLoadRegisterImmediate });
    this.register(0xFFC00000, 0xF9400000, { execute: executeLoadRegisterImmediate });
    this.register(0xFFC00000, 0xB9400000, { execute: executeLoadRegisterImmediate });
    this.register(0xFFC00000, 0x79400000, { execute: executeLoadRegisterImmediate });
    this.register(0xFFC00000, 0x39400000, { execute: executeLoadRegisterImmediate });

    this.register(0xFFF00000, 0xD4000000, { execute: executeSvc });
    this.register(0xFFF00000, 0xD4200000, { execute: executeBrk });
  }

  private register(mask: number, value: number, handler: InstructionHandler): void {
    const signedMask = mask | 0;
    const signedValue = value | 0;

    for (let bucket = 0; bucket < this.dispatchTable.length; bucket++) {
      const candidate = ((bucket << 22) | (value & 0x003fffff)) | 0;
      if (((candidate & signedMask) >>> 0) === (signedValue >>> 0)) {
        this.dispatchTable[bucket].push({ mask, value, handler });
      }
    }
  }
}

export const Arm64Interpreter = Cpu;

function createCpuProfileSnapshot(): CpuProfileSnapshot {
  return {
    instructions: 0,
    branches: 0,
    loads: 0,
    stores: 0,
    svc: 0,
    jitBlocks: 0,
    jitFallbacks: 0,
    byOpcode: {},
  };
}

function executeNop(_cpu: Cpu, _instruction: number): void {
  // Intentionally empty.
}

function executeMovz(cpu: Cpu, instruction: number): void {
  const rd = instruction & 0x1f;
  const imm16 = (instruction >>> 5) & 0xffff;
  const hw = (instruction >>> 21) & 3;
  const value = BigInt(imm16) << BigInt(hw * 16);
  writeRegister(cpu, rd, value, is64Bit(instruction));
}

function executeMovn(cpu: Cpu, instruction: number): void {
  const rd = instruction & 0x1f;
  const imm16 = (instruction >>> 5) & 0xffff;
  const hw = (instruction >>> 21) & 3;
  const width = is64Bit(instruction) ? 64n : 32n;
  const mask = (1n << width) - 1n;
  const value = mask ^ (BigInt(imm16) << BigInt(hw * 16));
  writeRegister(cpu, rd, value, is64Bit(instruction));
}

function executeMovk(cpu: Cpu, instruction: number): void {
  const rd = instruction & 0x1f;
  const imm16 = (instruction >>> 5) & 0xffff;
  const hw = (instruction >>> 21) & 3;
  const width = is64Bit(instruction) ? 64n : 32n;
  const mask = (1n << width) - 1n;
  const insertMask = ~(BigInt(0xffff) << BigInt(hw * 16)) & mask;
  const current = readRegister(cpu, rd, is64Bit(instruction));
  const value = (current & insertMask) | (BigInt(imm16) << BigInt(hw * 16));
  writeRegister(cpu, rd, value, is64Bit(instruction));
}

function executeAddImmediate(cpu: Cpu, instruction: number): void {
  const rn = (instruction >>> 5) & 0x1f;
  const rd = instruction & 0x1f;
  const imm = decodeAddSubImmediate(instruction);
  const width = is64Bit(instruction) ? 64n : 32n;
  const mask = (1n << width) - 1n;
  const lhs = readRegister(cpu, rn, is64Bit(instruction));
  const result = (lhs + imm) & mask;
  writeRegister(cpu, rd, result, is64Bit(instruction));
}

function executeSubImmediate(cpu: Cpu, instruction: number): void {
  const rn = (instruction >>> 5) & 0x1f;
  const rd = instruction & 0x1f;
  const imm = decodeAddSubImmediate(instruction);
  const width = is64Bit(instruction) ? 64n : 32n;
  const mask = (1n << width) - 1n;
  const lhs = readRegister(cpu, rn, is64Bit(instruction));
  const result = (lhs - imm) & mask;
  writeRegister(cpu, rd, result, is64Bit(instruction));
}

function executeAddsImmediate(cpu: Cpu, instruction: number): void {
  const rn = (instruction >>> 5) & 0x1f;
  const rd = instruction & 0x1f;
  const imm = decodeAddSubImmediate(instruction);
  const width = is64Bit(instruction) ? 64n : 32n;
  const mask = (1n << width) - 1n;
  const lhs = readRegister(cpu, rn, is64Bit(instruction));
  const rhs = imm;
  const unsignedResult = (BigInt.asUintN(Number(width), lhs) + BigInt.asUintN(Number(width), rhs)) & mask;
  const signedLhs = BigInt.asIntN(Number(width), lhs);
  const signedRhs = BigInt.asIntN(Number(width), rhs);
  const signedResult = signedLhs + signedRhs;

  cpu.state.c = unsignedResult < BigInt.asUintN(Number(width), lhs);
  cpu.state.overflow = signedResult < -(1n << (width - 1n)) || signedResult >= (1n << (width - 1n));

  const result = unsignedResult & mask;
  writeRegister(cpu, rd, result, is64Bit(instruction));
  updateFlags(cpu, result, width);
}

function executeSubsImmediate(cpu: Cpu, instruction: number): void {
  const rn = (instruction >>> 5) & 0x1f;
  const rd = instruction & 0x1f;
  const imm = decodeAddSubImmediate(instruction);
  const width = is64Bit(instruction) ? 64n : 32n;
  const mask = (1n << width) - 1n;
  const lhs = readRegister(cpu, rn, is64Bit(instruction));
  const rhs = imm;
  const unsignedResult = (BigInt.asUintN(Number(width), lhs) - BigInt.asUintN(Number(width), rhs)) & mask;
  const signedLhs = BigInt.asIntN(Number(width), lhs);
  const signedRhs = BigInt.asIntN(Number(width), rhs);
  const signedResult = signedLhs - signedRhs;

  cpu.state.c = BigInt.asUintN(Number(width), lhs) >= BigInt.asUintN(Number(width), rhs);
  cpu.state.overflow = signedResult < -(1n << (width - 1n)) || signedResult >= (1n << (width - 1n));

  const result = unsignedResult & mask;
  if (rd !== 31) {
    writeRegister(cpu, rd, result, is64Bit(instruction));
  }
  updateFlags(cpu, result, width);
}

function executeAndsImmediate(cpu: Cpu, instruction: number): void {
  const rn = (instruction >>> 5) & 0x1f;
  const rd = instruction & 0x1f;
  const width = is64Bit(instruction) ? 64n : 32n;
  const mask = (1n << width) - 1n;
  const lhs = readRegister(cpu, rn, is64Bit(instruction));
  const rhs = decodeLogicalImmediate(instruction, width) & mask;
  const result = lhs & rhs;

  if (rd !== 31) {
    writeRegister(cpu, rd, result, is64Bit(instruction));
  }
  updateFlags(cpu, result, width);
}

function executeOrrImmediate(cpu: Cpu, instruction: number): void {
  const rn = (instruction >>> 5) & 0x1f;
  const rd = instruction & 0x1f;
  const width = is64Bit(instruction) ? 64n : 32n;
  const mask = (1n << width) - 1n;
  const lhs = readRegister(cpu, rn, is64Bit(instruction));
  const rhs = decodeLogicalImmediate(instruction, width) & mask;
  writeRegister(cpu, rd, lhs | rhs, is64Bit(instruction));
}

function executeEorImmediate(cpu: Cpu, instruction: number): void {
  const rn = (instruction >>> 5) & 0x1f;
  const rd = instruction & 0x1f;
  const width = is64Bit(instruction) ? 64n : 32n;
  const mask = (1n << width) - 1n;
  const lhs = readRegister(cpu, rn, is64Bit(instruction));
  const rhs = decodeLogicalImmediate(instruction, width) & mask;
  writeRegister(cpu, rd, lhs ^ rhs, is64Bit(instruction));
}

function executeBranch(cpu: Cpu, instruction: number): void {
  cpu.state.pc = addPcRelative(cpu.state.pc, decodeBranchImm26(instruction));
}

function executeBranchLink(cpu: Cpu, instruction: number): void {
  cpu.state.lr = cpu.state.pc + 4n;
  cpu.state.pc = addPcRelative(cpu.state.pc, decodeBranchImm26(instruction));
}

function executeCbz(cpu: Cpu, instruction: number): void {
  const rt = instruction & 0x1f;
  const value = readRegister(cpu, rt, is64Bit(instruction));
  if (value === 0n) {
    cpu.state.pc = addPcRelative(cpu.state.pc, decodeBranchImm19(instruction));
  }
}

function executeCbnz(cpu: Cpu, instruction: number): void {
  const rt = instruction & 0x1f;
  const value = readRegister(cpu, rt, is64Bit(instruction));
  if (value !== 0n) {
    cpu.state.pc = addPcRelative(cpu.state.pc, decodeBranchImm19(instruction));
  }
}

function executeRet(cpu: Cpu, instruction: number): void {
  const rn = (instruction >>> 5) & 0x1f;
  cpu.state.pc = readRegister(cpu, rn, true);
}

function executeBr(cpu: Cpu, instruction: number): void {
  const rn = (instruction >>> 5) & 0x1f;
  cpu.state.pc = readRegister(cpu, rn, true);
}

function executeBlr(cpu: Cpu, instruction: number): void {
  const rn = (instruction >>> 5) & 0x1f;
  cpu.state.lr = cpu.state.pc + 4n;
  cpu.state.pc = readRegister(cpu, rn, true);
}

function executeStoreRegisterImmediate(cpu: Cpu, instruction: number): void {
  const rt = instruction & 0x1f;
  const rn = (instruction >>> 5) & 0x1f;
  const address = decodeLoadStoreAddress(cpu, instruction);
  const size = loadStoreSize(instruction);
  const value = readRegister(cpu, rt, size === 3);

  switch (size) {
    case 0:
      cpu.memory.write8(address, Number(value & 0xffn));
      break;
    case 1:
      cpu.memory.write16(address, Number(value & 0xffffn));
      break;
    case 2:
      cpu.memory.write32(address, Number(value & 0xffffffffn));
      break;
    case 3:
      cpu.memory.write64(address, BigInt.asUintN(64, value));
      break;
    default:
      throw new CpuExecutionError(`Invalid load/store size ${size}`);
  }
}

function executeLoadRegisterImmediate(cpu: Cpu, instruction: number): void {
  const rt = instruction & 0x1f;
  const rn = (instruction >>> 5) & 0x1f;
  const address = decodeLoadStoreAddress(cpu, instruction);
  const size = loadStoreSize(instruction);
  const signed = isSignedLoad(instruction);
  let value: bigint;

  switch (size) {
    case 0:
      value = BigInt(cpu.memory.read8(address));
      if (signed) value = signExtend(value, 8n);
      break;
    case 1:
      value = BigInt(cpu.memory.read16(address));
      if (signed) value = signExtend(value, 16n);
      break;
    case 2:
      value = BigInt(cpu.memory.read32(address));
      if (signed) value = signExtend(value, 32n);
      break;
    case 3:
      value = cpu.memory.read64(address);
      break;
    default:
      throw new CpuExecutionError(`Invalid load/store size ${size}`);
  }

  writeRegister(cpu, rt, value, size === 3);
}

function executeSvc(cpu: Cpu, instruction: number): void {
  const svcNumber = (instruction >>> 5) & 0xffff;
  if (cpu.syscallHandler) {
    try {
      cpu.syscallHandler.handle(cpu, svcNumber);
    } catch (error) {
      cpu.state.setX(0, 0xe0000006n);
      cpu.halt('syscall');
      return;
    }
  }
  cpu.halt('syscall');
}

function executeBrk(cpu: Cpu, _instruction: number): void {
  cpu.halt('break');
}

function readRegister(cpu: Cpu, reg: number, is64: boolean): bigint {
  return is64 ? cpu.state.getX(reg) : BigInt(cpu.state.getW(reg));
}

function writeRegister(cpu: Cpu, reg: number, value: bigint, is64: boolean): void {
  if (is64) {
    cpu.state.setX(reg, value);
  } else {
    cpu.state.setW(reg, Number(value & 0xffffffffn));
  }
}

function is64Bit(instruction: number): boolean {
  return (instruction & 0x80000000) !== 0;
}

function decodeAddSubImmediate(instruction: number): bigint {
  const imm12 = (instruction >>> 10) & 0xfff;
  const shift = (instruction >>> 22) & 1;
  return BigInt(imm12) << BigInt(shift ? 12 : 0);
}

function updateFlags(cpu: Cpu, result: bigint, width: bigint): void {
  cpu.state.n = (result & (1n << (width - 1n))) !== 0n;
  cpu.state.z = (result & ((1n << width) - 1n)) === 0n;
}

function decodeBranchImm26(instruction: number): bigint {
  let imm26 = instruction & 0x03ffffff;
  if ((imm26 & 0x02000000) !== 0) {
    imm26 |= ~0x03ffffff;
  }
  return BigInt(imm26) << 2n;
}

function decodeBranchImm19(instruction: number): bigint {
  let imm19 = (instruction >>> 5) & 0x7ffff;
  if ((imm19 & 0x40000) !== 0) {
    imm19 |= ~0x7ffff;
  }
  return BigInt(imm19) << 2n;
}

function addPcRelative(pc: bigint, offset: bigint): bigint {
  return pc + offset;
}

function decodeLoadStoreAddress(cpu: Cpu, instruction: number): bigint {
  const rn = (instruction >>> 5) & 0x1f;
  const base = cpu.state.getX(rn);
  const unsignedOffset = (instruction & 0x00000400) !== 0;
  const writeback = (instruction & 0x00000400) === 0 && (instruction & 0x00000800) !== 0;
  const signedOffset = (instruction & 0x00000800) === 0;

  let offset: bigint;
  if (unsignedOffset) {
    const imm = (instruction >>> 10) & 0xfff;
    offset = BigInt(imm) << BigInt(loadStoreSize(instruction));
  } else {
    const imm = (instruction >>> 12) & 0x1ff;
    offset = signExtend(BigInt(imm), 9n) << BigInt(loadStoreSize(instruction));
  }

  const address = base + offset;
  if (writeback) {
    cpu.state.setX(rn, address);
  }

  return address;
}

function loadStoreSize(instruction: number): number {
  return (instruction >>> 30) & 3;
}

function isSignedLoad(instruction: number): boolean {
  const size = loadStoreSize(instruction);
  if (size === 3) {
    return (instruction & 0x00400000) !== 0 && (instruction & 0x00200000) !== 0;
  }
  return ((instruction >>> 22) & 3) === 3 && (instruction & 0x00400000) !== 0;
}

function decodeLogicalImmediate(instruction: number, width: bigint): bigint {
  const immr = (instruction >>> 16) & 0x3f;
  const imms = (instruction >>> 10) & 0x3f;
  const n = (instruction >>> 22) & 1;

  if (n === 0 && imms >= 32) {
    throw new CpuExecutionError('Invalid logical immediate encoding');
  }

  const len = n === 1 ? 64 : 1 << highestSetBit(imms);
  const s = imms & (len - 1);
  const r = immr & (len - 1);
  const ones = s + 1;
  const patternMask = (1n << BigInt(len)) - 1n;
  const pattern = rotateLeft((1n << BigInt(ones)) - 1n, r, len) & patternMask;
  const widthMask = (1n << width) - 1n;

  let result = 0n;
  for (let offset = 0; offset < Number(width); offset += len) {
    result |= pattern << BigInt(offset);
  }

  return result & widthMask;
}

function highestSetBit(value: number): number {
  for (let bit = 5; bit >= 0; bit--) {
    if (((value >>> bit) & 1) !== 0) {
      return bit;
    }
  }
  return 0;
}

function rotateLeft(value: bigint, amount: number, width: number): bigint {
  const mask = (1n << BigInt(width)) - 1n;
  const shift = BigInt(amount % width);
  return ((value << shift) | (value >> BigInt(width - Number(shift)))) & mask;
}

function signExtend(value: bigint, bits: bigint): bigint {
  const signBit = 1n << (bits - 1n);
  const mask = (1n << bits) - 1n;
  return (value & mask) >= signBit ? (value & mask) | (~mask) : value & mask;
}

export function decodeInstructionGroup(instruction: number): InstructionGroup {
  return decodeInstruction(instruction).group;
}
