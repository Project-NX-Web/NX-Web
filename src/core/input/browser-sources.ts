// Browser input sources for Phase 8.
//
// The Gamepad API is polled through requestAnimationFrame because browsers only
// expose fresh gamepad samples during the animation frame lifecycle. Keyboard
// input is event-driven and emits only when the pressed-key set changes.

import {
  type NpadInputState,
  createEmptyNpadState,
} from './types';
import { mapGamepadToNpadState, mapKeyboardState, sameNpadState, type GamepadLike } from './mapper';
import { createInputRemapping, type InputRemapping } from './remapping';

export type InputStateEmitter = (state: NpadInputState, source: 'gamepad' | 'keyboard') => void;

export interface BrowserInputSourceOptions {
  remapping?: Partial<InputRemapping>;
}

export interface BrowserInputSource {
  start(): void;
  stop(): void;
}

export class BrowserGamepadInputSource implements BrowserInputSource {
  private rafId = 0;
  private lastState = createEmptyNpadState(0);
  private connected = false;
  private readonly remapping: InputRemapping;

  constructor(
    private readonly emit: InputStateEmitter,
    private readonly options: BrowserInputSourceOptions = {},
  ) {
    this.remapping = createInputRemapping(options.remapping);
  }

  start(): void {
    if (this.connected || typeof window === 'undefined') {
      return;
    }

    this.connected = true;
    window.addEventListener('gamepadconnected', this.handleGamepadConnected);
    window.addEventListener('gamepaddisconnected', this.handleGamepadDisconnected);
    this.rafId = window.requestAnimationFrame(this.poll);
  }

  stop(): void {
    if (!this.connected || typeof window === 'undefined') {
      return;
    }

    this.connected = false;
    window.cancelAnimationFrame(this.rafId);
    window.removeEventListener('gamepadconnected', this.handleGamepadConnected);
    window.removeEventListener('gamepaddisconnected', this.handleGamepadDisconnected);
  }

  private readonly handleGamepadConnected = (): void => {
    this.poll(0);
  };

  private readonly handleGamepadDisconnected = (): void => {
    this.emit(createEmptyNpadState(), 'gamepad');
    this.lastState = createEmptyNpadState(0);
  };

  private readonly poll = (_timestamp: number): void => {
    if (!this.connected) {
      return;
    }

    const gamepad = latestConnectedGamepad();
    if (gamepad) {
      const state = mapGamepadToNpadState(gamepad, undefined, this.remapping);
      if (!sameNpadState(state, this.lastState)) {
        this.lastState = state;
        this.emit(state, 'gamepad');
      }
    }

    this.rafId = window.requestAnimationFrame(this.poll);
  };
}

export class KeyboardInputSource implements BrowserInputSource {
  private readonly pressedKeys = new Set<string>();
  private connected = false;
  private readonly remapping: InputRemapping;

  constructor(
    private readonly emit: InputStateEmitter,
    private readonly options: BrowserInputSourceOptions = {},
  ) {
    this.remapping = createInputRemapping(options.remapping);
  }

  start(): void {
    if (this.connected || typeof window === 'undefined') {
      return;
    }

    this.connected = true;
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
    window.addEventListener('blur', this.handleBlur);
  }

  stop(): void {
    if (!this.connected || typeof window === 'undefined') {
      return;
    }

    this.connected = false;
    this.pressedKeys.clear();
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
    window.removeEventListener('blur', this.handleBlur);
  }

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    const sizeBefore = this.pressedKeys.size;
    this.pressedKeys.add(event.code);
    if (this.pressedKeys.size !== sizeBefore) {
      this.emitCurrentState();
    }
  };

  private readonly handleKeyUp = (event: KeyboardEvent): void => {
    const sizeBefore = this.pressedKeys.size;
    this.pressedKeys.delete(event.code);
    if (this.pressedKeys.size !== sizeBefore) {
      this.emitCurrentState();
    }
  };

  private readonly handleBlur = (): void => {
    this.pressedKeys.clear();
    this.emit(createEmptyNpadState(), 'keyboard');
  };

  private emitCurrentState(): void {
    this.emit(mapKeyboardState(this.pressedKeys, undefined, this.remapping), 'keyboard');
  }
}

export function latestConnectedGamepad(): GamepadLike | undefined {
  if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') {
    return undefined;
  }

  const gamepads = navigator.getGamepads();
  let latest: GamepadLike | undefined;
  let latestTimestamp = Number.NEGATIVE_INFINITY;

  for (const gamepad of gamepads) {
    if (!gamepad?.connected) {
      continue;
    }
    if (gamepad.timestamp >= latestTimestamp) {
      latest = gamepad;
      latestTimestamp = gamepad.timestamp;
    }
  }

  return latest;
}
