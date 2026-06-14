# Phase 4 Checklist: Horizon OS HLE Kernel

## Status

Phase 4 kernel/syscall work is structurally complete and verified:

- `npm test` passed: current full suite is 34 test files, 170 tests.
- `npm run build` passed TypeScript and Vite production build.
- No retail firmware, keys, NROs, NSPs, or XCIs were added or used.

## Phase 4 Goal

Build enough Horizon OS HLE kernel infrastructure that synthetic ARM64 homebrew can make syscalls and receive sane results without crashing.

## Completed Kernel Primitive Work

- [x] `HorizonKernel` implements `SyscallHandler`.
- [x] SVC dispatch returns structured Horizon-style result codes in X0.
- [x] Unimplemented SVCs log structured warnings and return a defined stub result.
- [x] Common SVC constants and result codes are centralized.
- [x] `HandleTable` allocates unique handles, tracks object type, closes safely, and rejects invalid handles.
- [x] `ProcessState` tracks heap start/size, TLS address, and process handle.
- [x] `ThreadState` tracks TLS address, current thread handle, priority, and wait state.
- [x] `KernelEvent` participates in handle-table lifecycle and supports signal/wait behavior.

## Completed Syscall Coverage

- [x] `svcSetHeapSize`
- [x] `svcExitProcess`
- [x] `svcSleepThread`
- [x] `svcCloseHandle`
- [x] `svcSendSyncRequest`
- [x] `svcOutputDebugString`
- [x] `svcGetThreadPriority`
- [x] `svcGetProcessId`
- [x] `svcGetThreadId`
- [x] `svcCreateEvent`
- [x] `svcSignalEvent`
- [x] `svcWaitSynchronization`
- [x] `svcMapMemory`
- [x] `svcUnmapMemory`
- [x] `svcQueryMemory`

## Completed Service-Manager Foundation

- [x] `ServiceManager` tracks registered services with stable service IDs.
- [x] `ServiceManager` supports duplicate registration lookup, service records, and listing.
- [x] `HorizonKernel` owns a synthetic `ServiceManager`.
- [x] Synthetic `registerService(name)` registers a service and returns a kernel handle-table handle.
- [x] Synthetic `getService(cpu, name, outHandle)` returns an existing service handle through the kernel handle table.
- [x] Unknown service lookup returns `HorizonResult.InvalidHandle`.
- [x] Synthetic CMIF-style TLS request validation is hardened for pointer/size combinations, buffer limits, and unsupported flags.
- [ ] Full CMIF IPC parsing remains intentionally deferred.

## Phase 4 Definition of Done

- [x] `npm test` passes.
- [x] `npm run build` passes.
- [x] HorizonKernel no longer treats SVC #0 as a dead end.
- [x] Common syscalls return structured results instead of crashing.
- [x] HandleTable has tests.
- [x] At least one ARM64 program makes SVC #0 and observes a kernel-provided result.
- [x] Invalid syscall memory pointers return structured errors and do not crash the process.
- [x] No unimplemented syscall silently corrupts CPU state.

## Next Phase

Phase 5 initializes GPU emulation and WebGPU rendering on top of the stable syscall/handle foundation. See `phase5-gpu-rendering.md`.
