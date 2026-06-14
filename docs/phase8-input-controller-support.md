# Phase 8: Input and Controller Support

## Status

Phase 8 is complete at the feasible app-shell level with synthetic HID, browser input mapping, remapping UI, WebHID Joy-Con pairing/report parsing scaffold, and latency instrumentation. Physical Joy-Con, HD rumble, real SixAxisSensor integration, and commercial-game latency validation remain hardware/game-gated.

## Implemented

- Synthetic `hid` HLE service registered through `HorizonKernel`.
- HID command scaffold:
  - `CreateAppletResource`
  - `ActivateNpad`
  - `SetSupportedNpadStyleSet`
  - `GetNpadState`
- N-pad state model with button bitmask, left/right stick axes, and timestamp.
- Shared-memory encoding/decoding for HID applet resource state using 32-bit little-endian fields.
- Standard Gamepad API mapping through `requestAnimationFrame`.
- Keyboard fallback mapping for no-gamepad scenarios.
- App-shell input session integration point that starts browser sources and attaches to HID when the kernel/CPU are available.
- Minimal controls remapping UI with localStorage persistence.
- Data-driven remapping model shared by code and UI.
- WebHID Joy-Con pairing scaffold with 0x21/0x30 report parsing and IMU sample extraction.
- Synthetic browser-to-HID latency instrumentation.
- Synthetic CMIF-style TLS validation for service pointer/size combinations, buffer limits, and unsupported flags.
- Synthetic input and HID service tests.

## Important limitations

- This is not a complete Switch HID implementation.
- Real CMIF domain/session semantics are still deferred; the kernel now validates synthetic TLS request shape before dispatch.
- WebHID Joy-Con pairing/report parsing is implemented as a feature-gated scaffold but not validated against physical Joy-Con hardware.
- HD rumble output reports and real SixAxisSensor integration are deferred.
- Minimal button remapping UI is implemented; a polished settings panel is still future work.
- No commercial game pause-menu input validation has been performed.

## Files

- `src/core/input/types.ts`
- `src/core/input/mapper.ts`
- `src/core/input/browser-sources.ts`
- `src/core/input/hid-adapter.ts`
- `src/core/input/remapping.ts`
- `src/core/input/app-input.ts`
- `src/core/input/index.ts`
- `src/main.ts`
- `src/core/kernel/services/hid.ts`
- `src/core/kernel/horizon.ts`

## Verification

Synthetic verification is performed with:

```powershell
npm test -- src/core/input/input.test.ts src/core/kernel/services/hid.test.ts src/core/kernel/horizon.test.ts
npm run build
```

Browser verification, when the app shell is ready for input testing, should confirm:

- `navigator.getGamepads()` is polled only through `requestAnimationFrame`.
- Keyboard input updates the synthetic HID state without requiring a connected gamepad.
- WebHID calls are made only after the user clicks the Joy-Con pairing button and only when `navigator.hid` exists.
