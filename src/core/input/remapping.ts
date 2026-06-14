// Data-driven input remapping for Phase 8.
//
// The remapping model stays independent from browser APIs so tests, settings, and
// future UI can share the same button mapping semantics.

import { NpadButton } from './types';

export type ButtonKey = keyof typeof NpadButton;

export interface InputRemapping {
  gamepadButtons: Record<number, number>;
  keyboardButtons: Record<number, readonly string[]>;
}

export const DEFAULT_GAMEPAD_BUTTON_REMAPPING: InputRemapping['gamepadButtons'] = {
  [NpadButton.B]: 0,
  [NpadButton.A]: 1,
  [NpadButton.Y]: 2,
  [NpadButton.X]: 3,
  [NpadButton.L]: 4,
  [NpadButton.R]: 5,
  [NpadButton.ZL]: 6,
  [NpadButton.ZR]: 7,
  [NpadButton.Minus]: 8,
  [NpadButton.Plus]: 9,
  [NpadButton.DPadUp]: 12,
  [NpadButton.DPadDown]: 13,
  [NpadButton.DPadLeft]: 14,
  [NpadButton.DPadRight]: 15,
};

export const DEFAULT_KEYBOARD_BUTTON_REMAPPING: InputRemapping['keyboardButtons'] = {
  [NpadButton.B]: ['KeyZ'],
  [NpadButton.A]: ['KeyX'],
  [NpadButton.Y]: ['KeyC'],
  [NpadButton.X]: ['KeyV'],
  [NpadButton.L]: ['KeyQ'],
  [NpadButton.R]: ['KeyE'],
  [NpadButton.ZL]: ['KeyR'],
  [NpadButton.ZR]: ['KeyF'],
  [NpadButton.Plus]: ['Enter'],
  [NpadButton.Minus]: ['Backspace'],
  [NpadButton.Home]: ['Tab'],
  [NpadButton.DPadUp]: ['ArrowUp'],
  [NpadButton.DPadDown]: ['ArrowDown'],
  [NpadButton.DPadLeft]: ['ArrowLeft'],
  [NpadButton.DPadRight]: ['ArrowRight'],
};

export function createInputRemapping(overrides?: Partial<InputRemapping>): InputRemapping {
  return {
    gamepadButtons: {
      ...DEFAULT_GAMEPAD_BUTTON_REMAPPING,
      ...overrides?.gamepadButtons,
    },
    keyboardButtons: {
      ...DEFAULT_KEYBOARD_BUTTON_REMAPPING,
      ...overrides?.keyboardButtons,
    },
  };
}

export function npadButtonsFromGamepad(gamepadButtonIndex: number, remapping: InputRemapping): number {
  let buttons = 0;
  for (const [npadButton, mappedGamepadButton] of Object.entries(remapping.gamepadButtons)) {
    if (mappedGamepadButton === gamepadButtonIndex) {
      buttons |= Number(npadButton);
    }
  }
  return buttons;
}

export function npadButtonsFromKeyboard(keys: ReadonlySet<string>, remapping: InputRemapping): number {
  let buttons = 0;
  for (const [npadButton, keyCodes] of Object.entries(remapping.keyboardButtons)) {
    if (keyCodes.some((keyCode) => keys.has(keyCode))) {
      buttons |= Number(npadButton);
    }
  }
  return buttons;
}
