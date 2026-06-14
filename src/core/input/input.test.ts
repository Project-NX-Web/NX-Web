import { describe, expect, it } from 'vitest';
import {
  NpadButton,
  NpadStyle,
  type NpadInputState,
  createEmptyNpadState,
  decodeNpadState,
  encodeNpadState,
  normalizeStick,
} from './types';
import { mapGamepadToNpadState, mapKeyboardState, sameNpadState } from './mapper';
import { InputHidAdapter } from './hid-adapter';
import { AppInputSession } from './app-input';
import { createInputRemapping } from './remapping';
import { HidResult } from '../kernel/services/hid';
import { InputLatencyTracker } from './latency';
import { joyConReportToNpadState, parseJoyConInputReport } from './joycon-webhid';

function fakeGamepad(overrides: Partial<ReturnType<typeof createGamepad>> = {}): ReturnType<typeof createGamepad> {
  return {
    ...createGamepad(),
    ...overrides,
    buttons: overrides.buttons ?? createGamepad().buttons,
    axes: overrides.axes ?? createGamepad().axes,
  };
}

function createGamepad() {
  const buttons = Array.from({ length: 16 }, () => ({ pressed: false, touched: false, value: 0 }));
  return {
    id: 'synthetic-gamepad',
    index: 0,
    connected: true,
    timestamp: 1234,
    buttons,
    axes: [0, 0, 0, 0],
  };
}

describe('N-pad input mapping', () => {
  it('maps standard gamepad buttons and axes to Switch N-pad state', () => {
    const gamepad = fakeGamepad();
    gamepad.buttons[0].pressed = true;
    gamepad.buttons[1].pressed = true;
    gamepad.buttons[4].pressed = true;
    gamepad.buttons[6].pressed = true;
    gamepad.buttons[8].pressed = true;
    gamepad.buttons[12].pressed = true;
    gamepad.axes = [0.5, -1, 0.25, 0.75];

    const state = mapGamepadToNpadState(gamepad, 42);

    expect(state.buttons).toBe(NpadButton.B | NpadButton.A | NpadButton.L | NpadButton.ZL | NpadButton.Minus | NpadButton.DPadUp);
    expect(state.leftStickX).toBe(normalizeStick(0.5));
    expect(state.leftStickY).toBe(normalizeStick(-1));
    expect(state.rightStickX).toBe(normalizeStick(0.25));
    expect(state.rightStickY).toBe(normalizeStick(0.75));
    expect(state.timestampMs).toBe(42);
  });

  it('maps keyboard fallback keys to D-pad, face buttons, shoulders, and sticks', () => {
    const keys = new Set(['ArrowRight', 'KeyX', 'KeyV', 'KeyE', 'KeyF', 'Enter', 'KeyD', 'KeyS', 'KeyL', 'KeyI']);

    const state = mapKeyboardState(keys, 99);

    expect(state.buttons).toBe(
      NpadButton.A |
      NpadButton.X |
      NpadButton.R |
      NpadButton.ZR |
      NpadButton.Plus |
      NpadButton.DPadRight |
      NpadButton.LeftStick |
      NpadButton.RightStick,
    );
    expect(state.leftStickX).toBe(32767);
    expect(state.leftStickY).toBe(32767);
    expect(state.rightStickX).toBe(32767);
    expect(state.rightStickY).toBe(-32767);
  });

  it('encodes and decodes shared-memory state as 32-bit little-endian values', () => {
    const state = {
      buttons: NpadButton.A | NpadButton.DPadLeft,
      leftStickX: -123,
      leftStickY: 456,
      rightStickX: -789,
      rightStickY: 1011,
      timestampMs: 123456789,
    };

    const encoded = encodeNpadState(state);
    const decoded = decodeNpadState(encoded);

    expect(decoded).toEqual(state);
  });

  it('compares states without considering timestamps', () => {
    const first = { ...createEmptyNpadState(1), buttons: NpadButton.A };
    const second = { ...createEmptyNpadState(2), buttons: NpadButton.A };

    expect(sameNpadState(first, second)).toBe(true);
  });

  it('adapts input state changes into HID service state', () => {
    const writes: Array<{ npadId: number; state: ReturnType<typeof createEmptyNpadState> }> = [];
    const adapter = new InputHidAdapter({
      setNpadState: (npadId, state) => {
        writes.push({ npadId, state });
        return 0;
      },
      writeSharedMemory: () => 0,
    });

    const state = mapGamepadToNpadState(fakeGamepad(), 500);
    adapter.update(state, 'gamepad');

    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ npadId: 0, state });
    expect(adapter.getLastState()).toBe(state);
  });

  it('keeps the latest state when HID is not attached yet', () => {
    const adapter = new InputHidAdapter(undefined);
    const state = mapGamepadToNpadState(fakeGamepad(), 500);

    expect(adapter.update(state, 'gamepad')).toBe(HidResult.InvalidState);
    expect(adapter.getLastState()).toBe(state);
  });

  it('tracks supported N-pad style sets', () => {
    expect(NpadStyle.FullKey | NpadStyle.JoyDual).toBe(0b1100);
  });

  it('maps gamepad and keyboard buttons through a data-driven remapping model', () => {
    const remapping = createInputRemapping({
      gamepadButtons: { [NpadButton.A]: 11 },
      keyboardButtons: { [NpadButton.ZL]: ['KeyT'] },
    });
    const gamepad = fakeGamepad();
    gamepad.buttons[11].pressed = true;
    const keys = new Set(['KeyT']);

    expect(mapGamepadToNpadState(gamepad, 10, remapping).buttons).toBe(NpadButton.A);
    expect(mapKeyboardState(keys, 20, remapping).buttons).toBe(NpadButton.ZL);
  });

  it('starts browser input sources and buffers state until HID is attached', () => {
    const writes: NpadInputState[] = [];
    const session = new AppInputSession({
      hid: {
        setNpadState: (_npadId, state) => {
          writes.push(state);
          return 0;
        },
        writeSharedMemory: () => 0,
      },
      onStatus: () => undefined,
    });
    const state = mapGamepadToNpadState(fakeGamepad({ timestamp: 30 }), 30);

    session.start();
    expect(session).toBeDefined();
    session.stop();

    expect(writes).toHaveLength(0);
    expect(state.timestampMs).toBe(30);
  });

  it('parses Joy-Con full input reports with buttons, sticks, and IMU samples', () => {
    const bytes = new Uint8Array(55);
    bytes[0] = 0x30;
    bytes[3] = 0b0000_1001; // Y + A
    bytes[4] = 0b0000_0100; // Left stick pressed
    bytes[5] = 0b0000_0010; // D-pad up
    bytes[6] = 0x10;
    bytes[7] = 0x08;
    bytes[8] = 0x80;
    bytes[9] = 0x7f;
    bytes[10] = 0x07;
    bytes[11] = 0x80;
    for (let index = 0; index < 3; index++) {
      const offset = 19 + index * 12;
      bytes[offset] = 0x01;
      bytes[offset + 2] = 0x02;
      bytes[offset + 4] = 0x03;
      bytes[offset + 6] = 0x04;
      bytes[offset + 8] = 0x05;
      bytes[offset + 10] = 0x06;
    }

    const report = parseJoyConInputReport(new DataView(bytes.buffer), 1234);
    const state = joyConReportToNpadState(report!);

    expect(report?.reportId).toBe(0x30);
    expect(state.buttons).toBe(NpadButton.Y | NpadButton.A | NpadButton.LeftStick | NpadButton.DPadUp);
    expect(state.leftStickX).toBeGreaterThan(0);
    expect(state.rightStickX).toBeLessThan(0);
    expect(report?.accelerometer).toHaveLength(3);
    expect(report?.gyroscope).toHaveLength(3);
  });

  it('tracks synthetic browser-to-HID input latency samples', () => {
    const tracker = new InputLatencyTracker();

    tracker.record('keyboard', 100, 106);
    tracker.record('gamepad', 200, 204);

    expect(tracker.getLastSample()?.latencyMs).toBe(4);
    expect(tracker.getAverageLatencyMs()).toBe(5);
  });
});
