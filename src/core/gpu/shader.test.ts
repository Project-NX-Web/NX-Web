import { describe, expect, it } from 'vitest';
import {
  compileMaxwellShaderToWgsl,
  MaxwellOpcode,
  parseSyntheticMaxwellInstructions,
  ShaderCompileError,
} from './shader';

describe('synthetic Maxwell shader compiler', () => {
  it('compiles critical instruction families to valid WGSL text', () => {
    const shader = compileMaxwellShaderToWgsl([
      { opcode: MaxwellOpcode.MOV32I, dst: 'r0', imm: 0x3f800000 },
      { opcode: MaxwellOpcode.FADD, dst: 'r1', src: ['r0', 'r0'] },
      { opcode: MaxwellOpcode.FMUL, dst: 'r2', src: ['r1', 'r1'] },
      { opcode: MaxwellOpcode.FFMA, dst: 'r3', src: ['r2', 'r1', 'r0'] },
      { opcode: MaxwellOpcode.ISETP, dst: 'r4', src: ['r3', 'r0'] },
      { opcode: MaxwellOpcode.BRA, target: 0x20 },
      { opcode: MaxwellOpcode.LD, dst: 'r5', address: 0x48000000n },
      { opcode: MaxwellOpcode.ST, dst: 'r5', address: 0x48001000n },
      { opcode: MaxwellOpcode.TEX, dst: 'r6', texture: 'texture0' },
    ]);

    expect(shader.wgsl).toContain('@vertex');
    expect(shader.wgsl).toContain('@fragment');
    expect(shader.wgsl).toContain('var r1: f32 = r0 + r0;');
    expect(shader.wgsl).toContain('var r3: f32 = (r2 * r1) + r0;');
    expect(shader.wgsl).toContain('select(0u, 1u');
    expect(shader.wgsl).toContain('// sample texture0');
  });

  it('parses synthetic Maxwell instruction words', () => {
    const movHeader = (MaxwellOpcode.MOV32I << 28) | 0;
    const words = new Uint32Array([movHeader, 0x3f800000]);

    expect(parseSyntheticMaxwellInstructions(words)).toEqual([
      { opcode: MaxwellOpcode.MOV32I, dst: 'r0', imm: 0x3f800000 },
    ]);
  });

  it('rejects empty and malformed shader programs', () => {
    expect(() => compileMaxwellShaderToWgsl([])).toThrow(ShaderCompileError);
    expect(() => parseSyntheticMaxwellInstructions(new Uint32Array([MaxwellOpcode.MOV32I << 28]))).toThrow(ShaderCompileError);
  });
});
