import { describe, expect, it } from 'vitest';
import { AudioSampleFormat } from './audio-voice';
import { decodeAudioBuffer, decodeNintendoAdpcmBlock, decodePcm16Interleaved, detectAudioDecoderCapabilities } from './decoders';

describe('audio decoders', () => {
  it('decodes interleaved PCM16 samples', () => {
    const bytes = new Uint8Array([
      0x34, 0x12,
      0xdc, 0xed,
      0x00, 0x80,
      0x00, 0x7f,
    ]);

    expect(decodePcm16Interleaved(bytes, 2)).toEqual(Int16Array.from([0x1234, -0x1224, -0x8000, 0x7f00]));
  });

  it('decodes a synthetic Nintendo ADPCM block', () => {
    const block = new Uint8Array(22);
    const view = new DataView(block.buffer);
    view.setInt16(0, 0, true);
    view.setUint16(2, 0x100, true);
    view.setInt16(4, 0, true);
    view.setInt16(6, 0, true);
    block.set([0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc, 0xde, 0xf0, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66], 8);

    const samples = decodeNintendoAdpcmBlock(block);
    expect(samples.length).toBe(28);
    expect(samples[0]).toBe(16);
    expect(samples[1]).toBe(8);
  });

  it('decodes ADPCM through the format dispatcher', () => {
    const block = new Uint8Array(10);
    const view = new DataView(block.buffer);
    view.setInt16(0, 0, true);
    view.setUint16(2, 0x80, true);
    block.set([0x10, 0x20], 8);

    expect([...decodeAudioBuffer(block, AudioSampleFormat.Adpcm, 1)]).toEqual([0, 4, 0, 8]);
  });

  it('reports PCM16 and ADPCM capability', () => {
    const capabilities = detectAudioDecoderCapabilities();
    expect(capabilities.pcm16).toBe(true);
    expect(capabilities.adpcm).toBe(true);
    expect(capabilities.opus).toBeDefined();
  });
});
