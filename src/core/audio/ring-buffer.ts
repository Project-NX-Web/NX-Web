// Interleaved PCM16 frame ring buffer with silence-on-underrun behavior.

export class PcmRingBuffer {
  private readonly storage: Int16Array;
  private readIndex = 0;
  private writeIndex = 0;
  private usedSamples = 0;

  constructor(public readonly capacityFrames: number, public readonly channels: number) {
    if (capacityFrames <= 0) {
      throw new Error('Ring buffer capacity must be positive');
    }
    if (channels <= 0) {
      throw new Error('Ring buffer channel count must be positive');
    }
    this.storage = new Int16Array(capacityFrames * channels);
  }

  get availableFrames(): number {
    return Math.floor(this.availableSamples / this.channels);
  }

  get freeFrames(): number {
    return this.capacityFrames - this.availableFrames;
  }

  get isFull(): boolean {
    return this.usedSamples === this.storage.length;
  }

  get isEmpty(): boolean {
    return this.usedSamples === 0;
  }

  write(frames: Int16Array): number {
    if (frames.length % this.channels !== 0) {
      throw new Error('Frame sample count must be a multiple of channel count');
    }

    let writtenSamples = 0;
    while (writtenSamples < frames.length && !this.isFull) {
      this.storage[this.writeIndex] = frames[writtenSamples];
      this.writeIndex = (this.writeIndex + 1) % this.storage.length;
      this.usedSamples++;
      writtenSamples++;
    }

    return Math.floor(writtenSamples / this.channels);
  }

  read(frames: Int16Array): number {
    if (frames.length % this.channels !== 0) {
      throw new Error('Frame sample count must be a multiple of channel count');
    }

    let readSamples = 0;
    while (readSamples < frames.length && !this.isEmpty) {
      frames[readSamples] = this.storage[this.readIndex];
      this.readIndex = (this.readIndex + 1) % this.storage.length;
      this.usedSamples--;
      readSamples++;
    }

    return Math.floor(readSamples / this.channels);
  }

  readOrSilence(frames: Int16Array): { framesRead: number; underrun: boolean } {
    const requestedFrames = Math.floor(frames.length / this.channels);
    const framesRead = this.read(frames);
    const underrun = framesRead < requestedFrames;

    if (underrun) {
      for (let sample = framesRead * this.channels; sample < frames.length; sample++) {
        frames[sample] = 0;
      }
    }

    return { framesRead, underrun };
  }

  clear(): void {
    this.storage.fill(0);
    this.readIndex = 0;
    this.writeIndex = 0;
    this.usedSamples = 0;
  }

  private get availableSamples(): number {
    return this.usedSamples;
  }
}
