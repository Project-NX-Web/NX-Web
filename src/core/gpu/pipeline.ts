// Phase 5 WebGPU render-pipeline scaffolding.
//
// This module builds deterministic render-pipeline descriptors from synthetic
// Maxwell render state. It does not require a live WebGPU device, which keeps
// tests portable while preserving the shape needed for real submission later.

import type { MaxwellRenderStateSnapshot, PrimitiveTopology } from './render-state';

export interface SyntheticRenderPipelineDescriptor {
  label: string;
  vertex: {
    moduleLabel: string;
    entryPoint: 'vs_main';
  };
  fragment: {
    moduleLabel: string;
    entryPoint: 'fs_main';
    targets: Array<{ format: 'rgba8-unorm' }>;
  };
  primitive: {
    topology: GPUPrimitiveTopology;
  };
  colorStates: Array<{
    format: 'rgba8-unorm';
    blend?: GPUBlendState;
  }>;
  depthStencil?: {
    format: 'depth24plus';
    depthWriteEnabled: boolean;
    depthCompare: GPUCompareFunction;
  };
  raster: {
    cullMode: GPUCullMode;
    frontFace: GPUFrontFace;
  };
}

export interface WebGpuCapabilitySnapshot {
  available: boolean;
  astcSupported: boolean;
  reason?: string;
}

export function createSyntheticRenderPipelineDescriptor(
  state: MaxwellRenderStateSnapshot,
  options: { label?: string; vertexModuleLabel?: string; fragmentModuleLabel?: string } = {},
): SyntheticRenderPipelineDescriptor {
  return {
    label: options.label ?? 'nx-web-synthetic-maxwell-pipeline',
    vertex: {
      moduleLabel: options.vertexModuleLabel ?? 'maxwell-vertex-module',
      entryPoint: 'vs_main',
    },
    fragment: {
      moduleLabel: options.fragmentModuleLabel ?? 'maxwell-fragment-module',
      entryPoint: 'fs_main',
      targets: [{ format: state.renderTarget.format }],
    },
    primitive: {
      topology: toGpuPrimitiveTopology(state.topology),
    },
    colorStates: [{
      format: state.renderTarget.format,
      blend: state.blend.enabled ? {
        color: {
          srcFactor: toGpuBlendFactor(state.blend.srcFactor),
          dstFactor: toGpuBlendFactor(state.blend.dstFactor),
          operation: toGpuBlendOperation(state.blend.operation),
        },
        alpha: {
          srcFactor: toGpuBlendFactor(state.blend.srcFactor),
          dstFactor: toGpuBlendFactor(state.blend.dstFactor),
          operation: toGpuBlendOperation(state.blend.operation),
        },
      } : undefined,
    }],
    depthStencil: state.depth.enabled ? {
      format: 'depth24plus',
      depthWriteEnabled: state.depth.writeEnabled,
      depthCompare: toGpuCompareFunction(state.depth.compareFunction),
    } : undefined,
    raster: {
      cullMode: toGpuCullMode(state.rasterizer.cullMode),
      frontFace: state.rasterizer.frontFace === 'cw' ? 'cw' : 'ccw',
    },
  };
}

export function getWebGpuCapabilitySnapshot(): WebGpuCapabilitySnapshot {
  const navigatorWithGpu = globalThis.navigator as Navigator & { gpu?: unknown };
  if (typeof navigatorWithGpu?.gpu === 'undefined') {
    return {
      available: false,
      astcSupported: false,
      reason: 'navigator.gpu is unavailable in this environment',
    };
  }

  const adapterFeatures = new Set<string>();
  return {
    available: true,
    astcSupported: adapterFeatures.has('texture-compression-astc'),
  };
}

function toGpuPrimitiveTopology(topology: PrimitiveTopology): GPUPrimitiveTopology {
  switch (topology) {
    case 'point-list':
      return 'point-list';
    case 'line-list':
      return 'line-list';
    case 'triangle-strip':
      return 'triangle-strip';
    case 'triangle-list':
    default:
      return 'triangle-list';
  }
}

function toGpuBlendFactor(factor: import('./render-state').BlendFactor): GPUBlendFactor {
  switch (factor) {
    case 'zero':
      return 'zero';
    case 'one':
      return 'one';
    case 'src-alpha':
      return 'src-alpha';
    case 'one-minus-src-alpha':
      return 'one-minus-src-alpha';
  }
  return 'one';
}

function toGpuBlendOperation(operation: import('./render-state').BlendOperation): GPUBlendOperation {
  switch (operation) {
    case 'add':
      return 'add';
    case 'subtract':
      return 'subtract';
    case 'reverse-subtract':
      return 'reverse-subtract';
  }
  return 'add';
}

function toGpuCompareFunction(compare: import('./render-state').CompareFunction): GPUCompareFunction {
  switch (compare) {
    case 'never':
      return 'never';
    case 'less':
      return 'less';
    case 'equal':
      return 'equal';
    case 'less-equal':
      return 'less-equal';
    case 'greater':
      return 'greater';
    case 'not-equal':
      return 'not-equal';
    case 'greater-equal':
      return 'greater-equal';
    case 'always':
      return 'always';
  }
  return 'always';
}

function toGpuCullMode(mode: import('./render-state').CullMode): GPUCullMode {
  switch (mode) {
    case 'front':
      return 'front';
    case 'back':
      return 'back';
    case 'none':
    default:
      return 'none';
  }
}
