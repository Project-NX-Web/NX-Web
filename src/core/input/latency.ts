// Input latency tracking for Phase 8.
//
// This tracks synthetic browser-to-HID latency without claiming commercial-game
// validation. Real Definition-of-Done latency still requires browser/hardware
// measurement against an actual game or homebrew.

export type InputLatencySource = 'gamepad' | 'keyboard' | 'joycon';

export interface InputLatencySample {
  source: InputLatencySource;
  receivedAtMs: number;
  writtenAtMs: number;
  latencyMs: number;
}

export class InputLatencyTracker {
  private readonly samples: InputLatencySample[] = [];
  private lastSample?: InputLatencySample;

  record(source: InputLatencySource, receivedAtMs: number, writtenAtMs = nowMs()): void {
    const sample: InputLatencySample = {
      source,
      receivedAtMs,
      writtenAtMs,
      latencyMs: Math.max(0, writtenAtMs - receivedAtMs),
    };
    this.lastSample = sample;
    this.samples.push(sample);

    const maxSamples = 240;
    if (this.samples.length > maxSamples) {
      this.samples.splice(0, this.samples.length - maxSamples);
    }
  }

  getLastSample(): InputLatencySample | undefined {
    return this.lastSample;
  }

  getAverageLatencyMs(): number | undefined {
    if (this.samples.length === 0) {
      return undefined;
    }
    const total = this.samples.reduce((sum, sample) => sum + sample.latencyMs, 0);
    return total / this.samples.length;
  }

  getLatencySamples(): InputLatencySample[] {
    return [...this.samples];
  }
}

function nowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}
