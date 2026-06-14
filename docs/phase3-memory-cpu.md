# Phase 3: Memory & CPU Subsystem

## Status

Phase 2 ROM/filesystem work is structurally complete and verified:

- `npm test -- --reporter=verbose` passed 12 files / 55 tests.
- `npm run build` passed TypeScript and Vite production build.
- Retail encrypted NCA end-to-end parsing remains intentionally deferred until non-retail fixtures or user-provided keys are available.

Phase 3 initialization is now active.

## Goal

Build a working ARM64 interpreter capable of booting simple homebrew, backed by a browser-safe software virtual memory manager.

## Existing Phase 3 Assets

- `src/core/memory/vmm.ts`
  - 256 MB physical RAM pool.
  - 4 KB page table.
  - `MemoryPermission` flags.
  - `MemoryFault` for unmapped or unauthorized access.
  - Read/write/execute permission enforcement.
  - Basic read/write helpers and mapping/unmapping tests.
- `src/core/cpu/state.ts`
  - ARM64 `CpuState`.
  - X0-X30, SP, PC, NZCV flags.
  - SIMD/FP register storage placeholders.
  - Condition-code evaluation.
- `src/core/cpu/decoder.ts`
  - Initial instruction grouping/field extraction scaffold.

## Phase 3 Plan

### 3a. VMM Contract

Tighten the existing VMM into the Phase 3 software-TLB contract from `Agent.md`:

- Enforce read/write/execute permissions on access.
- Add page-aligned mapping/unmapping semantics.
- Add explicit boot-region helpers:
  - `0x10000000`: main executable code.
  - `0x48000000`: heap.
  - `0x7100000000`: NRO/NSP main module.
  - `0xFF80000000`: stack, growing down.
- Keep all memory in browser-safe buffers; do not allocate guest-sized RAM directly.

### 3b. ARM64 Interpreter Scaffold

Create the interpreter structure before adding opcode coverage:

- `Cpu` or `Arm64Interpreter` facade using `CpuState` and VMM.
- Fetch-decode-execute loop skeleton.
- `InstructionHandler` interface and dispatch table indexed by top opcode bits.
- Initial `NOP`, `MOV/MOVZ/MOVN/MOVK`, `ADD/SUB`, `CMP/TST`, and branch stubs as needed for simple homebrew.
- `SVC #0` must be recognized and routed to a kernel callback placeholder for Phase 4.

### 3c. Test Strategy

Use synthetic instruction vectors and minimal homebrew-style buffers only. Do not use retail ROMs, `prod.keys`, or encrypted NCA content for Phase 3 verification.

Initial tests should cover:

- VMM permission faults for read, write, and execute.
- Page alignment and unmap behavior.
- ARM64 state register aliases, especially XZR/SP and W-registers.
- NOP advancement.
- ADD/SUB/CMP flag behavior with known vectors.
- Branch stubs for B/BL/RET/CBZ/CBNZ where implemented.
- SVC dispatch hook.

## Definition of Done

Phase 3 is not complete until:

- ARM64 interpreter passes basic synthetic test vectors.
- `SVC #0` is intercepted and dispatched to a Phase 4 hook.
- A minimal Hello World-style NRO/homebrew path reaches `main()` or an equivalent entrypoint.
- VMM correctly handles stack reads/writes and code execution from mapped regions.

## Next Immediate Work

1. Add VMM page-alignment tests, boot-region helpers, and cross-page read/write coverage.
2. Add ARM64 interpreter scaffold files under `src/core/cpu` around `CpuState` and `decoder.ts`.
3. Add synthetic ARM64 instruction tests before adding opcode implementations.
4. Keep verification limited to unit tests and build until homebrew integration fixtures are available.
