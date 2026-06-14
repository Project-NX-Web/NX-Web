import { describe, expect, it } from 'vitest';
import { createSyntheticRenderPipelineDescriptor, getWebGpuCapabilitySnapshot } from './pipeline';
import { MaxwellRenderState, MaxwellMethod } from './render-state';

describe('synthetic WebGPU render pipeline', () => {
  it('builds a render-pipeline descriptor from Maxwell render state', () => {
    const state = new MaxwellRenderState();
    state.applyMethods([
      { method: MaxwellMethod.PrimitiveTopology, value: 2 },
      { method: MaxwellMethod.BlendEnable, value: 1 },
      { method: MaxwellMethod.BlendSrcFactor, value: 6 },
      { method: MaxwellMethod.BlendDstFactor, value: 7 },
      { method: MaxwellMethod.BlendOperation, value: 0 },
      { method: MaxwellMethod.DepthEnable, value: 1 },
      { method: MaxwellMethod.DepthWriteEnable, value: 1 },
      { method: MaxwellMethod.DepthCompare, value: 1 },
      { method: MaxwellMethod.CullMode, value: 2 },
      { method: MaxwellMethod.FrontFace, value: 0 },
    ]);

    const descriptor = createSyntheticRenderPipelineDescriptor(state.snapshot(), { label: 'triangle-test' });

    expect(descriptor.label).toBe('triangle-test');
    expect(descriptor.primitive.topology).toBe('triangle-list');
    expect(descriptor.fragment.targets[0].format).toBe('rgba8-unorm');
    expect(descriptor.colorStates[0].blend?.color).toMatchObject({
      srcFactor: 'src-alpha',
      dstFactor: 'one-minus-src-alpha',
      operation: 'add',
    });
    expect(descriptor.depthStencil).toMatchObject({
      format: 'depth24plus',
      depthWriteEnabled: true,
      depthCompare: 'less',
    });
    expect(descriptor.raster).toEqual({ cullMode: 'back', frontFace: 'ccw' });
  });

  it('exposes a capability snapshot even when WebGPU is unavailable', () => {
    const capabilities = getWebGpuCapabilitySnapshot();

    expect(capabilities).toHaveProperty('available');
    expect(capabilities).toHaveProperty('astcSupported');
  });
});
