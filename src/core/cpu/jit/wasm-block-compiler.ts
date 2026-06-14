// Safe limited WASM block compiler for Phase 7.
//
// This compiler emits WebAssembly binary directly for a narrow subset of ARM64
// integer-immediate blocks. It is intentionally conservative: any unsupported
// instruction, memory access, conditional branch, SVC, or BRK leaves the block
// uncompiled so the interpreter remains the fallback.

import { liftInstruction, type BasicBlock, type IrOpcode, type IrOperation } from './block-ir';

const REGISTER_COUNT = 32;
const I64 = 0x7e;

export interface CompiledWasmBlock {
  pc: bigint;
  instance: WebAssembly.Instance;
  rawInstructions: number[];
  run(registers: readonly bigint[] | BigInt64Array, sp: bigint): bigint[];
}

export interface WasmBlockCompilerOptions {
  maxInstructions?: number;
}

export class WasmBlockCompiler {
  private readonly cache = new Map<string, CompiledWasmBlock>();

  constructor(private readonly options: WasmBlockCompilerOptions = {}) {}

  compileOrGet(block: BasicBlock): CompiledWasmBlock | undefined {
    const key = this.cacheKey(block);
    const cached = this.cache.get(key);
    if (cached) {
      return cached;
    }

    try {
      const compiled = this.compile(block);
      this.cache.set(key, compiled);
      return compiled;
    } catch (error) {
      console.error(error);
      return undefined;
    }
  }

  invalidate(pc: bigint): void {
    const prefix = `${pc.toString(16)}:`;
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        this.cache.delete(key);
      }
    }
  }

  clear(): void {
    this.cache.clear();
  }

  get size(): number {
    return this.cache.size;
  }

  private compile(block: BasicBlock): CompiledWasmBlock {
    const operations = this.compilableOperations(block);
    const bodyInstructions: number[] = [];

    for (const operation of operations) {
      this.emitOperation(operation, bodyInstructions);
    }

    for (let reg = 0; reg < REGISTER_COUNT; reg++) {
      emitGetLocal(reg, bodyInstructions);
    }

    const module = buildWasmModule(bodyInstructions);
    const instance = new WebAssembly.Instance(module);
    const run = instance.exports.run as (...values: bigint[]) => bigint[];

    return {
      pc: block.pc,
      instance,
      rawInstructions: operations.map((operation) => operation.raw),
      run(registers: readonly bigint[] | BigInt64Array, sp: bigint): bigint[] {
        const params = [...registers.slice(0, REGISTER_COUNT - 1), sp];
        return run(...params);
      },
    };
  }

  private compilableOperations(block: BasicBlock): IrOperation[] {
    const compilable = new Set<IrOpcode>(['nop', 'movz', 'movk', 'addImm', 'subImm']);
    const operations: IrOperation[] = [];

    for (const instruction of block.instructions) {
      if (isTerminal(instruction)) {
        break;
      }
      if (!compilable.has(instruction.opcode)) {
        throw new Error(`Unsupported WASM block instruction ${instruction.opcode}`);
      }
      operations.push(liftInstruction(instruction.raw, instruction.pc));
    }

    if (operations.length === 0) {
      throw new Error('No compilable instructions in block');
    }

    return operations;
  }

  private emitOperation(operation: IrOperation, bodyInstructions: number[]): void {
    switch (operation.opcode) {
      case 'nop':
        break;
      case 'movz':
        emitI64Const(operation.imm ?? 0n, bodyInstructions);
        emitLocalSet(operation.rd, bodyInstructions);
        break;
      case 'movk':
        emitGetLocal(operation.rd, bodyInstructions);
        emitI64Const(operation.imm ?? 0n, bodyInstructions);
        bodyInstructions.push(0x84);
        emitLocalSet(operation.rd, bodyInstructions);
        break;
      case 'addImm':
        emitGetLocal(operation.rn, bodyInstructions);
        emitI64Const(operation.imm ?? 0n, bodyInstructions);
        bodyInstructions.push(0x7c);
        emitLocalSet(operation.rd, bodyInstructions);
        break;
      case 'subImm':
        emitGetLocal(operation.rn, bodyInstructions);
        emitI64Const(operation.imm ?? 0n, bodyInstructions);
        bodyInstructions.push(0x7d);
        emitLocalSet(operation.rd, bodyInstructions);
        break;
      default:
        throw new Error(`Unsupported WASM block instruction ${operation.opcode}`);
    }

    if (operation.width === 32 && operation.opcode !== 'nop') {
      emitGetLocal(operation.rd, bodyInstructions);
      emitI64Const(0xffffffffn, bodyInstructions);
      bodyInstructions.push(0x83);
      emitLocalSet(operation.rd, bodyInstructions);
    }
  }

  private cacheKey(block: BasicBlock): string {
    return `${block.pc.toString(16)}:${block.rawInstructions.join(':')}`;
  }
}

function isTerminal(operation: IrOperation): boolean {
  return operation.opcode === 'branch' || operation.opcode === 'halt' || operation.opcode === 'unsupported';
}

function emitGetLocal(reg: number | undefined, out: number[]): void {
  if (reg === undefined || reg < 0 || reg >= REGISTER_COUNT) {
    throw new Error(`Invalid register ${reg}`);
  }
  out.push(0x20, ...encodeUnsignedLeb128(reg));
}

function emitLocalSet(reg: number | undefined, out: number[]): void {
  if (reg === undefined || reg < 0 || reg >= REGISTER_COUNT) {
    throw new Error(`Invalid register ${reg}`);
  }
  out.push(0x21, ...encodeUnsignedLeb128(reg));
}

function emitI64Const(value: bigint, out: number[]): void {
  out.push(0x42);
  emitSignedLeb128(toI64Signed(value), out);
}

function toI64Signed(value: bigint): bigint {
  const masked = BigInt.asUintN(64, value);
  return masked >= (1n << 63n) ? masked - (1n << 64n) : masked;
}

function emitSignedLeb128(value: bigint, out: number[]): void {
  let current = value;
  let more = true;
  while (more) {
    let byte = Number(current & 0x7fn);
    current >>= 7n;
    const signBit = (byte & 0x40) !== 0;
    more = !((current === 0n && !signBit) || (current === -1n && signBit));
    if (more) {
      byte |= 0x80;
    }
    out.push(byte);
  }
}

function buildWasmModule(bodyInstructions: number[]): WebAssembly.Module {
  const params = Array.from({ length: REGISTER_COUNT }, () => I64);
  const results = Array.from({ length: REGISTER_COUNT }, () => I64);
  const typePayload = [0x01, 0x60, REGISTER_COUNT, ...params, REGISTER_COUNT, ...results];
  const typeSection = [0x01, ...encodeUnsignedLeb128(typePayload.length), ...typePayload];
  const functionSection = [0x03, 0x02, 0x01, 0x00];
  const exportSection = [
    0x07,
    0x07,
    0x01,
    0x03,
    'r'.charCodeAt(0),
    'u'.charCodeAt(0),
    'n'.charCodeAt(0),
    0x00,
    0x00,
  ];
  const codeSection = encodeCodeSection(bodyInstructions);

  const bytes = [
    0x00,
    0x61,
    0x73,
    0x6d,
    0x01,
    0x00,
    0x00,
    0x00,
    ...typeSection,
    ...functionSection,
    ...exportSection,
    ...codeSection,
  ];
  return new WebAssembly.Module(Uint8Array.from(bytes));
}

function encodeCodeSection(bodyInstructions: number[]): number[] {
  const body = [0x00, ...bodyInstructions, 0x0b];
  const bodySize = encodeUnsignedLeb128(body.length);
  return [0x0a, ...encodeUnsignedLeb128(1 + bodySize.length + body.length), 0x01, ...bodySize, ...body];
}

function encodeUnsignedLeb128(value: number): number[] {
  const out: number[] = [];
  let current = value;
  do {
    let byte = current & 0x7f;
    current >>>= 7;
    if (current !== 0) {
      byte |= 0x80;
    }
    out.push(byte);
  } while (current !== 0);
  return out;
}
