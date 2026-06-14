import { describe, expect, it } from 'vitest';
import { Cpu } from '../cpu/cpu';
import { MemoryPermission, PAGE_SIZE, VirtualMemoryManager } from '../memory/vmm';
import {
  HorizonKernel,
  HorizonResult,
  HorizonSVC,
  KernelEvent,
  HandleTable,
} from './horizon';

const CODE_BASE = 0x10000000n;
const HEAP_BASE = 0x48000000n;
const STACK_BASE = 0xff80000000n;

function cpuWithCode(kernel: HorizonKernel, instructions: number[]): Cpu {
  const vmm = new VirtualMemoryManager();
  vmm.mapMemory(CODE_BASE, instructions.length * 4, MemoryPermission.ReadWriteExecute);
  vmm.mapMemory(HEAP_BASE, PAGE_SIZE * 4, MemoryPermission.ReadWrite);
  vmm.mapMemory(STACK_BASE - BigInt(PAGE_SIZE), PAGE_SIZE, MemoryPermission.ReadWrite);
  vmm.mapMemory(0x1f85c00n, PAGE_SIZE, MemoryPermission.ReadWrite);
  vmm.writeBytes(0x1f85c00n, new Uint8Array(PAGE_SIZE));

  instructions.forEach((instruction, index) => vmm.write32(CODE_BASE + BigInt(index * 4), instruction));

  const cpu = new Cpu(vmm, kernel);
  cpu.state.pc = CODE_BASE;
  cpu.state.sp = STACK_BASE - 0x100n;
  return cpu;
}

function movz(reg: number, imm16: number, hw = 0, sf = 1): number {
  return (sf << 31) | 0x52800000 | (hw << 21) | (imm16 << 5) | reg;
}

function movk(reg: number, imm16: number, hw = 0, sf = 1): number {
  return (sf << 31) | 0x72800000 | (hw << 21) | (imm16 << 5) | reg;
}

function loadImmediate(reg: number, value: number, sf = 1): number[] {
  return [
    movz(reg, value & 0xffff, 0, sf),
    movk(reg, (value >>> 16) & 0xffff, 1, sf),
  ];
}

function svc(imm: number): number {
  return (0xd4000000 | ((imm & 0xffff) << 5)) >>> 0;
}

function str(rt: number, rn: number, imm = 0, sf = 1): number {
  return (sf ? 0xf9000000 : 0xb9000000) | (imm << 10) | (rn << 5) | rt;
}

describe('HandleTable', () => {
  it('allocates unique handles and preserves lookup until close', () => {
    const table = new HandleTable();
    const first = table.allocate({ id: 1, type: 'event', destroyed: false });
    const second = table.allocate({ id: 2, type: 'session', destroyed: false });

    expect(first).not.toBe(second);
    expect(table.get(first)?.type).toBe('event');
    expect(table.get(second)?.type).toBe('session');
    expect(table.isValid(first)).toBe(true);

    expect(table.close(first)).toBe(true);
    expect(table.get(first)).toBeUndefined();
    expect(table.isValid(first)).toBe(false);
    expect(table.get(second)?.type).toBe('session');
  });

  it('returns false for invalid and double close', () => {
    const table = new HandleTable();
    const handle = table.allocate({ id: 1, type: 'event', destroyed: false });

    expect(table.close(handle)).toBe(true);
    expect(table.close(handle)).toBe(false);
    expect(table.close(0xdeadbeef)).toBe(false);
  });

  it('clears all handles and resets allocation', () => {
    const table = new HandleTable();
    const handle = table.allocate({ id: 1, type: 'event', destroyed: false });
    table.clear();

    expect(table.get(handle)).toBeUndefined();
    expect(table.allocate({ id: 1, type: 'event', destroyed: false })).toBe(handle);
  });
});

describe('HorizonKernel syscalls', () => {
  it('dispatches SVC #0 through the kernel hook and returns a structured result', () => {
    const kernel = new HorizonKernel();
    const cpu = cpuWithCode(kernel, [movz(0, 0x2000), svc(HorizonSVC.SetHeapSizeAlias0)]);

    const result = cpu.run();

    expect(result.halted).toBe(true);
    expect(result.reason).toBe('syscall');
    expect(cpu.state.getX(0)).toBe(BigInt(HorizonResult.Success));
    expect(kernel.process.heapSize).toBe(0x2000n);
  });

  it('reads a guest debug string and returns success', () => {
    const kernel = new HorizonKernel();
    const cpu = cpuWithCode(kernel, [
      movz(0, 0, 0, 1),
      movk(0, 0x4800, 1, 1),
      movz(1, 0x0006),
      svc(HorizonSVC.OutputDebugString),
    ]);
    cpu.memory.writeBytes(HEAP_BASE, new TextEncoder().encode('hello\0'));

    const result = cpu.run();

    expect(result.reason).toBe('syscall');
    expect(cpu.state.getX(0)).toBe(BigInt(HorizonResult.Success));
    expect(kernel.logs.at(-1)).toMatchObject({ message: 'svcOutputDebugString' });
  });

  it('returns a structured error for invalid debug string pointers without crashing', () => {
    const kernel = new HorizonKernel();
    const cpu = cpuWithCode(kernel, [movz(1, 1), svc(HorizonSVC.OutputDebugString)]);

    const result = cpu.run();

    expect(result.reason).toBe('syscall');
    expect(cpu.state.getX(0)).toBe(BigInt(HorizonResult.InvalidAddress));
  });

  it('invalidates handles on close and rejects invalid close', () => {
    const kernel = new HorizonKernel();
    const eventHandle = kernel.handleTable.allocate(new KernelEvent());
    const validCpu = cpuWithCode(kernel, [movz(0, eventHandle), svc(HorizonSVC.CloseHandle)]);

    expect(validCpu.run().reason).toBe('syscall');
    expect(validCpu.state.getX(0)).toBe(BigInt(HorizonResult.Success));
    expect(kernel.handleTable.get(eventHandle)).toBeUndefined();

    const invalidCpu = cpuWithCode(kernel, [movz(0, eventHandle), svc(HorizonSVC.CloseHandle)]);

    expect(invalidCpu.run().reason).toBe('syscall');
    expect(invalidCpu.state.getX(0)).toBe(BigInt(HorizonResult.InvalidHandle));
  });

  it('returns success for valid sync requests and invalid handle for unknown handles', () => {
    const kernel = new HorizonKernel();
    const sessionHandle = kernel.handleTable.allocate({ id: 1, type: 'session', destroyed: false });
    const validCpu = cpuWithCode(kernel, [movz(0, sessionHandle), svc(HorizonSVC.SendSyncRequest)]);

    expect(validCpu.run().reason).toBe('syscall');
    expect(validCpu.state.getX(0)).toBe(BigInt(HorizonResult.Success));

    const invalidCpu = cpuWithCode(kernel, [
      ...loadImmediate(0, 0xdeadbeef),
      svc(HorizonSVC.SendSyncRequest),
    ]);

    expect(invalidCpu.run().reason).toBe('syscall');
    expect(invalidCpu.state.getX(0)).toBe(BigInt(HorizonResult.InvalidHandle));
  });

  it('registers services and returns stable kernel handles', () => {
    const kernel = new HorizonKernel();

    expect(kernel.registerService('hid')).toBe(HorizonResult.Success);
    expect(kernel.registerService('fsp-srv')).toBe(HorizonResult.Success);

    const hidHandle = kernel.getServiceHandle('hid');
    const fspHandle = kernel.getServiceHandle('fsp-srv');

    expect(hidHandle).toBeDefined();
    expect(fspHandle).toBeDefined();
    expect(hidHandle).not.toBe(fspHandle);
    expect(kernel.handleTable.get(hidHandle!)?.type).toBe('service');
    expect(kernel.handleTable.get(fspHandle!)?.type).toBe('service');
    expect(kernel.registerService('hid')).toBe(HorizonResult.Success);
    expect(kernel.getServiceHandle('hid')).toBe(hidHandle);
  });

  it('gets services through the kernel handle table', () => {
    const kernel = new HorizonKernel();
    expect(kernel.registerService('time')).toBe(HorizonResult.Success);
    const getServiceCpu = cpuWithCode(kernel, []);
    const serviceResult = kernel.getService(getServiceCpu, 'time', HEAP_BASE);

    expect(serviceResult).toBe(HorizonResult.Success);
    expect(kernel.handleTable.get(Number(getServiceCpu.memory.read64(HEAP_BASE) & 0xffffffffn))?.type).toBe('service');

    const unknownResult = kernel.getService(getServiceCpu, 'missing', HEAP_BASE);
    expect(unknownResult).toBe(HorizonResult.InvalidHandle);
  });

  it('sleeps the current thread and returns success', () => {
    const kernel = new HorizonKernel();
    const cpu = cpuWithCode(kernel, [svc(HorizonSVC.SleepThread)]);

    const result = cpu.run();

    expect(result.reason).toBe('syscall');
    expect(cpu.state.getX(0)).toBe(BigInt(HorizonResult.Success));
    expect(kernel.currentThread.waiting).toBe(false);
  });

  it('gets the current thread priority through a guest pointer', () => {
    const kernel = new HorizonKernel();
    kernel.currentThread.priority = 39;
    const cpu = cpuWithCode(kernel, [
      movz(0, 0, 0, 1),
      movk(0, 0x4800, 1, 1),
      movz(1, kernel.currentThread.handle),
      svc(HorizonSVC.GetThreadPriority),
    ]);

    const result = cpu.run();

    expect(result.reason).toBe('syscall');
    expect(cpu.state.getX(0)).toBe(BigInt(HorizonResult.Success));
    expect(cpu.memory.read64(HEAP_BASE)).toBe(39n);
  });

  it('exits the process and halts execution', () => {
    const kernel = new HorizonKernel();
    const cpu = cpuWithCode(kernel, [svc(HorizonSVC.ExitProcess)]);

    const result = cpu.run();

    expect(result.halted).toBe(true);
    expect(result.reason).toBe('syscall');
    expect(cpu.state.getX(0)).toBe(BigInt(HorizonResult.Success));
  });

  it('sets heap size and returns success', () => {
    const kernel = new HorizonKernel();
    const cpu = cpuWithCode(kernel, [movz(0, 0x4000), svc(HorizonSVC.SetHeapSize)]);

    const result = cpu.run();

    expect(result.reason).toBe('syscall');
    expect(cpu.state.getX(0)).toBe(BigInt(HorizonResult.Success));
    expect(kernel.process.heapSize).toBe(0x4000n);
  });

  it('stubs unimplemented syscalls without corrupting CPU state', () => {
    const kernel = new HorizonKernel();
    const cpu = cpuWithCode(kernel, [movz(7, 0x1234), svc(0x1234)]);

    const result = cpu.run();

    expect(result.reason).toBe('syscall');
    expect(cpu.state.getX(0)).toBe(BigInt(HorizonResult.Success));
    expect(cpu.state.getX(7)).toBe(0x1234n);
    expect(kernel.logs.at(-1)).toMatchObject({ level: 'warn', message: 'unimplemented SVC', svcNumber: 0x1234 });
  });

  it('creates events and writes the handle to guest memory', () => {
    const kernel = new HorizonKernel();
    const cpu = cpuWithCode(kernel, [
      movz(0, 0, 0, 1),
      movk(0, 0x4800, 1, 1),
      movz(1, 1),
      svc(HorizonSVC.CreateEvent),
    ]);

    const result = cpu.run();
    const eventHandle = Number(cpu.memory.read64(HEAP_BASE) & 0xffffffffn);

    expect(result.reason).toBe('syscall');
    expect(cpu.state.getX(0)).toBe(BigInt(HorizonResult.Success));
    expect(kernel.handleTable.get(eventHandle)).toBeInstanceOf(KernelEvent);
  });

  it('signals events', () => {
    const kernel = new HorizonKernel();
    const eventHandle = kernel.handleTable.allocate(new KernelEvent());
    const cpu = cpuWithCode(kernel, [movz(0, eventHandle), svc(HorizonSVC.SignalEvent)]);

    const result = cpu.run();

    expect(result.reason).toBe('syscall');
    expect(cpu.state.getX(0)).toBe(BigInt(HorizonResult.Success));
    expect((kernel.handleTable.get(eventHandle) as KernelEvent).signaled).toBe(true);
  });

  it('waits on already signaled events and returns the signaled index', () => {
    const kernel = new HorizonKernel();
    const eventHandle = kernel.handleTable.allocate(new KernelEvent(0, true));
    const cpu = cpuWithCode(kernel, [
      movz(0, 0, 0, 1),
      movk(0, 0x4800, 1, 1),
      movz(1, eventHandle),
      str(1, 0, 0, 1),
      movz(1, 1),
      movz(2, 0),
      svc(HorizonSVC.WaitSynchronization),
    ]);

    const result = cpu.run();

    expect(result.reason).toBe('syscall');
    expect(cpu.state.getX(0)).toBe(BigInt(HorizonResult.Success));
    expect(cpu.state.getX(1)).toBe(0n);
    expect(cpu.memory.read32(HEAP_BASE)).toBe(0);
  });

  it('returns process and thread identifiers through guest pointers', () => {
    const kernel = new HorizonKernel(0x42, 0x77);
    const processCpu = cpuWithCode(kernel, [
      movz(0, 0, 0, 1),
      movk(0, 0x4800, 1, 1),
      movz(1, kernel.process.processHandle),
      svc(HorizonSVC.GetProcessId),
    ]);
    const threadCpu = cpuWithCode(kernel, [
      movz(0, 0, 0, 1),
      movk(0, 0x4800, 1, 1),
      movz(1, kernel.currentThread.handle),
      svc(HorizonSVC.GetThreadId),
    ]);

    expect(processCpu.run().reason).toBe('syscall');
    expect(threadCpu.run().reason).toBe('syscall');

    expect(processCpu.memory.read64(HEAP_BASE)).toBe(0x42n);
    expect(threadCpu.memory.read64(HEAP_BASE)).toBe(0x77n);
    expect(processCpu.state.getX(0)).toBe(BigInt(HorizonResult.Success));
    expect(threadCpu.state.getX(0)).toBe(BigInt(HorizonResult.Success));
  });

  it('maps memory and returns success', () => {
    const kernel = new HorizonKernel();
    const cpu = cpuWithCode(kernel, [
      movz(0, 0x2000, 0, 1),
      movk(0, 0x4800, 1, 1),
      movz(1, 0x1000, 0, 1),
      movk(1, 0x4800, 1, 1),
      movz(2, 1),
      svc(HorizonSVC.MapMemory),
    ]);

    const result = cpu.run();

    expect(result.reason).toBe('syscall');
    expect(cpu.state.getX(0)).toBe(BigInt(HorizonResult.Success));
    expect(cpu.memory.isAddressMapped(HEAP_BASE + 0x2000n)).toBe(true);
  });

  it('queries memory into a guest structure', () => {
    const kernel = new HorizonKernel();
    const out = HEAP_BASE + 0x3000n;
    const address = HEAP_BASE + 0x2000n;
    const cpu = cpuWithCode(kernel, [
      movz(0, 0x3000, 0, 1),
      movk(0, 0x4800, 1, 1),
      movz(1, 0x2000, 0, 1),
      movk(1, 0x4800, 1, 1),
      svc(HorizonSVC.QueryMemory),
    ]);

    const result = cpu.run();

    expect(result.reason).toBe('syscall');
    expect(cpu.state.getX(0)).toBe(BigInt(HorizonResult.Success));
    expect(cpu.memory.read64(out)).toBe(address);
    expect(cpu.memory.read64(out + 8n)).toBe(BigInt(PAGE_SIZE));
    expect(cpu.memory.read32(out + 16n)).toBe(MemoryPermission.ReadWrite);
  });

  it('unmaps memory and rejects invalid query pointers', () => {
    const kernel = new HorizonKernel();
    const unmapCpu = cpuWithCode(kernel, [
      movz(0, 0x2000, 0, 1),
      movk(0, 0x4800, 1, 1),
      movz(1, 0x2000, 0, 1),
      movk(1, 0x4800, 1, 1),
      movz(2, 1),
      svc(HorizonSVC.UnmapMemory),
    ]);

    expect(unmapCpu.run().reason).toBe('syscall');
    expect(unmapCpu.state.getX(0)).toBe(BigInt(HorizonResult.Success));
    expect(unmapCpu.memory.isAddressMapped(HEAP_BASE + 0x2000n)).toBe(false);

    const invalidPointerCpu = cpuWithCode(kernel, [
      movz(0, 0),
      movz(1, 0x2000, 0, 1),
      movk(1, 0x4800, 1, 1),
      svc(HorizonSVC.QueryMemory),
    ]);

    expect(invalidPointerCpu.run().reason).toBe('syscall');
    expect(invalidPointerCpu.state.getX(0)).toBe(BigInt(HorizonResult.InvalidMemoryRange));
  });

  it('routes synthetic service-port GetService requests to registered services', () => {
    const kernel = new HorizonKernel();
    expect(kernel.registerService('nvdrv')).toBe(HorizonResult.Success);

    const servicePortCpu = cpuWithCode(kernel, [movz(0, kernel.servicePortHandleValue), svc(HorizonSVC.SendSyncRequest)]);
    const tls = 0x1f85c00n;
    const name = new TextEncoder().encode('nvdrv');
    servicePortCpu.memory.write32(tls, 48);
    servicePortCpu.memory.write32(tls + 4n, 0);
    servicePortCpu.memory.write64(tls + 8n, 0n);
    servicePortCpu.memory.write64(tls + 16n, tls + 0x100n);
    servicePortCpu.memory.write32(tls + 24n, name.byteLength);
    servicePortCpu.memory.writeBytes(tls + 0x100n, name);
    servicePortCpu.memory.writeBytes(tls + 32n, new Uint8Array(8));

    expect(servicePortCpu.run().reason).toBe('syscall');
    expect(servicePortCpu.state.getX(0)).toBe(BigInt(HorizonResult.Success));
    expect(kernel.getServiceHandle('nvdrv')).toBeDefined();
  });

  it('registers the synthetic HID service by default and dispatches HID commands', () => {
    const kernel = new HorizonKernel();
    expect(kernel.getServiceHandle('hid')).toBeDefined();

    const servicePortCpu = cpuWithCode(kernel, [movz(0, kernel.servicePortHandleValue), svc(HorizonSVC.SendSyncRequest)]);
    const tls = 0x1f85c00n;
    const name = new TextEncoder().encode('hid');
    servicePortCpu.memory.write32(tls, 48);
    servicePortCpu.memory.write32(tls + 4n, 0);
    servicePortCpu.memory.write64(tls + 8n, 1n);
    servicePortCpu.memory.write64(tls + 16n, tls + 0x100n);
    servicePortCpu.memory.write32(tls + 24n, name.byteLength);
    servicePortCpu.memory.writeBytes(tls + 0x100n, name);
    servicePortCpu.memory.write64(tls + 32n, tls + 0x200n);
    servicePortCpu.memory.write32(tls + 40n, 8);

    expect(servicePortCpu.run().reason).toBe('syscall');
    expect(servicePortCpu.state.getX(0)).toBe(BigInt(HorizonResult.Success));

    const hidHandle = Number(servicePortCpu.memory.read64(tls + 0x200n) & 0xffffffffn);
    expect(kernel.handleTable.get(hidHandle)?.type).toBe('service');
    expect(kernel.handleTable.get(hidHandle)?.name).toBe('hid');
  });

  it('returns structured errors for invalid synthetic service TLS requests', () => {
    const kernel = new HorizonKernel();
    const hidHandle = kernel.getServiceHandle('hid')!;
    const cpu = cpuWithCode(kernel, [...loadImmediate(0, hidHandle), svc(HorizonSVC.SendSyncRequest)]);
    const tls = 0x1f85c00n;

    cpu.memory.write32(tls, 48);
    cpu.memory.write32(tls + 4n, 0);
    cpu.memory.write64(tls + 8n, 100n);
    cpu.memory.write64(tls + 16n, 0n);
    cpu.memory.write32(tls + 24n, 1);
    cpu.memory.write64(tls + 32n, 0n);
    cpu.memory.write32(tls + 40n, 0);

    expect(cpu.run().reason).toBe('syscall');
    expect(cpu.state.getX(0)).toBe(BigInt(HorizonResult.InvalidCombination));
  });
});

function mov(rd: number, rn: number): number {
  return 0xaa0003e0 | ((rn & 0x1f) << 5) | (rd & 0x1f);
}
