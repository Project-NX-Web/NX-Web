use wasm_bindgen::prelude::*;

/// No-op test function to verify WASM compilation and loading works.
#[wasm_bindgen]
pub fn wasm_noop() -> u32 {
    42
}

/// Placeholder for hot-path CPU operations that will be implemented in WASM.
#[wasm_bindgen]
pub fn add(a: u32, b: u32) -> u32 {
    a + b
}
