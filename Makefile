.PHONY: build dev test clean wasm

# Default target
all: build

# Build WASM from Rust sources (requires wasm-pack)
wasm:
	cd wasm-src && wasm-pack build --target web --out-dir ../src/wasm-pkg

# Development server with COEP/COOP headers
dev:
	npx vite

# Production build
build: wasm
	npx tsc && npx vite build

# Run tests
test:
	npx vitest run

# Watch mode tests
test-watch:
	npx vitest

# Clean build artifacts
clean:
	rm -rf dist
	rm -rf src/wasm-pkg
	rm -rf wasm-src/target
