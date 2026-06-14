// Phase 5 synthetic renderer facade.
//
// This class ties command ingestion, render state, shader compilation, texture
// cache, and presentation into a deterministic object that can be tested without
// a live WebGPU device.

import { parseGpfifo } from './gpfifo';
import { parseMaxwellStream } from './maxwell';
import { createSyntheticRenderPipelineDescriptor } from './pipeline';
import { MaxwellRenderState } from './render-state';
import { compileMaxwellShaderToWgsl, MaxwellOpcode, type MaxwellInstruction } from './shader';
import { TextureCache } from './texture';

export interface GpuSubmitOptions {
  commandBuffer: Uint8Array;
  vertexInstructions?: MaxwellInstruction[];
  fragmentInstructions?: MaxwellInstruction[];
}

export interface GpuFrame {
  frameId: number;
  pipelineLabel: string;
  vertexShaderInstructions: number;
  fragmentShaderInstructions: number;
  textureCount: number;
}

export class SyntheticGpuRenderer {
  readonly renderState = new MaxwellRenderState();
  readonly textureCache = new TextureCache();
  private frameId = 0;

  submit(options: GpuSubmitOptions): GpuFrame {
    const gpfifoEntries = parseGpfifo(options.commandBuffer);
    for (const entry of gpfifoEntries) {
      const commandBytes = options.commandBuffer.subarray(Number(entry.pointer & 0xffffffffn), Number(entry.pointer & 0xffffffffn) + entry.size);
      const commandWords = new Uint32Array(commandBytes.buffer, commandBytes.byteOffset, Math.floor(commandBytes.byteLength / 4));
      const stream = parseMaxwellStream(commandWords);
      this.renderState.applyMethods(stream.methods);
    }

    const vertexShader = compileMaxwellShaderToWgsl(options.vertexInstructions ?? [
      { opcode: MaxwellOpcode.MOV32I, dst: 'r0', imm: 0x3f800000 },
    ]);
    const fragmentShader = compileMaxwellShaderToWgsl(options.fragmentInstructions ?? [
      { opcode: MaxwellOpcode.MOV32I, dst: 'r0', imm: 0x3f800000 },
    ]);
    const pipeline = createSyntheticRenderPipelineDescriptor(this.renderState.snapshot());

    this.frameId++;
    return {
      frameId: this.frameId,
      pipelineLabel: pipeline.label,
      vertexShaderInstructions: vertexShader.instructions.length,
      fragmentShaderInstructions: fragmentShader.instructions.length,
      textureCount: this.textureCache.size,
    };
  }

  present(): GpuFrame {
    return {
      frameId: this.frameId,
      pipelineLabel: 'present',
      vertexShaderInstructions: 0,
      fragmentShaderInstructions: 0,
      textureCount: this.textureCache.size,
    };
  }
}
