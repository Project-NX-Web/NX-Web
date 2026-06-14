// Browser-independent input mapping for Phase 8.
//
// Gamepad and keyboard sources are reduced to the same synthetic Switch N-pad
// state. Unit tests can feed lightweight fakes instead of requiring a browser.

import {
  NpadButton,
  type NpadInputState,
  createEmptyNpadState,
  normalizeStick,
} from './types';
import {
  createInputRemapping,
  npadButtonsFromGamepad,
  npadButtonsFromKeyboard,
  type InputRemapping,
} from './remapping';

export interface GamepadButtonLike {
  pressed: boolean;
  touched?: boolean;
  value?: number;
}

export interface GamepadLike {
  id: string;
  index?: number;
  connected: boolean;
  timestamp?: number;
  buttons: readonly GamepadButtonLike[];
  axes: readonly number[];
}

export function mapGamepadToNpadState(
  gamepad: GamepadLike,
  timestampMs = nowForSource(gamepad),
  remapping = createInputRemapping(),
): NpadInputState {
  const buttons = gamepad.buttons;
  let npadButtons = 0;

  for (let index = 0; index < buttons.length; index++) {
    if (buttons[index]?.pressed) {
      npadButtons |= npadButtonsFromGamepad(index, remapping);
    }
  }

  return {
    ...createEmptyNpadState(timestampMs),
    buttons: npadButtons,
    leftStickX: normalizeStick(gamepad.axes[0] ?? 0),
    leftStickY: normalizeStick(gamepad.axes[1] ?? 0),
    rightStickX: normalizeStick(gamepad.axes[2] ?? 0),
    rightStickY: normalizeStick(gamepad.axes[3] ?? 0),
  };
}

export function mapKeyboardState(
  keys: ReadonlySet<string>,
  timestampMs = nowForSource({ code: [...keys].at(-1) ?? '' }),
  remapping = createInputRemapping(),
): NpadInputState {
  const has = (code: string): boolean => keys.has(code);
  const leftX = axisFromKeys(has, 'KeyD', 'KeyA');
  const leftY = axisFromKeys(has, 'KeyS', 'KeyW');
  const rightX = axisFromKeys(has, 'KeyL', 'KeyJ');
  const rightY = axisFromKeys(has, 'KeyK', 'KeyI');

  return {
    ...createEmptyNpadState(timestampMs),
    buttons:
      npadButtonsFromKeyboard(keys, remapping) |
      (leftX !== 0 || leftY !== 0 ? NpadButton.LeftStick : 0) |
      (rightX !== 0 || rightY !== 0 ? NpadButton.RightStick : 0),
    leftStickX: normalizeStick(leftX),
    leftStickY: normalizeStick(leftY),
    rightStickX: normalizeStick(rightX),
    rightStickY: normalizeStick(rightY),
  };
}

export function sameNpadState(a: NpadInputState, b: NpadInputState): boolean {
  return a.buttons === b.buttons &&
    a.leftStickX === b.leftStickX &&
    a.leftStickY === b.leftStickY &&
    a.rightStickX === b.rightStickX &&
    a.rightStickY === b.rightStickY;
}

function axisFromKeys(has: (code: string) => boolean, positive: string, negative: string): number {
  const positiveDown = has(positive);
  const negativeDown = has(negative);
  if (positiveDown === negativeDown) {
    return 0;
  }
  return positiveDown ? 1 : -1;
}

function nowForSource(_source: { timestamp?: number } | { code?: string }): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}
