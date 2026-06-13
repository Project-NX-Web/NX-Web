export interface BrowserCapabilities {
  sharedArrayBuffer: boolean;
  webgpu: boolean;
  opfs: boolean;
  wasm: boolean;
  wasmTest: boolean;
}

export async function checkBrowserCapabilities(): Promise<BrowserCapabilities> {
  const sharedArrayBuffer = typeof SharedArrayBuffer !== 'undefined';
  const webgpu = 'gpu' in navigator;
  const opfs = 'storage' in navigator && typeof navigator.storage.getDirectory === 'function';
  const wasm = typeof WebAssembly !== 'undefined';

  let wasmTest = false;
  if (wasm) {
    try {
      // Minimal WASM module: exports a function that returns 42
      // (module (func (export "test") (result i32) (i32.const 42)))
      const bytes = new Uint8Array([
        0x00, 0x61, 0x73, 0x6d, // magic
        0x01, 0x00, 0x00, 0x00, // version
        0x01, 0x05, 0x01, 0x60, 0x00, 0x01, 0x7f, // type section: () -> i32
        0x03, 0x02, 0x01, 0x00, // function section: func 0 uses type 0
        0x07, 0x08, 0x01, 0x04, 0x74, 0x65, 0x73, 0x74, 0x00, 0x00, // export "test" = func 0
        0x0a, 0x06, 0x01, 0x04, 0x00, 0x41, 0x2a, 0x0b, // code: i32.const 42, end
      ]);
      const module = await WebAssembly.instantiate(bytes);
      const testFn = module.instance.exports.test as () => number;
      wasmTest = testFn() === 42;
    } catch {
      wasmTest = false;
    }
  }

  return { sharedArrayBuffer, webgpu, opfs, wasm, wasmTest };
}
