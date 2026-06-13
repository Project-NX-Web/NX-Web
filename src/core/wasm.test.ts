import { describe, it, expect } from 'vitest';

describe('WASM Module Loading', () => {
  it('loads and executes a minimal WASM module', async () => {
    // Minimal WASM module: (module (func (export "test") (result i32) (i32.const 42)))
    const bytes = new Uint8Array([
      0x00, 0x61, 0x73, 0x6d, // magic
      0x01, 0x00, 0x00, 0x00, // version
      0x01, 0x05, 0x01, 0x60, 0x00, 0x01, 0x7f, // type section
      0x03, 0x02, 0x01, 0x00, // function section
      0x07, 0x08, 0x01, 0x04, 0x74, 0x65, 0x73, 0x74, 0x00, 0x00, // export section
      0x0a, 0x06, 0x01, 0x04, 0x00, 0x41, 0x2a, 0x0b, // code section
    ]);

    const module = await WebAssembly.instantiate(bytes);
    const testFn = module.instance.exports.test as () => number;
    expect(testFn()).toBe(42);
  });

  it('supports SharedArrayBuffer', () => {
    const sab = new SharedArrayBuffer(1024);
    const view = new Int32Array(sab);
    Atomics.store(view, 0, 123);
    expect(Atomics.load(view, 0)).toBe(123);
  });
});
