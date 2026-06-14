# Continuation Prompt: Phase 6 Audio + Phase 7 JIT/Performance

Use this prompt to continue NX-Web after the verified Phase 5 GPU foundation.

## Current verified state

Phase 5 is structurally complete at the synthetic foundation level:

- `src/core/gpu/gpfifo.ts` parses synthetic GPFIFO pointer/size entries.
- `src/core/gpu/maxwell.ts` parses synthetic NV2A/Maxwell method streams and tracks class `0xB197`.
- `src/core/gpu/render-state.ts` accumulates viewport, render target, blend, depth, rasterizer, topology, and draw state.
- `src/core/gpu/shader.ts` emits WGSL from a synthetic Maxwell instruction model for `MOV32I`, `FADD`, `FMUL`, `FFMA`, `ISETP`, `BRA`, `LD`, `ST`, and `TEX`.
- `src/core/gpu/pipeline.ts` builds WebGPU-like render-pipeline descriptors and capability snapshots.
- `src/core/gpu/texture.ts` provides texture cache, range invalidation, ASTC block metadata, and synthetic ASTC 4x4 decode.
- `src/core/gpu/renderer.ts` ties GPFIFO submission, Maxwell state, shader compilation, texture cache, and synthetic frame presentation together.
- Phase 5 tests pass under `npm test`.
- `npm run build` passes.
- No retail firmware, keys, NROs, NSPs, XCIs, or commercial GPU command streams were used.

Important Phase 5 limitation:
- This is not accurate commercial Maxwell execution yet.
- Real `nvdrv` IOCTLs, real CMIF IPC, real Maxwell ISA decompilation, live WebGPU device/pipeline/draw/present, production ASTC decoding, OPFS shader cache, and commercial game boot validation are still future work.

## What still needs to be done before Phase 6

Phase 4/5 handoff items that may still need follow-up:

1. Real CMIF IPC
   - `svcSendSyncRequest` still validates handles but does not parse real TLS CMIF buffers.
   - `sm:RegisterService` and `sm:GetService` are synthetic methods, not real IPC command handlers.
   - Do not start audio service work until the syscall/handle/IPC boundary can pass structured service requests safely.

2. Real `nvdrv` service IOCTLs
   - Phase 5 GPU parsing is not connected to `nvdrv`.
   - Add synthetic `nvdrv` IOCTL handling before relying on GPU command submission from guest code.

3. Real WebGPU presentation
   - Current renderer returns synthetic frame metadata only.
   - Live `GPUDevice`, `GPURenderPipeline`, `GPURenderPassEncoder`, canvas blit, and presentation remain deferred.

4. Real shader pipeline
   - Current shader compiler accepts already-modeled `MaxwellInstruction` values.
   - Real 64-bit Maxwell ISA parsing, SSA IR, WGSL lowering, OPFS shader cache, and shader-cache UI remain future work.

## Phase 6 prompt: Audio subsystem

Start Phase 6 only after confirming the kernel/service handoff is stable enough for service HLE.

Phase 6 goal from `Agent.md`:
- Produce game audio through the Web Audio API.
- Implement `audren:u` Audio Renderer service HLE.
- Run audio processing in a dedicated worker/AudioWorklet path.
- Support ADPCM, PCM16, and Opus fallback behavior.

Phase 6 implementation order:

1. Add audio domain model
   - Create `src/core/audio/`.
   - Add `AudioRenderer`, `AudioVoice`, `AudioBuffer`, `AudioMixState`, and result-code types.
   - Model up to 24 hardware voices:
     - sample data pointer
     - loop start/end
     - pitch
     - volume
     - play state
     - sample format: PCM16 or ADPCM
   - Keep all tests synthetic. Do not use retail audio samples.

2. Add audio decoding
   - Implement PCM16 passthrough.
   - Implement Nintendo/GameCube-style ADPCM decoder with test vectors.
   - Add Opus capability detection:
     - Prefer browser `AudioDecoder` when available.
     - Provide a clear fallback path/interface for future `libopus` WASM.
   - Do not bundle proprietary codecs or samples.

3. Add ring buffer
   - Implement a typed-array ring buffer for interleaved PCM frames.
   - Handle producer/consumer timing mismatches.
   - Underrun behavior must output silence, not crash or corrupt state.
   - Add tests for wraparound, overfill, underfill, and silence-on-underrun.

4. Add audio worker/AudioWorklet scaffolding
   - Create `src/workers/audio.worker.ts` or equivalent.
   - Create `src/workers/audio-worklet.ts` if the project can bundle worklets.
   - Use `SharedArrayBuffer` only if COOP/COEP is available.
   - If SharedArrayBuffer is unavailable, fall back to postMessage buffers and document the limitation.
   - Do not block the main thread during audio mixing.

5. Add `audren:u` service HLE
   - Add `src/core/kernel/services/audren-u.ts`.
   - Implement synthetic methods first:
     - `OpenAudioRenderer`
     - `StartAudioRenderer`
     - `StopAudioRenderer`
     - `RequestUpdateAudioRenderer`
   - Return handles through `HorizonKernel.handleTable`.
   - Keep real CMIF parsing deferred unless Phase 4 IPC scaffolding is expanded.

6. Add tests
   - Audio decoder tests.
   - Ring buffer tests.
   - Voice mixing tests.
   - Service HLE tests for handle creation/start/stop/update.
   - Worker fallback tests where practical.

Phase 6 acceptance criteria:
- `npm test` passes.
- `npm run build` passes.
- PCM16 and ADPCM decode known synthetic/reference vectors.
- Ring buffer never crashes on underrun and outputs silence.
- `audren:u` synthetic service returns structured handles/results.
- No audio worker blocks or throws during normal update.
- No retail audio content is bundled.

## Phase 7 prompt: JIT compiler and performance optimization

Start Phase 7 after the interpreter, VMM, kernel syscall layer, and at least one service path are stable enough to profile.

Phase 7 goal from `Agent.md`:
- Achieve native-speed CPU execution for 30/60 FPS gameplay.
- Add an AOT/block compiler from ARM64 to WebAssembly.
- Optimize memory access hot paths.
- Add frame pacing and developer telemetry.

Phase 7 implementation order:

1. Add profiling hooks
   - Add optional instruction counters to `Cpu`.
   - Track instruction frequency, branch frequency, load/store frequency, and SVC frequency.
   - Add synthetic test programs that exercise hot patterns.
   - Do not optimize before measuring.

2. Add block IR
   - Create `src/core/cpu/jit/`.
   - Add ARM64 basic-block splitting:
     - start at PC
     - continue through linear instructions
     - stop at branch, RET, SVC, BRK, or max block length.
   - Represent operations as a small IR:
     - register read/write
     - immediate load
     - add/sub
     - load/store
     - branch target
     - halt/syscall marker.
   - Keep IR deterministic and testable.

3. Add WASM block compiler
   - Emit WebAssembly binary directly, not WAT at runtime.
   - Start with safe limited patterns:
     - MOVZ/MOVK
     - ADD/SUB immediate
     - simple stores/loads through VMM callbacks
     - branch to absolute target
     - halt/syscall callback.
   - Cache compiled blocks in `Map<bigint, WebAssembly.Instance>` or equivalent.
   - Invalidate cache on self-modifying code writes if memory write APIs expose that path.

4. Integrate optional JIT execution
   - Keep interpreter as fallback.
   - Add `Cpu.executionMode` or similar:
     - `interpreter`
     - `jit`
     - `hybrid`.
   - Ensure SVC, unknown instructions, and memory faults preserve existing structured behavior.
   - Do not let JIT failures corrupt CPU state; fall back to interpreter or controlled error.

5. Optimize memory access
   - Identify VMM hot paths from profiling.
   - Add fast-path helpers for mapped page reads/writes where safe.
   - Keep permission checks intact.
   - Preserve Phase 3 behavior: instruction fetch must still go through VMM execute checks.

6. Add shader cache from Phase 5
   - Add OPFS persistence for compiled WGSL under `shader-cache/{titleId}/{hash}.wgsl`.
   - Add hash utility.
   - Add tests using synthetic shader binaries and a fake OPFS/storage adapter if real OPFS is unavailable in Vitest.

7. Add frame pacing and telemetry
   - Add frame timer using `performance.now()`.
   - Track dropped frames and frame-time budget.
   - Add developer overlay data model, not necessarily full UI unless requested.
   - Target 60 FPS = 16.67ms budget.

Phase 7 acceptance criteria:
- `npm test` passes.
- `npm run build` passes.
- Profiling data is produced for synthetic programs.
- Basic block splitting is tested.
- At least one simple ARM64 block compiles to WebAssembly and executes correctly.
- JIT failures fall back safely without corrupting CPU state.
- Shader WGSL cache has a tested synthetic storage path.
- Frame pacing telemetry is implemented and tested with mocked time.
- No claim of full commercial-game 30 FPS stability unless actually verified.

## Important notes for the next agent

- Always run `npm test` and `npm run build` after substantive changes.
- Keep tests synthetic. Do not bundle or depend on copyrighted Switch firmware, keys, NROs, NSPs, or XCIs.
- Preserve Phase 3 behavior:
  - instruction fetch goes through VMM execute checks
  - unknown instructions throw controlled `UnimplementedInstruction`
  - invalid memory accesses throw controlled `MemoryFault`
- Preserve Phase 4 behavior:
  - syscalls return structured result codes
  - invalid syscall pointers do not crash the process
  - unimplemented syscalls log warnings and return a defined stub result
- Preserve Phase 5 behavior:
  - GPU command parsing is synthetic and testable
  - do not pretend synthetic shader WGSL is real Maxwell decompilation
  - do not claim live WebGPU presentation until a real device path exists
- Roadmap source is `Agent.md`; if a doc conflicts with `Agent.md`, follow `Agent.md` and update the doc.

## Phase 8 prompt: Input and controller support

Phase 8 is initialized. Continue from the current synthetic HID/input foundation without claiming real Joy-Con or commercial-game input validation.

Current Phase 8 files:
- `src/core/input/types.ts`
- `src/core/input/mapper.ts`
- `src/core/input/browser-sources.ts`
- `src/core/input/hid-adapter.ts`
- `src/core/input/index.ts`
- `src/core/kernel/services/hid.ts`
- `src/core/kernel/horizon.ts`
- `docs/phase8-input-controller-support.md`
- `docs/phase8-checklist.md`

Continue in this order:
1. Harden synthetic HID CMIF-style request/response handling if the kernel IPC layer expands.
2. Add a small app-shell integration point that starts browser Gamepad/keyboard sources and writes HID state when CPU/shared memory is available.
3. Add a data-driven remapping model before building UI.
4. Defer WebHID Joy-Con work until a concrete motion-control requirement exists; when implemented, gate it behind user action and feature detection.
5. Keep tests synthetic and verify with `npm test` plus `npm run build`.
