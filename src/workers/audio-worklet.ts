// Synthetic AudioWorkletProcessor scaffold for Phase 6.
//
// This file is intentionally small and non-blocking. It reads interleaved PCM16
// samples from a SharedArrayBuffer ring buffer when configured, otherwise it
// outputs silence.

interface AudioWorkletProcessorLike {
  readonly port: MessagePort;
  process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean;
}

type AudioWorkletProcessorConstructor = new (options?: AudioWorkletNodeOptions) => AudioWorkletProcessorLike;

declare const AudioWorkletProcessor: AudioWorkletProcessorConstructor;
declare const registerProcessor: (name: string, processorCtor: AudioWorkletProcessorConstructor) => void;

interface AudioWorkletRingBuffer {
  buffer: SharedArrayBuffer;
  channels: number;
  capacityFrames: number;
}

class SyntheticAudioWorkletProcessor extends AudioWorkletProcessor {
  private ringBuffer?: AudioWorkletRingBuffer;
  private readIndex = 0;

  constructor(options?: AudioWorkletNodeOptions) {
    super(options);
    this.port.postMessage({ type: 'ready' });
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][], _parameters: Record<string, Float32Array>): boolean {
    const output = outputs[0]?.[0];
    if (!output) {
      return true;
    }

    if (!this.ringBuffer) {
      output.fill(0);
      return true;
    }

    const storage = new Int16Array(this.ringBuffer.buffer);
    for (let index = 0; index < output.length; index++) {
      if (this.readIndex < storage.length) {
        output[index] = storage[this.readIndex++] / 0x8000;
      } else {
        output[index] = 0;
      }
    }

    return true;
  }

  configure(message: AudioWorkletRingBuffer): void {
    this.ringBuffer = message;
    this.readIndex = 0;
    this.port.postMessage({ type: 'configured', capacityFrames: message.capacityFrames });
  }
}

registerProcessor('synthetic-audio-worklet', SyntheticAudioWorkletProcessor);
