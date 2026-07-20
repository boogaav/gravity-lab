import type { BodySpec, CollisionEvent, CollisionMode, Diagnostics } from '../physics/types';

export interface WorkerSimConfig {
  timeScale: number; // sim-seconds per real-second
  eta: number;
  softening: number;
  collisionMode: CollisionMode;
  /** Auto slow-motion near close encounters: caps sim-rate to K × recommendedDt per tick. */
  autoSlowMo: boolean;
  /** Real-seconds between recorded snapshots. */
  snapshotEverySec: number;
}

export type MainToWorker =
  | { type: 'init'; bodies: BodySpec[]; config: WorkerSimConfig }
  | { type: 'setRunning'; running: boolean }
  | { type: 'singleStep' } // exactly one physics substep
  | { type: 'setConfig'; config: Partial<WorkerSimConfig> }
  | { type: 'restore'; snapshot: { time: number; specs: BodySpec[]; stopped: boolean } }
  | { type: 'predict'; id: number; duration: number; samples: number; bodies?: BodySpec[] }
  | { type: 'requestFrame' };

export interface FramePayload {
  time: number;
  n: number;
  ids: string[];
  pos: Float64Array;
  vel: Float64Array;
  acc: Float64Array;
  masses: number[];
  radii: number[];
  diag: Diagnostics;
  effTimeScale: number;
  lastSubstep: number; // s, the adaptive dt currently in use
  lagging: boolean;
  stopped: boolean;
}

export type WorkerToMain =
  | { type: 'frame'; frame: FramePayload }
  | { type: 'bodies'; specs: BodySpec[] } // structure changed (merge) or after init/restore
  | { type: 'snapshot'; time: number; specs: BodySpec[]; stopped: boolean }
  | { type: 'collisions'; events: CollisionEvent[] }
  | { type: 'prediction'; id: number; times: number[]; ids: string[]; tracks: Float64Array };
