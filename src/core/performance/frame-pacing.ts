// Frame pacing telemetry for Phase 7.

export interface FramePacingTelemetry {
  frameId: number;
  frameTimeMs: number;
  budgetMs: number;
  droppedFrames: number;
  averageFrameTimeMs: number;
  maxFrameTimeMs: number;
}

export interface FramePacerOptions {
  targetFps?: number;
  now?: () => number;
  historyLength?: number;
}

export class FramePacer {
  private readonly targetFps: number;
  private readonly now: () => number;
  private readonly historyLength: number;
  private readonly frameTimes: number[] = [];
  private frameId = 0;
  private droppedFrames = 0;
  private lastFrameEnd = 0;

  constructor(options: FramePacerOptions = {}) {
    this.targetFps = options.targetFps ?? 60;
    this.now = options.now ?? performance.now.bind(performance);
    this.historyLength = options.historyLength ?? 180;
  }

  get budgetMs(): number {
    return 1000 / this.targetFps;
  }

  beginFrame(): number {
    return this.now();
  }

  endFrame(startTime: number): FramePacingTelemetry {
    const frameTimeMs = Math.max(0, this.now() - startTime);
    if (frameTimeMs > this.budgetMs) {
      this.droppedFrames++;
    }

    this.frameTimes.push(frameTimeMs);
    if (this.frameTimes.length > this.historyLength) {
      this.frameTimes.shift();
    }

    this.frameId++;
    this.lastFrameEnd = startTime + frameTimeMs;
    return this.snapshot();
  }

  waitUntilNextFrame(startTime: number): number {
    const elapsed = this.now() - startTime;
    const remaining = this.budgetMs - elapsed;
    if (remaining <= 0) {
      return 0;
    }
    return remaining;
  }

  snapshot(): FramePacingTelemetry {
    const total = this.frameTimes.reduce((sum, value) => sum + value, 0);
    const averageFrameTimeMs = this.frameTimes.length === 0 ? 0 : total / this.frameTimes.length;
    const maxFrameTimeMs = this.frameTimes.length === 0 ? 0 : Math.max(...this.frameTimes);

    return {
      frameId: this.frameId,
      frameTimeMs: this.frameTimes.at(-1) ?? 0,
      budgetMs: this.budgetMs,
      droppedFrames: this.droppedFrames,
      averageFrameTimeMs,
      maxFrameTimeMs,
    };
  }

  reset(): void {
    this.frameId = 0;
    this.droppedFrames = 0;
    this.frameTimes.length = 0;
    this.lastFrameEnd = 0;
  }
}
