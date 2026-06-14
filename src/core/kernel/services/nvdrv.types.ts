// Synthetic nvdrv service types for Phase 5 polish.
//
// These IDs intentionally model the shape of the Switch NvGPU IOCTL surface
// without claiming real ioctl ABI compatibility. The service is deterministic
// and test-oriented so GPU command ingestion can be reached through HLE.

export const NVDRV_IOCTL = {
  NVMAP_IOC_FROM_ID: 0xc0184e01,
  NVGPU_AS_IOCTL_MAP_BUFFER_EX: 0x4018462d,
  NVGPU_GPU_IOCTL_SUBMIT_GPFIFO: 0x4018461b,
} as const;

export type NvdrvIoctlId = (typeof NVDRV_IOCTL)[keyof typeof NVDRV_IOCTL];

export interface NvMapHandle {
  id: number;
  size: number;
  alignment: number;
  kind: 'synthetic' | 'guest-memory';
}

export interface NvGpuMappedBuffer {
  id: number;
  nvmapHandle: number;
  guestAddress: bigint;
  size: number;
  permissions: 'read' | 'write' | 'read-write';
}

export interface NvGpuChannel {
  id: number;
  deviceName: string;
  openedAt: number;
  mappedBuffers: Map<number, NvGpuMappedBuffer>;
}

export interface NvGpuSubmission {
  channelId: number;
  numEntries: number;
  frames: Array<{
    frameId: number;
    pipelineLabel: string;
    vertexShaderInstructions: number;
    fragmentShaderInstructions: number;
    textureCount: number;
  }>;
}

export interface NvGpuSubmitResult {
  result: number;
  submission?: NvGpuSubmission;
  response?: Uint8Array;
}

export function ioctlResultCode(success: boolean, syntheticError = 0xe0000000): number {
  return success ? 0 : syntheticError;
}
