# Contributing to NX-Web

## Architecture

NX-Web is a browser-native Nintendo Switch emulator structured in layers:

```
UI (main thread) → Orchestrator Worker → CPU/GPU/Audio Workers → SharedArrayBuffer → HLE Services → OPFS Storage
```

### Directory Structure

```
src/
  core/
    cpu/          — ARM64 interpreter and JIT compiler
    gpu/          — WebGPU rendering backend and Maxwell shader compiler
    audio/        — Audio HLE and ADPCM/Opus decoding
    memory/       — Virtual memory manager (software TLB)
    kernel/       — Horizon OS HLE kernel
      services/   — One file per IPC service (sm, fsp-srv, hid, etc.)
  formats/        — ROM parsers (NSP, XCI, NRO)
  workers/        — Web Worker entry points
  ui/             — UI components
  storage/        — OPFS persistence layer
wasm-src/         — Rust source compiled to WASM for hot paths
```

### Worker Communication Protocol

Workers communicate via two mechanisms:

1. **SharedArrayBuffer**: High-frequency data (CPU registers, GPU command buffers, audio frames, HID input state). Accessed via `Atomics` for synchronization.

2. **postMessage**: Low-frequency control (init, start, pause, halt). Each message has a `type` field:
   - `init`: Worker should initialize with the provided SharedArrayBuffer
   - `run` / `pause` / `step`: Execution control
   - `ready`: Worker acknowledges initialization

### Adding a New HLE Service

1. Create `src/core/kernel/services/<name>.ts`
2. Implement the service interface:
   ```typescript
   export class MyService {
     handleRequest(cmdId: number, buffer: DataView): Uint8Array {
       switch (cmdId) {
         case 0: return this.methodZero(buffer);
         default:
           console.warn(`MyService: unimplemented cmd ${cmdId}`);
           return new Uint8Array(0); // Return success
       }
     }
   }
   ```
3. Register it in `src/core/kernel/services/sm.ts`
4. Add unit tests in `src/core/kernel/services/<name>.test.ts`

### Build & Development

```bash
# Start dev server (COEP/COOP headers included)
npm run dev        # or: make dev

# Run tests
npm test           # or: make test

# Build WASM (requires wasm-pack + Rust)
make wasm

# Production build
make build
```

### Requirements

- Node.js 20+
- Rust toolchain + wasm-pack (for WASM compilation)
- A browser with SharedArrayBuffer + WebGPU support (Chrome 120+)

### Testing

- Unit tests use Vitest
- Test files live next to their source: `foo.ts` → `foo.test.ts`
- Run `npm test` before submitting changes
- Phase 3 Memory/CPU changes must use synthetic instruction vectors, VMM permission tests, and minimal homebrew-style fixtures only. Do not add tests that require retail ROMs, `prod.keys`, or encrypted retail NCA content.
