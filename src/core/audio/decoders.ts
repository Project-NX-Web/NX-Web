// Synthetic audio decoders for Phase 6.
//
// PCM16 is a direct passthrough. ADPCM follows the Nintendo/GameCube-style
// block layout often used by DSP-ADPCM: 8-byte block headers followed by 14
// signed 4-bit deltas. This is deterministic and testable without retail audio.

import { AudioSampleFormat } from './audio-voice';

export interface OpusDecoderCapability {
  supported: boolean;
  reason?: string;
}

export interface OpusDecoderFactory {
  create(sampleRate: number, channels: number): unknown;
}

export interface AudioDecoderCapabilities {
  pcm16: true;
  adpcm: true;
  opus: OpusDecoderCapability;
}

export function detectAudioDecoderCapabilities(): AudioDecoderCapabilities {
  const audioDecoderCtor = globalThis.AudioDecoder;
  return {
    pcm16: true,
    adpcm: true,
    opus: audioDecoderCtor === undefined
      ? { supported: false, reason: 'WebCodecs AudioDecoder is unavailable' }
      : { supported: true },
  };
}

export function decodePcm16Interleaved(data: Uint8Array, channels: number): Int16Array {
  if (data.byteLength % 2 !== 0) {
    throw new Error('PCM16 byte length must be even');
  }
  if (channels <= 0) {
    throw new Error('Channel count must be positive');
  }
  if ((data.byteLength / 2) % channels !== 0) {
    throw new Error('PCM16 sample count must be a multiple of channel count');
  }

  const samples = new Int16Array(data.byteLength / 2);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  for (let index = 0; index < samples.length; index++) {
    samples[index] = view.getInt16(index * 2, true);
  }
  return samples;
}

export function decodeNintendoAdpcmBlock(block: Uint8Array): Int16Array {
  if (block.byteLength < 8) {
    throw new Error('ADPCM block must include an 8-byte header');
  }

  const view = new DataView(block.buffer, block.byteOffset, block.byteLength);
  let predictor = view.getInt16(0, true);
  const scale = view.getUint16(2, true);
  if (predictor < 0 || predictor > 7) {
    predictor = 0;
  }

  const history: [number, number] = [view.getInt16(4, true), view.getInt16(6, true)];
  const samples = new Int16Array(Math.max(0, block.byteLength - 8) * 2);
  let sampleIndex = 0;

  for (let byteIndex = 8; byteIndex < block.byteLength; byteIndex++) {
    const byte = block[byteIndex];
    for (const nibble of [byte & 0x0f, byte >> 4]) {
      const delta = nibble > 7 ? nibble - 16 : nibble;
      const sample = clampInt16((scale * delta * 8 + ADPCM_COEFFICIENTS[predictor][0] * history[0] + ADPCM_COEFFICIENTS[predictor][1] * history[1]) >> 8);
      samples[sampleIndex++] = sample;
      history[1] = history[0];
      history[0] = sample;
    }
  }

  return samples;
}

export function decodeNintendoAdpcm(data: Uint8Array, channels = 1): Int16Array {
  if (channels <= 0) {
    throw new Error('Channel count must be positive');
  }

  const samples: number[] = [];
  for (let offset = 0; offset < data.byteLength;) {
    const blockSize = Math.min(146, data.byteLength - offset);
    const block = data.subarray(offset, offset + blockSize);
    const decoded = decodeNintendoAdpcmBlock(block);
    samples.push(...decoded);
    offset += blockSize;
  }

  if (samples.length % channels !== 0) {
    throw new Error('ADPCM sample count must be a multiple of channel count');
  }
  return Int16Array.from(samples);
}

export function decodeAudioBuffer(data: Uint8Array, format: AudioSampleFormat, channels: number): Int16Array {
  switch (format) {
    case AudioSampleFormat.Pcm16:
      return decodePcm16Interleaved(data, channels);
    case AudioSampleFormat.Adpcm:
      return decodeNintendoAdpcm(data, channels);
    default:
      throw new Error(`Unsupported audio sample format ${format}`);
  }
}

const ADPCM_COEFFICIENTS = [
  [0, 0],
  [0x800, 0],
  [0x920, -0x120],
  [0x6c0, -0x200],
  [0x800, -0x280],
  [0x580, -0x180],
  [0x680, -0x240],
  [0x780, -0x2c0],
] as const;

function clampInt16(value: number): number {
  return Math.max(-0x8000, Math.min(0x7fff, value));
}
