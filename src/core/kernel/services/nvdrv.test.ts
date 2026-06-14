import { describe, expect, it } from 'vitest';
import { Cpu } from '../../cpu/cpu';
import { MemoryPermission, PAGE_SIZE, VirtualMemoryManager } from '../../memory/vmm';
import { HorizonKernel } from '../horizon';
import { NVDRV_IOCTL } from './nvdrv.types';

const HEAP = 0x48000000n;
const COMMAND_BASE = 0x10000000n;

function cpuWithMemory(kernel: HorizonKernel, writes: Array<[bigint, Uint8Array]>): Cpu {
  const vmm = new VirtualMemoryManager();
  vmm.mapMemory(HEAP, PAGE_SIZE * 4, MemoryPermission.ReadWrite);
  vmm.mapMemory(COMMAND_BASE, PAGE_SIZE, MemoryPermission.ReadWriteExecute);
  for (const [address, data] of writes) {
    vmm.writeBytes(address, data);
  }
  return new Cpu(vmm, kernel);
}

function request(commandId: number, inputPointer: bigint, inputSize: number, outputPointer = HEAP + 0x100n) {
  return { tlsAddress: 0n, commandId, inputPointer, inputSize, outputPointer, outputSize: 32 };
}

describe('NvdrvService', () => {
  it('opens synthetic channels and maps buffers', () => {
    const kernel = new HorizonKernel();
    const channel = kernel.nvdrv.open('nvhost-gpu');
    const input = new Uint8Array(20);
    const view = new DataView(input.buffer);
    view.setUint32(0, channel, true);
    view.setUint32(4, 7, true);
    view.setBigUint64(8, COMMAND_BASE, true);
    view.setUint32(16, 64, true);

    const cpu = cpuWithMemory(kernel, [[HEAP, input]]);
    const result = kernel.nvdrv.handle(request(NVDRV_IOCTL.NVGPU_AS_IOCTL_MAP_BUFFER_EX, HEAP, input.byteLength), kernel, cpu);

    expect(result.result).toBe(0);
    expect(result.response).toBeDefined();
    expect(kernel.nvdrv.getChannel(channel)?.mappedBuffers.size).toBe(1);
  });

  it('submits synthetic GPFIFO entries into the renderer', () => {
    const kernel = new HorizonKernel();
    const channel = kernel.nvdrv.open('nvhost-gpu');
    const commandBuffer = new Uint8Array(16);
    const gpfifo = new Uint8Array(8);
    const gpfifoView = new DataView(gpfifo.buffer);
    gpfifoView.setUint32(0, Number(COMMAND_BASE & 0xffffffffn), true);
    gpfifoView.setUint32(4, commandBuffer.byteLength, true);

    const cpu = cpuWithMemory(kernel, [
      [HEAP, gpfifo],
      [COMMAND_BASE, commandBuffer],
    ]);
    const result = kernel.nvdrv.handle(request(NVDRV_IOCTL.NVGPU_GPU_IOCTL_SUBMIT_GPFIFO, HEAP, gpfifo.byteLength), kernel, cpu);

    expect(result.result).toBe(0);
    expect(result.submission).toMatchObject({ numEntries: 1 });
    expect(kernel.nvdrv.renderer.present().frameId).toBe(1);
  });

  it('returns structured errors for invalid channel mappings', () => {
    const kernel = new HorizonKernel();
    const input = new Uint8Array(20);
    const view = new DataView(input.buffer);
    view.setUint32(0, 999, true);
    view.setUint32(4, 1, true);
    view.setBigUint64(8, COMMAND_BASE, true);
    view.setUint32(16, 4, true);

    const cpu = cpuWithMemory(kernel, [[HEAP, input]]);
    const result = kernel.nvdrv.handle(request(NVDRV_IOCTL.NVGPU_AS_IOCTL_MAP_BUFFER_EX, HEAP, input.byteLength), kernel, cpu);

    expect(result.result).toBe(0xe0000002);
  });
});
