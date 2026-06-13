# AGENT MISSION: NX-Web — Browser-Native Nintendo Switch Emulator

## PREAMBLE: READ THIS ENTIRELY BEFORE WRITING A SINGLE LINE OF CODE

You are a world-class systems engineer tasked with building a Nintendo Switch emulator that runs entirely inside a modern web browser with zero installation. This is one of the most technically complex projects a software agent can attempt. Your success depends entirely on **disciplined, phased execution** — not on speed. Rushing any layer will cascade failures into every layer above it.

This prompt contains your complete specification, execution strategy, and verification criteria. You must follow the phase order exactly. Do not skip phases. Do not combine phases. When a phase fails its gate criteria, **stop and fix it** before proceeding.

---

## SECTION 0: IDENTITY & CONSTRAINTS

### What you are building
A web application, deployable to a static host (e.g., GitHub Pages, Cloudflare Pages), that:
- Loads in a modern browser (Chrome 120+ / Firefox 120+ / Edge 120+) with no extensions or plugins
- Accepts a Nintendo Switch ROM file (`.nsp`, `.xci`, `.nro`) via drag-and-drop
- Emulates the Nintendo Switch's hardware at sufficient fidelity to boot and play commercial games
- Persists saves, shader caches, and firmware data in the browser's Origin Private File System (OPFS)

### What you are NOT doing
- You are NOT building a cloud-streaming solution. Emulation runs locally in the browser.
- You are NOT wrapping an existing desktop emulator (Yuzu, Ryujinx) in Electron. This is a ground-up browser implementation.
- You are NOT building a server-side component. Everything is client-side.

### Constraints you must never violate
1. **No native binaries**: No `.exe`, no native Node server, no platform-specific installers.
2. **No hardcoded proprietary firmware**: The emulator must prompt the user to provide their own firmware dump. Never bundle copyrighted Nintendo data.
3. **SharedArrayBuffer requires headers**: Every deployment target must serve `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`. Bake this into your deployment config from day one.
4. **WASM memory is limited**: Browser WASM linear memory has practical limits. You must implement a virtual memory manager that pages Switch RAM in/out of a smaller WASM heap.

---

## SECTION 1: ARCHITECTURE OVERVIEW

Before writing any code, internalize this architecture. Every component you build lives in one of these layers:

```
┌─────────────────────────────────────────────────────┐
│                   USER INTERFACE                    │  ← HTML/CSS/JS (main thread)
│        ROM Drop Zone · Game Library · Settings      │
└───────────────────────┬─────────────────────────────┘
                        │ postMessage / SharedArrayBuffer
┌───────────────────────▼─────────────────────────────┐
│              ORCHESTRATOR WORKER                    │  ← Web Worker (coordinator)
│   Boots ROM · Dispatches to CPU/GPU/Audio workers   │
└──────┬──────────────────┬──────────────────┬────────┘
       │                  │                  │
┌──────▼──────┐  ┌────────▼──────┐  ┌───────▼────────┐
│  CPU WORKER │  │   GPU WORKER  │  │  AUDIO WORKER  │
│  ARM64→WASM │  │ WebGPU render │  │  Web Audio API │
│  JIT/AOT    │  │ Maxwell→WGSL  │  │  NX-AUDIO HLE  │
└──────┬──────┘  └────────┬──────┘  └───────┬────────┘
       │                  │                  │
┌──────▼──────────────────▼──────────────────▼────────┐
│              SHARED MEMORY LAYER                    │  ← SharedArrayBuffer
│    CPU Registers · GPU Cmd Buffer · Audio Frames    │
└──────────────────────────┬──────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────┐
│           HORIZON OS HLE SERVICES                   │
│  sm · fs · audio · nv (gpu) · hid · account · time  │
└──────────────────────────┬──────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────┐
│              STORAGE LAYER (OPFS)                   │
│  Firmware · SaveData · ShaderCache · UpdateData     │
└─────────────────────────────────────────────────────┘
```

You will build these layers bottom-up: storage → HLE services → CPU core → GPU → audio → orchestration → UI.

---

## SECTION 2: PHASED EXECUTION PLAN

Each phase has a **Definition of Done** (DoD). You may not proceed to the next phase until the current phase's DoD is fully met. State which phase you are in at the start of every response.

---

### PHASE 1: Project Scaffold & Toolchain

**Goal**: A reproducible, working build environment.

**Tasks**:
1. Initialize a project using **Vite** with TypeScript. Do not use Create React App or Next.js — the build pipeline needs fine-grained control over WASM loading and Web Worker bundling.
2. Configure Vite to:
   - Bundle WASM files with `?url` import syntax for manual instantiation (not auto-WASM)
   - Correctly emit Web Workers via `new Worker(new URL('./workers/cpu.worker.ts', import.meta.url), { type: 'module' })`
   - Output a `_headers` file (Netlify/CF Pages format) and a `vercel.json` with COEP/COOP headers
3. Install and configure `wasm-pack` (Rust → WASM toolchain) and emit a `Makefile` or `justfile` with `make build`, `make dev`, `make test` targets.
4. Create the full directory structure before writing any logic:
   ```
   src/
     core/
       cpu/          ← ARM64 interpreter + JIT
       gpu/          ← WebGPU backend + shader compiler
       audio/        ← Audio HLE
       memory/       ← Virtual memory manager
       kernel/       ← Horizon OS HLE
         services/   ← One file per IPC service
     formats/        ← ROM parsing (NSP, XCI, NRO)
     workers/        ← cpu.worker.ts, gpu.worker.ts, audio.worker.ts
     ui/             ← React or vanilla TS UI components
     storage/        ← OPFS wrappers
   wasm-src/         ← Rust source for WASM-compiled hot paths
   public/
   ```
5. Write a `CONTRIBUTING.md` that documents the architecture, worker communication protocol, and how to add a new HLE service.

**Definition of Done**:
- `make dev` starts a dev server with correct COEP/COOP headers
- `SharedArrayBuffer` is accessible in the browser console without errors
- WASM test module loads and executes a no-op function successfully
- All TypeScript compiles with zero errors at `strict: true`

---

### PHASE 2: ROM Parsing & Filesystem Layer

**Goal**: Read and validate Switch ROM formats; expose a virtual filesystem.

**Tasks**:

**2a. Format parsers** (implement in TypeScript):
- **NRO** (homebrew): Parse header, read ASET section for icon/title, extract code/rodata/data segments
- **NSP** (eShop package): Parse the PFS0 (Partition Filesystem) container, iterate NCA (Nintendo Content Archive) entries, decrypt using provided title keys
- **XCI** (cartridge image): Parse the XCI header, extract the secure partition, then process as NSP/NCA

**2b. NCA decryption**:
- Implement AES-128-CTR and AES-128-XTS decryption for NCA content
- Key derivation must use user-provided `prod.keys` (from Lockpick_RCM format). Parse this file and derive header/body decryption keys
- Never hardcode keys. Never ship keys. If keys are absent, show a clear "provide your keys" onboarding UI

**2c. Virtual Filesystem (VFS)**:
- Implement a `VirtualFileSystem` class that presents a unified view of:
  - `RomFS`: Read-only ROM content (files in the game's data partition)
  - `SaveData`: Read/write, persisted to OPFS under a per-title-ID namespace
  - `SdCard`: Optional, backed by a user-selected directory via the File System Access API
- Implement INode-style addressing: every file has a numeric handle. HLE services will use these handles, not raw paths.

**2d. OPFS persistence**:
- Wrap all OPFS calls in a `StorageManager` class with a typed API:
  ```typescript
  class StorageManager {
    async readFile(namespace: string, path: string): Promise<Uint8Array | null>
    async writeFile(namespace: string, path: string, data: Uint8Array): Promise<void>
    async listDir(namespace: string, path: string): Promise<string[]>
    async deleteFile(namespace: string, path: string): Promise<void>
  }
  ```
- Namespace keys: `firmware`, `saves/{titleId}`, `shader-cache/{titleId}`, `updates/{titleId}`

**Definition of Done**:
- Unit tests pass for NRO, NSP, and XCI parsing against known test ROMs
- AES decryption test vectors match known-good outputs
- VFS can mount a RomFS and enumerate files
- OPFS read/write round-trip works across page reloads

---

### PHASE 3: Memory & CPU Subsystem

**Goal**: A working ARM64 interpreter capable of booting simple homebrew.

This is the hardest phase. Allocate the most time here. Do not rush.

**Tasks**:

**3a. Virtual Memory Manager (VMM)**:
- The Switch uses a 64-bit virtual address space. Browsers cannot allocate 8GB of WASM linear memory. Solve this with a **software TLB**:
  - Allocate a fixed 256MB WASM ArrayBuffer as the physical "RAM pool"
  - Maintain a `Map<bigint, PhysicalPage>` as the page table (4KB pages)
  - Implement `mapMemory(virtualAddr, size, perms)` and `unmapMemory(virtualAddr, size)`
  - On access to an unmapped page, throw a structured `MemoryFault` that the CPU can handle as a page fault or IPC trigger
- Regions to map at boot:
  - `0x10000000`: Main executable code
  - `0x48000000`: Heap
  - `0x7100000000`: NRO/NSP main module
  - `0xFF8000000000`: Stack (grows down)

**3b. ARM64 Interpreter**:
- Implement the ARMv8-A instruction set interpreter in TypeScript/WASM:
  - 31 general-purpose 64-bit registers (X0–X30), SP, PC, NZCV flags
  - Instruction groups (implement in this order, as games need them in roughly this order):
    1. Data processing (immediate): `ADD`, `SUB`, `AND`, `ORR`, `EOR`, `MOV`, `CMP`, `TST`
    2. Loads/Stores: `LDR`, `STR`, `LDP`, `STP` (all addressing modes)
    3. Branches: `B`, `BL`, `BLR`, `RET`, `CBZ`, `CBNZ`, `B.cond`
    4. System: `SVC`, `MSR`, `MRS`, `NOP`, `BRK`
    5. Multiply/Divide: `MUL`, `SDIV`, `UDIV`, `MADD`
    6. SIMD/NEON: `FMOV`, `FADD`, `FMUL`, `FCMP` (basic floats), then vector ops
  - `SVC #0` must dispatch to the HLE kernel (Phase 4)
- Structure the fetch-decode-execute loop for future JIT replacement:
  ```typescript
  interface InstructionHandler {
    execute(cpu: Cpu, instruction: number): void
  }
  // Each opcode group is a class implementing InstructionHandler
  // The dispatch table is an array indexed by top 10 bits of opcode
  ```

**3c. JIT Compilation (AOT tier)**:
- After the interpreter is stable, implement an AOT compilation tier:
  - On first execution of a basic block, translate ARM64 → WASM bytecode using the WASM binary encoding spec
  - Cache compiled blocks in a `Map<number, WebAssembly.Instance>` keyed by PC
  - Compiled blocks call back into the interpreter for SVC and unimplemented instructions
  - Use a simple block invalidation scheme: any self-modifying code clears the cache for the affected address range
- The JIT is optional for Phase 3's DoD but required before Phase 7.

**Definition of Done**:
- ARM64 interpreter passes the `arm64-test-suite` basic test vectors
- `SVC #0` is correctly intercepted and dispatched
- A "Hello World" NRO homebrew boots and reaches `main()`
- VMM correctly handles stack reads/writes and code execution from mapped regions

---

### PHASE 4: Horizon OS HLE Kernel

**Goal**: Emulate enough of Nintendo's Horizon OS to satisfy what commercial games expect.

HLE (High Level Emulation) means: when the game makes a system call, you intercept it and service it with JavaScript/WASM rather than emulating the actual Horizon OS kernel. You are building a compatibility layer, not a kernel.

**Tasks**:

**4a. IPC Infrastructure**:
- Horizon uses an IPC (Inter-Process Communication) model where services are addressed by name strings
- Implement the `sm` (service manager) service first: it handles `sm:GetService(name)` and returns a session handle
- Service session handles are numeric IDs registered in a `HandleTable`
- IPC requests arrive via the `svcSendSyncRequest` system call with a `TLS` (Thread Local Storage) IPC buffer at `0x1F85C00`
- Parse the CMIF (Command Interface Format) request structure to dispatch to the right service method

**4b. Services to implement** (implement in this order — earlier = more critical):

| Service | Interface | Critical Methods |
|---|---|---|
| `sm` | Service Manager | `GetService`, `RegisterService` |
| `fsp-srv` | Filesystem | `OpenSdCardFileSystem`, `OpenFileSystem`, `OpenSaveDataFileSystem` |
| `fsp-pr` | FS Process | `SetFsPermissions` |
| `set` | Settings | `GetLanguageCode`, `GetRegionCode`, `GetFirmwareVersion` |
| `set:sys` | System Settings | `GetColorSetId` (UI theme), `GetSerialNumber` |
| `acc` | Accounts | `GetPreselectedUser`, `LoadProfile`, `GetUserCount` |
| `vi:m` | Display/VI | `CreateDisplay`, `OpenLayer`, `CreateManagedLayer` |
| `nvdrv` | GPU Driver | `Open`, `Ioctl`, `MapSharedMem` — this is the GPU entry point |
| `nvnflinger` | Display mgr | `CreateStrayLayer`, `ConnectLayer` |
| `audren:u` | Audio Renderer | `OpenAudioRenderer`, `StartAudioRenderer` |
| `hid` | Input | `CreateAppletResource`, `ActivateNpad`, `SetSupportedNpadStyleSet` |
| `time` | Time | `GetStandardUserSystemClock`, `GetCurrentTime` |
| `am` | AppletManager | `GetSelfController`, `GetWindowController` — stubs OK |
| `lm` | Logger | Log all output to browser console — games call this early |
| `fatal` | Fatal errors | Show game's fatal error message in UI |

**4c. System call table**:
Implement every SVC. Unimplemented SVCs must log a warning and return 0 (not crash). The critical ones:
- `svcSetHeapSize`, `svcSetMemoryPermission`, `svcMapMemory`, `svcUnmapMemory`
- `svcQueryMemory`, `svcExitProcess`, `svcCreateThread`, `svcStartThread`
- `svcExitThread`, `svcSleepThread`, `svcGetThreadPriority`
- `svcSendSyncRequest`, `svcGetProcessId`, `svcOutputDebugString`
- `svcCreateTransferMemory`, `svcCloseHandle`
- `svcWaitSynchronization`, `svcSignalEvent`, `svcCreateEvent`

**4d. Threading model**:
- The Switch CPU has 4 ARM Cortex-A57 cores. Map each to a separate Web Worker.
- Use `SharedArrayBuffer` for inter-worker communication of register state and event signals.
- Implement `Futex`-style blocking: a thread that calls `svcWaitSynchronization` on an unsignaled event sleeps via `Atomics.wait()`.

**Definition of Done**:
- `lm` (logger) output appears in the browser console
- A simple NRO homebrew that reads a file from RomFS can open, read, and close it
- Account service returns a valid user profile stub
- Settings service returns a language code without crashing

---

### PHASE 5: GPU Emulation & Rendering

**Goal**: Render frames using WebGPU.

The Switch GPU is an NVIDIA Maxwell architecture. Games program it via NvGPU IOCTL calls through the `nvdrv` service.

**Tasks**:

**5a. NvGPU command processor**:
- Games submit GPU work via `NVMAP_IOC_FROM_ID`, `NVGPU_AS_IOCTL_MAP_BUFFER_EX`, `NVGPU_GPU_IOCTL_SUBMIT_GPFIFO`
- Parse the GPFIFO (GPU FIFO) command stream: each entry is a 64-bit pointer + size
- The command stream contains NV2A-style method/value pairs (method offset into GPU register space, value)
- Implement the Fermi/Maxwell 3D engine class (`0xB197`) — this handles draw calls, state changes, render target binding

**5b. Shader compilation (GLSL → WGSL)**:
- Switch shaders are compiled to Maxwell shader ISA at game build time
- You must decompile Maxwell ISA → intermediate IR → WGSL for WebGPU
- Use the following pipeline:
  1. Parse Maxwell ISA binary: instructions are 64-bit, parse opcode/predicate/src/dst fields
  2. Lift to SSA IR: each Maxwell instruction maps to 1-N IR operations
  3. Lower IR to WGSL: map SSA values to WGSL `var` declarations
- Cache compiled WGSL in OPFS under `shader-cache/{titleId}/{shaderHash}` — this eliminates stuttering on subsequent play sessions
- Critical Maxwell instructions to support first: `MOV32I`, `FADD`, `FMUL`, `FFMA`, `ISETP`, `BRA`, `LD`/`ST` (global memory), `TEX` (texture sample)

**5c. WebGPU render pipeline**:
- For each draw call from the GPU command processor:
  1. Resolve the vertex/fragment shader pair from cache or compile
  2. Map Maxwell render state to a `GPURenderPipelineDescriptor`:
     - Blend state, depth/stencil, culling, primitive topology
  3. Map Maxwell vertex buffer bindings to `GPUVertexBufferLayout`
  4. Resolve texture handles to `GPUTexture` objects
  5. Submit a `GPURenderPassEncoder` draw call
- Framebuffer presentation: blit the final render target to a `<canvas>` using a full-screen quad shader

**5d. ASTC texture support**:
- Switch games heavily use ASTC compressed textures (4x4, 6x6, 8x8 block sizes)
- WebGPU on most platforms does not support ASTC natively in software fallback scenarios
- Implement a software ASTC decoder in WASM (Rust for performance): given an ASTC-compressed `Uint8Array`, output RGBA8 `Uint8Array`, then upload to WebGPU as an uncompressed texture
- On platforms where `device.features.has('texture-compression-astc')` is true, upload compressed directly

**5e. Texture cache**:
- Map GPU virtual addresses to `GPUTexture` objects in a `TextureCache` with LRU eviction
- On cache miss: decode from guest memory, create `GPUTexture`, upload, insert to cache
- Invalidate on write to the same guest memory range

**Definition of Done**:
- The GPU command processor parses a GPFIFO without crashing
- At least one shader compiles end-to-end from Maxwell ISA to valid WGSL
- A homebrew that draws a triangle renders correctly on screen
- The `<canvas>` displays frames (even if incorrect) from a commercial game boot attempt

---

### PHASE 6: Audio Subsystem

**Goal**: Produce game audio through the Web Audio API.

**Tasks**:

**6a. NX-AUDIO HLE**:
- Implement `audren:u` (Audio Renderer service):
  - `OpenAudioRenderer`: Initialize an audio renderer with the game's requested sample rate (48kHz standard), channel count, and buffer size
  - `StartAudioRenderer` / `StopAudioRenderer`: Start/stop the audio worker
  - `RequestUpdateAudioRenderer`: Process one audio frame — mix voices, apply effects, output to the final mix buffer
- Voice model: maintain a list of up to 24 hardware voices, each with: sample data pointer, loop points, pitch, volume, play state

**6b. Audio worker**:
- Run audio processing in a dedicated `AudioWorkletProcessor`
- The processor pulls mixed audio frames from a `SharedArrayBuffer` ring buffer
- CPU worker writes decoded, mixed PCM data to the ring buffer; the AudioWorklet reads it
- Ring buffer must handle producer/consumer timing mismatches gracefully (no glitches on underrun — output silence)

**6c. Audio decoding**:
- Support ADPCM (DSP-ADPCM / GameCube-style): implement the decoder per the Nintendo ADPCM spec
- Support PCM16 (raw signed 16-bit): trivial passthrough
- Support Opus: use the browser's native `OPUSDecoder` via `AudioDecoder` Web API if available, else fall back to `libopus` compiled to WASM

**Definition of Done**:
- Audio plays in any game without crashing the audio worker
- Ring buffer operates without underruns during normal gameplay
- ADPCM decodes correctly (verify against reference audio output)

---

### PHASE 7: JIT Compiler & Performance Optimization

**Goal**: Achieve native-speed CPU execution for 30/60 FPS gameplay.

**Tasks**:

**7a. AOT block compiler** (finalize from Phase 3c):
- Profile the interpreter: identify the 20 most-executed instruction patterns in your test games
- For each hot pattern, write a WASM bytecode template (using the binary encoding spec directly — no text format at runtime)
- The block compiler translates a linear sequence of ARM64 instructions until a branch, building a WASM function body
- Emit the WASM binary, call `WebAssembly.instantiate()`, and cache the result
- Measure the speedup. Target: 10x faster than pure interpreter.

**7b. Shader compilation cache**:
- On first shader encounter: compile Maxwell ISA → WGSL (may stutter for 50–200ms)
- Immediately persist the compiled WGSL to OPFS under `shader-cache/{titleId}/{xxhash(shaderBinary)}.wgsl`
- On subsequent launches: check OPFS cache before compiling; load instantly
- Display a "Building shader cache..." progress indicator in the UI during first-run compilation

**7c. Memory access optimization**:
- The software TLB is a hot path. Optimize common access patterns:
  - Inline the TLB fast-path check in compiled WASM blocks (avoid JS callback for hits)
  - Use `Atomics.load` / `Atomics.store` only where necessary; use direct typed array access for non-shared regions

**7d. Frame pacing**:
- Target 60 FPS = 16.67ms per frame. Implement a frame timer using `performance.now()`
- If a frame completes early, idle until the next frame deadline
- If a frame runs long, log a dropped frame counter visible in a developer overlay (Ctrl+D to toggle)
- Display frame time graph in the dev overlay: 16ms budget line, actual frame time bars

**Definition of Done**:
- JIT speedup is measurable and documented
- Shader cache eliminates recompilation on second launch
- At least one commercial game runs at a stable 30 FPS for 5+ minutes

---

### PHASE 8: Input & Controller Support

**Goal**: Complete input handling with sub-16ms latency.

**Tasks**:

**8a. HID service implementation**:
- `hid:ActivateNpad`: Register N-pad controllers (standard gamepad)
- `hid:SetSupportedNpadStyleSet`: Accept `FullKey` (Pro Controller), `JoyDual`, `JoyLeft`, `JoyRight`
- The `hid:AppletResource` shared memory region at a mapped address contains the raw input state
- Update this shared memory on every input event (do not poll — event-driven updates)
- N-pad state layout: buttons bitmask, left stick X/Y, right stick X/Y, as 32-bit little-endian values

**8b. Gamepad API integration**:
- Use `window.addEventListener('gamepadconnected')` and poll via `requestAnimationFrame` (not `setInterval` — RAF is synced to display)
- Map standard gamepad buttons to Switch buttons:
  ```
  Gamepad[0]  → B      Gamepad[1]  → A      Gamepad[2]  → Y      Gamepad[3]  → X
  Gamepad[4]  → L      Gamepad[5]  → R      Gamepad[6]  → ZL     Gamepad[7]  → ZR
  Gamepad[8]  → Minus  Gamepad[9]  → Plus   Gamepad[12-15] → DPad
  ```
- Show a button-mapping UI for remapping

**8c. WebHID Joy-Con support**:
- Detect Joy-Con via `navigator.hid.requestDevice({ filters: [{ vendorId: 0x057e }] })`
- Parse Joy-Con HID input reports (format: 0x21 standard report, 0x30 full report with IMU)
- Extract gyroscope (deg/s) and accelerometer (g) from IMU data in the 0x30 report
- Write gyro/accel data to the `SixAxisSensor` state in HID shared memory
- Implement HD Rumble: write `output report 0x10` with encoded rumble data to the Joy-Con HID device

**8d. Keyboard mapping**:
- Default keyboard mapping for when no gamepad is connected:
  ```
  Arrow keys → DPad    ZXCV → ABXY    QE → L/R    RF → ZL/ZR
  Enter → Plus         Backspace → Minus           Tab → Home
  WASD → Left stick    IJKL → Right stick
  ```

**Definition of Done**:
- Gamepad input reaches the HID service with <16ms latency (measure with `performance.now()` timestamps)
- Button presses register correctly in a game's pause menu
- Joy-Con motion controls update IMU state (verify with a motion-control homebrew)

---

### PHASE 9: Multiplayer & Network Services

**Goal**: Local and network multiplayer via WebRTC.

**Tasks**:

**9a. LDN (Local Delivery Network) emulation**:
- The Switch's local wireless multiplayer uses LDN — a proprietary L2 protocol
- Emulate LDN over WebRTC DataChannels:
  - Each emulator instance is a WebRTC peer
  - Use a lightweight signaling server (deployable as a Cloudflare Worker) for SDP/ICE exchange
  - Once connected, LDN packets are sent as ArrayBuffers over the DataChannel
- LDN service methods: `Scan` (discover nearby games), `OpenAccessPoint`, `OpenStation`, `Connect`, `Disconnect`

**9b. Signaling server**:
- Write a minimal signaling server as a Cloudflare Worker (or provide a WebSocket-based Node.js alternative)
- Protocol: JSON messages over WebSocket: `{ type: 'offer'|'answer'|'ice', roomId, payload }`
- Room IDs are derived from the game's title ID + a user-entered lobby code

**9c. NSD / NIFM services**:
- Implement stub `nsd` (Name Service Discovery) and `nifm` (Network Interface Manager) services
- `nifm:GetCurrentIpAddress` → return `192.168.1.x` (fake LAN IP)
- `nifm:IsNetworkAvailable` → return `true`

**Definition of Done**:
- Two browser tabs running the same game can see each other via the LDN scan
- A simple 2-player local wireless game (e.g., a party game) establishes a session

---

### PHASE 10: UI, UX & Final Polish

**Goal**: A complete, polished user-facing application.

**Tasks**:

**10a. Main UI**:
- Home screen: game library grid (populated from previously loaded ROMs, stored in OPFS)
- ROM loading: large drag-and-drop zone with file format validation before loading
- Settings panel:
  - Graphics: resolution scale (0.5x, 1x, 2x), V-sync toggle, frame limiter
  - System: firmware path, prod.keys path, language/region
  - Controls: button remapping UI, Joy-Con pairing
  - Storage: show OPFS usage per game, delete save data, export saves

**10b. In-emulation overlay**:
- FPS counter (top-right corner, toggleable)
- Developer overlay (Ctrl+D): frame time graph, GPU command queue depth, audio buffer level, JIT block cache size
- Pause menu: accessible via Escape or Home button — Resume, Screenshot, Save State, Load State, Exit

**10c. Save states**:
- Implement software save states: serialize the entire emulator state (CPU registers, memory pages, GPU state, audio state) to a binary blob
- Compress with `CompressionStream` (deflate) before storing in OPFS
- Limit to 3 save state slots per game

**10d. Onboarding flow**:
- First launch: guide the user through providing firmware files and `prod.keys`
- Validate the keys file format before accepting
- Show a compatibility notice and legal reminder (user must own the games they load)

**10e. Error handling**:
- Unimplemented HLE service method → log warning, return `ResultSuccess`, continue (never crash)
- GPU shader compile failure → show "shader error" overlay with the offending shader hash for bug reporting
- ROM parse failure → show human-readable error ("This file does not appear to be a valid NSP/XCI/NRO")
- Fatal game error (`fatal` service) → show the game's own error screen, then offer to return to home

**Definition of Done**:
- A non-technical user can load and play a game following only the UI (no console, no README)
- The developer overlay is functional and accurate
- Save states round-trip correctly (save, reload page, load state, continue playing)

---

## SECTION 3: QUALITY GATES (NEVER SKIP)

At every phase transition and before every commit, verify:

**Correctness**
- [ ] No `console.error` output during normal operation
- [ ] No unhandled promise rejections
- [ ] No TypeScript errors at `strict: true`

**Performance**
- [ ] Frame time ≤ 16.67ms for 60 FPS targets
- [ ] Input latency ≤ 16ms (measure timestamp from gamepad event to HID write)
- [ ] Memory usage stable over 10 minutes (no heap leak)

**Compatibility**
- [ ] Works in Chrome 120+, Firefox 120+, Edge 120+
- [ ] COEP/COOP headers verified in browser DevTools
- [ ] `SharedArrayBuffer` available without flags

**Persistence**
- [ ] Save data survives page reload
- [ ] Shader cache reduces stuttering on second launch
- [ ] Settings persist across sessions

---

## SECTION 4: TESTING STRATEGY

### Unit test targets (use Vitest)
- ROM parsers: test against known-good ROM headers
- ARM64 interpreter: each instruction group has golden-output tests
- AES decryption: NIST test vectors
- VMM: map/unmap/fault correctness
- IPC parser: CMIF request/response serialization
- Audio ADPCM decoder: reference output comparison

### Integration test targets
- NRO homebrew boot: "Hello World" reaches main() and calls `lm` service
- Filesystem: write then read a save file across a VFS mount cycle
- GPU: triangle homebrew renders correct RGB values to a known pixel

### Game compatibility test matrix
Document a spreadsheet of tested games with columns: Title, Boot (Y/N), Menu (Y/N), Gameplay (Y/N), FPS (avg), Notes. Track this in `COMPATIBILITY.md`. A boot rate of ≥80% of tested titles (minimum 50 tested) is the compatibility success criterion.

---

## SECTION 5: KNOWN HARD PROBLEMS — READ BEFORE HITTING THEM

These are the problems most likely to block you. Read this section before entering each relevant phase, not after getting stuck.

**The 64-bit Address Space Problem**  
WASM memory cannot directly represent 8GB of Switch RAM. Your software TLB (Phase 3a) is the solution. Never try to `new ArrayBuffer(8 * 1024 * 1024 * 1024)` — it will fail. Page physical memory on demand.

**Maxwell ISA Decompilation Completeness**  
You will encounter Maxwell instructions not in any public spec. Use the `nouveau` Linux driver's `envyas`/`nvdisasm` as your reference. When you find an unknown instruction, stub it as NOP and log its encoding — do not crash.

**The Shader Compilation Stutter Problem**  
First time a shader is compiled from Maxwell ISA → WGSL, it may take 100–400ms. This causes gameplay hitches. The OPFS shader cache (Phase 7b) is the solution, but you must also pipeline compilation: begin compiling on the GPU worker while the frame continues rendering (draw the previous frame's output until the new shader is ready).

**The CMIF IPC Buffer Layout**  
The IPC buffer layout is not well-documented. Use the `Atmosphere` HLE source code and `libnx` (the homebrew SDK) as ground truth. The domain/session distinction is where most IPC bugs originate.

**The nvnflinger / VI Layering System**  
Games do not write directly to a framebuffer. They use a producer/consumer buffer queue (Android BufferQueue ported to Switch). You must implement `nvnflinger` correctly: games push buffers, you consume and blit to `<canvas>`. Stub it incorrectly and games will boot but show a black screen forever.

**AudioRenderer Timing**  
The audio renderer runs on a fixed schedule (5ms or 10ms per update depending on requested renderer size). If your audio worker runs late, you get crackling. If you skip audio update calls because the game is slow, you get silence. The `RequestUpdateAudioRenderer` call from the game must be honored on its deadline or you must synthesize silence for the missed period.

---

## SECTION 6: REFERENCE MATERIALS

Use these as ground truth. Prefer them over any other source:

- **ARM Architecture Reference Manual (ARMv8-A)**: The ISA spec. Use for every instruction implementation.
- **Switch Brew** (https://switchbrew.org): Horizon OS IPC, NCA format, service documentation.
- **libnx** (https://github.com/switchbrew/libnx): Homebrew SDK. IPC call sites show exactly what arguments each service method expects.
- **Atmosphere** (https://github.com/Atmosphere-NX/Atmosphere): Open-source Switch firmware. HLE implementations here are ground truth.
- **Ryujinx** (https://github.com/Ryujinx/Ryujinx): .NET Switch emulator. Reference for service implementations — do not copy code, but use it to understand behavior.
- **WebGPU Spec** (https://gpuweb.github.io/gpuweb/): Your GPU API reference.
- **nouveau GPU docs**: Maxwell ISA reverse engineering. Use for shader decompilation.
- **WebAssembly Binary Encoding Spec** (https://webassembly.github.io/spec/core/binary/): Required for the JIT compiler.

---

## SECTION 7: DELIVERY FORMAT

At the end of each phase, deliver:

1. **Phase summary**: What was built, what decisions were made, what was deferred.
2. **All new source files**: Complete, compilable, with inline comments on non-obvious logic.
3. **Test results**: Which tests pass, which fail, and why (for known limitations).
4. **Blockers**: Any unresolved technical issues blocking the next phase.
5. **Updated COMPATIBILITY.md**: Which homebrew/commercial titles have been tested and to what degree.

Do not deliver partial functions. Do not deliver placeholder implementations without marking them `// STUB: not yet implemented — see issue #N`. Do not deliver code that does not compile.

---

## BEGIN

Start with **Phase 1**. State "PHASE 1 IN PROGRESS" before your first code block. Do not read ahead and start Phase 2 work during Phase 1. The scaffold must be complete and verified before any emulation logic is written.

When Phase 1's Definition of Done is met, explicitly state "PHASE 1 COMPLETE — DoD verified" and list each DoD item with a checkmark before proceeding.
