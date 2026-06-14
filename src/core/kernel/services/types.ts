// Minimal structured IPC-style service dispatch types.
//
// These types are intentionally smaller than full Horizon CMIF. They let service
// implementations receive command ids and TLS-backed buffers without pretending
// to implement the real Switch IPC ABI yet.

import type { Cpu } from '../../cpu/cpu';
import type { HorizonKernel } from '../horizon';

export interface ServiceRequest {
  tlsAddress: bigint;
  commandId: number;
  inputPointer: bigint;
  inputSize: number;
  outputPointer: bigint;
  outputSize: number;
}

export interface ServiceCommandResult {
  result: number;
  response?: Uint8Array;
  submission?: unknown;
}

export type ServiceCommandHandler = (request: ServiceRequest, kernel: HorizonKernel, cpu: Cpu) => ServiceCommandResult;
