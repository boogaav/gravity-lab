import { create } from 'zustand';
import type { BodySpec, CollisionEvent, CollisionMode, Vec3 } from '../physics/types';
import type { FrameSel } from '../physics/frames';
import { PRESETS, getPreset } from '../physics/presets';
import { pairOrbit, analyticDeflection } from '../physics/orbital';
import type { ValidationResult } from '../validation/suite';
import { workerClient } from './workerClient';
import { api, type WorldCard } from './api';
import { decodeWorld, encodeWorld, type World, type WorldConfigSlice } from './worldCodec';
import { analyzeWorld, type WorldStats } from '../physics/analyze';
import { captureThumbnail } from '../ui/capture';
import { forgetKey, recallKey, rememberKey } from './worldKeys';

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

export type Route =
  | { kind: 'home' }
  | { kind: 'world'; slug: string }
  | { kind: 'leaderboard' }
  | { kind: 'creator'; handle: string };

interface StoreState {
  mode: UIMode;
  route: Route;
  /** Metadata of the published world currently on screen (null when improvising). */
  worldRecord: WorldCard | null;
  worldLiked: boolean;
  worldLoading: boolean;
  worldError: string | null;
  publishOpen: boolean;
  publishing: boolean;
  /** 'create' publishes a new world; 'update' saves over one you hold the key for. */
  publishMode: 'create' | 'update';
  /** True once the owner key for the world on screen has been verified. */
  worldUnlocked: boolean;
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

/** Deployment base path ('/' on the app host, '/gravity-lab/' on the static mirror). */
export const BASE_PATH: string = (import.meta as any).env?.BASE_URL ?? '/';

export function parseRoute(pathname: string): Route {
  let p = pathname;
  if (BASE_PATH !== '/') {
    if (p.startsWith(BASE_PATH)) p = '/' + p.slice(BASE_PATH.length);
    else if (p === BASE_PATH.replace(/\/$/, '')) p = '/';
  }
  const m = /^\/@([a-z0-9-]{2,32})\/?$/i.exec(p);
  if (m) return { kind: 'world', slug: m[1].toLowerCase() };
  if (/^\/worlds\/?$/.test(p)) return { kind: 'leaderboard' };
  const u = /^\/u\/([a-z0-9_-]{2,24})\/?$/i.exec(p);
  if (u) return { kind: 'creator', handle: u[1].toLowerCase() };
  return { kind: 'home' };
}

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
  route: { kind: 'home' },
  worldRecord: null,
  worldLiked: false,
  worldLoading: false,
  worldError: null,
  publishOpen: false,
  publishing: false,
  publishMode: 'create',
  worldUnlocked: false,
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
   * Open a fresh world in a new browser tab, leaving the current one intact.
   * Falls back to starting fresh in place if the browser blocks the popup.
   */
  startNewWorld() {
    const url = actions.routePath({ kind: 'home' });
    const win = typeof window !== 'undefined' ? window.open(url, '_blank', 'noopener') : null;
    if (win) return;
    // popup blocked (or no window): do it here instead
    actions.navigate({ kind: 'home' });
    useStore.setState({ worldRecord: null, worldLiked: false, worldUnlocked: false });
    actions.loadPreset('sandbox');
    actions.setConfig({
      radiusScale: 10,
      showLabels: false,
      showVelocity: false,
      showCom: false,
      trailLength: 800,
    });
    actions.select(null);
    actions.play();
  },

  // ---------------------------------------------------------------- routing

  /** Path for a route, honouring the deployment's base path. */
  routePath(route: Route): string {
    const base = BASE_PATH;
    if (route.kind === 'world') return `${base}@${route.slug}`;
    if (route.kind === 'leaderboard') return `${base}worlds`;
    if (route.kind === 'creator') return `${base}u/${route.handle}`;
    return base;
  },

  navigate(route: Route, opts: { replace?: boolean } = {}) {
    const path = actions.routePath(route);
    if (typeof history !== 'undefined') {
      if (opts.replace) history.replaceState({}, '', path);
      else history.pushState({}, '', path);
    }
    actions.applyRoute(route);
  },

  /** React to a route without touching history (initial load and popstate). */
  applyRoute(route: Route) {
    const prev = useStore.getState().route;
    useStore.setState({ route, worldError: null });
    if (route.kind === 'world') {
      if (prev.kind !== 'world' || prev.slug !== route.slug || !useStore.getState().worldRecord) {
        void actions.openWorld(route.slug);
      }
    } else if (route.kind === 'home' && prev.kind === 'world') {
      useStore.setState({ worldRecord: null, worldLiked: false });
    }
  },

  /** Parse the current URL into a route. Also handles `#w=` ad-hoc world codes. */
  async bootRouting() {
    if (typeof location === 'undefined') return;
    const hash = /[#&]w=([A-Za-z0-9_-]+)/.exec(location.hash);
    if (hash) {
      const world = await decodeWorld(hash[1]);
      if (world) {
        actions.applyWorld(world, 'Shared world');
        useStore.setState({ route: { kind: 'home' } });
        return true;
      }
    }
    actions.applyRoute(parseRoute(location.pathname));
    return false;
  },

  // ---------------------------------------------------------------- worlds

  /** Load bodies + presentation settings from a decoded world into the sim. */
  applyWorld(world: World, title = 'Shared world', description = '') {
    const s = useStore.getState();
    const config: UIConfig = { ...s.config, ...world.config };
    useStore.setState({ config });
    actions.loadBodies(world.bodies, {
      presetId: 'custom',
      name: title,
      description,
      timeScale: world.config.timeScale,
      collisionMode: world.config.collisionMode,
    });
    useStore.setState({ config });
    workerClient.send({ type: 'setConfig', config: workerConfig(config) });
    actions.select(null);
    actions.play();
  },

  async openWorld(slug: string) {
    useStore.setState({ worldLoading: true, worldError: null });
    try {
      const rec = await api.get(slug);
      const world = await decodeWorld(rec.data);
      if (!world) throw new Error('This world could not be decoded.');
      actions.applyWorld(world, rec.title, rec.author ? `by ${rec.author}` : '');
      useStore.setState({
        worldRecord: rec,
        worldLiked: rec.liked,
        worldLoading: false,
        route: { kind: 'world', slug },
        // this device already holds the owner key → edit controls unlock
        worldUnlocked: rec.editable && !!recallKey(slug),
      });
    } catch (err) {
      useStore.setState({
        worldLoading: false,
        worldError: err instanceof Error ? err.message : String(err),
        worldRecord: null,
      });
    }
  },

  /** Fork the current world into an unpublished sandbox session. */
  remixWorld() {
    useStore.setState({ worldRecord: null, worldLiked: false, mode: 'sandbox' });
    actions.navigate({ kind: 'home' });
    actions.play();
  },

  async toggleLike() {
    const rec = useStore.getState().worldRecord;
    if (!rec) return;
    try {
      const res = await api.like(rec.slug);
      useStore.setState({
        worldLiked: res.liked,
        worldRecord: { ...rec, likes: res.likes },
      });
    } catch {
      /* likes are best-effort */
    }
  },

  setPublishOpen(open: boolean, mode: 'create' | 'update' = 'create') {
    useStore.setState({ publishOpen: open, publishMode: open ? mode : 'create' });
  },

  /** Verify an owner key for the world on screen and remember it on this device. */
  async unlockWorld(key: string): Promise<void> {
    const rec = useStore.getState().worldRecord;
    if (!rec) throw new Error('No world loaded.');
    await api.auth(rec.slug, key);
    rememberKey(rec.slug, key);
    useStore.setState({ worldUnlocked: true });
  },

  /** Permanently remove a published world (requires its owner key). */
  async deleteWorld(slug: string, key: string) {
    await api.remove(slug, key);
    forgetKey(slug);
    useStore.setState({ worldRecord: null, worldUnlocked: false, publishOpen: false });
    actions.navigate({ kind: 'leaderboard' });
  },

  /** Save the current state over an existing world (requires its owner key). */
  async updateWorld(input: {
    slug: string;
    title: string;
    author: string;
    key: string;
    world?: World;
    stats?: WorldStats;
    thumb?: string | null;
  }) {
    useStore.setState({ publishing: true });
    try {
      const world = input.world ?? actions.currentWorld();
      const thumb = input.thumb !== undefined ? input.thumb : captureThumbnail(640);
      const stats = input.stats ?? analyzeWorld(world.bodies);
      const data = await encodeWorld(world);
      const res = await api.update(input.slug, {
        title: input.title,
        author: input.author,
        data,
        thumb,
        stats,
        key: input.key,
      });
      rememberKey(input.slug, input.key);
      useStore.setState({ publishing: false, publishOpen: false, worldUnlocked: true });
      await actions.openWorld(input.slug);
      return res;
    } catch (err) {
      useStore.setState({ publishing: false });
      throw err;
    }
  },

  /** Current world (initial conditions as loaded/edited) in codec form. */
  currentWorld(): World {
    const s = useStore.getState();
    const c = s.config;
    const config: WorldConfigSlice = {
      timeScale: c.timeScale,
      collisionMode: c.collisionMode,
      radiusScale: c.radiusScale,
      eta: c.eta,
      softening: c.softening,
      trailLength: c.trailLength,
      showVelocity: c.showVelocity,
      showAcceleration: c.showAcceleration,
      showForces: c.showForces,
      showGrid: c.showGrid,
      showLabels: c.showLabels,
      showCom: c.showCom,
    };
    // Publish what is on screen right now, so a world captured mid-run keeps
    // the arrangement its author actually saw.
    const live = workerClient.latest;
    const bodies = live && s.liveSpecs.length
      ? s.liveSpecs.map((b, i) => {
          const k = live.ids.indexOf(b.id);
          if (k < 0) return b;
          return {
            ...b,
            mass: live.masses[k],
            radius: live.radii[k],
            position: [live.pos[3 * k], live.pos[3 * k + 1], live.pos[3 * k + 2]] as Vec3,
            velocity: [live.vel[3 * k], live.vel[3 * k + 1], live.vel[3 * k + 2]] as Vec3,
          };
        })
      : s.specs;
    return { bodies, config };
  },

  /** Measure the current world's dynamics without disturbing the live run. */
  analyzeCurrent(): WorldStats {
    return analyzeWorld(actions.currentWorld().bodies);
  },

  /**
   * Publish a world. The caller passes the exact snapshot it previewed
   * (bodies, stats, thumbnail) so that what was measured and shown is what
   * gets stored — the live simulation keeps running while the dialog is open,
   * so re-reading it here would publish a different set of initial conditions.
   */
  async publishWorld(input: {
    slug: string;
    title: string;
    author: string;
    world?: World;
    stats?: WorldStats;
    thumb?: string | null;
    key: string;
  }) {
    useStore.setState({ publishing: true });
    try {
      const world = input.world ?? actions.currentWorld();
      const thumb = input.thumb !== undefined ? input.thumb : captureThumbnail(640);
      const stats = input.stats ?? analyzeWorld(world.bodies);
      const data = await encodeWorld(world);
      const res = await api.publish({
        slug: input.slug,
        title: input.title,
        author: input.author,
        data,
        thumb,
        stats,
        key: input.key,
      });
      rememberKey(res.slug, input.key);
      useStore.setState({ publishing: false, publishOpen: false, worldUnlocked: true });
      actions.navigate({ kind: 'world', slug: res.slug });
      return res;
    } catch (err) {
      useStore.setState({ publishing: false });
      throw err;
    }
  },

  /** Encode the current world into a link that needs no server. */
  async shareableHashLink(): Promise<string> {
    const code = await encodeWorld(actions.currentWorld());
    const base = typeof location !== 'undefined' ? location.origin + BASE_PATH : '';
    return `${base}#w=${code}`;
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

if (typeof window !== 'undefined') {
  window.addEventListener('popstate', () => actions.applyRoute(parseRoute(location.pathname)));
}
