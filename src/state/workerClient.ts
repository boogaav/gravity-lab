import type { FramePayload, MainToWorker, WorkerToMain } from '../worker/protocol';

/**
 * Thin client around the physics worker. The most recent frame is kept in a
 * mutable slot that the render loop reads directly at 60 fps without going
 * through React state; panels re-render at ~10 Hz off a version counter.
 */
export type WorkerListener = (msg: WorkerToMain) => void;

class WorkerClient {
  private worker: Worker;
  latest: FramePayload | null = null;
  private listeners = new Set<WorkerListener>();

  constructor() {
    this.worker = new Worker(new URL('../worker/physicsWorker.ts', import.meta.url), {
      type: 'module',
    });
    this.worker.onmessage = (ev: MessageEvent<WorkerToMain>) => {
      const msg = ev.data;
      if (msg.type === 'frame') this.latest = msg.frame;
      for (const l of this.listeners) l(msg);
    };
  }

  send(msg: MainToWorker): void {
    this.worker.postMessage(msg);
  }

  on(l: WorkerListener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
}

export const workerClient = new WorkerClient();
