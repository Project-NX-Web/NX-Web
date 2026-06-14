// Horizon OS HLE kernel primitives used by the Phase 3 -> Phase 4 SVC bridge.
//
// This layer intentionally models only the syscall surface needed by synthetic
// homebrew-style tests. It returns structured Horizon-style result codes instead
// of corrupting guest CPU state when a syscall receives invalid handles or guest
// pointers.

import { ServiceManager } from './services/sm';
import { NvdrvService } from './services/nvdrv';
import { AudrenUService } from './services/audren-u';
import { HidService } from './services/hid';
import { MemoryFault, MemoryPermission, PAGE_SIZE } from '../memory/vmm';
import type { Cpu, SyscallHandler } from '../cpu/cpu';
import type { ServiceCommandHandler, ServiceRequest } from './services/types';

export const TLS_ADDRESS = 0x1f85c00n;
const MAX_SERVICE_BUFFER_SIZE = 1024 * 1024;
const MIN_TLS_MESSAGE_SIZE = 48;

export enum HorizonSVC {
  SetHeapSizeAlias0 = 0x00,
  SetHeapSize = 0x01,
  CreateEvent = 0x03,
  SignalEvent = 0x04,
  WaitSynchronization = 0x05,
  ExitProcess = 0x07,
  QueryMemory = 0x09,
  SleepThread = 0x0b,
  GetThreadPriority = 0x11,
  CloseHandle = 0x1b,
  SendSyncRequest = 0x27,
  OutputDebugString = 0x2d,
  GetProcessId = 0x50,
  GetThreadId = 0x51,
  MapMemory = 0x71,
  UnmapMemory = 0x72,
}

export enum HorizonResult {
  Success = 0x0,
  InvalidHandle = 0xe0000001,
  InvalidMemoryRange = 0xe0000002,
  InvalidAddress = 0xe0000003,
  InvalidSize = 0xe0000004,
  InvalidCombination = 0xe0000005,
  SyscallHandlerError = 0xe0000006,
  TimedOut = 0xea0107f6,
}

export type KernelObjectType = 'process' | 'thread' | 'event' | 'port' | 'session' | 'service' | 'memory' | 'audio-renderer' | 'hid-applet-resource' | 'unknown';

export interface KernelObject {
  id: number;
  type: KernelObjectType;
  name?: string;
  destroyed: boolean;
}

export interface ProcessState {
  id: number;
  heapStart: bigint;
  heapSize: bigint;
  tlsAddress: bigint;
  processHandle: number;
}

export interface ThreadState {
  id: number;
  priority: number;
  tlsAddress: bigint;
  contextHandle?: number;
  handle: number;
  waiting: boolean;
}

export interface KernelLogEntry {
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  svcNumber?: number;
  svcName?: string;
  result?: HorizonResult;
  handle?: number;
  fields?: Record<string, unknown>;
}

export class KernelEvent implements KernelObject {
  id = 0;
  type: KernelObjectType = 'event';
  name = '';
  destroyed = false;

  constructor(
    public readonly resetType: number = 0,
    public signaled = false,
  ) {}
}

export class ServiceRequestValidationError extends Error {
  constructor(message: string, public readonly result: HorizonResult) {
    super(message);
  }
}

export class HorizonKernel implements SyscallHandler {
  readonly process: ProcessState;
  readonly currentThread: ThreadState;
  readonly serviceManager = new ServiceManager();
  readonly handleTable = new HandleTable();
  readonly logs: KernelLogEntry[] = [];
  readonly nvdrv = new NvdrvService();
  readonly audren = new AudrenUService();
  readonly hid = new HidService();

  private readonly servicePortHandle: number;
  private readonly serviceHandles = new Map<string, number>();

  constructor(processId = 1, threadId = 1) {
    const processHandle = this.handleTable.allocate({
      id: processId,
      type: 'process',
      name: `process:${processId}`,
      destroyed: false,
    });
    const threadHandle = this.handleTable.allocate({
      id: threadId,
      type: 'thread',
      name: `thread:${threadId}`,
      destroyed: false,
    });
    this.servicePortHandle = this.handleTable.allocate({
      id: 0,
      type: 'port',
      name: 'sm:',
      destroyed: false,
    });
    this.registerService('nvdrv', (request, kernel, cpu) => this.nvdrv.handle(request, kernel, cpu));
    this.registerService('audren:u', (request, kernel, cpu) => this.audren.handle(request, kernel, cpu));
    this.registerService('hid', (request, kernel, cpu) => this.hid.handle(request, kernel, cpu));

    this.process = {
      id: processId,
      heapStart: 0x48000000n,
      heapSize: 0n,
      tlsAddress: TLS_ADDRESS,
      processHandle,
    };
    this.currentThread = {
      id: threadId,
      priority: 0,
      tlsAddress: TLS_ADDRESS,
      contextHandle: threadHandle,
      handle: threadHandle,
      waiting: false,
    };
  }

  handle(cpu: Cpu, svcNumber: number): void {
    switch (svcNumber) {
      case HorizonSVC.SetHeapSizeAlias0:
      case HorizonSVC.SetHeapSize:
        this.writeResult(cpu, this.svcSetHeapSize(cpu));
        this.log('debug', 'svcSetHeapSize', { svcNumber, result: HorizonResult.Success });
        break;
      case HorizonSVC.CreateEvent:
        this.writeResult(cpu, this.svcCreateEvent(cpu));
        this.log('debug', 'svcCreateEvent', { svcNumber });
        break;
      case HorizonSVC.SignalEvent:
        this.writeResult(cpu, this.svcSignalEvent(cpu));
        this.log('debug', 'svcSignalEvent', { svcNumber });
        break;
      case HorizonSVC.WaitSynchronization:
        this.writeResult(cpu, this.svcWaitSynchronization(cpu));
        this.log('debug', 'svcWaitSynchronization', { svcNumber });
        break;
      case HorizonSVC.ExitProcess:
        this.svcExitProcess(cpu);
        this.writeResult(cpu, HorizonResult.Success);
        this.log('info', 'svcExitProcess', { svcNumber, result: HorizonResult.Success });
        break;
      case HorizonSVC.QueryMemory:
        this.writeResult(cpu, this.svcQueryMemory(cpu));
        this.log('debug', 'svcQueryMemory', { svcNumber });
        break;
      case HorizonSVC.SleepThread:
        this.writeResult(cpu, this.svcSleepThread(cpu));
        this.log('debug', 'svcSleepThread', { svcNumber, result: HorizonResult.Success });
        break;
      case HorizonSVC.GetThreadPriority:
        this.writeResult(cpu, this.svcGetThreadPriority(cpu));
        this.log('debug', 'svcGetThreadPriority', { svcNumber });
        break;
      case HorizonSVC.CloseHandle:
        this.writeResult(cpu, this.svcCloseHandle(cpu));
        this.log('debug', 'svcCloseHandle', { svcNumber });
        break;
      case HorizonSVC.SendSyncRequest:
        this.writeResult(cpu, this.svcSendSyncRequest(cpu));
        this.log('debug', 'svcSendSyncRequest', { svcNumber });
        break;
      case HorizonSVC.OutputDebugString:
        this.writeResult(cpu, this.svcOutputDebugString(cpu));
        this.log('debug', 'svcOutputDebugString', { svcNumber });
        break;
      case HorizonSVC.GetProcessId:
        this.writeResult(cpu, this.svcGetProcessId(cpu));
        this.log('debug', 'svcGetProcessId', { svcNumber });
        break;
      case HorizonSVC.GetThreadId:
        this.writeResult(cpu, this.svcGetThreadId(cpu));
        this.log('debug', 'svcGetThreadId', { svcNumber });
        break;
      case HorizonSVC.MapMemory:
        this.writeResult(cpu, this.svcMapMemory(cpu));
        this.log('debug', 'svcMapMemory', { svcNumber });
        break;
      case HorizonSVC.UnmapMemory:
        this.writeResult(cpu, this.svcUnmapMemory(cpu));
        this.log('debug', 'svcUnmapMemory', { svcNumber });
        break;
      default:
        this.svcUnimplemented(cpu, svcNumber);
        break;
    }
  }

  getTlsPointer(cpu: Cpu): bigint {
    return cpu.state.tpidrEl0 !== 0n ? cpu.state.tpidrEl0 : this.currentThread.tlsAddress;
  }

  get servicePortHandleValue(): number {
    return this.servicePortHandle;
  }

  registerService(name: string, handler?: ServiceCommandHandler): HorizonResult {
    const serviceId = this.serviceManager.registerService(name, handler);
    const existingHandle = this.serviceHandles.get(name);
    if (existingHandle !== undefined && this.handleTable.isValid(existingHandle)) {
      return HorizonResult.Success;
    }

    const handle = this.handleTable.allocate({
      id: serviceId,
      type: 'service',
      name,
      destroyed: false,
    });
    this.serviceHandles.set(name, handle);
    return HorizonResult.Success;
  }

  getService(cpu: Cpu, name: string, outHandle: bigint): HorizonResult {
    const record = this.serviceManager.getServiceRecord(name);
    if (!record) {
      return HorizonResult.InvalidHandle;
    }

    let handle = this.serviceHandles.get(name);
    if (handle === undefined || !this.handleTable.isValid(handle)) {
      handle = this.handleTable.allocate({
        id: record.id,
        type: 'service',
        name,
        destroyed: false,
      });
      this.serviceHandles.set(name, handle);
    }

    if (!this.writeU64(cpu, outHandle, BigInt(handle))) {
      return HorizonResult.InvalidMemoryRange;
    }
    return HorizonResult.Success;
  }

  getServiceHandle(name: string): number | undefined {
    const handle = this.serviceHandles.get(name);
    return handle !== undefined && this.handleTable.isValid(handle) ? handle : undefined;
  }

  private svcSetHeapSize(cpu: Cpu): HorizonResult {
    const requested = cpu.state.getX(0);
    this.process.heapSize = requested;
    return HorizonResult.Success;
  }

  private svcExitProcess(cpu: Cpu): void {
    cpu.halt('syscall');
  }

  private svcSleepThread(cpu: Cpu): HorizonResult {
    this.currentThread.waiting = true;
    this.currentThread.waiting = false;
    return HorizonResult.Success;
  }

  private svcCloseHandle(cpu: Cpu): HorizonResult {
    const handle = this.handleArg(cpu);
    if (!this.handleTable.close(handle)) {
      return HorizonResult.InvalidHandle;
    }
    return HorizonResult.Success;
  }

  private svcSendSyncRequest(cpu: Cpu): HorizonResult {
    const handle = this.handleArg(cpu);
    const object = this.handleTable.get(handle);
    if (!object || object.destroyed) {
      return HorizonResult.InvalidHandle;
    }

    if (handle !== this.servicePortHandle && object.type !== 'service') {
      return HorizonResult.Success;
    }

    let request: ServiceRequest;
    try {
      request = this.readServiceRequest(cpu);
    } catch (error) {
      const result = error instanceof ServiceRequestValidationError ? error.result : HorizonResult.InvalidMemoryRange;
      this.log('warn', 'svcSendSyncRequest ignored invalid TLS request', {
        svcNumber: HorizonSVC.SendSyncRequest,
        handle,
        result,
        fields: { error: error instanceof Error ? error.message : String(error) },
      });
      return result;
    }

    if (handle === this.servicePortHandle) {
      return this.dispatchServicePort(cpu, request);
    }

    const record = this.serviceManager.getServiceRecord(object.name ?? 'unknown');
    const handler = record?.handler;
    if (!handler) {
      return HorizonResult.Success;
    }

    try {
      const result = handler(request, this, cpu);
      this.writeServiceResponse(cpu, request, result.response);
      return result.result === 0 ? HorizonResult.Success : (result.result as HorizonResult);
    } catch (error) {
      this.log('warn', 'svcSendSyncRequest service dispatch failed', {
        svcNumber: HorizonSVC.SendSyncRequest,
        handle,
        fields: { service: object.name ?? 'unknown', error: error instanceof Error ? error.message : String(error) },
      });
      return HorizonResult.SyscallHandlerError;
    }
  }

  private svcOutputDebugString(cpu: Cpu): HorizonResult {
    const address = cpu.state.getX(0);
    const size = Number(cpu.state.getX(1) & 0xffffffffn);
    if (size === 0) {
      return HorizonResult.Success;
    }
    if (address === 0n) {
      return HorizonResult.InvalidAddress;
    }

    try {
      const bytes = cpu.memory.readBytes(address, size);
      const text = new TextDecoder().decode(bytes);
      console.debug('[horizon:svcOutputDebugString]', text);
      return HorizonResult.Success;
    } catch (error) {
      this.log('warn', 'svcOutputDebugString ignored invalid guest string', {
        svcNumber: HorizonSVC.OutputDebugString,
        fields: { address: address.toString(16), error: error instanceof Error ? error.message : String(error) },
      });
      return HorizonResult.InvalidMemoryRange;
    }
  }

  private svcGetThreadPriority(cpu: Cpu): HorizonResult {
    const outPriority = cpu.state.getX(0);
    const handle = Number(cpu.state.getX(1) & 0xffffffffn);
    const thread = this.lookupThread(handle);
    if (!thread) {
      return HorizonResult.InvalidHandle;
    }
    if (!this.writeU64(cpu, outPriority, BigInt(thread.priority))) {
      return HorizonResult.InvalidMemoryRange;
    }
    return HorizonResult.Success;
  }

  private svcGetProcessId(cpu: Cpu): HorizonResult {
    const outProcessId = cpu.state.getX(0);
    const handle = Number(cpu.state.getX(1) & 0xffffffffn);
    if (!this.handleTable.isValid(handle) || this.handleTable.get(handle)?.type !== 'process') {
      return HorizonResult.InvalidHandle;
    }
    if (!this.writeU64(cpu, outProcessId, BigInt(this.process.id))) {
      return HorizonResult.InvalidMemoryRange;
    }
    return HorizonResult.Success;
  }

  private svcGetThreadId(cpu: Cpu): HorizonResult {
    const outThreadId = cpu.state.getX(0);
    const handle = Number(cpu.state.getX(1) & 0xffffffffn);
    const thread = this.lookupThread(handle);
    if (!thread) {
      return HorizonResult.InvalidHandle;
    }
    if (!this.writeU64(cpu, outThreadId, BigInt(thread.id))) {
      return HorizonResult.InvalidMemoryRange;
    }
    return HorizonResult.Success;
  }

  private svcCreateEvent(cpu: Cpu): HorizonResult {
    const outHandle = cpu.state.getX(0);
    const resetType = Number(cpu.state.getX(1) & 0xffffffffn);
    const namePointer = cpu.state.getX(2);
    const nameSize = Number(cpu.state.getX(3) & 0xffffffffn);
    const name = this.readOptionalDebugName(cpu, namePointer, nameSize);
    const event = new KernelEvent(resetType);
    event.name = name;
    const handle = this.handleTable.allocate(event);

    if (!this.writeU64(cpu, outHandle, BigInt(handle))) {
      this.handleTable.close(handle);
      return HorizonResult.InvalidMemoryRange;
    }
    return HorizonResult.Success;
  }

  private svcSignalEvent(cpu: Cpu): HorizonResult {
    const handle = this.handleArg(cpu);
    const event = this.handleTable.get(handle);
    if (!(event instanceof KernelEvent) || event.destroyed) {
      return HorizonResult.InvalidHandle;
    }
    event.signaled = true;
    return HorizonResult.Success;
  }

  private svcWaitSynchronization(cpu: Cpu): HorizonResult {
    const handlesPointer = cpu.state.getX(0);
    const handleCount = Number(cpu.state.getX(1) & 0xffffffffn);
    if (handleCount === 0) {
      return HorizonResult.InvalidCombination;
    }

    let handles: number[];
    try {
      const bytes = cpu.memory.readBytes(handlesPointer, handleCount * 4);
      handles = Array.from({ length: handleCount }, (_, index) => Number(new DataView(bytes.buffer, bytes.byteOffset).getUint32(index * 4, true)));
    } catch (error) {
      this.log('warn', 'svcWaitSynchronization ignored invalid handle table', {
        svcNumber: HorizonSVC.WaitSynchronization,
        fields: { error: error instanceof Error ? error.message : String(error) },
      });
      return HorizonResult.InvalidMemoryRange;
    }

    for (let index = 0; index < handles.length; index++) {
      const object = this.handleTable.get(handles[index]);
      if (!object || object.destroyed) {
        return HorizonResult.InvalidHandle;
      }
      if (object instanceof KernelEvent && object.signaled) {
        this.writeU32(cpu, handlesPointer, index);
        cpu.state.setX(1, BigInt(index));
        return HorizonResult.Success;
      }
    }

    return HorizonResult.TimedOut;
  }

  private svcMapMemory(cpu: Cpu): HorizonResult {
    const destination = cpu.state.getX(0);
    const source = cpu.state.getX(1);
    const size = Number(cpu.state.getX(2) & 0xffffffffn);
    if (size === 0) {
      return HorizonResult.InvalidSize;
    }
    if (destination === 0n || source === 0n) {
      return HorizonResult.InvalidAddress;
    }

    try {
      cpu.memory.mapMemory(destination, size, MemoryPermission.ReadWrite);
      return HorizonResult.Success;
    } catch (error) {
      this.log('warn', 'svcMapMemory failed', {
        svcNumber: HorizonSVC.MapMemory,
        fields: { destination: destination.toString(16), source: source.toString(16), error: error instanceof Error ? error.message : String(error) },
      });
      return HorizonResult.InvalidMemoryRange;
    }
  }

  private svcUnmapMemory(cpu: Cpu): HorizonResult {
    const destination = cpu.state.getX(0);
    const source = cpu.state.getX(1);
    const size = Number(cpu.state.getX(2) & 0xffffffffn);
    if (size === 0) {
      return HorizonResult.InvalidSize;
    }
    if (destination === 0n || source === 0n) {
      return HorizonResult.InvalidAddress;
    }

    cpu.memory.unmapMemory(destination, size);
    return HorizonResult.Success;
  }

  private svcQueryMemory(cpu: Cpu): HorizonResult {
    const outMemoryInfo = cpu.state.getX(0);
    const address = cpu.state.getX(1);
    const permission = cpu.memory.getPagePermissions(address) ?? MemoryPermission.None;
    const pageAddress = alignDown(address);
    const size = BigInt(PAGE_SIZE);

    if (!this.writeU64(cpu, outMemoryInfo, pageAddress) ||
        !this.writeU64(cpu, outMemoryInfo + 8n, size) ||
        !this.writeU32(cpu, outMemoryInfo + 16n, permission) ||
        !this.writeU32(cpu, outMemoryInfo + 20n, 0) ||
        !this.writeU64(cpu, outMemoryInfo + 24n, 0n)) {
      return HorizonResult.InvalidMemoryRange;
    }
    return HorizonResult.Success;
  }

  private svcUnimplemented(cpu: Cpu, svcNumber: number): void {
    this.log('warn', 'unimplemented SVC', {
      svcNumber,
      result: HorizonResult.Success,
    });
    console.warn(`[horizon:svc] unimplemented SVC 0x${svcNumber.toString(16)} (stubbed)`);
    cpu.state.setX(0, BigInt(HorizonResult.Success));
  }

  private readServiceRequest(cpu: Cpu): ServiceRequest {
    const tlsAddress = this.getTlsPointer(cpu);
    try {
      const messageSize = cpu.memory.read32(tlsAddress);
      const flags = cpu.memory.read32(tlsAddress + 4n);
      const commandId = Number(cpu.memory.read64(tlsAddress + 8n) & 0xffffffffn);
      const inputPointer = cpu.memory.read64(tlsAddress + 16n);
      const inputSize = cpu.memory.read32(tlsAddress + 24n) >>> 0;
      const outputPointer = cpu.memory.read64(tlsAddress + 32n);
      const outputSize = cpu.memory.read32(tlsAddress + 40n) >>> 0;

      if (messageSize < MIN_TLS_MESSAGE_SIZE) {
        throw new ServiceRequestValidationError('Synthetic service TLS message is too small', HorizonResult.InvalidCombination);
      }
      if (inputSize > MAX_SERVICE_BUFFER_SIZE || outputSize > MAX_SERVICE_BUFFER_SIZE) {
        throw new ServiceRequestValidationError('Synthetic service buffer size is unsupported', HorizonResult.InvalidCombination);
      }
      if ((inputPointer === 0n) !== (inputSize === 0)) {
        throw new ServiceRequestValidationError('Synthetic service input pointer/size combination is invalid', HorizonResult.InvalidCombination);
      }
      if ((outputPointer === 0n) !== (outputSize === 0)) {
        throw new ServiceRequestValidationError('Synthetic service output pointer/size combination is invalid', HorizonResult.InvalidCombination);
      }
      if (flags !== 0) {
        throw new ServiceRequestValidationError('Synthetic service request flags are unsupported', HorizonResult.InvalidCombination);
      }

      return { tlsAddress, commandId, inputPointer, inputSize, outputPointer, outputSize };
    } catch (error) {
      if (error instanceof ServiceRequestValidationError) {
        throw error;
      }
      if (error instanceof MemoryFault) {
        return { tlsAddress, commandId: 0, inputPointer: 0n, inputSize: 0, outputPointer: 0n, outputSize: 0 };
      }
      throw error;
    }
  }

  private dispatchServicePort(cpu: Cpu, request: ServiceRequest): HorizonResult {
    switch (request.commandId) {
      case 0: {
        const name = this.readServiceName(cpu, request.inputPointer, request.inputSize);
        if (name === '') {
          return HorizonResult.InvalidAddress;
        }
        return this.registerService(name);
      }
      case 1: {
        const name = this.readServiceName(cpu, request.inputPointer, request.inputSize);
        return this.getService(cpu, name, request.outputPointer);
      }
      default:
        return HorizonResult.Success;
    }
  }

  private readServiceName(cpu: Cpu, pointer: bigint, size: number): string {
    if (pointer === 0n || size === 0) {
      return '';
    }
    try {
      const bytes = cpu.memory.readBytes(pointer, size);
      const nullIndex = bytes.indexOf(0);
      return new TextDecoder().decode(nullIndex >= 0 ? bytes.subarray(0, nullIndex) : bytes);
    } catch {
      return '';
    }
  }

  private writeServiceResponse(cpu: Cpu, request: ServiceRequest, response?: Uint8Array): void {
    if (!response || response.byteLength === 0 || request.outputPointer === 0n) {
      return;
    }
    try {
      cpu.memory.writeBytes(request.outputPointer, response);
    } catch (error) {
      if (error instanceof MemoryFault) {
        this.log('warn', 'svcSendSyncRequest failed to write service response', {
          svcNumber: HorizonSVC.SendSyncRequest,
          fields: { error: error.message },
        });
        return;
      }
      throw error;
    }
  }

  private handleArg(cpu: Cpu): number {
    return Number(cpu.state.getX(0) & 0xffffffffn);
  }

  private lookupThread(handle: number): ThreadState | undefined {
    const object = this.handleTable.get(handle);
    if (object?.type !== 'thread') {
      return undefined;
    }
    if (handle === this.currentThread.handle) {
      return this.currentThread;
    }
    return undefined;
  }

  private readOptionalDebugName(cpu: Cpu, pointer: bigint, size: number): string {
    if (pointer === 0n || size === 0) {
      return '';
    }
    try {
      const bytes = cpu.memory.readBytes(pointer, size);
      const nullIndex = bytes.indexOf(0);
      return new TextDecoder().decode(nullIndex >= 0 ? bytes.subarray(0, nullIndex) : bytes);
    } catch {
      return '';
    }
  }

  private writeResult(cpu: Cpu, result: HorizonResult): void {
    cpu.state.setX(0, BigInt(result));
  }

  private writeU64(cpu: Cpu, address: bigint, value: bigint): boolean {
    try {
      cpu.memory.write64(address, BigInt.asUintN(64, value));
      return true;
    } catch (error) {
      if (error instanceof MemoryFault) {
        return false;
      }
      throw error;
    }
  }

  private writeU32(cpu: Cpu, address: bigint, value: number): boolean {
    try {
      cpu.memory.write32(address, value >>> 0);
      return true;
    } catch (error) {
      if (error instanceof MemoryFault) {
        return false;
      }
      throw error;
    }
  }

  private log(level: KernelLogEntry['level'], message: string, fields: Omit<KernelLogEntry, 'level' | 'message'> = {}): void {
    this.logs.push({ level, message, ...fields });
  }
}

export class HandleTable {
  private objects = new Map<number, KernelObject>();
  private nextHandle = 1;

  allocate(object: KernelObject): number {
    if (this.nextHandle > 0x7fffffff) {
      throw new Error('Handle table exhausted');
    }

    const handle = this.nextHandle++;
    this.objects.set(handle, object);
    return handle;
  }

  get(handle: number): KernelObject | undefined {
    const object = this.objects.get(handle);
    return object?.destroyed ? undefined : object;
  }

  isValid(handle: number): boolean {
    return this.objects.has(handle) && !this.objects.get(handle)!.destroyed;
  }

  close(handle: number): boolean {
    const object = this.objects.get(handle);
    if (!object || object.destroyed) {
      return false;
    }
    object.destroyed = true;
    this.objects.delete(handle);
    return true;
  }

  clear(): void {
    this.objects.clear();
    this.nextHandle = 1;
  }
}

function alignDown(value: bigint): bigint {
  return value & ~BigInt(PAGE_SIZE - 1);
}
