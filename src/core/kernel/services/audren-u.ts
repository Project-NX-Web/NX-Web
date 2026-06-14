// Synthetic audren:u service HLE for Phase 6 audio scaffolding.

import type { Cpu } from '../../cpu/cpu';
import type { HorizonKernel } from '../horizon';
import type { ServiceRequest, ServiceCommandResult } from './types';
import { AudioRenderer, AudioRendererStatus } from '../../audio/audio-renderer';
import { AudioResult } from '../../audio/result-codes';

export enum AudrenUCommand {
  OpenAudioRenderer = 0,
  StartAudioRenderer = 1,
  StopAudioRenderer = 2,
  RequestUpdateAudioRenderer = 3,
}

export class AudrenUService {
  private readonly renderers = new Map<number, AudioRenderer>();
  private nextHandleId = 1;

  handle(request: ServiceRequest, kernel: HorizonKernel, cpu: Cpu): ServiceCommandResult {
    switch (request.commandId) {
      case AudrenUCommand.OpenAudioRenderer:
        return this.openAudioRenderer(request, kernel);
      case AudrenUCommand.StartAudioRenderer:
        return this.startAudioRenderer(request, cpu);
      case AudrenUCommand.StopAudioRenderer:
        return this.stopAudioRenderer(request, cpu);
      case AudrenUCommand.RequestUpdateAudioRenderer:
        return this.requestUpdate(request, cpu);
      default:
        return this.result(AudioResult.InvalidState);
    }
  }

  getRenderer(handle: number): AudioRenderer | undefined {
    return this.renderers.get(handle);
  }

  private openAudioRenderer(request: ServiceRequest, kernel: HorizonKernel): ServiceCommandResult {
    const handle = kernel.handleTable.allocate({
      id: this.nextHandleId++,
      type: 'audio-renderer',
      name: 'audren:u',
      destroyed: false,
    });
    this.renderers.set(handle, new AudioRenderer(handle));
    return this.result(AudioResult.Success, [
      ['u32', handle],
    ]);
  }

  private startAudioRenderer(request: ServiceRequest, cpu: Cpu): ServiceCommandResult {
    const renderer = this.lookup(request, cpu);
    if (!renderer) {
      return this.result(AudioResult.InvalidHandle);
    }
    return this.result(renderer.start());
  }

  private stopAudioRenderer(request: ServiceRequest, cpu: Cpu): ServiceCommandResult {
    const renderer = this.lookup(request, cpu);
    if (!renderer) {
      return this.result(AudioResult.InvalidHandle);
    }
    return this.result(renderer.stop());
  }

  private requestUpdate(request: ServiceRequest, cpu: Cpu): ServiceCommandResult {
    const renderer = this.lookup(request, cpu);
    if (!renderer) {
      return this.result(AudioResult.InvalidHandle);
    }

    const frames = request.inputSize >= 4 ? new DataView(requestInput(request, cpu).buffer).getUint32(0, true) : 256;
    const result = renderer.update(cpu.memory, Math.max(1, Math.min(frames, 8192)));
    return this.result(result, [
      ['u32', renderer.ringBuffer.availableFrames],
      ['u32', renderer.mixState.framesProduced],
      ['u32', renderer.mixState.underruns],
    ]);
  }

  private lookup(request: ServiceRequest, cpu: Cpu): AudioRenderer | undefined {
    const handle = request.inputSize >= 4 ? new DataView(requestInput(request, cpu).buffer).getUint32(0, true) : 0;
    return this.renderers.get(handle);
  }

  private result(code: AudioResult, fields: Array<['u32', number] | ['u64', bigint]> = []): ServiceCommandResult {
    const response = new Uint8Array(fields.length * 8);
    const view = new DataView(response.buffer);
    for (let index = 0; index < fields.length; index++) {
      const [type, value] = fields[index];
      if (type === 'u32') {
        view.setUint32(index * 8, value >>> 0, true);
      } else {
        view.setBigUint64(index * 8, BigInt.asUintN(64, value), true);
      }
    }
    return { result: code, response };
  }
}

function requestInput(request: ServiceRequest, cpu: Cpu): Uint8Array {
  if (request.inputPointer === 0n || request.inputSize === 0) {
    return new Uint8Array();
  }
  return cpu.memory.readBytes(request.inputPointer, request.inputSize);
}
