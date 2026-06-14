// WebHID Joy-Con input support for Phase 8.
//
// This is intentionally feature-gated behind navigator.hid and a user gesture.
// It parses the common Joy-Con 0x21/0x30 input-report shapes and maps buttons
// plus analog sticks into the synthetic N-pad state. IMU samples are exposed for
// future SixAxisSensor integration.

import {
  NpadButton,
  type NpadInputState,
  createEmptyNpadState,
  normalizeStick,
} from './types';

export interface JoyConInputReport {
  reportId: number;
  buttons: number;
  leftStickX: number;
  leftStickY: number;
  rightStickX: number;
  rightStickY: number;
  timestampMs: number;
  accelerometer?: AccelerometerSample[];
  gyroscope?: GyroscopeSample[];
}

export interface AccelerometerSample {
  x: number;
  y: number;
  z: number;
}

export interface GyroscopeSample {
  x: number;
  y: number;
  z: number;
}

export type JoyConInputEmitter = (state: NpadInputState, report: JoyConInputReport) => void;

interface MinimalHidDevice {
  productName?: string;
  vendorId?: number;
  productId?: number;
  open(): Promise<void>;
  close(): Promise<void>;
  addEventListener(type: 'inputreport', listener: (event: InputReportEvent) => void): void;
  removeEventListener(type: 'inputreport', listener: (event: InputReportEvent) => void): void;
}

interface InputReportEvent {
  data: DataView;
}

interface NavigatorWithHid extends Navigator {
  hid?: {
    requestDevice(options: { filters: Array<{ vendorId?: number }> }): Promise<MinimalHidDevice[]>;
    getDevices?(): Promise<MinimalHidDevice[]>;
  };
}

const JOY_CON_VENDOR_ID = 0x057e;
const JOY_CON_REPORT_STANDARD_INPUT = 0x21;
const JOY_CON_REPORT_FULL_INPUT_WITH_IMU = 0x30;
const STICK_ZERO = 0x800;
const STICK_MAX = 0xfff;

export class JoyConWebHidInputSource {
  private readonly devices = new Set<MinimalHidDevice>();
  private readonly handleInputReport = (event: InputReportEvent): void => {
    const report = parseJoyConInputReport(event.data, nowMs());
    if (!report) {
      return;
    }
    const state = joyConReportToNpadState(report);
    this.emit(state, report);
  };

  constructor(private readonly emit: JoyConInputEmitter) {}

  async requestAndConnect(): Promise<number> {
    const hid = getHid();
    if (!hid) {
      throw new Error('WebHID is not available in this browser');
    }

    const devices = await hid.requestDevice({ filters: [{ vendorId: JOY_CON_VENDOR_ID }] });
    for (const device of devices) {
      await device.open();
      device.addEventListener('inputreport', this.handleInputReport);
      this.devices.add(device);
    }
    return devices.length;
  }

  start(): void {
    // Joy-Con reports are event-driven; pairing is started by requestAndConnect().
  }

  stop(): void {
    for (const device of this.devices) {
      device.removeEventListener('inputreport', this.handleInputReport);
      void device.close();
    }
    this.devices.clear();
  }
}

export function parseJoyConInputReport(data: DataView, timestampMs = nowMs()): JoyConInputReport | undefined {
  const reportId = data.getUint8(0);
  if (reportId !== JOY_CON_REPORT_STANDARD_INPUT && reportId !== JOY_CON_REPORT_FULL_INPUT_WITH_IMU) {
    return undefined;
  }
  if (data.byteLength < 12) {
    return undefined;
  }

  const buttons = readJoyConButtons(data);
  const leftStick = readJoyConStick(data, 6);
  const rightStick = readJoyConStick(data, 9);
  const accelerometer = reportId === JOY_CON_REPORT_FULL_INPUT_WITH_IMU && data.byteLength >= 49
    ? readJoyConAccelerometer(data)
    : undefined;
  const gyroscope = reportId === JOY_CON_REPORT_FULL_INPUT_WITH_IMU && data.byteLength >= 49
    ? readJoyConGyroscope(data)
    : undefined;

  return {
    reportId,
    buttons,
    leftStickX: leftStick.x,
    leftStickY: leftStick.y,
    rightStickX: rightStick.x,
    rightStickY: rightStick.y,
    timestampMs,
    accelerometer,
    gyroscope,
  };
}

export function joyConReportToNpadState(report: JoyConInputReport): NpadInputState {
  return {
    ...createEmptyNpadState(report.timestampMs),
    buttons: report.buttons,
    leftStickX: normalizeStick((report.leftStickX - STICK_ZERO) / (STICK_MAX - STICK_ZERO)),
    leftStickY: normalizeStick((report.leftStickY - STICK_ZERO) / (STICK_MAX - STICK_ZERO)),
    rightStickX: normalizeStick((report.rightStickX - STICK_ZERO) / (STICK_MAX - STICK_ZERO)),
    rightStickY: normalizeStick((report.rightStickY - STICK_ZERO) / (STICK_MAX - STICK_ZERO)),
  };
}

export function isWebHidAvailable(): boolean {
  return getHid() !== undefined;
}

function getHid(): NavigatorWithHid['hid'] {
  if (typeof navigator === 'undefined') {
    return undefined;
  }
  return (navigator as NavigatorWithHid).hid;
}

function readJoyConButtons(data: DataView): number {
  const byte3 = data.getUint8(3);
  const byte4 = data.getUint8(4);
  const byte5 = data.getUint8(5);

  return (
    (bit(byte3, 2) ? NpadButton.B : 0) |
    (bit(byte3, 3) ? NpadButton.A : 0) |
    (bit(byte3, 1) ? NpadButton.X : 0) |
    (bit(byte3, 0) ? NpadButton.Y : 0) |
    (bit(byte4, 6) ? NpadButton.L : 0) |
    (bit(byte4, 7) ? NpadButton.ZL : 0) |
    (bit(byte3, 6) ? NpadButton.R : 0) |
    (bit(byte3, 7) ? NpadButton.ZR : 0) |
    (bit(byte4, 0) ? NpadButton.Minus : 0) |
    (bit(byte4, 3) ? NpadButton.Home : 0) |
    (bit(byte5, 1) ? NpadButton.DPadUp : 0) |
    (bit(byte5, 0) ? NpadButton.DPadDown : 0) |
    (bit(byte5, 3) ? NpadButton.DPadLeft : 0) |
    (bit(byte5, 2) ? NpadButton.DPadRight : 0) |
    (bit(byte4, 2) ? NpadButton.LeftStick : 0) |
    (bit(byte4, 1) ? NpadButton.RightStick : 0)
  );
}

function readJoyConStick(data: DataView, offset: number): { x: number; y: number } {
  const low = data.getUint8(offset);
  const mid = data.getUint8(offset + 1);
  const high = data.getUint8(offset + 2);
  return {
    x: low | ((mid & 0x0f) << 8),
    y: (mid >> 4) | (high << 4),
  };
}

function readJoyConAccelerometer(data: DataView): AccelerometerSample[] {
  const samples: AccelerometerSample[] = [];
  for (let index = 0; index < 3; index++) {
    const offset = 19 + index * 12;
    samples.push({
      x: data.getInt16(offset, true),
      y: data.getInt16(offset + 2, true),
      z: data.getInt16(offset + 4, true),
    });
  }
  return samples;
}

function readJoyConGyroscope(data: DataView): GyroscopeSample[] {
  const samples: GyroscopeSample[] = [];
  for (let index = 0; index < 3; index++) {
    const offset = 25 + index * 12;
    samples.push({
      x: data.getInt16(offset, true),
      y: data.getInt16(offset + 2, true),
      z: data.getInt16(offset + 4, true),
    });
  }
  return samples;
}

function bit(value: number, index: number): boolean {
  return (value & (1 << index)) !== 0;
}

function nowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}
