// Synthetic audio worker scaffold for Phase 6.
//
// The worker accepts structured start/stop/update messages. It does not block on
// normal updates and falls back to postMessage buffers when SharedArrayBuffer is
// unavailable.

export interface AudioWorkerMessage {
  type: 'init' | 'start' | 'stop' | 'update' | 'configure';
  sampleRate?: number;
  channels?: number;
  frames?: number;
  sharedBuffer?: SharedArrayBuffer;
}

export interface AudioWorkerResponse {
  type: 'ready' | 'started' | 'stopped' | 'updated' | 'error';
  availableFrames?: number;
  sharedBufferAvailable: boolean;
  message?: string;
}

let sampleRate = 48000;
let channels = 2;
let frames = 256;
let running = false;
let sharedBufferAvailable = typeof SharedArrayBuffer !== 'undefined';

export function handleAudioWorkerMessage(message: AudioWorkerMessage): AudioWorkerResponse {
  switch (message.type) {
    case 'init':
      sampleRate = message.sampleRate ?? sampleRate;
      channels = message.channels ?? channels;
      sharedBufferAvailable = message.sharedBuffer !== undefined || typeof SharedArrayBuffer !== 'undefined';
      return { type: 'ready', sharedBufferAvailable };
    case 'start':
      running = true;
      return { type: 'started', sharedBufferAvailable };
    case 'stop':
      running = false;
      return { type: 'stopped', sharedBufferAvailable };
    case 'configure':
      sampleRate = message.sampleRate ?? sampleRate;
      channels = message.channels ?? channels;
      frames = message.frames ?? frames;
      return { type: 'ready', sharedBufferAvailable };
    case 'update':
      frames = message.frames ?? frames;
      return {
        type: running ? 'updated' : 'stopped',
        availableFrames: running ? frames : 0,
        sharedBufferAvailable,
      };
    default:
      return { type: 'error', sharedBufferAvailable, message: 'Unknown audio worker message' };
  }
}

if (typeof self !== 'undefined') {
  const ctx: Worker = self as unknown as Worker;
  ctx.addEventListener('message', (event: MessageEvent<AudioWorkerMessage>) => {
    try {
      ctx.postMessage(handleAudioWorkerMessage(event.data));
    } catch (error) {
      ctx.postMessage({
        type: 'error',
        sharedBufferAvailable,
        message: error instanceof Error ? error.message : String(error),
      } satisfies AudioWorkerResponse);
    }
  });

  ctx.postMessage({ type: 'ready', sharedBufferAvailable } satisfies AudioWorkerResponse);
}
