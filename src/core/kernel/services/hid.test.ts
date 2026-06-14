import { describe, expect, it } from 'vitest';
import { Cpu } from '../../cpu/cpu';
import { MemoryPermission, PAGE_SIZE, VirtualMemoryManager } from '../../memory/vmm';
import { NpadButton, NpadStyle, createEmptyNpadState } from '../../input';
import { HorizonKernel } from '../horizon';
import type { ServiceRequest } from './types';
import { HidCommand, HidResult } from './hid';

const HEAP = 0x48000000n;
const SHARED_MEMORY = 0x48001000n;
const OUTPUT = 0x48002000n;

function cpuWithMemory(kernel: HorizonKernel, writes: Array<[bigint, Uint8Array]>): Cpu {
  const vmm = new VirtualMemoryManager();
  vmm.mapMemory(HEAP, PAGE_SIZE * 8, MemoryPermission.ReadWrite);
  vmm.mapMemory(SHARED_MEMORY, PAGE_SIZE, MemoryPermission.ReadWrite);
  vmm.mapMemory(OUTPUT, PAGE_SIZE, MemoryPermission.ReadWrite);
  for (const [address, data] of writes) {
    vmm.writeBytes(address, data);
  }
  return new Cpu(vmm, kernel);
}

function request(command: HidCommand, input: Uint8Array = new Uint8Array(), outputPointer = OUTPUT): ServiceRequest {
  return {
    tlsAddress: 0n,
    commandId: command,
    inputPointer: HEAP,
    inputSize: input.byteLength,
    outputPointer,
    outputSize: 64,
  };
}

describe('HidService', () => {
  it('creates an applet resource and activates an N-pad', () => {
    const kernel = new HorizonKernel();
    const input = new Uint8Array(12);
    const view = new DataView(input.buffer);
    view.setBigUint64(0, SHARED_MEMORY, true);
    view.setUint32(8, 32, true);
    const cpu = cpuWithMemory(kernel, [[HEAP, input]]);

    const createResult = kernel.hid.handle(request(HidCommand.CreateAppletResource, input), kernel, cpu);
    expect(createResult.result).toBe(HidResult.Success);
    expect(kernel.hid.getAppletResource()).toMatchObject({ handle: 1, address: SHARED_MEMORY, size: 32 });

    const activateInput = new Uint8Array(4);
    new DataView(activateInput.buffer).setUint32(0, 2, true);
    const activateCpu = cpuWithMemory(kernel, [[HEAP, activateInput]]);
    const activateResult = kernel.hid.handle(request(HidCommand.ActivateNpad, activateInput), kernel, activateCpu);

    expect(activateResult.result).toBe(HidResult.Success);
    expect(kernel.hid.getActivatedNpadId()).toBe(2);
    expect(kernel.hid.getNpadState(2)).toBeDefined();
  });

  it('sets supported N-pad styles and rejects an empty style set', () => {
    const kernel = new HorizonKernel();
    const fullKeyInput = new Uint8Array(8);
    new DataView(fullKeyInput.buffer).setBigUint64(0, BigInt(NpadStyle.FullKey | NpadStyle.JoyDual), true);
    const fullKeyCpu = cpuWithMemory(kernel, [[HEAP, fullKeyInput]]);

    expect(kernel.hid.handle(request(HidCommand.SetSupportedNpadStyleSet, fullKeyInput), kernel, fullKeyCpu).result).toBe(HidResult.Success);
    expect(kernel.hid.getSupportedNpadStyleSet()).toBe(NpadStyle.FullKey | NpadStyle.JoyDual);

    const emptyInput = new Uint8Array(8);
    const emptyCpu = cpuWithMemory(kernel, [[HEAP, emptyInput]]);
    expect(kernel.hid.handle(request(HidCommand.SetSupportedNpadStyleSet, emptyInput), kernel, emptyCpu).result).toBe(HidResult.InvalidCombination);
  });

  it('updates N-pad state and flushes it to shared memory', () => {
    const kernel = new HorizonKernel();
    const resourceInput = new Uint8Array(12);
    const resourceView = new DataView(resourceInput.buffer);
    resourceView.setBigUint64(0, SHARED_MEMORY, true);
    resourceView.setUint32(8, 32, true);
    const cpu = cpuWithMemory(kernel, [[HEAP, resourceInput]]);
    expect(kernel.hid.handle(request(HidCommand.CreateAppletResource, resourceInput), kernel, cpu).result).toBe(HidResult.Success);

    const state = {
      ...createEmptyNpadState(1234),
      buttons: NpadButton.A | NpadButton.DPadRight,
      leftStickX: 123,
      leftStickY: -456,
      rightStickX: 789,
      rightStickY: -1011,
    };

    expect(kernel.hid.setNpadState(0, state)).toBe(HidResult.Success);
    expect(kernel.hid.writeSharedMemory(cpu)).toBe(HidResult.Success);

    const encoded = cpu.memory.readBytes(SHARED_MEMORY, 32);
    const view = new DataView(encoded.buffer);
    expect(view.getUint32(0, true)).toBe(state.buttons);
    expect(view.getInt32(4, true)).toBe(state.leftStickX);
    expect(view.getInt32(8, true)).toBe(state.leftStickY);
    expect(view.getInt32(12, true)).toBe(state.rightStickX);
    expect(view.getInt32(16, true)).toBe(state.rightStickY);
    expect(Number(view.getBigUint64(20, true))).toBe(state.timestampMs);
  });

  it('returns N-pad state through a service response', () => {
    const kernel = new HorizonKernel();
    expect(kernel.hid.setNpadState(0, {
      ...createEmptyNpadState(100),
      buttons: NpadButton.B,
      leftStickX: -1,
    })).toBe(HidResult.Success);

    const input = new Uint8Array(4);
    new DataView(input.buffer).setUint32(0, 0, true);
    const cpu = cpuWithMemory(kernel, [[HEAP, input]]);
    const result = kernel.hid.handle(request(HidCommand.GetNpadState, input), kernel, cpu);

    expect(result.result).toBe(HidResult.Success);
    expect(result.response).toBeDefined();
    const view = new DataView(result.response!.buffer);
    expect(view.getUint32(0, true)).toBe(NpadButton.B);
    expect(view.getUint32(8, true)).toBe(0xffffffff);
  });

  it('returns structured errors for invalid shared-memory ranges', () => {
    const kernel = new HorizonKernel();
    const resourceInput = new Uint8Array(12);
    const resourceView = new DataView(resourceInput.buffer);
    resourceView.setBigUint64(0, 0x1n, true);
    resourceView.setUint32(8, 32, true);
    const cpu = cpuWithMemory(kernel, [[HEAP, resourceInput]]);
    expect(kernel.hid.handle(request(HidCommand.CreateAppletResource, resourceInput), kernel, cpu).result).toBe(HidResult.Success);

    expect(kernel.hid.writeSharedMemory(cpu)).toBe(HidResult.InvalidMemoryRange);
  });
});
