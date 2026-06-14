// Phase 5 Maxwell/NV2A method-stream parsing.
//
// This is the first GPU-side parser. It does not emulate Maxwell execution yet;
// it converts synthetic NvGPU command streams into structured method/value
// records that later render-pipeline code can consume.

export const MAXWELL_3D_ENGINE_CLASS = 0xb197;
export const NV2A_CLASS_TOKEN_MASK = 0xffff0000;
export const NV2A_CLASS_TOKEN_BASE = 0x40000000;
export const NV2A_METHOD_HEADER_MASK = 0x80000000;
export const NV2A_METHOD_HEADER_COUNT_MASK = 0x3fff0000;
export const NV2A_METHOD_HEADER_METHOD_MASK = 0x0000ffff;

export interface MaxwellMethod {
  method: number;
  value: number;
}

export interface ParsedMaxwellStream {
  classId?: number;
  methods: MaxwellMethod[];
  ignoredWords: number[];
}

export interface ParseMaxwellStreamOptions {
  expectedClassId?: number;
}

export class MaxwellParseError extends Error {
  constructor(message: string) {
    super(message);
  }
}

export function parseMaxwellStream(words: Uint32Array, options: ParseMaxwellStreamOptions = {}): ParsedMaxwellStream {
  const result: ParsedMaxwellStream = {
    methods: [],
    ignoredWords: [],
  };
  let index = 0;

  while (index < words.length) {
    const word = words[index];

    if (isClassToken(word)) {
      const classId = word & 0xffff;
      if (options.expectedClassId !== undefined && classId !== options.expectedClassId) {
        throw new MaxwellParseError(`Unexpected Maxwell class 0x${classId.toString(16)}, expected 0x${options.expectedClassId.toString(16)}`);
      }
      result.classId = classId;
      index++;
      continue;
    }

    if ((word & NV2A_METHOD_HEADER_MASK) !== 0) {
      const method = word & NV2A_METHOD_HEADER_METHOD_MASK;
      const count = ((word & NV2A_METHOD_HEADER_COUNT_MASK) >>> 16) + 1;
      const values = words.subarray(index + 1, index + 1 + count);
      if (values.length !== count) {
        throw new MaxwellParseError(`Method 0x${method.toString(16)} requests ${count} values, but only ${values.length} remain`);
      }

      for (const value of values) {
        result.methods.push({ method, value });
      }
      index += 1 + count;
      continue;
    }

    // Fallback for simple synthetic method/value pairs: [method, value].
    if (index + 1 >= words.length) {
      result.ignoredWords.push(word);
      index++;
      continue;
    }

    result.methods.push({ method: word >>> 16, value: words[index + 1] });
    index += 2;
  }

  return result;
}

export function isClassToken(word: number): boolean {
  return (word & NV2A_CLASS_TOKEN_MASK) === NV2A_CLASS_TOKEN_BASE;
}

export function makeNv2aClassToken(classId = MAXWELL_3D_ENGINE_CLASS): number {
  return (NV2A_CLASS_TOKEN_BASE | classId) >>> 0;
}

export function makeNv2aMethodHeader(method: number, count: number): number {
  if (count <= 0 || count > 0x4000) {
    throw new MaxwellParseError(`NV2A method count must be in range 1..0x4000, got ${count}`);
  }
  if (method > 0xffff) {
    throw new MaxwellParseError(`NV2A method must fit in 16 bits, got 0x${method.toString(16)}`);
  }
  return (NV2A_METHOD_HEADER_MASK | ((count - 1) << 16) | method) >>> 0;
}
