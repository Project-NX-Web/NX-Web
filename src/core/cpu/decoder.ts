// ARM64 instruction decoder — extracts fields from 32-bit instruction words

export enum InstructionGroup {
  DataProcessingImm,
  Branch,
  LoadStore,
  DataProcessingReg,
  FpSimd,
  System,
  Unknown,
}

export interface DecodedInstruction {
  group: InstructionGroup;
  raw: number;
  // Common fields extracted for convenience
  rd: number;     // Destination register
  rn: number;     // First source register
  rm: number;     // Second source register
  imm: number;    // Immediate value (varies by instruction)
  sf: boolean;    // 64-bit operation flag
  op: number;     // Sub-operation code
}

export function decodeInstruction(inst: number): DecodedInstruction {
  const op0 = (inst >>> 25) & 0xF;
  const sf = (inst >>> 31) & 1;
  const rd = inst & 0x1F;
  const rn = (inst >>> 5) & 0x1F;
  const rm = (inst >>> 16) & 0x1F;

  let group: InstructionGroup;
  let imm = 0;
  let op = 0;

  // Top-level decode based on bits [28:25]
  switch (op0) {
    case 0b1000:
    case 0b1001:
      // Data processing — immediate
      group = InstructionGroup.DataProcessingImm;
      op = (inst >>> 23) & 0x7;
      imm = extractImmediate(inst, group, op);
      break;

    case 0b1010:
    case 0b1011:
      // Branch, exception generation, system
      if ((inst & 0x7C000000) === 0x14000000) {
        group = InstructionGroup.Branch;
      } else if ((inst & 0xFE000000) === 0xD4000000) {
        group = InstructionGroup.System;
      } else if ((inst & 0xFF000000) === 0xD5000000) {
        group = InstructionGroup.System;
      } else {
        group = InstructionGroup.Branch;
      }
      op = (inst >>> 26) & 0x3F;
      imm = extractBranchImm(inst);
      break;

    case 0b0100:
    case 0b0110:
    case 0b1100:
    case 0b1110:
      // Loads and stores
      group = InstructionGroup.LoadStore;
      op = (inst >>> 22) & 0x3;
      imm = extractLsImm(inst);
      break;

    case 0b0101:
    case 0b1101:
      // Data processing — register
      group = InstructionGroup.DataProcessingReg;
      op = (inst >>> 21) & 0xF;
      break;

    case 0b0111:
    case 0b1111:
      // FP/SIMD
      group = InstructionGroup.FpSimd;
      op = (inst >>> 21) & 0xF;
      break;

    default:
      group = InstructionGroup.Unknown;
  }

  return { group, raw: inst, rd, rn, rm, imm, sf: sf === 1, op };
}

function extractImmediate(inst: number, _group: InstructionGroup, op: number): number {
  switch (op) {
    case 0b010: // ADD/SUB immediate
    case 0b011:
      return (inst >>> 10) & 0xFFF;
    case 0b100: // Logical immediate — complex encoding
      return (inst >>> 10) & 0x1FFF;
    case 0b101: // MOVZ/MOVN/MOVK
      return (inst >>> 5) & 0xFFFF;
    default:
      return 0;
  }
}

function extractBranchImm(inst: number): number {
  const op = (inst >>> 26) & 0x3F;

  if (op === 0b000101 || op === 0b100101) {
    // B / BL — 26-bit signed offset
    let imm26 = inst & 0x3FFFFFF;
    if (imm26 & 0x2000000) imm26 |= ~0x3FFFFFF; // sign extend
    return imm26 << 2;
  }

  if ((op & 0b111110) === 0b010100) {
    // B.cond — 19-bit signed offset
    let imm19 = (inst >>> 5) & 0x7FFFF;
    if (imm19 & 0x40000) imm19 |= ~0x7FFFF;
    return imm19 << 2;
  }

  if ((op & 0b111110) === 0b011010) {
    // CBZ/CBNZ — 19-bit signed offset
    let imm19 = (inst >>> 5) & 0x7FFFF;
    if (imm19 & 0x40000) imm19 |= ~0x7FFFF;
    return imm19 << 2;
  }

  return 0;
}

function extractLsImm(inst: number): number {
  // Unsigned offset: imm12 at bits [21:10]
  return (inst >>> 10) & 0xFFF;
}
