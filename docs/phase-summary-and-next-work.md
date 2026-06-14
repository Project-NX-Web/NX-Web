# NX-Web Phase Summary and Next Work

## Current status

- Phase 3 CPU/VMM is structurally complete for the synthetic ARM64 interpreter, VMM, stack/boot-region helpers, and homebrew-style SVC fixture.
- Phase 4 Horizon OS HLE kernel is structurally complete and verified with hardened synthetic CMIF-style TLS validation.
- Phase 5 GPU emulation/rendering foundation is structurally complete and verified with synthetic tests.
- Phase 6 Audio is structurally scaffolded with domain model, worker/AudioWorklet pieces, and synthetic `audren:u` coverage.
- Phase 7 JIT/performance scaffolding is implemented and verified with synthetic profiling, block IR, WASM block compiler, shader cache, and frame pacing tests.
- Phase 8 input/controller work is complete at the feasible app-shell level: synthetic HID, Gamepad/keyboard input, remapping UI, WebHID Joy-Con report parsing scaffold, and latency instrumentation.
- A continuation prompt for Phases 6 and 7 is in `docs/phase6-7-continuation-prompt.md`.

## Verified commands

- `npm test` passed most recently with 34 test files and 170 tests.
- `npm run build` passed TypeScript and Vite build.

## Phase 4 summary

Completed:
- Horizon kernel syscall bridge.
- Handle table lifecycle.
- Process/thread state.
- Kernel events.
- Common syscalls.
- Synthetic service-manager foundation.
- CPU/kernel integration tests for SVC results and invalid pointers.

Important limitations:
- Full CMIF IPC parsing is still deferred, though synthetic TLS validation is hardened.
- `sm:RegisterService` and `sm:GetService` are synthetic service-manager methods, not real IPC command handlers.

## Phase 5 summary

Completed:
- GPFIFO parser.
- NV2A/Maxwell method parser.
- Maxwell render-state model.
- Synthetic Maxwell ISA → WGSL compiler.
- WebGPU pipeline descriptor scaffolding.
- Texture cache and ASTC metadata.
- Synthetic ASTC 4x4 decode.
- Synthetic GPU renderer integration facade.
- GPU unit and integration tests.

Important limitations:
- This is not accurate commercial Maxwell execution.
- Real `nvdrv` IOCTLs are not implemented.
- Real CMIF IPC is not implemented.
- Real Maxwell shader ISA decompilation is not implemented.
- Live WebGPU device/pipeline/draw/present is not implemented.
- Production ASTC decoding is not implemented.
- Commercial game boot validation is not done.

## Phase 6 summary

Completed:
- Audio domain model and ring-buffer scaffolding.
- PCM16/ADPCM decoding scaffolding.
- Synthetic `audren:u` service HLE.
- Audio worker and AudioWorklet scaffolding.
- Synthetic audio worker tests.

Important limitations:
- This is not a complete Switch audio pipeline yet.
- Real `audren:u` command dispatch, hardware buffer management, and device-present behavior remain future work.

## Phase 7 summary

Completed:
- Optional CPU execution modes: `interpreter`, `jit`, and `hybrid`.
- Profiling hooks for instruction counts, branch/load/store/SVC counts, opcode distribution, JIT block count, and JIT fallback count.
- Synthetic profiling coverage for interpreter and JIT paths.
- ARM64 basic-block splitting with deterministic IR for NOP, MOVZ, MOVK, ADD/SUB immediate, branches, halt/SVC/BRK markers, and unsupported terminals.
- Safe limited WebAssembly block compiler that emits binary directly, caches compiled blocks, invalidates by PC, and falls back to the interpreter for unsupported blocks.
- Synthetic shader WGSL cache with deterministic hash, title-id scoped keys, memory storage adapter, and cache tests.
- Frame pacing telemetry with mocked-time coverage for frame time, dropped frames, budget, average/max frame time, and remaining budget.

Important limitations:
- The Phase 7 JIT is a scaffold, not a production ARM64-to-WASM compiler.
- It only compiles a narrow integer-immediate subset and does not implement conditional branches, memory load/store lowering, flags, SIMD/FP, or commercial-game performance.
- Shader cache is synthetic storage scaffolding, not real OPFS persistence or real Maxwell decompilation.
- Frame pacing provides a telemetry/pacing model, not a full browser presentation loop or developer overlay UI.
- No commercial-game 30 FPS stability claim is made.

## Phase 8 summary

Completed at feasible app-shell level:
- Synthetic `hid` service registered in `HorizonKernel`.
- HID applet resource, N-pad activation, supported style set, and N-pad state commands.
- Shared-memory encoding for buttons and left/right stick axes as 32-bit little-endian values.
- Browser Gamepad API mapping through `requestAnimationFrame`.
- Keyboard fallback mapping.
- App-shell input session integration point.
- Minimal controls remapping UI with localStorage persistence.
- Data-driven remapping model for future UI.
- WebHID Joy-Con pairing/report parsing scaffold.
- Synthetic browser-to-HID latency instrumentation.
- Synthetic CMIF-style TLS validation hardening.
- Synthetic input and HID service tests.

Important limitations:
- Phase 8 is scaffolded, not complete.
- Real CMIF HID session/domain handling is still deferred, but synthetic TLS validation is hardened.
- WebHID Joy-Con report parsing is scaffolded but not hardware-validated; HD rumble and SixAxisSensor integration remain future work.
- Minimal remapping UI exists; polished settings panel and real game pause-menu validation remain future work.
- No sub-16ms latency claim is made without browser/hardware measurement.

## What still needs to be done

Highest-priority next work:

1. Finish service IPC foundation before more service HLE
   - Add TLS buffer handling.
   - Add CMIF request/response parsing.
   - Connect `svcSendSyncRequest` to real service dispatch.
   - Move synthetic `sm` methods behind IPC-style handlers.

2. Connect GPU parsing to `nvdrv`
   - Add synthetic `nvdrv` service HLE.
   - Handle `NVMAP_IOC_FROM_ID`, `NVGPU_AS_IOCTL_MAP_BUFFER_EX`, and `NVGPU_GPU_IOCTL_SUBMIT_GPFIFO`.
   - Feed parsed GPFIFO into the Phase 5 renderer.

3. Finish Phase 8 input/controller validation and hardware paths
   - Add real CMIF HID session/domain handling.
   - Validate browser Gamepad/keyboard latency with <16ms target against hardware.
   - Validate Joy-Con WebHID parsing against physical Joy-Con hardware.
   - Integrate SixAxisSensor state and HD rumble output report 0x10 when a motion-control requirement exists.

## Files to read first

- `Agent.md` — canonical roadmap.
- `docs/phase4-checklist.md` — Phase 4 completion notes.
- `docs/phase5-gpu-rendering.md` — Phase 5 completion notes and limitations.
- `docs/phase5-checklist.md` — short Phase 5 checklist.
- `docs/phase6-7-continuation-prompt.md` — Phase 6/7 continuation context.
- `src/core/kernel/horizon.ts` — syscall/kernel/service-manager foundation.
- `src/core/gpu/*` — Phase 5 GPU foundation.
- `src/core/cpu/*` and `src/core/cpu/jit/*` — Phase 7 CPU profiling and JIT scaffolding.
- `src/core/performance/*` — Phase 7 frame pacing telemetry.

## Important constraints

- Keep tests synthetic.
- Do not bundle or depend on copyrighted Switch firmware, keys, NROs, NSPs, or XCIs.
- Preserve Phase 3 failure behavior:
  - instruction fetch must go through VMM execute checks
  - unknown instructions must throw controlled errors
  - invalid memory accesses must throw controlled errors
- Preserve Phase 4 failure behavior:
  - syscalls return structured result codes
  - invalid syscall pointers do not crash
  - unimplemented syscalls log warnings and return defined stub results
- If documentation conflicts with `Agent.md`, follow `Agent.md` and update the documentation.
