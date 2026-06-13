export {};

const ctx: Worker = self as unknown as Worker;

interface GpuWorkerMessage {
  type: 'init' | 'submit-gpfifo' | 'present';
  sharedMemory?: SharedArrayBuffer;
}

ctx.addEventListener('message', (e: MessageEvent<GpuWorkerMessage>) => {
  switch (e.data.type) {
    case 'init':
      // STUB: not yet implemented — see Phase 5
      ctx.postMessage({ type: 'ready' });
      break;
    case 'submit-gpfifo':
      break;
    case 'present':
      break;
  }
});

ctx.postMessage({ type: 'loaded' });
