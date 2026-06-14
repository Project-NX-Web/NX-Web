// Phase 5 Maxwell render-state model.
//
// This module converts parsed NV2A/Maxwell method writes into structured render
// state. It does not execute GPU work yet; it provides the deterministic state
// model needed by the WebGPU pipeline scaffolding and tests.

export enum PrimitiveTopology {
  PointList = 'point-list',
  LineList = 'line-list',
  TriangleList = 'triangle-list',
  TriangleStrip = 'triangle-strip',
}

export enum BlendFactor {
  Zero = 'zero',
  One = 'one',
  SrcAlpha = 'src-alpha',
  OneMinusSrcAlpha = 'one-minus-src-alpha',
}

export enum BlendOperation {
  Add = 'add',
  Subtract = 'subtract',
  ReverseSubtract = 'reverse-subtract',
}

export enum CompareFunction {
  Never = 'never',
  Less = 'less',
  Equal = 'equal',
  LessEqual = 'less-equal',
  Greater = 'greater',
  NotEqual = 'not-equal',
  GreaterEqual = 'greater-equal',
  Always = 'always',
}

export enum CullMode {
  None = 'none',
  Front = 'front',
  Back = 'back',
}

export enum FrontFace {
  CCW = 'ccw',
  CW = 'cw',
}

export interface ViewportState {
  x: number;
  y: number;
  width: number;
  height: number;
  minDepth: number;
  maxDepth: number;
}

export interface RenderTargetState {
  address: bigint;
  width: number;
  height: number;
  format: 'rgba8-unorm';
}

export interface BlendState {
  enabled: boolean;
  srcFactor: BlendFactor;
  dstFactor: BlendFactor;
  operation: BlendOperation;
}

export interface DepthState {
  enabled: boolean;
  writeEnabled: boolean;
  compareFunction: CompareFunction;
}

export interface RasterizerState {
  cullMode: CullMode;
  frontFace: FrontFace;
}

export interface DrawState {
  vertexCount: number;
  indexCount: number;
  firstVertex: number;
  firstIndex: number;
  instanceCount: number;
}

export interface MaxwellRenderStateSnapshot {
  viewport: ViewportState;
  renderTarget: RenderTargetState;
  topology: PrimitiveTopology;
  blend: BlendState;
  depth: DepthState;
  rasterizer: RasterizerState;
  draw: DrawState;
}

export class MaxwellRenderState {
  viewport: ViewportState = {
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    minDepth: 0,
    maxDepth: 1,
  };
  renderTarget: RenderTargetState = {
    address: 0n,
    width: 0,
    height: 0,
    format: 'rgba8-unorm',
  };
  topology = PrimitiveTopology.TriangleList;
  blend: BlendState = {
    enabled: false,
    srcFactor: BlendFactor.One,
    dstFactor: BlendFactor.Zero,
    operation: BlendOperation.Add,
  };
  depth: DepthState = {
    enabled: false,
    writeEnabled: true,
    compareFunction: CompareFunction.Always,
  };
  rasterizer: RasterizerState = {
    cullMode: CullMode.None,
    frontFace: FrontFace.CCW,
  };
  draw: DrawState = {
    vertexCount: 0,
    indexCount: 0,
    firstVertex: 0,
    firstIndex: 0,
    instanceCount: 1,
  };

  applyMethod(method: number, value: number): boolean {
    switch (method) {
      case MaxwellMethod.ViewportX:
        this.viewport.x = value;
        return true;
      case MaxwellMethod.ViewportY:
        this.viewport.y = value;
        return true;
      case MaxwellMethod.ViewportWidth:
        this.viewport.width = value;
        return true;
      case MaxwellMethod.ViewportHeight:
        this.viewport.height = value;
        return true;
      case MaxwellMethod.ViewportMinDepth:
        this.viewport.minDepth = bitsToFloat(value);
        return true;
      case MaxwellMethod.ViewportMaxDepth:
        this.viewport.maxDepth = bitsToFloat(value);
        return true;
      case MaxwellMethod.RenderTargetAddress:
        this.renderTarget.address = BigInt(value) << 16n;
        return true;
      case MaxwellMethod.RenderTargetAddressLow:
        this.renderTarget.address = (this.renderTarget.address & 0xffff0000n) | BigInt(value);
        return true;
      case MaxwellMethod.RenderTargetWidth:
        this.renderTarget.width = value;
        return true;
      case MaxwellMethod.RenderTargetHeight:
        this.renderTarget.height = value;
        return true;
      case MaxwellMethod.PrimitiveTopology:
        this.topology = topologyFromValue(value);
        return true;
      case MaxwellMethod.BlendEnable:
        this.blend.enabled = value !== 0;
        return true;
      case MaxwellMethod.BlendSrcFactor:
        this.blend.srcFactor = blendFactorFromValue(value);
        return true;
      case MaxwellMethod.BlendDstFactor:
        this.blend.dstFactor = blendFactorFromValue(value);
        return true;
      case MaxwellMethod.BlendOperation:
        this.blend.operation = blendOperationFromValue(value);
        return true;
      case MaxwellMethod.DepthEnable:
        this.depth.enabled = value !== 0;
        return true;
      case MaxwellMethod.DepthWriteEnable:
        this.depth.writeEnabled = value !== 0;
        return true;
      case MaxwellMethod.DepthCompare:
        this.depth.compareFunction = compareFunctionFromValue(value);
        return true;
      case MaxwellMethod.CullMode:
        this.rasterizer.cullMode = cullModeFromValue(value);
        return true;
      case MaxwellMethod.FrontFace:
        this.rasterizer.frontFace = value === 1 ? FrontFace.CW : FrontFace.CCW;
        return true;
      case MaxwellMethod.VertexCount:
        this.draw.vertexCount = value;
        return true;
      case MaxwellMethod.IndexCount:
        this.draw.indexCount = value;
        return true;
      case MaxwellMethod.FirstVertex:
        this.draw.firstVertex = value;
        return true;
      case MaxwellMethod.FirstIndex:
        this.draw.firstIndex = value;
        return true;
      case MaxwellMethod.InstanceCount:
        this.draw.instanceCount = value === 0 ? 1 : value;
        return true;
      default:
        return false;
    }
  }

  applyMethods(methods: Iterable<{ method: number; value: number }>): void {
    for (const method of methods) {
      this.applyMethod(method.method, method.value);
    }
  }

  snapshot(): MaxwellRenderStateSnapshot {
    return {
      viewport: { ...this.viewport },
      renderTarget: { ...this.renderTarget },
      topology: this.topology,
      blend: { ...this.blend },
      depth: { ...this.depth },
      rasterizer: { ...this.rasterizer },
      draw: { ...this.draw },
    };
  }

  clone(): MaxwellRenderState {
    const cloned = new MaxwellRenderState();
    cloned.applySnapshot(this.snapshot());
    return cloned;
  }

  applySnapshot(snapshot: MaxwellRenderStateSnapshot): void {
    this.viewport = { ...snapshot.viewport };
    this.renderTarget = { ...snapshot.renderTarget };
    this.topology = snapshot.topology;
    this.blend = { ...snapshot.blend };
    this.depth = { ...snapshot.depth };
    this.rasterizer = { ...snapshot.rasterizer };
    this.draw = { ...snapshot.draw };
  }
}

export enum MaxwellMethod {
  ViewportX = 0x0300,
  ViewportY = 0x0301,
  ViewportWidth = 0x0302,
  ViewportHeight = 0x0303,
  ViewportMinDepth = 0x0304,
  ViewportMaxDepth = 0x0305,
  RenderTargetAddress = 0x0400,
  RenderTargetAddressLow = 0x0401,
  RenderTargetWidth = 0x0402,
  RenderTargetHeight = 0x0403,
  PrimitiveTopology = 0x0500,
  BlendEnable = 0x0600,
  BlendSrcFactor = 0x0601,
  BlendDstFactor = 0x0602,
  BlendOperation = 0x0603,
  DepthEnable = 0x0700,
  DepthWriteEnable = 0x0701,
  DepthCompare = 0x0702,
  CullMode = 0x0800,
  FrontFace = 0x0801,
  VertexCount = 0x0900,
  IndexCount = 0x0901,
  FirstVertex = 0x0902,
  FirstIndex = 0x0903,
  InstanceCount = 0x0904,
}

function topologyFromValue(value: number): PrimitiveTopology {
  switch (value) {
    case 0:
      return PrimitiveTopology.PointList;
    case 1:
      return PrimitiveTopology.LineList;
    case 2:
      return PrimitiveTopology.TriangleList;
    case 3:
      return PrimitiveTopology.TriangleStrip;
    default:
      return PrimitiveTopology.TriangleList;
  }
}

function blendFactorFromValue(value: number): BlendFactor {
  switch (value) {
    case 0:
      return BlendFactor.Zero;
    case 1:
      return BlendFactor.One;
    case 6:
      return BlendFactor.SrcAlpha;
    case 7:
      return BlendFactor.OneMinusSrcAlpha;
    default:
      return BlendFactor.One;
  }
}

function blendOperationFromValue(value: number): BlendOperation {
  switch (value) {
    case 1:
      return BlendOperation.Subtract;
    case 2:
      return BlendOperation.ReverseSubtract;
    default:
      return BlendOperation.Add;
  }
}

function compareFunctionFromValue(value: number): CompareFunction {
  switch (value) {
    case 0:
      return CompareFunction.Never;
    case 1:
      return CompareFunction.Less;
    case 2:
      return CompareFunction.Equal;
    case 3:
      return CompareFunction.LessEqual;
    case 4:
      return CompareFunction.Greater;
    case 5:
      return CompareFunction.NotEqual;
    case 6:
      return CompareFunction.GreaterEqual;
    default:
      return CompareFunction.Always;
  }
}

function cullModeFromValue(value: number): CullMode {
  switch (value) {
    case 1:
      return CullMode.Front;
    case 2:
      return CullMode.Back;
    default:
      return CullMode.None;
  }
}

function bitsToFloat(value: number): number {
  return new DataView(new Uint32Array([value]).buffer).getFloat32(0, true);
}
