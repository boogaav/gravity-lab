/**
 * Physics worker: all numerical integration happens here, fully separated from
 * rendering. The main thread only ever receives copies of the state.
 */
import { Engine } from '../physics/engine';
import type { BodySpec } from '../physics/types';
import type { FramePayload, MainToWorker, WorkerSimConfig, WorkerToMain } from './protocol';

const post = (msg: WorkerToMain, transfer?: Transferable[]) =>
  (self as unknown as Worker).postMessage(msg, transfer ?? []);

let engine: Engine | null = null;
let cfg: WorkerSimConfig = {
  timeScale: 1e5,
  eta: 0.03,
  softening: 0,
  collisionMode: 'stop',
  autoSlowMo: true,
  snapshotEverySec: 0.25,
};
let running = false;
let lastSnapshotWall = 0;
const TICK_MS = 16;
/** Auto slow-mo: at most this many recommended substeps of sim-time per real second. */
const SLOWMO_STEPS_PER_SEC = 800;

function makeFrame(effTimeScale: number, lagging: boolean): FramePayload {
  const e = engine!;
  const acc = e.currentAccelerations();
  return {
    time: e.time,
    n: e.n,
    ids: e.specs.map((s) => s.id),
    pos: e.pos.slice(),
    vel: e.vel.slice(),
    acc: acc.slice(),
    masses: Array.from(e.mass),
    radii: Array.from(e.radius),
    diag: e.diagnostics(),
    effTimeScale,
    lastSubstep: e.recommendedDt(),
    lagging,
    stopped: e.stopped,
  };
}

function emitFrame(effTimeScale = 0, lagging = false) {
  if (!engine) return;
  const f = makeFrame(effTimeScale, lagging);
  post({ type: 'frame', frame: f }, [f.pos.buffer, f.vel.buffer, f.acc.buffer]);
}

function emitSnapshot() {
  if (!engine) return;
  post({ type: 'snapshot', time: engine.time, specs: engine.syncedSpecs(), stopped: engine.stopped });
}

function tick() {
  if (!engine || !running || engine.stopped) return;
  const dtReal = TICK_MS / 1000;
  let effTs = cfg.timeScale;
  if (cfg.autoSlowMo) {
    // During close encounters recommendedDt collapses; cap the sim-rate so the
    // encounter unfolds visibly instead of flashing past in one tick.
    const cap = (SLOWMO_STEPS_PER_SEC * engine.recommendedDt());
    effTs = Math.min(effTs, Math.max(cap, 1e-9));
  }
  const hadStructure = engine.n;
  const res = engine.advance(effTs * dtReal);
  if (engine.structureChanged) {
    engine.structureChanged = false;
    post({ type: 'bodies', specs: engine.syncedSpecs() });
  }
  const events = engine.takeEvents();
  if (events.length) post({ type: 'collisions', events });
  void hadStructure;
  emitFrame(effTs, res.lagging);
  const now = Date.now();
  if (now - lastSnapshotWall >= cfg.snapshotEverySec * 1000) {
    lastSnapshotWall = now;
    emitSnapshot();
  }
  if (engine.stopped) running = false;
}

setInterval(tick, TICK_MS);

function runPrediction(id: number, duration: number, samples: number, bodies?: BodySpec[]) {
  if (!engine && !bodies) return;
  // Prediction NEVER touches the live engine: it integrates a clone.
  const ghost = bodies
    ? new Engine(bodies, { ...engine?.config, collisionMode: 'none', eta: Math.max(cfg.eta, 0.05), maxSubstepsPerAdvance: 200000 })
    : engine!.clone();
  if (!bodies) {
    ghost.config = { ...ghost.config, collisionMode: 'none', eta: Math.max(cfg.eta, 0.05), maxSubstepsPerAdvance: 200000 };
  }
  const ids = ghost.specs.map((s) => s.id);
  const n = ghost.n;
  const tracks = new Float64Array(samples * n * 3);
  const times: number[] = [];
  const dt = duration / samples;
  for (let s = 0; s < samples; s++) {
    ghost.advance(dt);
    times.push(ghost.time);
    for (let i = 0; i < n; i++) {
      for (let q = 0; q < 3; q++) tracks[(s * n + i) * 3 + q] = ghost.pos[3 * i + q];
    }
  }
  post({ type: 'prediction', id, times, ids, tracks }, [tracks.buffer]);
}

(self as unknown as Worker).onmessage = (ev: MessageEvent<MainToWorker>) => {
  const msg = ev.data;
  switch (msg.type) {
    case 'init':
      cfg = msg.config;
      engine = new Engine(msg.bodies, {
        eta: cfg.eta,
        softening: cfg.softening,
        collisionMode: cfg.collisionMode,
      });
      running = false;
      post({ type: 'bodies', specs: engine.syncedSpecs() });
      emitSnapshot();
      emitFrame();
      break;
    case 'setRunning':
      running = msg.running && !!engine && !engine.stopped;
      break;
    case 'singleStep':
      if (engine && !engine.stopped) {
        engine.advance(engine.recommendedDt());
        const events = engine.takeEvents();
        if (events.length) post({ type: 'collisions', events });
        if (engine.structureChanged) {
          engine.structureChanged = false;
          post({ type: 'bodies', specs: engine.syncedSpecs() });
        }
        emitFrame();
        emitSnapshot();
      }
      break;
    case 'setConfig':
      cfg = { ...cfg, ...msg.config };
      if (engine) {
        engine.config = {
          ...engine.config,
          eta: cfg.eta,
          softening: cfg.softening,
          collisionMode: cfg.collisionMode,
        };
      }
      break;
    case 'restore':
      if (engine) {
        engine.restore(msg.snapshot);
        running = false;
        post({ type: 'bodies', specs: engine.syncedSpecs() });
        emitFrame();
      }
      break;
    case 'predict':
      runPrediction(msg.id, msg.duration, msg.samples, msg.bodies);
      break;
    case 'requestFrame':
      emitFrame();
      break;
  }
};
