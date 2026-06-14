// Synthetic hid service HLE for Phase 8 input/controller support.
//
// This service models the Switch HID surface needed by homebrew-style tests:
// applet-resource shared memory, N-pad activation, supported style sets, and
// deterministic N-pad state writes. It does not implement WebHID Joy-Con reports.

import type { Cpu } from '../../cpu/cpu';
import type { HorizonKernel } from '../horizon';
import type { ServiceRequest, ServiceCommandResult } from './types';
import { MemoryFault } from '../../memory/vmm';
import {
  DEFAULT_SUPPORTED_NPAD_STYLE_SET,
  HID_SHARED_MEMORY_SIZE,
  type NpadInputState,
  createEmptyNpadState,
  encodeNpadState,
} from '../../input/types';

export enum HidResult {
  Success = 0x0,
  InvalidState = 0xe0000001,
  InvalidHandle = 0xe0000002,
  InvalidMemoryRange = 0xe0000003,
  InvalidCombination = 0xe0000004,
  Unsupported = 0xe0000005,
}

export enum HidCommand {
  CreateAppletResource = 100,
  ActivateNpad = 101,
  SetSupportedNpadStyleSet = 102,
  GetNpadState = 103,
}

export interface HidAppletResource {
  handle: number;
  address: bigint;
  size: number;
}

export class HidServiceError extends Error {
  constructor(
    message: string,
    public readonly code = HidResult.InvalidState,
    options?: { cause?: unknown },
  ) {
    super(message, options);
  }
}

export class HidService {
  private readonly npadStates = new Map<number, NpadInputState>();
  private nextAppletResourceHandle = 1;
  private appletResource?: HidAppletResource;
  private activatedNpadId = 0;
  private supportedNpadStyleSet = DEFAULT_SUPPORTED_NPAD_STYLE_SET;

  handle(request: ServiceRequest, _kernel: HorizonKernel, cpu: Cpu): ServiceCommandResult {
    switch (request.commandId) {
      case HidCommand.CreateAppletResource:
        return this.handleCreateAppletResource(request, cpu);
      case HidCommand.ActivateNpad:
        return this.handleActivateNpad(request, cpu);
      case HidCommand.SetSupportedNpadStyleSet:
        return this.handleSetSupportedNpadStyleSet(request, cpu);
      case HidCommand.GetNpadState:
        return this.handleGetNpadState(request, cpu);
      default:
        return this.result(HidResult.Unsupported);
    }
  }

  createAppletResource(address: bigint, size: number): HidResult {
    if (address === 0n || size <= 0) {
      return HidResult.InvalidCombination;
    }
    if (size < HID_SHARED_MEMORY_SIZE) {
      return HidResult.InvalidCombination;
    }

    this.appletResource = {
      handle: this.nextAppletResourceHandle++,
      address,
      size,
    };
    return HidResult.Success;
  }

  setSupportedNpadStyleSet(styleSet: number): HidResult {
    if (styleSet === 0) {
      return HidResult.InvalidCombination;
    }

    this.supportedNpadStyleSet = styleSet >>> 0;
    return HidResult.Success;
  }

  activateNpad(npadId: number): HidResult {
    if (npadId < 0) {
      return HidResult.InvalidHandle;
    }

    this.activatedNpadId = npadId >>> 0;
    this.ensureState(this.activatedNpadId);
    return HidResult.Success;
  }

  setNpadState(npadId: number, state: NpadInputState): HidResult {
    if (npadId < 0) {
      return HidResult.InvalidHandle;
    }
    if (!this.isNpadSupported(npadId)) {
      return HidResult.Unsupported;
    }

    this.npadStates.set(npadId >>> 0, state);
    return HidResult.Success;
  }

  getNpadState(npadId: number): NpadInputState | undefined {
    return this.npadStates.get(npadId >>> 0) ?? this.npadStates.get(0);
  }

  getAppletResource(): HidAppletResource | undefined {
    return this.appletResource;
  }

  getSupportedNpadStyleSet(): number {
    return this.supportedNpadStyleSet;
  }

  getActivatedNpadId(): number {
    return this.activatedNpadId;
  }

  writeSharedMemory(cpu: Cpu): HidResult {
    if (!this.appletResource) {
      return HidResult.InvalidState;
    }

    const state = this.getNpadState(this.activatedNpadId) ?? createEmptyNpadState();
    try {
      cpu.memory.writeBytes(this.appletResource.address, encodeNpadState(state));
      return HidResult.Success;
    } catch (error) {
      if (error instanceof MemoryFault) {
        return HidResult.InvalidMemoryRange;
      }
      throw error;
    }
  }

  private handleCreateAppletResource(request: ServiceRequest, cpu: Cpu): ServiceCommandResult {
    const input = readInput(request, cpu, 12);
    const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
    const address = view.getBigUint64(0, true);
    const size = view.getUint32(8, true);
    const result = this.createAppletResource(address, size);

    return this.result(result, result === HidResult.Success ? [['u32', this.appletResource!.handle]] : []);
  }

  private handleActivateNpad(request: ServiceRequest, cpu: Cpu): ServiceCommandResult {
    const input = readInput(request, cpu, 4);
    const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
    const npadId = view.getUint32(0, true);
    const result = this.activateNpad(npadId);
    if (result === HidResult.Success) {
      const memoryResult = this.writeSharedMemory(cpu);
      if (memoryResult !== HidResult.Success) {
        return this.result(memoryResult);
      }
    }
    return this.result(result);
  }

  private handleSetSupportedNpadStyleSet(request: ServiceRequest, cpu: Cpu): ServiceCommandResult {
    const input = readInput(request, cpu, 8);
    const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
    const styleSet = Number(view.getBigUint64(0, true) & 0xffffffffn);
    return this.result(this.setSupportedNpadStyleSet(styleSet));
  }

  private handleGetNpadState(request: ServiceRequest, cpu: Cpu): ServiceCommandResult {
    const input = readInput(request, cpu, 4);
    const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
    const npadId = view.getUint32(0, true);
    const state = this.getNpadState(npadId) ?? createEmptyNpadState();

    return this.result(HidResult.Success, [
      ['u32', state.buttons],
      ['u32', state.leftStickX],
      ['u32', state.leftStickY],
      ['u32', state.rightStickX],
      ['u32', state.rightStickY],
    ]);
  }

  private isNpadSupported(_npadId: number): boolean {
    return this.supportedNpadStyleSet !== 0;
  }

  private ensureState(npadId: number): void {
    if (!this.npadStates.has(npadId)) {
      this.npadStates.set(npadId, createEmptyNpadState());
    }
  }

  private result(code: HidResult, fields: Array<['u32', number] | ['u64', bigint]> = []): ServiceCommandResult {
    const response = new Uint8Array(fields.length * 8);
    const view = new DataView(response.buffer);
    for (let index = 0; index < fields.length; index++) {
      const [type, value] = fields[index];
      if (type === 'u32') {
        view.setUint32(index * 8, value >>> 0, true);
      } else {
        view.setBigUint64(index * 8, BigInt.asUintN(64, value), true);
      }
    }

    return { result: code, response };
  }
}

function readInput(request: ServiceRequest, cpu: Cpu, minimumSize = 0): Uint8Array {
  if (request.inputPointer === 0n && request.inputSize === 0) {
    if (minimumSize === 0) {
      return new Uint8Array();
    }
    throw new HidServiceError('Synthetic hid command missing input buffer', HidResult.InvalidCombination);
  }

  if (request.inputSize < minimumSize) {
    throw new HidServiceError('Synthetic hid command input buffer is too small', HidResult.InvalidCombination);
  }

  try {
    return cpu.memory.readBytes(request.inputPointer, request.inputSize);
  } catch (error) {
    throw new HidServiceError('Synthetic hid command input pointer is invalid', HidResult.InvalidMemoryRange, { cause: error });
  }
}
