import { checkBrowserCapabilities } from './core/capabilities';

function addStatus(message: string, isError = false): void {
  const container = document.getElementById('status-container')!;
  const div = document.createElement('div');
  div.className = isError ? 'status error' : 'status';
  div.textContent = message;
  container.appendChild(div);
}

async function init(): Promise<void> {
  addStatus('Checking browser capabilities...');

  const caps = await checkBrowserCapabilities();

  if (caps.sharedArrayBuffer) {
    addStatus('✓ SharedArrayBuffer available');
  } else {
    addStatus('✗ SharedArrayBuffer not available — COEP/COOP headers missing', true);
  }

  if (caps.webgpu) {
    addStatus('✓ WebGPU available');
  } else {
    addStatus('⚠ WebGPU not available — GPU emulation will not work', true);
  }

  if (caps.opfs) {
    addStatus('✓ Origin Private File System available');
  } else {
    addStatus('✗ OPFS not available — saves will not persist', true);
  }

  if (caps.wasm) {
    addStatus('✓ WebAssembly available');
  } else {
    addStatus('✗ WebAssembly not available — cannot run', true);
  }

  if (caps.wasmTest) {
    addStatus('✓ WASM test module executed successfully');
  } else {
    addStatus('✗ WASM test module failed', true);
  }

  setupDropZone();
}

function setupDropZone(): void {
  const dropZone = document.getElementById('drop-zone')!;

  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('dragover');
  });

  dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('dragover');
  });

  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    const files = e.dataTransfer?.files;
    if (files && files.length > 0) {
      const file = files[0];
      const ext = file.name.split('.').pop()?.toLowerCase();
      if (ext === 'nsp' || ext === 'xci' || ext === 'nro') {
        addStatus(`ROM loaded: ${file.name} (${(file.size / 1024 / 1024).toFixed(1)} MB)`);
      } else {
        addStatus(`Unsupported file format: .${ext}`, true);
      }
    }
  });
}

init();
