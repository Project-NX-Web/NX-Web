# Phase 8 Checklist: Input and Controller Support

## Phase goal

Complete input handling with sub-16ms latency.

## Phase 8a: HID service implementation

- [x] Add synthetic `hid` service implementation.
- [x] Register `hid` in `HorizonKernel`.
- [x] Add `ActivateNpad` synthetic command.
- [x] Add `SetSupportedNpadStyleSet` synthetic command.
- [x] Add `CreateAppletResource` synthetic command.
- [x] Model N-pad state as buttons bitmask plus left/right stick X/Y values.
- [x] Add shared-memory encoding for HID applet resource state.
- [x] Harden synthetic CMIF-style TLS validation for pointer/size combinations, buffer limits, and unsupported flags.
- [ ] Implement real CMIF domain/session parsing for HID.
- [ ] Validate against motion-control homebrew.

## Phase 8b: Gamepad API integration

- [x] Map standard Gamepad API buttons to Switch buttons.
- [x] Poll gamepads through `requestAnimationFrame`.
- [x] Emit synthetic `NpadInputState` on state changes.
- [x] Add synthetic mapping tests.
- [x] Add app-shell input session integration point.
- [x] Add data-driven remapping model before UI.
- [x] Add minimal remapping UI with localStorage persistence.
- [x] Add synthetic browser-to-HID latency instrumentation.
- [ ] Measure end-to-end browser input latency against a real gamepad.

## Phase 8c: WebHID Joy-Con support

- [x] Gate WebHID Joy-Con support behind feature detection and user action.
- [x] Detect Joy-Con via `navigator.hid.requestDevice({ filters: [{ vendorId: 0x057e }] })`.
- [x] Parse HID input reports `0x21` and `0x30`.
- [x] Extract IMU gyro/accel raw samples.
- [ ] Validate Joy-Con parsing against physical hardware.
- [ ] Write IMU data to HID shared memory.
- [ ] Implement HD rumble output report `0x10`.

## Phase 8d: Keyboard mapping

- [x] Map Arrow keys to D-pad.
- [x] Map `ZXCV` to `ABXY`.
- [x] Map `QE` to `L/R`.
- [x] Map `RF` to `ZL/ZR`.
- [x] Map `Enter` to Plus.
- [x] Map `Backspace` to Minus.
- [x] Map `Tab` to Home.
- [x] Map `WASD` to left stick.
- [x] Map `IJKL` to right stick.
- [x] Add data-driven remapping model.
- [ ] Add user-facing remapping controls.

## Quality gates

- [x] Synthetic tests added for HID service and input mapping.
- [x] Full `npm test` passes after Phase 8 changes.
- [x] Full `npm run build` passes after Phase 8 changes.
- [x] WebHID calls are gated behind feature detection and a user gesture.
- [ ] No commercial-game input claims made yet.
