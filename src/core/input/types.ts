// NX-Web input model for Phase 8 HID service scaffolding.
//
// The types here intentionally stay browser-agnostic where possible. Browser
// Gamepad/keyboard sources map into the same synthetic N-pad state that the HID
// service exposes to HLE code.

export const HID_SHARED_MEMORY_SIZE = 32;

export enum HidResult {
  Success = 0x0,
  InvalidState = 0xe0000001,
  InvalidHandle = 0xe0000002,
  InvalidMemoryRange = 0xe0000003,
  InvalidCombination = 0xe0000004,
  Unsupported = 0xe0000005,
}

export enum NpadButton {
  A = 1 << 0,
  B = 1 << 1,
  X = 1 << 2,
  Y = 1 << 3,
  L = 1 << 4,
  R = 1 << 5,
  ZL = 1 << 6,
  ZR = 1 << 7,
  Minus = 1 << 8,
  Plus = 1 << 9,
  LeftStick = 1 << 10,
  RightStick = 1 << 11,
  Home = 1 << 12,
  Capture = 1 << 13,
  DPadUp = 1 << 14,
  DPadDown = 1 << 15,
  DPadLeft = 1 << 16,
  DPadRight = 1 << 17,
}

export enum NpadStyle {
  JoyConLeft = 1 << 0,
  JoyConRight = 1 << 1,
  JoyDual = 1 << 2,
  FullKey = 1 << 3,
}

export const DEFAULT_SUPPORTED_NPAD_STYLE_SET =
  NpadStyle.FullKey | NpadStyle.JoyDual | NpadStyle.JoyConLeft | NpadStyle.JoyConRight;

export interface NpadInputState {
  buttons: number;
  leftStickX: number;
  leftStickY: number;
  rightStickX: number;
  rightStickY: number;
  timestampMs: number;
}

export interface EncodedNpadState {
  buttons: number;
  leftStickX: number;
  leftStickY: number;
  rightStickX: number;
  rightStickY: number;
  timestampMs: number;
}

export function createEmptyNpadState(timestampMs = nowMs()): NpadInputState {
  return {
    buttons: 0,
    leftStickX: 0,
    leftStickY: 0,
    rightStickX: 0,
    rightStickY: 0,
    timestampMs,
  };
}

export function encodeNpadState(state: NpadInputState): Uint8Array {
  const data = new Uint8Array(HID_SHARED_MEMORY_SIZE);
  const view = new DataView(data.buffer);
  view.setUint32(0, state.buttons >>> 0, true);
  view.setInt32(4, clampStick(state.leftStickX), true);
  view.setInt32(8, clampStick(state.leftStickY), true);
  view.setInt32(12, clampStick(state.rightStickX), true);
  view.setInt32(16, clampStick(state.rightStickY), true);
  view.setBigUint64(20, BigInt(Math.trunc(state.timestampMs)), true);
  return data;
}

export function decodeNpadState(data: Uint8Array): EncodedNpadState {
  if (data.byteLength < HID_SHARED_MEMORY_SIZE) {
    throw new Error(`HID shared memory buffer is too small: ${data.byteLength}`);
  }

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return {
    buttons: view.getUint32(0, true),
    leftStickX: view.getInt32(4, true),
    leftStickY: view.getInt32(8, true),
    rightStickX: view.getInt32(12, true),
    rightStickY: view.getInt32(16, true),
    timestampMs: Number(view.getBigUint64(20, true)),
  };
}

export function clampStick(value: number): number {
  return Math.max(-32768, Math.min(32767, Math.trunc(value)));
}

export function normalizeStick(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return clampStick(Math.round(value * 32767));
}

export function nowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}
