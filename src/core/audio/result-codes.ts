// Synthetic NX-AUDIO result codes used by Phase 6 HLE scaffolding.

export enum AudioResult {
  Success = 0,
  InvalidHandle = 0xe0a00001,
  InvalidState = 0xe0a00002,
  InvalidSampleCount = 0xe0a00003,
  BufferUnderrun = 0x20a00004,
  UnsupportedCodec = 0xe0a00005,
}
