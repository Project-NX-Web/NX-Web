// Connects browser input sources to the synthetic HID service.
//
// The adapter keeps the HID service as the source of truth. When a browser input
// source emits a state change, the adapter updates the selected N-pad and, if a
// CPU/memory accessor is available, flushes that state into HID shared memory.

import type { Cpu } from '../cpu/cpu';
import { HidResult } from '../kernel/services/hid';
import { type NpadInputState, createEmptyNpadState } from './types';
import type { BrowserInputSource, InputStateEmitter } from './browser-sources';

export interface HidSharedMemorySink {
  setNpadState(npadId: number, state: NpadInputState): HidResult;
  writeSharedMemory(cpu: Cpu): HidResult;
}

export interface InputHidAdapterOptions {
  hid?: HidSharedMemorySink;
  npadId?: number;
  getCpu?: () => Cpu | undefined;
}

export class InputHidAdapter {
  private readonly sources = new Set<BrowserInputSource>();
  private lastState = createEmptyNpadState(0);
  private started = false;

  constructor(
    private hid: HidSharedMemorySink | undefined,
    private readonly options: InputHidAdapterOptions = {},
  ) {
    this.hid = options.hid ?? hid;
  }

  addSource(source: BrowserInputSource): void {
    this.sources.add(source);
    if (this.started) {
      source.start();
    }
  }

  removeSource(source: BrowserInputSource): void {
    this.sources.delete(source);
    source.stop();
  }

  setHidSink(hid: HidSharedMemorySink): void {
    this.hid = hid;
  }

  setNpadId(npadId: number): void {
    this.options.npadId = npadId;
  }

  setCpuProvider(getCpu: () => Cpu | undefined): void {
    this.options.getCpu = getCpu;
  }

  start(): void {
    if (this.started) {
      return;
    }
    this.started = true;
    for (const source of this.sources) {
      source.start();
    }
  }

  stop(): void {
    if (!this.started) {
      return;
    }
    this.started = false;
    for (const source of this.sources) {
      source.stop();
    }
  }

  update(state: NpadInputState, _source: 'gamepad' | 'keyboard'): HidResult {
    const npadId = this.options.npadId ?? 0;
    this.lastState = state;

    const result = this.hid?.setNpadState(npadId, state) ?? HidResult.InvalidState;
    if (result !== 0) {
      return result;
    }
    const cpu = this.options.getCpu?.();
    if (cpu) {
      return this.hid!.writeSharedMemory(cpu);
    }
    return HidResult.Success;
  }

  getEmitter(): InputStateEmitter {
    return (state, source) => {
      this.update(state, source);
    };
  }

  getLastState(): NpadInputState {
    return this.lastState;
  }
}
