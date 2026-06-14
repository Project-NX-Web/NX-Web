// Synthetic nvdrv service HLE for Phase 5 GPU command ingestion.
//
// This service is intentionally not a faithful Switch nvdrv implementation. It
// provides a deterministic HLE boundary that accepts synthetic IOCTL-shaped
// requests and forwards GPFIFO submissions into the Phase 5 renderer.

import type { Cpu } from '../../cpu/cpu';
import type { HorizonKernel } from '../horizon';
import type { ServiceRequest, ServiceCommandResult } from './types';
import { SyntheticGpuRenderer } from '../../gpu/renderer';
import { parseGpfifo } from '../../gpu/gpfifo';
import { ioctlResultCode, NVDRV_IOCTL, type NvGpuChannel, type NvGpuMappedBuffer } from './nvdrv.types';

export class NvdrvServiceError extends Error {
  constructor(
    message: string,
    public readonly code = 0xe0000000,
    options?: { cause?: unknown },
  ) {
    super(message, options);
  }
}

export class NvdrvService {
  readonly renderer = new SyntheticGpuRenderer();

  private readonly channels = new Map<number, NvGpuChannel>();
  private readonly mappedBuffers = new Map<number, NvGpuMappedBuffer>();
  private nextChannelId = 1;
  private nextNvmapId = 1;
  private nextMappedBufferId = 1;

  open(deviceName: string): number {
    const id = this.nextChannelId++;
    this.channels.set(id, {
      id,
      deviceName,
      openedAt: id,
      mappedBuffers: new Map(),
    });
    return id;
  }

  handle(request: ServiceRequest, kernel: HorizonKernel, cpu: Cpu): ServiceCommandResult {
    switch (request.commandId) {
      case NVDRV_IOCTL.NVMAP_IOC_FROM_ID:
        return this.handleNvmapFromId(request, cpu);
      case NVDRV_IOCTL.NVGPU_AS_IOCTL_MAP_BUFFER_EX:
        return this.handleMapBufferEx(request, cpu);
      case NVDRV_IOCTL.NVGPU_GPU_IOCTL_SUBMIT_GPFIFO:
        return this.handleSubmitGpfifo(request, cpu);
      default:
        return this.writeResult(request.outputPointer, ioctlResultCode(false, 0xe0000001));
    }
  }

  getChannel(id: number): NvGpuChannel | undefined {
    return this.channels.get(id);
  }

  listChannels(): NvGpuChannel[] {
    return [...this.channels.values()];
  }

  private handleNvmapFromId(request: ServiceRequest, cpu: Cpu): ServiceCommandResult {
    const input = this.readInput(request, cpu, 8);
    const id = readU32(input, 0);
    const size = readU32(input, 4);

    const mapped = this.mappedBuffers.get(id) ?? this.allocateMappedBuffer({
      id: this.nextMappedBufferId++,
      nvmapHandle: id,
      guestAddress: 0n,
      size,
      permissions: 'read',
    });

    return this.writeResult(request.outputPointer, 0, [
      ['u32', mapped.id],
      ['u32', mapped.size],
      ['u64', mapped.guestAddress],
    ]);
  }

  private handleMapBufferEx(request: ServiceRequest, cpu: Cpu): ServiceCommandResult {
    const input = this.readInput(request, cpu, 20);
    const channelId = readU32(input, 0);
    const nvmapHandle = readU32(input, 4);
    const guestAddress = readU64(input, 8);
    const size = readU32(input, 16);

    const channel = this.channels.get(channelId);
    if (!channel) {
      return this.writeResult(request.outputPointer, 0xe0000002);
    }

    const mapped = this.allocateMappedBuffer({
      id: this.nextMappedBufferId++,
      nvmapHandle,
      guestAddress,
      size,
      permissions: 'read-write',
    });
    channel.mappedBuffers.set(mapped.id, mapped);

    return this.writeResult(request.outputPointer, 0, [
      ['u32', mapped.id],
      ['u64', mapped.guestAddress],
      ['u32', mapped.size],
    ]);
  }

  private handleSubmitGpfifo(request: ServiceRequest, cpu: Cpu): ServiceCommandResult {
    const input = this.readInput(request, cpu);
    let entries;
    try {
      entries = parseGpfifo(input);
    } catch (error) {
      return this.writeResult(request.outputPointer, 0xe0000003, [
        ['message', error instanceof Error ? error.message : String(error)],
      ]);
    }

    const frames = [];
    for (const entry of entries) {
      try {
        const commandBuffer = cpu.memory.readBytes(entry.pointer, entry.size);
        frames.push(this.renderer.submit({ commandBuffer }));
      } catch (error) {
        return this.writeResult(request.outputPointer, 0xe0000004, [
          ['message', error instanceof Error ? error.message : String(error)],
        ]);
      }
    }

    const channelId = readU32(input, 0) || 0;
    return this.writeResult(request.outputPointer, 0, [
      ['u32', frames.length],
      ['u32', channelId],
      ['u32', frames.at(-1)?.frameId ?? 0],
    ], {
      result: 0,
      submission: {
        channelId,
        numEntries: entries.length,
        frames,
      },
    });
  }

  private readInput(request: ServiceRequest, cpu: Cpu, minimumSize = 0): Uint8Array {
    if (request.inputPointer === 0n && request.inputSize === 0) {
      if (minimumSize === 0) {
        return new Uint8Array();
      }
      throw new NvdrvServiceError('Synthetic nvdrv ioctl missing input buffer', 0xe0000005);
    }

    try {
      return cpu.memory.readBytes(request.inputPointer, request.inputSize);
    } catch (error) {
      throw new NvdrvServiceError('Synthetic nvdrv ioctl input pointer is invalid', 0xe0000006, { cause: error });
    }
  }

  private allocateMappedBuffer(mapped: NvGpuMappedBuffer): NvGpuMappedBuffer {
    this.mappedBuffers.set(mapped.id, mapped);
    return mapped;
  }

  private writeResult(
    outputPointer: bigint,
    code: number,
    fields: Array<['u32', number] | ['u64', bigint] | ['message', string]> = [],
    extra: Partial<Omit<ServiceCommandResult, 'response'>> = {},
  ): ServiceCommandResult {
    const response = new Uint8Array(fields.length * 8);
    const view = new DataView(response.buffer);
    for (let index = 0; index < fields.length; index++) {
      const [type, value] = fields[index];
      if (type === 'u32') {
        view.setUint32(index * 8, value >>> 0, true);
      } else if (type === 'u64') {
        view.setBigUint64(index * 8, BigInt.asUintN(64, value), true);
      } else {
        const bytes = new TextEncoder().encode(value);
        response.set(bytes.subarray(0, 8), index * 8);
      }
    }

    return {
      ...extra,
      result: code,
      response,
    };
  }
}

function readU32(data: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 4 > data.byteLength) {
    throw new NvdrvServiceError(`readU32 out of bounds: offset=${offset}, length=${data.byteLength}`);
  }
  return new DataView(data.buffer, data.byteOffset + offset, 4).getUint32(0, true);
}

function readU64(data: Uint8Array, offset: number): bigint {
  if (offset < 0 || offset + 8 > data.byteLength) {
    throw new NvdrvServiceError(`readU64 out of bounds: offset=${offset}, length=${data.byteLength}`);
  }
  return new DataView(data.buffer, data.byteOffset + offset, 8).getBigUint64(0, true);
}
