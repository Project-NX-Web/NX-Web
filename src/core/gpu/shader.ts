// Phase 5 synthetic Maxwell ISA → WGSL compiler.
//
// This is not a full Maxwell decompiler. It implements the first compiler pass
// for the critical instruction families listed in Agent.md and emits valid WGSL
// for synthetic test shaders. Real Maxwell ISA decoding remains future work.

export enum MaxwellOpcode {
  NOP = 0x0,
  MOV32I = 0x1,
  FADD = 0x2,
  FMUL = 0x3,
  FFMA = 0x4,
  ISETP = 0x5,
  BRA = 0x6,
  LD = 0x7,
  ST = 0x8,
  TEX = 0x9,
}

export interface MaxwellInstruction {
  opcode: MaxwellOpcode;
  dst?: string;
  src?: string[];
  imm?: number;
  target?: number;
  address?: bigint;
  texture?: string;
}

export interface CompiledShader {
  wgsl: string;
  instructions: MaxwellInstruction[];
}

export class ShaderCompileError extends Error {
  constructor(message: string) {
    super(message);
  }
}

export function compileMaxwellShaderToWgsl(instructions: MaxwellInstruction[]): CompiledShader {
  if (instructions.length === 0) {
    throw new ShaderCompileError('Cannot compile an empty Maxwell instruction list');
  }

  const body = instructions.map(compileInstruction).filter(Boolean).join('\n  ');
  return {
    instructions,
    wgsl: `
struct VertexInput {
  @location(0) position: vec2<f32>,
};

@vertex
fn vs_main(input: VertexInput) -> @builtin(position) vec4<f32> {
  return vec4<f32>(input.position, 0.0, 1.0);
}

@fragment
fn fs_main() -> @location(0) vec4<f32> {
  ${body}
  return vec4<f32>(1.0, 0.0, 0.0, 1.0);
}
`.trimStart(),
  };
}

export function parseSyntheticMaxwellInstructions(words: Uint32Array): MaxwellInstruction[] {
  const instructions: MaxwellInstruction[] = [];
  let index = 0;

  while (index < words.length) {
    const header = words[index];
    const opcode = (header >>> 28) & 0xf;
    const dst = regName(header & 0xff);
    const src0 = regName((header >>> 8) & 0xff);
    const src1 = regName((header >>> 16) & 0xff);
    const src2 = regName((header >>> 24) & 0x0f);

    switch (opcode) {
      case MaxwellOpcode.NOP:
        instructions.push({ opcode: MaxwellOpcode.NOP });
        index++;
        break;
      case MaxwellOpcode.MOV32I:
        if (index + 1 >= words.length) {
          throw new ShaderCompileError('MOV32I missing immediate word');
        }
        instructions.push({ opcode: MaxwellOpcode.MOV32I, dst, imm: words[index + 1] });
        index += 2;
        break;
      case MaxwellOpcode.FADD:
      case MaxwellOpcode.FMUL:
      case MaxwellOpcode.FFMA:
      case MaxwellOpcode.ISETP:
        instructions.push({
          opcode,
          dst,
          src: opcode === MaxwellOpcode.FFMA ? [src0, src1, src2] : [src0, src1],
        });
        index++;
        break;
      case MaxwellOpcode.BRA:
        instructions.push({ opcode: MaxwellOpcode.BRA, target: header & 0x0fffffff });
        index++;
        break;
      case MaxwellOpcode.LD:
      case MaxwellOpcode.ST:
        if (index + 1 >= words.length) {
          throw new ShaderCompileError(`${MaxwellOpcode[opcode]} missing address word`);
        }
        instructions.push({ opcode, dst, address: BigInt(words[index + 1]) });
        index += 2;
        break;
      case MaxwellOpcode.TEX:
        instructions.push({ opcode: MaxwellOpcode.TEX, dst, texture: `texture${header & 0xff}` });
        index++;
        break;
      default:
        throw new ShaderCompileError(`Unsupported synthetic Maxwell opcode 0x${opcode.toString(16)}`);
    }
  }

  return instructions;
}

function compileInstruction(instruction: MaxwellInstruction): string {
  switch (instruction.opcode) {
    case MaxwellOpcode.NOP:
      return '// nop';
    case MaxwellOpcode.MOV32I:
      return `var ${instruction.dst}: f32 = ${floatLiteral(instruction.imm ?? 0)};`;
    case MaxwellOpcode.FADD:
      return `var ${instruction.dst}: f32 = ${instruction.src?.[0] ?? '0.0'} + ${instruction.src?.[1] ?? '0.0'};`;
    case MaxwellOpcode.FMUL:
      return `var ${instruction.dst}: f32 = ${instruction.src?.[0] ?? '1.0'} * ${instruction.src?.[1] ?? '1.0'};`;
    case MaxwellOpcode.FFMA:
      return `var ${instruction.dst}: f32 = (${instruction.src?.[0] ?? '0.0'} * ${instruction.src?.[1] ?? '0.0'}) + ${instruction.src?.[2] ?? '0.0'};`;
    case MaxwellOpcode.ISETP:
      return `var ${instruction.dst}: u32 = select(0u, 1u, (${instruction.src?.[0] ?? '0.0'} < ${instruction.src?.[1] ?? '0.0'}));`;
    case MaxwellOpcode.BRA:
      return `// branch to synthetic target ${instruction.target ?? 0}`;
    case MaxwellOpcode.LD:
      return `// load from guest address 0x${(instruction.address ?? 0n).toString(16)} into ${instruction.dst ?? 'value'}`;
    case MaxwellOpcode.ST:
      return `// store ${instruction.dst ?? 'value'} to guest address 0x${(instruction.address ?? 0n).toString(16)}`;
    case MaxwellOpcode.TEX:
      return `// sample ${instruction.texture ?? 'texture'} into ${instruction.dst ?? 'color'}`;
    default:
      throw new ShaderCompileError(`Unsupported Maxwell opcode ${instruction.opcode}`);
  }
}

function regName(value: number): string {
  return `r${value}`;
}

function floatLiteral(value: number): string {
  const floatValue = new DataView(new Uint32Array([value]).buffer).getFloat32(0, true);
  return `${floatValue.toFixed(6)}f`;
}
