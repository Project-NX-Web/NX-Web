export {};

const ctx: Worker = self as unknown as Worker;

interface AudioWorkerMessage {
  type: 'init' | 'start' | 'stop';
  sharedMemory?: SharedArrayBuffer;
  sampleRate?: number;
}

ctx.addEventListener('message', (e: MessageEvent<AudioWorkerMessage>) => {
  switch (e.data.type) {
    case 'init':
      // STUB: not yet implemented — see Phase 6
      ctx.postMessage({ type: 'ready' });
      break;
    case 'start':
      break;
    case 'stop':
      break;
  }
});

ctx.postMessage({ type: 'loaded' });
