## NX Web README
NX-Web is currently a browser-native Nintendo Switch emulator scaffold with substantial synthetic HLE foundations, not
  yet a playable commercial-game emulator.

  The project has working TypeScript/Vite infrastructure, ROM/container parsing, a synthetic ARM64 CPU interpreter path,
  VMM/memory handling, Horizon-style kernel/syscall scaffolding, synthetic service HLE, synthetic GPU/rendering
  foundations, synthetic audio foundations, and Phase 8 input/controller integration.

  The latest verification state:

  - npm test: 34 test files, 170 tests passed
  - npm run build: passed
  - No retail firmware, prod.keys, encrypted retail NCAs, or commercial games were used for verification.

  ---
  Progress by phase

  Phase 1 — Toolchain and project scaffold

  Status: complete.

  Implemented:

  - Vite + TypeScript browser app.
  - COOP/COEP headers for SharedArrayBuffer.
  - Worker aliases.
  - WASM source/tooling scaffold.
  - Makefile/dev/test/build commands.
  - Contribution and compatibility docs.

  This phase is foundational and working.

  ---
  Phase 2 — ROM/container/filesystem parsing

  Status: structurally complete for supported non-retail fixtures and synthetic tests.

  Implemented coverage for:

  - NRO parsing.
  - PFS0/HFS0.
  - NSP/XCI container parsing.
  - RomFS/VFS.
  - StorageManager.
  - AES-CTR, AES-XTS, AES-CMAC helpers.
  - NCA header/section helpers.
  - Atmosphere fixture parsing.
  - hbmenu.nro fixture parsing where present.

  Important limitation:

  - Retail encrypted NCA end-to-end execution/parsing remains intentionally untested.
  - No commercial game boot is available yet.

  This is good parser infrastructure, but it is not yet a full game-loading pipeline.

  ---
  Phase 3 — CPU, memory, and ARM64 interpreter

  Status: structurally complete for the synthetic ARM64 interpreter foundation.

  Implemented:

  - VirtualMemoryManager with:
    - page mapping/unmapping,
    - permissions,
    - physical RAM pool,
    - boot-region helpers,
    - stack growth helpers,
    - cross-page read/write behavior.
  - ARM64 interpreter facade via Cpu.
  - Dispatch table indexed by opcode bits.
  - Synthetic ARM64 instruction support:
    - MOVZ/MOVK/MOVN,
    - ADD/SUB,
    - AND/ORR/EOR,
    - branch/branch-link,
    - RET/BR/BLR,
    - CBZ/CBNZ,
    - SVC/BRK,
    - load/store immediates.
  - CPU state handling:
    - XZR behavior,
    - SP alias,
    - W-register zero-extension,
    - condition flags.
  - Synthetic homebrew-style SVC fixture that reaches a MAIN marker.

  Important limitation:

  - This is still an interpreter scaffold, not a full Switch CPU implementation.
  - Many ARM64 instruction classes remain unimplemented.
  - Real NRO execution beyond synthetic fixtures is not yet supported.

  ---
  Phase 4 — Horizon OS HLE kernel and services

  Status: structurally complete for synthetic HLE kernel behavior.

  Implemented:

  - HorizonKernel.
  - SVC dispatch.
  - Structured Horizon-style result codes.
  - Handle table.
  - Process/thread state.
  - Kernel events.
  - Common syscalls:
    - heap size,
    - exit process,
    - sleep thread,
    - close handle,
    - sync request,
    - output debug string,
    - thread/process IDs,
    - create/signal/wait events,
    - map/unmap memory,
    - query memory.
  - Synthetic service manager.
  - Synthetic service implementations:
    - nvdrv,
    - audren:u,
    - hid.

  Recent hardening:

  - Synthetic CMIF-style TLS request validation:
    - message size,
    - pointer/size combinations,
    - buffer limits,
    - unsupported flags.

  Important limitation:

  - This is not real CMIF IPC parsing.
  - sm:RegisterService / sm:GetService are still synthetic service-manager paths.
  - Real service sessions/domains are future work.

  ---
  Phase 5 — GPU emulation/rendering foundation

  Status: structurally complete as a synthetic GPU/rendering foundation.

  Implemented:

  - GPFIFO parser.
  - NV2A/Maxwell method parser.
  - Maxwell render-state model.
  - Synthetic Maxwell ISA → WGSL compiler.
  - WebGPU-like pipeline descriptor scaffolding.
  - Texture cache.
  - ASTC metadata and synthetic ASTC 4x4 decode.
  - Synthetic renderer integration facade.
  - GPU unit/integration tests.

  Important limitation:

  - This is not accurate commercial Maxwell execution.
  - Real nvdrv IOCTLs are not implemented.
  - Real Maxwell shader ISA decompilation is not implemented.
  - Live WebGPU device/pipeline/draw/present is not implemented.
  - Production ASTC decoding is not implemented.
  - No commercial game GPU command validation exists.

  This is a strong synthetic GPU foundation, but not yet real Switch GPU execution.

  ---
  Phase 6 — Audio subsystem

  Status: structurally scaffolded and synthetic-tested.

  Implemented:

  - Audio domain model:
    - AudioRenderer,
    - AudioVoice,
    - AudioBuffer,
    - AudioMixState.
  - PCM ring buffer.
  - PCM16/ADPCM decoding scaffolding.
  - Mixer.
  - Synthetic audren:u service HLE.
  - Audio worker scaffold.
  - AudioWorklet scaffold.
  - Synthetic audio worker tests.

  Important limitation:

  - This is not yet a complete Switch audio pipeline.
  - Real Web Audio output is not fully wired.
  - Real audren:u command dispatch is synthetic.
  - Hardware buffer management and device-present behavior remain future work.

  ---
  Phase 7 — JIT/performance

  Status: synthetic scaffolding implemented and tested.

  Implemented:

  - CPU execution modes:
    - interpreter,
    - jit,
    - hybrid.
  - Profiling hooks:
    - instruction count,
    - branch/load/store/SVC counts,
    - opcode distribution,
    - JIT block/fallback counts.
  - ARM64 basic-block splitting.
  - Synthetic block IR.
  - Limited WebAssembly block compiler.
  - JIT fallback behavior.
  - Synthetic shader cache.
  - Frame pacing telemetry.
  - Tests for JIT block splitting, WASM compiler, shader cache, and frame pacing.

  Important limitation:

  - This is not a production ARM64-to-WASM JIT.
  - It only covers a narrow integer-immediate subset.
  - It does not implement full conditional branches, memory lowering, flags, SIMD/FP, or commercial-game performance.
  - No 30/60 FPS gameplay claim is valid yet.

  ---
  Phase 8 — Input and controller support

  Status: complete at the feasible app-shell level.

  Implemented:

  - Synthetic hid HLE service.
  - HID commands:
    - CreateAppletResource,
    - ActivateNpad,
    - SetSupportedNpadStyleSet,
    - GetNpadState.
  - N-pad state model:
    - buttons bitmask,
    - left/right stick X/Y,
    - timestamp.
  - HID shared-memory encoding/decoding.
  - Gamepad API mapping through requestAnimationFrame.
  - Keyboard fallback mapping.
  - Data-driven remapping model.
  - Minimal in-page controls/remapping UI.
  - localStorage remapping persistence.
  - App-shell input session integration.
  - WebHID Joy-Con pairing/report parsing scaffold:
    - 0x21 standard input,
    - 0x30 full input with IMU samples.
  - Synthetic browser-to-HID latency instrumentation.
  - Synthetic CMIF-style TLS validation hardening.
  - Phase 8 tests.

  Important limitation:

  - Physical Joy-Con validation has not been performed.
  - HD rumble output report 0x10 is not implemented.
  - Real SixAxisSensor integration is not implemented.
  - Commercial-game pause-menu input validation has not been performed.
  - <16ms latency target has not been measured against real hardware/game input.

  Phase 8 is now as complete as can be finished without physical Joy-Con hardware or a real game/homebrew latency
  target.

  ---
  Phase 9 — Multiplayer/network services

  Status: not implemented.

  Planned in roadmap:

  - LDN-style local wireless.
  - WebRTC DataChannels.
  - Signaling server.
  - nsd / nifm service emulation.

  Current repository state:

  - No substantive Phase 9 implementation found.
  - This remains future work.

  ---
  Phase 10 — UI/UX/final polish

  Status: minimal app shell only.

  Implemented:

  - Basic Vite app shell.
  - ROM drag/drop zone.
  - Status panel.
  - Phase 8 controls/remapping panel.
  - WebHID Joy-Con pairing button.

  Not implemented:

  - Home screen/library.
  - OPFS save management UI.
  - Graphics settings.
  - System settings.
  - Controls settings panel beyond minimal remapping.
  - Developer overlay.
  - Pause menu.
  - Save states.
  - Onboarding flow.
  - Error overlay system.
  - Full non-technical user experience.

  ---
  Overall progress toward a browser Nintendo Switch emulator

  What exists now

  The repository has a real multi-phase emulator scaffold:

  - Browser app.
  - ROM/container parsing.
  - Memory management.
  - Synthetic ARM64 interpreter.
  - Horizon-style kernel/syscall HLE.
  - Synthetic service HLE.
  - Synthetic GPU/rendering foundations.
  - Synthetic audio foundations.
  - Input/controller app integration.
  - Tests and build pipeline.

  This is meaningful infrastructure. The project is no longer just an empty scaffold.

  What does not exist yet

  The project is not yet a playable Nintendo Switch emulator.

  Missing for actual gameplay:

  - Real CMIF IPC/session/domain handling.
  - Full ARM64 instruction coverage.
  - Real NRO/NSP/XCI game loading and execution flow.
  - Real nvdrv IOCTL path into GPU.
  - Live WebGPU presentation.
  - Real shader decompilation.
  - Real audio output pipeline.
  - Production JIT.
  - Real game compatibility testing.
  - Save state/load state.
  - Full UI/UX.
  - Multiplayer/network services.

  Honest progress estimate

  If the target is “documented synthetic foundation phases”, then:

  - Phases 1–5 are substantially complete at synthetic/scaffold level.
  - Phase 6 is scaffolded.
  - Phase 7 is scaffolded.
  - Phase 8 is complete at feasible app-shell level.
  - Phases 9–10 are mostly future work.

  If the target is “a browser Nintendo Switch emulator that can boot and play commercial games”, then the project is
  still early-to-mid foundation. A reasonable estimate is roughly 20–30% of the total emulator target, with the caveat
  that emulator completeness is not linear.

  The hardest remaining work is not Phase 8; it is the integration of:

  1. real CMIF IPC,
  2. full CPU instruction coverage,
  3. real service HLE,
  4. real GPU command execution/presentation,
  5. real audio output,
  6. real game loading/boot flow,
  7. hardware compatibility validation.

  Bottom line

  NX-Web has strong synthetic foundations across CPU, memory, kernel, services, GPU, audio, and input. Phase 8 is now
  finished at the feasible app-shell level. The repository is not yet a playable Switch emulator, but it has the
  architectural pieces needed to continue toward one..