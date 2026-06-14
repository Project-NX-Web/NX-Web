# Phase 3 Checklist: Memory & CPU

## Phase 2 Exit

- [x] README marks Phase 2 structurally complete.
- [x] COMPATIBILITY records Phase 2 parser coverage and verification.
- [x] `npm test -- --reporter=verbose` passed.
- [x] `npm run build` passed.
- [x] Retail ROMs, `prod.keys`, and encrypted retail NCA content were not used.

## 3a. VMM / Software TLB

- [x] 256 MB browser-safe physical RAM pool exists.
- [x] 4 KB page table exists.
- [x] `MemoryFault` is thrown on unmapped access.
- [x] Read/write/execute permissions are enforced.
- [x] Page-aligned map/unmap semantics are documented in tests and code comments.
- [x] Boot-region helpers exist for:
  - [x] `0x10000000` main executable code
  - [x] `0x48000000` heap
  - [x] `0x7100000000` NRO/NSP main module
  - [x] `0xFF80000000` stack
- [x] Stack growth behavior is covered by tests.
- [x] Cross-page read/write behavior is covered by tests.

## 3b. ARM64 Interpreter

- [x] `Cpu` / `Arm64Interpreter` facade exists.
- [x] Fetch-decode-execute loop skeleton exists.
- [x] `InstructionHandler` interface exists.
- [x] Dispatch table is indexed by top opcode bits.
- [x] `CpuState` aliases are tested:
  - [x] XZR/read-zero behavior
  - [x] SP as X30 alias
  - [x] W-register zero-extension
- [x] NOP advances PC.
- [x] ADD/SUB immediate behavior is tested.
- [x] CMP/TST flag behavior is tested.
- [x] Branch stubs are tested:
  - [x] B
  - [x] BL
  - [x] RET
  - [x] CBZ
  - [x] CBNZ
- [x] `SVC #0` dispatch hook is tested.

## 3c. JIT / AOT Tier

- [x] Deferred until interpreter is stable.
- [x] Basic block cache design documented in Phase 7 files.
- [x] WASM bytecode emission plan documented and implemented in synthetic Phase 7 scaffold.
- [x] Self-modifying code invalidation plan documented as future work because current JIT scope is synthetic.

## Phase 3 Definition of Done

- [x] ARM64 interpreter passes synthetic basic test vectors.
- [x] `SVC #0` is intercepted and dispatched to a Phase 4 hook.
- [x] Minimal Hello World-style NRO/homebrew reaches `main()` or an equivalent entrypoint.
- [x] VMM handles stack reads/writes and code execution from mapped regions.
- [ ] `npm test -- --reporter=verbose` passes.
- [ ] `npm run build` passes.
