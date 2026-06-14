import { describe, expect, it } from 'vitest';
import { makeNv2aClassToken, makeNv2aMethodHeader, MAXWELL_3D_ENGINE_CLASS } from './maxwell';
import { MaxwellMethod } from './render-state';
import { MaxwellOpcode } from './shader';
import { TextureFormat, AstcBlockSize, decodeSyntheticAstc4x4 } from './texture';
import { SyntheticGpuRenderer } from './renderer';

function writeU32(data: Uint8Array, offset: number, value: number): void {
  new DataView(data.buffer, data.byteOffset, data.byteLength).setUint32(offset, value, true);
}

describe('Phase 5 GPU integration', () => {
  it('submits a synthetic GPFIFO, applies Maxwell state, compiles shaders, and presents a frame', () => {
    const commandOffset = 36;
    const commandBytes = 9 * 4;
    const commandBuffer = new Uint8Array(commandOffset + commandBytes);
    writeU32(commandBuffer, 0, commandOffset);
    writeU32(commandBuffer, 4, commandBytes);

    const commands = new Uint32Array(commandBuffer.buffer, commandOffset, commandBytes / 4);
    commands[0] = makeNv2aClassToken(MAXWELL_3D_ENGINE_CLASS);
    commands[1] = makeNv2aMethodHeader(MaxwellMethod.RenderTargetWidth, 1);
    commands[2] = 640;
    commands[3] = makeNv2aMethodHeader(MaxwellMethod.RenderTargetHeight, 1);
    commands[4] = 480;
    commands[5] = makeNv2aMethodHeader(MaxwellMethod.PrimitiveTopology, 1);
    commands[6] = 2;
    commands[7] = makeNv2aMethodHeader(MaxwellMethod.VertexCount, 1);
    commands[8] = 3;

    const renderer = new SyntheticGpuRenderer();
    renderer.textureCache.set({
      address: 0x49000000n,
      size: 16,
      format: TextureFormat.ASTC4x4,
      width: 4,
      height: 4,
    }, decodeSyntheticAstc4x4(new Uint8Array(16)));

    const frame = renderer.submit({
      commandBuffer,
      vertexInstructions: [
        { opcode: MaxwellOpcode.MOV32I, dst: 'r0', imm: 0x3f800000 },
        { opcode: MaxwellOpcode.FADD, dst: 'r1', src: ['r0', 'r0'] },
      ],
      fragmentInstructions: [
        { opcode: MaxwellOpcode.MOV32I, dst: 'r0', imm: 0x3f800000 },
        { opcode: MaxwellOpcode.FMUL, dst: 'r1', src: ['r0', 'r0'] },
        { opcode: MaxwellOpcode.TEX, dst: 'r2', texture: 'texture0' },
      ],
    });
    const presented = renderer.present();
    const snapshot = renderer.renderState.snapshot();

    expect(frame.frameId).toBe(1);
    expect(frame.vertexShaderInstructions).toBe(2);
    expect(frame.fragmentShaderInstructions).toBe(3);
    expect(frame.textureCount).toBe(1);
    expect(presented.frameId).toBe(1);
    expect(snapshot.renderTarget.width).toBe(640);
    expect(snapshot.renderTarget.height).toBe(480);
    expect(snapshot.topology).toBe('triangle-list');
    expect(snapshot.draw.vertexCount).toBe(3);
  });
});
