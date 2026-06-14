import { describe, expect, it } from 'vitest';
import {
  MAXWELL_3D_ENGINE_CLASS,
  MaxwellParseError,
  isClassToken,
  makeNv2aClassToken,
  makeNv2aMethodHeader,
  parseMaxwellStream,
} from './maxwell';

describe('Maxwell/NV2A method parser', () => {
  it('parses a class token and NV2A method/value stream', () => {
    const stream = new Uint32Array([
      makeNv2aClassToken(MAXWELL_3D_ENGINE_CLASS),
      makeNv2aMethodHeader(0x0300, 2),
      0x00000001,
      0x00000002,
      makeNv2aMethodHeader(0x0900, 1),
      0x000000ff,
    ]);

    const parsed = parseMaxwellStream(stream, { expectedClassId: MAXWELL_3D_ENGINE_CLASS });

    expect(parsed.classId).toBe(MAXWELL_3D_ENGINE_CLASS);
    expect(parsed.methods).toEqual([
      { method: 0x0300, value: 0x00000001 },
      { method: 0x0300, value: 0x00000002 },
      { method: 0x0900, value: 0x000000ff },
    ]);
    expect(parsed.ignoredWords).toEqual([]);
  });

  it('rejects unexpected class tokens', () => {
    const stream = new Uint32Array([makeNv2aClassToken(0x1234)]);

    expect(() => parseMaxwellStream(stream, { expectedClassId: MAXWELL_3D_ENGINE_CLASS }))
      .toThrow(MaxwellParseError);
  });

  it('rejects truncated method payloads', () => {
    const stream = new Uint32Array([
      makeNv2aClassToken(MAXWELL_3D_ENGINE_CLASS),
      makeNv2aMethodHeader(0x0300, 2),
      0x00000001,
    ]);

    expect(() => parseMaxwellStream(stream)).toThrow(MaxwellParseError);
  });

  it('falls back to simple synthetic method/value pairs', () => {
    const stream = new Uint32Array([0x03000000, 0x00000001]);

    const parsed = parseMaxwellStream(stream);

    expect(parsed.methods).toEqual([{ method: 0x0300, value: 0x00000001 }]);
  });

  it('identifies NV2A class tokens', () => {
    expect(isClassToken(makeNv2aClassToken(MAXWELL_3D_ENGINE_CLASS))).toBe(true);
    expect(isClassToken(0x0000b197)).toBe(false);
  });
});
