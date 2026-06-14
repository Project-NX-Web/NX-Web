import type { Cpu } from './core/cpu/cpu';
import { AppInputSession } from './core/input/app-input';
import { checkBrowserCapabilities } from './core/capabilities';
import {
  NpadButton,
  createInputRemapping,
  type InputRemapping,
} from './core/input';
import type { HorizonKernel } from './core/kernel/horizon';

let inputSession: AppInputSession | undefined;
let inputRemapping = loadInputRemapping();

function addStatus(message: string, isError = false): void {
  const container = document.getElementById('status-container')!;
  const div = document.createElement('div');
  div.className = isError ? 'status error' : 'status';
  div.textContent = message;
  container.appendChild(div);
}

export function attachInput(kernel: HorizonKernel, cpu?: Cpu): void {
  inputSession?.attach(kernel, cpu);
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

  setupInput();
  setupDropZone();
}

function setupInput(): void {
  inputSession = new AppInputSession({
    remapping: inputRemapping,
    onStatus: (message) => {
      addStatus(`Input: ${message}`);
      updateLatencyDisplay();
    },
  });
  inputSession.start();
  setupControlsPanel();
  window.addEventListener('beforeunload', () => inputSession?.stop());
}

function setupControlsPanel(): void {
  const app = document.getElementById('app')!;
  const panel = document.createElement('section');
  panel.id = 'controls-panel';

  const title = document.createElement('h2');
  title.textContent = 'Controls';
  panel.append(title);

  const latency = document.createElement('div');
  latency.id = 'input-latency';
  latency.className = 'status';
  latency.textContent = 'Input latency: waiting for input';
  panel.append(latency);

  const grid = document.createElement('div');
  grid.id = 'controls-grid';
  panel.append(grid);

  const pairButton = document.createElement('button');
  pairButton.type = 'button';
  pairButton.textContent = 'Pair Joy-Con with WebHID';
  pairButton.addEventListener('click', async () => {
    try {
      const count = await inputSession?.pairJoyCon();
      addStatus(`WebHID Joy-Con paired: ${count ?? 0}`);
    } catch (error) {
      addStatus(`WebHID Joy-Con pairing failed: ${error instanceof Error ? error.message : String(error)}`, true);
    }
  });
  panel.append(pairButton);

  app.append(panel);
  renderControlsPanel();
}

function renderControlsPanel(): void {
  const grid = document.getElementById('controls-grid');
  if (!grid) {
    return;
  }
  grid.replaceChildren();

  for (const [button, label] of CONTROL_BUTTONS) {
    const row = document.createElement('div');
    row.className = 'control-row';

    const name = document.createElement('span');
    name.textContent = label;

    const keyboard = document.createElement('button');
    keyboard.type = 'button';
    keyboard.textContent = `Keyboard: ${inputRemapping.keyboardButtons[button]?.join(' + ') ?? 'none'}`;
    keyboard.addEventListener('click', () => captureKeyboardButton(button));

    const gamepad = document.createElement('select');
    for (let index = 0; index < 16; index++) {
      const option = document.createElement('option');
      option.value = String(index);
      option.textContent = `Gamepad ${index}`;
      option.selected = inputRemapping.gamepadButtons[button] === index;
      gamepad.append(option);
    }
    gamepad.addEventListener('change', () => {
      inputRemapping.gamepadButtons[button] = Number(gamepad.value);
      persistInputRemapping();
      applyInputRemapping();
    });

    row.append(name, keyboard, gamepad);
    grid.append(row);
  }

  updateLatencyDisplay();
}

function captureKeyboardButton(button: NpadButton): void {
  addStatus('Press a keyboard key for the selected control');
  const handler = (event: KeyboardEvent): void => {
    event.preventDefault();
    inputRemapping.keyboardButtons[button] = [event.code];
    persistInputRemapping();
    applyInputRemapping();
    window.removeEventListener('keydown', handler, true);
    renderControlsPanel();
  };
  window.addEventListener('keydown', handler, true);
}

function applyInputRemapping(): void {
  inputSession?.setRemapping(inputRemapping);
  renderControlsPanel();
}

function updateLatencyDisplay(): void {
  const latency = document.getElementById('input-latency');
  if (!latency || !inputSession) {
    return;
  }
  const last = inputSession.getLastInputLatency();
  const average = inputSession.getAverageInputLatencyMs();
  latency.textContent = last
    ? `Input latency: ${last.latencyMs.toFixed(2)} ms (${last.source}); average ${average?.toFixed(2) ?? 'n/a'} ms`
    : 'Input latency: waiting for input';
}

function loadInputRemapping(): InputRemapping {
  try {
    const raw = localStorage.getItem('nx-web-input-remapping');
    if (!raw) {
      return createInputRemapping();
    }
    const parsed = JSON.parse(raw) as Partial<InputRemapping>;
    return createInputRemapping(parsed);
  } catch {
    return createInputRemapping();
  }
}

function persistInputRemapping(): void {
  try {
    localStorage.setItem('nx-web-input-remapping', JSON.stringify(inputRemapping));
  } catch {
    addStatus('Could not persist input remapping', true);
  }
}

const CONTROL_BUTTONS: Array<[NpadButton, string]> = [
  [NpadButton.A, 'A'],
  [NpadButton.B, 'B'],
  [NpadButton.X, 'X'],
  [NpadButton.Y, 'Y'],
  [NpadButton.L, 'L'],
  [NpadButton.R, 'R'],
  [NpadButton.ZL, 'ZL'],
  [NpadButton.ZR, 'ZR'],
  [NpadButton.Minus, 'Minus'],
  [NpadButton.Plus, 'Plus'],
  [NpadButton.Home, 'Home'],
  [NpadButton.DPadUp, 'D-pad Up'],
  [NpadButton.DPadDown, 'D-pad Down'],
  [NpadButton.DPadLeft, 'D-pad Left'],
  [NpadButton.DPadRight, 'D-pad Right'],
];

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
