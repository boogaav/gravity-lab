import { create } from 'zustand';
import type { BodySpec, CollisionEvent, CollisionMode, Vec3 } from '../physics/types';
import type { FrameSel } from '../physics/frames';
import { PRESETS, getPreset } from '../physics/presets';
import { pairOrbit, analyticDeflection } from '../physics/orbital';
import type { ValidationResult } from '../validation/suite';
import { workerClient } from './workerClient';

export interface HistoryEntry {
  time: number;
  specs: BodySpec[];
  stopped: boolean;
}

export interface SeriesPoint {
  t: number;
  K: number;
  U: number;
  E: number;
  driftE: number;
  driftL: number;
}

/** Recorded at scenario load for the featured pair: the analytical prediction the sim is checked against. */
export interface EncounterRef {
  pair: [string, string];
  vRel0: Vec3;
  vInfinity: number;
  impactParameter: number;
  deltaAnalytic: number; // rad
  mu: number;
}

export interface EncounterLive {
  minSep: number;
  timeAtMin: number;
  posA: Vec3;
  posB: Vec3;
}

export interface UIConfig {
  timeScale: number;
  eta: number;
  softening: number;
  collisionMode: CollisionMode;
  autoSlowMo: boolean;
  radiusScale: number; // VISUAL only — never touches physics
  trailLength: number; // history entries used for trails
  showVelocity: boolean;
  showAcceleration: boolean;
  showForces: boolean;
  showGrid: boolean;
  showLabels: boolean;
  showCom: boolean;
  showPrediction: boolean;
  predictionDuration: number; // s
}

export type UIMode = 'sandbox' | 'lab';

interface StoreState {
  mode: UIMode;
  presetId: string;
  presetName: string;
  presetDescription: string;
  variationLabel: string | null;
  specs: BodySpec[]; // initial conditions (editable)
  liveSpecs: BodySpec[]; // current body structure (post-merge) from the worker
  config: UIConfig;
  running: boolean;
  started: boolean; // true once time > 0 (disables IC drag handles)
  liveTick: number; // bumped ~10 Hz; panels subscribe to this
  history: HistoryEntry[];
  series: SeriesPoint[];
  collisions: CollisionEvent[];
  frame: FrameSel;
  selectedId: string | null;
  pairSel: [string, string];
  markEntry: HistoryEntry | null;
  prediction: { times: number[]; ids: string[]; tracks: Float64Array } | null;
  validation: ValidationResult[] | null;
  validationRunning: boolean;
  encounterRef: EncounterRef | null;
  encounterLive: EncounterLive | null;
  sceneScale: number; // m per scene unit
  velScale: number; // m/s per scene unit (velocity-handle display scale)
  sceneEpoch: number; // bumped on scenario load → camera reset
  driftWarning: boolean;
}

const DRIFT_WARN = 1e-4; // configurable threshold: warn above 0.01% energy drift

function defaultConfig(): UIConfig {
  return {
    timeScale: 1e5,
    eta: 0.03,
    softening: 0,
    collisionMode: 'stop',
    autoSlowMo: true,
    radiusScale: 1,
    trailLength: 1200,
    showVelocity: true,
    showAcceleration: false,
    showForces: false,
    showGrid: true,
    showLabels: true,
    showCom: true,
    showPrediction: false,
    predictionDuration: 1e7,
  };
}

function scalesFor(specs: BodySpec[]): { sceneScale: number; velScale: number } {
  let maxR = 0;
  let maxV = 0;
  for (const b of specs) {
    maxR = Math.max(maxR, Math.hypot(...b.position));
    maxV = Math.max(maxV, Math.hypot(...b.velocity));
  }
  const sceneScale = Math.max(maxR, 1) / 18;
  const velScale = Math.max(maxV, 1) / 4;
  return { sceneScale, velScale };
}

function encounterRefFor(specs: BodySpec[], pair: [string, string]): EncounterRef | null {
  const a = specs.find((b) => b.id === pair[0]);
  const b = specs.find((x) => x.id === pair[1]);
  if (!a || !b) return null;
  const orb = pairOrbit(a.mass, a.position, a.velocity, b.mass, b.position, b.velocity);
  return {
    pair,
    vRel0: orb.relVelocity,
    vInfinity: orb.vInfinity,
    impactParameter: orb.impactParameter,
    deltaAnalytic: orb.vInfinity > 0
      ? analyticDeflection(orb.mu, orb.impactParameter, orb.vInfinity)
      : 0,
    mu: orb.mu,
  };
}

function workerConfig(c: UIConfig) {
  return {
    timeScale: c.timeScale,
    eta: c.eta,
    softening: c.softening,
    collisionMode: c.collisionMode,
    autoSlowMo: c.autoSlowMo,
    snapshotEverySec: 0.25,
  };
}

export const useStore = create<StoreState>(() => ({
  mode: 'sandbox',
  presetId: '',
  presetName: '',
  presetDescription: '',
  variationLabel: null,
  specs: [],
  liveSpecs: [],
  config: defaultConfig(),
  running: false,
  started: false,
  liveTick: 0,
  history: [],
  series: [],
  collisions: [],
  frame: { kind: 'inertial' },
  selectedId: null,
  pairSel: ['', ''],
  markEntry: null,
  prediction: null,
  validation: null,
  validationRunning: false,
  encounterRef: null,
  encounterLive: null,
  sceneScale: 1e10,
  velScale: 1e3,
  sceneEpoch: 0,
  driftWarning: false,
}));

// ---------------------------------------------------------------- actions

function initWorker(specs: BodySpec[], config: UIConfig) {
  workerClient.send({ type: 'init', bodies: specs, config: workerConfig(config) });
}

export const actions = {
  loadBodies(
    specs: BodySpec[],
    opts: {
      presetId?: string;
      name?: string;
      description?: string;
      timeScale?: number;
      collisionMode?: CollisionMode;
      featuredPair?: [string, string];
      frame?: FrameSel;
      predictionDuration?: number;
      variationLabel?: string | null;
    } = {},
  ) {
    const s = useStore.getState();
    const config: UIConfig = {
      ...s.config,
      timeScale: opts.timeScale ?? s.config.timeScale,
      collisionMode: opts.collisionMode ?? s.config.collisionMode,
      predictionDuration: opts.predictionDuration ?? s.config.predictionDuration,
    };
    const pair: [string, string] =
      opts.featuredPair ??
      (specs.length >= 2 ? [specs[0].id, specs[1].id] : ['', '']);
    useStore.setState({
      presetId: opts.presetId ?? 'custom',
      presetName: opts.name ?? 'Custom scenario',
      presetDescription: opts.description ?? '',
      variationLabel: opts.variationLabel ?? null,
      specs: specs.map((b) => ({ ...b, position: [...b.position] as Vec3, velocity: [...b.velocity] as Vec3 })),
      liveSpecs: specs,
      config,
      running: false,
      started: false,
      history: [],
      series: [],
      collisions: [],
      frame: opts.frame ?? { kind: 'inertial' },
      selectedId: specs.find((b) => b.type === 'spacecraft')?.id ?? specs[0]?.id ?? null,
      pairSel: pair,
      markEntry: null,
      prediction: null,
      encounterRef: encounterRefFor(specs, pair),
      encounterLive: null,
      ...scalesFor(specs),
      sceneEpoch: s.sceneEpoch + 1,
      driftWarning: false,
    });
    initWorker(specs, config);
  },

  loadPreset(id: string) {
    const p = getPreset(id);
    actions.loadBodies(p.bodies, {
      presetId: p.id,
      name: p.name,
      description: p.description,
      timeScale: p.timeScale,
      collisionMode: p.collisionMode,
      featuredPair: p.featuredPair,
      frame: p.defaultFrame,
      predictionDuration: p.predictionDuration,
    });
  },

  applyVariation() {
    const s = useStore.getState();
    const p = PRESETS.find((x) => x.id === s.presetId);
    if (!p?.variation) return;
    actions.loadBodies(p.variation.apply(s.specs.map((b) => ({ ...b }))), {
      presetId: p.id,
      name: p.name,
      description: p.description,
      timeScale: p.timeScale,
      collisionMode: p.collisionMode,
      featuredPair: p.featuredPair,
      frame: p.defaultFrame,
      predictionDuration: p.predictionDuration,
      variationLabel: p.variation.label,
    });
  },

  setMode(mode: UIMode) {
    useStore.setState({ mode });
  },

  /**
   * Drop a new body into the LIVE simulation (sandbox). The worker injects it
   * at the current sim time; conservation baselines rebase (adding external
   * mass/energy is a physical change, not numerical error).
   */
  spawnBody(spec: BodySpec) {
    workerClient.send({ type: 'addBody', body: spec });
  },

  play() {
    useStore.setState({ running: true, started: true });
    workerClient.send({ type: 'setRunning', running: true });
  },
  pause() {
    useStore.setState({ running: false });
    workerClient.send({ type: 'setRunning', running: false });
  },
  singleStep() {
    useStore.setState({ running: false, started: true });
    workerClient.send({ type: 'setRunning', running: false });
    workerClient.send({ type: 'singleStep' });
  },
  reset() {
    const s = useStore.getState();
    useStore.setState({
      running: false, started: false, history: [], series: [], collisions: [],
      markEntry: null, prediction: null, encounterLive: null, driftWarning: false,
      encounterRef: encounterRefFor(s.specs, s.pairSel),
    });
    initWorker(s.specs, s.config);
  },

  setConfig(patch: Partial<UIConfig>) {
    const s = useStore.getState();
    const config = { ...s.config, ...patch };
    useStore.setState({ config });
    workerClient.send({ type: 'setConfig', config: workerConfig(config) });
  },

  /** Edit a body's INITIAL conditions; re-initializes the run (honest reset, no live mutation). */
  updateSpec(id: string, patch: Partial<BodySpec>) {
    const s = useStore.getState();
    const specs = s.specs.map((b) => (b.id === id ? { ...b, ...patch } : b));
    useStore.setState({
      specs, liveSpecs: specs, running: false, started: false,
      history: [], series: [], collisions: [], markEntry: null, encounterLive: null,
      encounterRef: encounterRefFor(specs, s.pairSel),
      ...scalesFor(specs),
    });
    initWorker(specs, s.config);
    if (s.config.showPrediction) actions.requestPrediction();
  },

  addBody() {
    const s = useStore.getState();
    const id = `body-${Date.now().toString(36)}`;
    const specs = [
      ...s.specs,
      {
        id, name: `Body ${s.specs.length + 1}`, type: 'asteroid' as const,
        mass: 1e22, radius: 5e5,
        position: [s.sceneScale * 8, s.sceneScale * 4, 0] as Vec3,
        velocity: [0, 0, 0] as Vec3,
        color: '#c9a2ff', showTrail: true, showVectors: true,
      },
    ];
    useStore.setState({ specs, liveSpecs: specs, selectedId: id, running: false, started: false, history: [], series: [], collisions: [] });
    initWorker(specs, s.config);
  },

  removeBody(id: string) {
    const s = useStore.getState();
    const specs = s.specs.filter((b) => b.id !== id);
    useStore.setState({
      specs, liveSpecs: specs, running: false, started: false,
      history: [], series: [], collisions: [],
      selectedId: s.selectedId === id ? null : s.selectedId,
    });
    initWorker(specs, s.config);
  },

  select(id: string | null) {
    useStore.setState({ selectedId: id });
  },
  setPair(pair: [string, string]) {
    const s = useStore.getState();
    useStore.setState({ pairSel: pair, encounterRef: encounterRefFor(s.specs, pair), encounterLive: null });
  },
  setFrame(frame: FrameSel) {
    useStore.setState({ frame });
  },

  mark() {
    const s = useStore.getState();
    const last = s.history[s.history.length - 1];
    if (last) useStore.setState({ markEntry: last });
  },
  clearMark() {
    useStore.setState({ markEntry: null });
  },

  scrubTo(index: number) {
    const s = useStore.getState();
    const entry = s.history[index];
    if (!entry) return;
    // Restores a RECORDED state — no interpolation, no fake reverse physics.
    workerClient.send({ type: 'setRunning', running: false });
    workerClient.send({ type: 'restore', snapshot: entry });
    useStore.setState({
      running: false,
      history: s.history.slice(0, index + 1),
      series: s.series.filter((p) => p.t <= entry.time),
    });
  },

  requestPrediction() {
    const s = useStore.getState();
    workerClient.send({
      type: 'predict', id: ++predictionSeq,
      duration: s.config.predictionDuration, samples: 400,
    });
  },

  exportJSON(): string {
    const s = useStore.getState();
    return JSON.stringify(
      {
        format: 'gravity-lab-scenario-v1',
        name: s.presetName,
        description: s.presetDescription,
        config: s.config,
        bodies: s.specs,
      },
      null,
      2,
    );
  },

  importJSON(text: string) {
    const data = JSON.parse(text);
    if (!Array.isArray(data.bodies)) throw new Error('Invalid scenario file: missing bodies[]');
    const s = useStore.getState();
    if (data.config) useStore.setState({ config: { ...s.config, ...data.config } });
    actions.loadBodies(data.bodies, {
      name: data.name ?? 'Imported scenario',
      description: data.description ?? '',
      timeScale: data.config?.timeScale,
      collisionMode: data.config?.collisionMode,
    });
  },

  saveScenario() {
    const s = useStore.getState();
    const key = 'gravity-lab-saved';
    const saved = JSON.parse(localStorage.getItem(key) ?? '{}');
    const name = `${s.presetName} @ ${new Date().toLocaleTimeString()}`;
    saved[name] = JSON.parse(actions.exportJSON());
    localStorage.setItem(key, JSON.stringify(saved));
    return name;
  },
  listSaved(): string[] {
    return Object.keys(JSON.parse(localStorage.getItem('gravity-lab-saved') ?? '{}'));
  },
  loadSaved(name: string) {
    const saved = JSON.parse(localStorage.getItem('gravity-lab-saved') ?? '{}');
    if (saved[name]) actions.importJSON(JSON.stringify(saved[name]));
  },

  async runValidation() {
    useStore.setState({ validationRunning: true, validation: null });
    const { ALL_TESTS } = await import('../validation/suite');
    const results: ValidationResult[] = [];
    for (const t of ALL_TESTS) {
      // yield to the UI between tests
      await new Promise((r) => setTimeout(r, 10));
      try {
        results.push(t());
      } catch (err) {
        results.push({ name: t.name, pass: false, measured: `threw: ${err}`, tolerance: '—' });
      }
      useStore.setState({ validation: [...results] });
    }
    useStore.setState({ validationRunning: false });
  },
};

let predictionSeq = 0;

// ---------------------------------------------------- worker message wiring

workerClient.on((msg) => {
  const s = useStore.getState();
  switch (msg.type) {
    case 'bodies':
      useStore.setState({ liveSpecs: msg.specs });
      break;
    case 'snapshot': {
      let history = [...s.history, { time: msg.time, specs: msg.specs, stopped: msg.stopped }];
      if (history.length > 3000) history = history.filter((_, i) => i % 2 === 0);
      const f = workerClient.latest;
      let series = s.series;
      if (f) {
        series = [...s.series, {
          t: msg.time, K: f.diag.kinetic, U: f.diag.potential, E: f.diag.total,
          driftE: f.diag.energyDrift, driftL: f.diag.angMomDrift,
        }];
        if (series.length > 3000) series = series.filter((_, i) => i % 2 === 0);
      }
      useStore.setState({ history, series });
      break;
    }
    case 'collisions':
      useStore.setState({ collisions: [...s.collisions, ...msg.events], running: s.config.collisionMode === 'stop' ? false : s.running });
      break;
    case 'prediction':
      if (msg.id === predictionSeq) {
        useStore.setState({ prediction: { times: msg.times, ids: msg.ids, tracks: msg.tracks } });
      }
      break;
    case 'frame': {
      // track closest approach of the featured pair (main-thread bookkeeping only)
      const ref = s.encounterRef;
      if (ref) {
        const ia = msg.frame.ids.indexOf(ref.pair[0]);
        const ib = msg.frame.ids.indexOf(ref.pair[1]);
        if (ia >= 0 && ib >= 0) {
          const p = msg.frame.pos;
          const dx = p[3 * ib] - p[3 * ia];
          const dy = p[3 * ib + 1] - p[3 * ia + 1];
          const dz = p[3 * ib + 2] - p[3 * ia + 2];
          const sep = Math.hypot(dx, dy, dz);
          if (!s.encounterLive || sep < s.encounterLive.minSep) {
            useStore.setState({
              encounterLive: {
                minSep: sep, timeAtMin: msg.frame.time,
                posA: [p[3 * ia], p[3 * ia + 1], p[3 * ia + 2]],
                posB: [p[3 * ib], p[3 * ib + 1], p[3 * ib + 2]],
              },
            });
          }
        }
      }
      const warn = Math.abs(msg.frame.diag.energyDrift) > DRIFT_WARN;
      if (warn !== s.driftWarning) useStore.setState({ driftWarning: warn });
      if (msg.frame.stopped && s.running) useStore.setState({ running: false });
      break;
    }
  }
});

// panels refresh at ~10 Hz
setInterval(() => {
  useStore.setState((s) => ({ liveTick: s.liveTick + 1 }));
}, 100);
