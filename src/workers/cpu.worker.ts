export {};

const ctx: Worker = self as unknown as Worker;

interface CpuWorkerMessage {
  type: 'init' | 'run' | 'pause' | 'step';
  sharedMemory?: SharedArrayBuffer;
}

ctx.addEventListener('message', (e: MessageEvent<CpuWorkerMessage>) => {
  switch (e.data.type) {
    case 'init':
      ctx.postMessage({ type: 'ready' });
      break;
    case 'run':
      // STUB: not yet implemented — see Phase 3
      ctx.postMessage({ type: 'halted', reason: 'not-implemented' });
      break;
    case 'pause':
      break;
    case 'step':
      break;
  }
});

ctx.postMessage({ type: 'loaded' });
