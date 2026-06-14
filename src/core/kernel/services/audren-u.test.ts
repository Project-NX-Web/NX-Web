import { describe, expect, it } from 'vitest';
import { Cpu } from '../../cpu/cpu';
import { MemoryPermission, PAGE_SIZE, VirtualMemoryManager } from '../../memory/vmm';
import { HorizonKernel } from '../horizon';
import { AudrenUCommand } from './audren-u';

const HEAP = 0x48000000n;

function cpuWithHeap(kernel: HorizonKernel, input: Uint8Array): Cpu {
  const vmm = new VirtualMemoryManager();
  vmm.mapMemory(HEAP, PAGE_SIZE, MemoryPermission.ReadWrite);
  vmm.writeBytes(HEAP, input);
  return new Cpu(vmm, kernel);
}

function request(command: AudrenUCommand, input = new Uint8Array()) {
  return {
    tlsAddress: 0n,
    commandId: command,
    inputPointer: HEAP,
    inputSize: input.byteLength,
    outputPointer: HEAP + 0x100n,
    outputSize: 32,
  };
}

describe('AudrenUService', () => {
  it('opens, starts, stops, and updates a synthetic renderer', () => {
    const kernel = new HorizonKernel();
    const openCpu = cpuWithHeap(kernel, new Uint8Array());
    const openResult = kernel.audren.handle(request(AudrenUCommand.OpenAudioRenderer), kernel, openCpu);
    expect(openResult.result).toBe(0);
    expect(openResult.response).toBeDefined();

    const handle = Number(new DataView(openResult.response!.buffer).getUint32(0, true));
    const input = new Uint8Array(4);
    new DataView(input.buffer).setUint32(0, handle, true);
    const cpu = cpuWithHeap(kernel, input);

    expect(kernel.audren.handle(request(AudrenUCommand.StartAudioRenderer, input), kernel, cpu).result).toBe(0);
    const updateResult = kernel.audren.handle(request(AudrenUCommand.RequestUpdateAudioRenderer, input), kernel, cpu);
    expect(updateResult.result).toBe(0);
    expect(kernel.audren.getRenderer(handle)?.ringBuffer.availableFrames).toBeGreaterThan(0);
    expect(kernel.audren.handle(request(AudrenUCommand.StopAudioRenderer, input), kernel, cpu).result).toBe(0);
  });
});
