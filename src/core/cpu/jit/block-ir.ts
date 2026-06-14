// Deterministic ARM64 basic-block IR scaffold for Phase 7.
//
// This is not a full JIT front-end. It splits linear instruction sequences and
// records a small, testable IR for the simple patterns that the safe WASM block
// compiler can emit.

import type { VirtualMemoryManager } from '../../memory/vmm';
import { decodeInstruction, InstructionGroup } from '../decoder';

export type IrOpcode =
  | 'nop'
  | 'movz'
  | 'movk'
  | 'addImm'
  | 'subImm'
  | 'branch'
  | 'halt'
  | 'unsupported';

export type IrRegisterWidth = 32 | 64;

export interface IrOperation {
  opcode: IrOpcode;
  pc: bigint;
  raw: number;
  rd?: number;
  rn?: number;
  imm?: bigint;
  target?: bigint;
  width?: IrRegisterWidth;
}

export interface BasicBlock {
  pc: bigint;
  instructions: IrOperation[];
  terminal: IrOperation;
  rawInstructions: number[];
}

export interface BlockSplitOptions {
  maxInstructions?: number;
}

export function splitBasicBlock(vmm: VirtualMemoryManager, pc: bigint, options: BlockSplitOptions = {}): BasicBlock {
  const maxInstructions = options.maxInstructions ?? 32;
  const instructions: IrOperation[] = [];
  const rawInstructions: number[] = [];
  let cursor = pc;

  for (let index = 0; index < maxInstructions; index++) {
    vmm.checkExecute(cursor);
    const raw = vmm.read32(cursor);
    rawInstructions.push(raw);
    const operation = liftInstruction(raw, cursor);
    instructions.push(operation);

    if (isTerminal(operation)) {
      return { pc, instructions, terminal: operation, rawInstructions };
    }

    cursor += 4n;
  }

  const terminal = instructions[instructions.length - 1] ?? { opcode: 'halt', pc, raw: 0 };
  return { pc, instructions, terminal, rawInstructions };
}

export function liftInstruction(raw: number, pc: bigint): IrOperation {
  const decoded = decodeInstruction(raw);
  const common = { pc, raw };

  if (raw === 0xd503201f) {
    return { ...common, opcode: 'nop' };
  }

  if (((raw & 0x7f800000) >>> 0) === 0x52800000 || ((raw & 0x7f800000) >>> 0) === 0xf2800000) {
    return {
      ...common,
      opcode: 'movz',
      rd: decoded.rd,
      imm: decodeMovImmediate(raw),
      width: decodeRegisterWidth(raw),
    };
  }

  if (((raw & 0x7f800000) >>> 0) === 0x72800000 || ((raw & 0x7f800000) >>> 0) === 0x92800000) {
    return {
      ...common,
      opcode: 'movk',
      rd: decoded.rd,
      imm: decodeMovImmediate(raw),
      width: decodeRegisterWidth(raw),
    };
  }

  if (((raw & 0xff000000) >>> 0) === 0x11000000 || ((raw & 0xff000000) >>> 0) === 0x91000000) {
    return {
      ...common,
      opcode: 'addImm',
      rd: decoded.rd,
      rn: decoded.rn,
      imm: decodeAddSubImmediate(raw),
      width: decodeRegisterWidth(raw),
    };
  }

  if (((raw & 0xff000000) >>> 0) === 0x51000000 || ((raw & 0xff000000) >>> 0) === 0xd1000000) {
    return {
      ...common,
      opcode: 'subImm',
      rd: decoded.rd,
      rn: decoded.rn,
      imm: decodeAddSubImmediate(raw),
      width: decodeRegisterWidth(raw),
    };
  }

  if (((raw & 0xfc000000) >>> 0) === 0x14000000 || ((raw & 0xfc000000) >>> 0) === 0x94000000) {
    return {
      ...common,
      opcode: 'branch',
      target: pc + decodeBranchImm26(raw),
    };
  }

  if (((raw & 0xfff00000) >>> 0) === 0xd4000000 || ((raw & 0xfff00000) >>> 0) === 0xd4200000) {
    return { ...common, opcode: 'halt' };
  }

  if (decoded.group === InstructionGroup.Branch || decoded.group === InstructionGroup.System || decoded.group === InstructionGroup.LoadStore) {
    return { ...common, opcode: 'unsupported' };
  }

  return { ...common, opcode: 'unsupported' };
}

function isTerminal(operation: IrOperation): boolean {
  return operation.opcode === 'branch' || operation.opcode === 'halt' || operation.opcode === 'unsupported';
}

function decodeMovImmediate(raw: number): bigint {
  const imm16 = (raw >>> 5) & 0xffff;
  const hw = (raw >>> 21) & 3;
  return BigInt(imm16) << BigInt(hw * 16);
}

function decodeAddSubImmediate(raw: number): bigint {
  const imm12 = (raw >>> 10) & 0xfff;
  const shift = (raw >>> 22) & 1;
  return BigInt(imm12) << BigInt(shift ? 12 : 0);
}

function decodeBranchImm26(raw: number): bigint {
  let imm26 = raw & 0x03ffffff;
  if ((imm26 & 0x02000000) !== 0) {
    imm26 |= ~0x03ffffff;
  }
  return BigInt(imm26) << 2n;
}

function decodeRegisterWidth(raw: number): IrRegisterWidth {
  return (raw & 0x80000000) !== 0 ? 64 : 32;
}
