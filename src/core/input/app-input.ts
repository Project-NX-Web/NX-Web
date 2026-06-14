// Browser app-shell integration for Phase 8 input.
//
// This layer starts Gamepad/keyboard sources as soon as the page loads, then
// attaches them to the synthetic HID service once the kernel/CPU are available.
// It keeps the input path active without requiring the emulator core to be fully
// wired into the app shell yet.

import type { Cpu } from '../cpu/cpu';
import type { HorizonKernel } from '../kernel/horizon';
import {
  BrowserGamepadInputSource,
  KeyboardInputSource,
  type BrowserInputSource,
  type BrowserInputSourceOptions,
} from './browser-sources';
import { InputHidAdapter, type HidSharedMemorySink } from './hid-adapter';
import { JoyConWebHidInputSource, isWebHidAvailable } from './joycon-webhid';
import { createInputRemapping, type InputRemapping } from './remapping';
import { InputLatencyTracker, type InputLatencySample } from './latency';
import type { NpadInputState } from './types';

export interface AppInputSessionOptions extends BrowserInputSourceOptions {
  hid?: HidSharedMemorySink;
  getCpu?: () => Cpu | undefined;
  onStatus?: (message: string) => void;
}

export class AppInputSession {
  private readonly adapter: InputHidAdapter;
  private readonly remapping: InputRemapping;
  private readonly latency = new InputLatencyTracker();
  private readonly sources: BrowserInputSource[] = [];
  private joyConSource?: JoyConWebHidInputSource;
  private started = false;

  constructor(private readonly options: AppInputSessionOptions = {}) {
    this.remapping = createInputRemapping(options.remapping);
    this.adapter = new InputHidAdapter(options.hid, {
      npadId: 0,
      getCpu: options.getCpu,
    });
    this.sources.push(
      new BrowserGamepadInputSource(this.emit, { remapping: this.remapping }),
      new KeyboardInputSource(this.emit, { remapping: this.remapping }),
    );
  }

  async pairJoyCon(): Promise<number> {
    if (!isWebHidAvailable()) {
      this.notify('WebHID Joy-Con pairing unavailable');
      return 0;
    }

    this.joyConSource ??= new JoyConWebHidInputSource(this.emitJoyCon);
    const connected = await this.joyConSource.requestAndConnect();
    if (connected > 0 && !this.sources.includes(this.joyConSource)) {
      this.sources.push(this.joyConSource);
      if (this.started) {
        this.joyConSource.start();
      }
      this.notify(`paired ${connected} Joy-Con device(s)`);
    }
    return connected;
  }

  getLastInputLatency(): InputLatencySample | undefined {
    return this.latency.getLastSample();
  }

  getAverageInputLatencyMs(): number | undefined {
    return this.latency.getAverageLatencyMs();
  }

  attach(kernel: HorizonKernel, cpu?: Cpu): void {
    this.adapter.setHidSink(kernel.hid);
    if (cpu) {
      this.adapter.setCpuProvider(() => cpu);
    }
    this.flushLastState();
    this.notify('attached to synthetic HID service');
  }

  start(): void {
    if (this.started) {
      return;
    }
    this.started = true;
    for (const source of this.sources) {
      source.start();
    }
    this.notify('started Gamepad and keyboard sources');
  }

  stop(): void {
    if (!this.started) {
      return;
    }
    this.started = false;
    for (const source of this.sources) {
      source.stop();
    }
    this.notify('stopped input sources');
  }

  private readonly emit = (state: NpadInputState, source: 'gamepad' | 'keyboard'): void => {
    const receivedAt = nowMs();
    const result = this.adapter.update(state, source);
    this.latency.record(source, receivedAt);
    if (result !== 0) {
      this.notify(`HID update failed: 0x${result.toString(16)}`);
    }
  };

  private readonly emitJoyCon = (state: NpadInputState): void => {
    const receivedAt = nowMs();
    const result = this.adapter.update(state, 'gamepad');
    this.latency.record('joycon', receivedAt);
    if (result !== 0) {
      this.notify(`Joy-Con HID update failed: 0x${result.toString(16)}`);
    }
  };

  setRemapping(remapping: Partial<InputRemapping>): void {
    if (this.started) {
      for (const source of this.sources) {
        source.stop();
      }
    }
    this.sources.length = 0;
    this.sources.push(
      new BrowserGamepadInputSource(this.adapter.getEmitter(), { remapping }),
      new KeyboardInputSource(this.adapter.getEmitter(), { remapping }),
    );
    if (this.started) {
      for (const source of this.sources) {
        source.start();
      }
    }
    this.notify('input remapping updated');
  }

  private flushLastState(): void {
    const state = this.adapter.getLastState();
    if (state.buttons !== 0 || state.leftStickX !== 0 || state.leftStickY !== 0 || state.rightStickX !== 0 || state.rightStickY !== 0) {
      this.adapter.update(state, 'gamepad');
    }
  }

  private notify(message: string): void {
    this.options.onStatus?.(message);
  }
}

function nowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}
