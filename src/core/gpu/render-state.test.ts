import { describe, expect, it } from 'vitest';
import {
  BlendFactor,
  CompareFunction,
  CullMode,
  FrontFace,
  MaxwellMethod,
  MaxwellRenderState,
  PrimitiveTopology,
} from './render-state';

describe('MaxwellRenderState', () => {
  it('applies viewport, render target, topology, blend, depth, rasterizer, and draw methods', () => {
    const state = new MaxwellRenderState();
    state.applyMethods([
      { method: MaxwellMethod.ViewportX, value: 10 },
      { method: MaxwellMethod.ViewportY, value: 20 },
      { method: MaxwellMethod.ViewportWidth, value: 640 },
      { method: MaxwellMethod.ViewportHeight, value: 480 },
      { method: MaxwellMethod.RenderTargetAddress, value: 0x4800 },
      { method: MaxwellMethod.RenderTargetAddressLow, value: 0x1000 },
      { method: MaxwellMethod.RenderTargetWidth, value: 640 },
      { method: MaxwellMethod.RenderTargetHeight, value: 480 },
      { method: MaxwellMethod.PrimitiveTopology, value: 3 },
      { method: MaxwellMethod.BlendEnable, value: 1 },
      { method: MaxwellMethod.BlendSrcFactor, value: 6 },
      { method: MaxwellMethod.BlendDstFactor, value: 7 },
      { method: MaxwellMethod.DepthEnable, value: 1 },
      { method: MaxwellMethod.DepthWriteEnable, value: 0 },
      { method: MaxwellMethod.DepthCompare, value: 3 },
      { method: MaxwellMethod.CullMode, value: 2 },
      { method: MaxwellMethod.FrontFace, value: 1 },
      { method: MaxwellMethod.VertexCount, value: 3 },
      { method: MaxwellMethod.InstanceCount, value: 2 },
    ]);

    const snapshot = state.snapshot();

    expect(snapshot.viewport).toEqual({ x: 10, y: 20, width: 640, height: 480, minDepth: 0, maxDepth: 1 });
    expect(snapshot.renderTarget.address).toBe(0x48001000n);
    expect(snapshot.renderTarget.width).toBe(640);
    expect(snapshot.renderTarget.height).toBe(480);
    expect(snapshot.topology).toBe(PrimitiveTopology.TriangleStrip);
    expect(snapshot.blend).toMatchObject({
      enabled: true,
      srcFactor: BlendFactor.SrcAlpha,
      dstFactor: BlendFactor.OneMinusSrcAlpha,
    });
    expect(snapshot.depth).toMatchObject({
      enabled: true,
      writeEnabled: false,
      compareFunction: CompareFunction.LessEqual,
    });
    expect(snapshot.rasterizer).toEqual({ cullMode: CullMode.Back, frontFace: FrontFace.CW });
    expect(snapshot.draw.vertexCount).toBe(3);
    expect(snapshot.draw.instanceCount).toBe(2);
  });

  it('ignores unknown methods and clones snapshots', () => {
    const state = new MaxwellRenderState();

    expect(state.applyMethod(0xffff, 1)).toBe(false);

    state.applyMethod(MaxwellMethod.VertexCount, 9);
    const clone = state.clone();
    clone.applyMethod(MaxwellMethod.VertexCount, 12);

    expect(state.snapshot().draw.vertexCount).toBe(9);
    expect(clone.snapshot().draw.vertexCount).toBe(12);
  });
});
