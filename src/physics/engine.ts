import { G } from './constants';
import { computeAccelerations } from './forces';
import { yoshida4Substep } from './integrator';
import { computeDiagnostics, makeBaseline, type DiagnosticBaseline } from './diagnostics';
import type { BodySpec, CollisionEvent, Diagnostics, EngineConfig } from './types';

export const DEFAULT_CONFIG: EngineConfig = {
  eta: 0.03,
  softening: 0,
  collisionMode: 'stop',
  maxSubstepsPerAdvance: 4000,
  minDt: 1e-6,
  maxDt: Infinity,
};

export interface AdvanceResult {
  substeps: number;
  advanced: number; // sim-seconds actually integrated
  lagging: boolean; // hit maxSubstepsPerAdvance before covering the request
}

export interface EngineSnapshot {
  time: number;
  specs: BodySpec[]; // specs with position/velocity synced to arrays
  stopped: boolean;
}

/**
 * Double-precision Newtonian N-body engine.
 * - Yoshida 4th-order symplectic substeps
 * - Adaptive substep from the shortest local gravitational timescale
 * - Physical-radius collision detection (stop / merge / elastic / none)
 * Every body both exerts and feels gravity; there are no fixed sources.
 */
export class Engine {
  n = 0;
  time = 0;
  mass = new Float64Array(0);
  radius = new Float64Array(0);
  pos = new Float64Array(0);
  vel = new Float64Array(0);
  acc = new Float64Array(0);
  specs: BodySpec[] = [];
  config: EngineConfig;
  stopped = false;
  pendingEvents: CollisionEvent[] = [];
  baseline: DiagnosticBaseline | null = null;
  structureChanged = false; // set when a merge removes a body

  constructor(bodies: BodySpec[], config: Partial<EngineConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.setBodies(bodies);
  }

  /** Reset to a fresh set of initial conditions. Resets time, baseline, events. */
  setBodies(bodies: BodySpec[]): void {
    this.specs = bodies.map((b) => ({ ...b, position: [...b.position], velocity: [...b.velocity] }));
    this.n = bodies.length;
    this.mass = new Float64Array(this.n);
    this.radius = new Float64Array(this.n);
    this.pos = new Float64Array(3 * this.n);
    this.vel = new Float64Array(3 * this.n);
    this.acc = new Float64Array(3 * this.n);
    for (let i = 0; i < this.n; i++) {
      this.mass[i] = bodies[i].mass;
      this.radius[i] = bodies[i].radius;
      for (let q = 0; q < 3; q++) {
        this.pos[3 * i + q] = bodies[i].position[q];
        this.vel[3 * i + q] = bodies[i].velocity[q];
      }
    }
    this.time = 0;
    this.stopped = false;
    this.pendingEvents = [];
    this.structureChanged = false;
    const soft2 = this.config.softening * this.config.softening;
    this.baseline = this.n > 0 ? makeBaseline(this.pos, this.vel, this.mass, this.n, soft2) : null;
  }

  /** Restore an arbitrary recorded state WITHOUT resetting the drift baseline (scrubbing). */
  restore(snap: EngineSnapshot): void {
    const keep = this.baseline;
    this.setBodies(snap.specs);
    this.time = snap.time;
    this.stopped = snap.stopped;
    if (keep) this.baseline = keep;
  }

  snapshot(): EngineSnapshot {
    return { time: this.time, specs: this.syncedSpecs(), stopped: this.stopped };
  }

  /** Specs with current position/velocity/mass copied back from the arrays. */
  syncedSpecs(): BodySpec[] {
    return this.specs.map((s, i) => ({
      ...s,
      mass: this.mass[i],
      radius: this.radius[i],
      position: [this.pos[3 * i], this.pos[3 * i + 1], this.pos[3 * i + 2]],
      velocity: [this.vel[3 * i], this.vel[3 * i + 1], this.vel[3 * i + 2]],
    }));
  }

  clone(): Engine {
    const e = new Engine(this.syncedSpecs(), this.config);
    e.time = this.time;
    e.stopped = this.stopped;
    e.baseline = this.baseline;
    return e;
  }

  /**
   * Recommended substep: eta * the shortest of, over all pairs,
   *  - free-fall / orbital timescale sqrt(r^3 / G(mi+mj))
   *  - crossing time r/|vrel|, applied only when the pair is on a near-collision
   *    course (linear-extrapolation minimum separation < 5x combined radii),
   *    so that close encounters and contacts are resolved without letting
   *    irrelevant distant pairs strangle the timestep.
   */
  recommendedDt(): number {
    const { eta, minDt, maxDt } = this.config;
    let tau = Infinity;
    for (let i = 0; i < this.n; i++) {
      const ix = 3 * i;
      for (let j = i + 1; j < this.n; j++) {
        const jx = 3 * j;
        const dx = this.pos[jx] - this.pos[ix];
        const dy = this.pos[jx + 1] - this.pos[ix + 1];
        const dz = this.pos[jx + 2] - this.pos[ix + 2];
        const r = Math.hypot(dx, dy, dz);
        if (r === 0) continue;
        const gm = G * (this.mass[i] + this.mass[j]);
        if (gm > 0) {
          const tff = Math.sqrt((r * r * r) / gm);
          if (tff < tau) tau = tff;
        }
        const vx = this.vel[jx] - this.vel[ix];
        const vy = this.vel[jx + 1] - this.vel[ix + 1];
        const vz = this.vel[jx + 2] - this.vel[ix + 2];
        const v2 = vx * vx + vy * vy + vz * vz;
        if (v2 > 0) {
          // linear-extrapolation closest approach
          const rdotv = dx * vx + dy * vy + dz * vz;
          const tStar = -rdotv / v2;
          let minSep = r;
          if (tStar > 0) {
            const mx = dx + vx * tStar, my = dy + vy * tStar, mz = dz + vz * tStar;
            minSep = Math.hypot(mx, my, mz);
          }
          const contact = this.radius[i] + this.radius[j];
          if (minSep < 5 * contact + 1e-9) {
            const tcross = r / Math.sqrt(v2);
            if (tcross < tau) tau = tcross;
          }
        }
      }
    }
    if (!isFinite(tau)) return maxDt;
    return Math.min(maxDt, Math.max(minDt, eta * tau));
  }

  /** Advance the simulation by (up to) dtTarget sim-seconds using adaptive substeps. */
  advance(dtTarget: number): AdvanceResult {
    if (this.stopped || this.n === 0 || dtTarget <= 0) {
      return { substeps: 0, advanced: 0, lagging: false };
    }
    const soft2 = this.config.softening * this.config.softening;
    let remaining = dtTarget;
    let steps = 0;
    while (remaining > 1e-12 * dtTarget) {
      if (steps >= this.config.maxSubstepsPerAdvance) {
        return { substeps: steps, advanced: dtTarget - remaining, lagging: true };
      }
      const h = Math.min(remaining, this.recommendedDt());
      yoshida4Substep(this.pos, this.vel, this.acc, this.mass, this.n, h, soft2);
      this.time += h;
      remaining -= h;
      steps++;
      if (this.config.collisionMode !== 'none' && this.handleCollisions()) break;
    }
    return { substeps: steps, advanced: dtTarget - remaining, lagging: false };
  }

  /** Fixed-step advance (no adaptivity) — used by convergence tests. */
  advanceFixed(totalTime: number, h: number): void {
    const soft2 = this.config.softening * this.config.softening;
    const steps = Math.round(totalTime / h);
    for (let s = 0; s < steps; s++) {
      yoshida4Substep(this.pos, this.vel, this.acc, this.mass, this.n, h, soft2);
      this.time += h;
    }
  }

  /** Detect and resolve contacts using REAL physical radii. Returns true if sim should stop. */
  private handleCollisions(): boolean {
    let rescan = true;
    while (rescan) {
      rescan = false;
      for (let i = 0; i < this.n && !rescan; i++) {
        for (let j = i + 1; j < this.n && !rescan; j++) {
          const ix = 3 * i, jx = 3 * j;
          const dx = this.pos[jx] - this.pos[ix];
          const dy = this.pos[jx + 1] - this.pos[ix + 1];
          const dz = this.pos[jx + 2] - this.pos[ix + 2];
          const r = Math.hypot(dx, dy, dz);
          const contact = this.radius[i] + this.radius[j];
          if (r > contact) continue;
          const vx = this.vel[jx] - this.vel[ix];
          const vy = this.vel[jx + 1] - this.vel[ix + 1];
          const vz = this.vel[jx + 2] - this.vel[ix + 2];
          const relSpeed = Math.hypot(vx, vy, vz);
          const mi = this.mass[i], mj = this.mass[j];
          const redM = (mi * mj) / Math.max(mi + mj, 1e-300);
          const event: CollisionEvent = {
            time: this.time,
            aId: this.specs[i].id, bId: this.specs[j].id,
            aName: this.specs[i].name, bName: this.specs[j].name,
            mode: this.config.collisionMode,
            relSpeed,
            impactEnergy: 0.5 * redM * relSpeed * relSpeed,
          };
          this.pendingEvents.push(event);
          switch (this.config.collisionMode) {
            case 'stop':
              this.stopped = true;
              return true;
            case 'merge':
              this.merge(i, j);
              rescan = true; // indices shifted; rescan remaining pairs
              break;
            case 'elastic':
              this.elasticBounce(i, j, dx, dy, dz, r, contact);
              break;
            case 'none':
              break;
          }
        }
      }
    }
    return false;
  }

  /** Perfectly inelastic merge: conserves total mass and linear momentum exactly. */
  private merge(i: number, j: number): void {
    const mi = this.mass[i], mj = this.mass[j];
    const M = mi + mj;
    const keep = mi >= mj ? i : j; // keep the more massive body's identity
    const ix = 3 * i, jx = 3 * j;
    const newPos = [
      (mi * this.pos[ix] + mj * this.pos[jx]) / M,
      (mi * this.pos[ix + 1] + mj * this.pos[jx + 1]) / M,
      (mi * this.pos[ix + 2] + mj * this.pos[jx + 2]) / M,
    ];
    const newVel = [
      (mi * this.vel[ix] + mj * this.vel[jx]) / M,
      (mi * this.vel[ix + 1] + mj * this.vel[jx + 1]) / M,
      (mi * this.vel[ix + 2] + mj * this.vel[jx + 2]) / M,
    ];
    // equal-density volume addition
    const newRadius = Math.cbrt(
      Math.pow(this.radius[i], 3) + Math.pow(this.radius[j], 3),
    );
    const keepSpec = this.specs[keep];
    const specs = this.syncedSpecs().filter((_, k) => k !== (keep === i ? j : i));
    const kIdx = specs.findIndex((s) => s.id === keepSpec.id);
    specs[kIdx] = {
      ...keepSpec,
      mass: M,
      radius: newRadius,
      position: newPos as [number, number, number],
      velocity: newVel as [number, number, number],
    };
    const t = this.time;
    const events = this.pendingEvents;
    this.setBodies(specs);
    this.time = t;
    this.pendingEvents = events;
    this.structureChanged = true;
    // NOTE: setBodies() rebased the conservation baseline to the post-merge
    // state. This is deliberate: an inelastic merge PHYSICALLY dissipates
    // kinetic energy (reported per-event as impactEnergy) and converts the
    // pair's orbital angular momentum into spin of the merged body, which a
    // point-mass model cannot carry. The drift indicators exist to measure
    // NUMERICAL error, so they restart from the post-merge state.
  }

  /**
   * Elastic contact (abstract experiments): impulse along the line of centers,
   * conserving momentum and kinetic energy; overlapping bodies are moved apart
   * along the same line (mass-weighted) to the contact distance.
   */
  private elasticBounce(
    i: number, j: number,
    dx: number, dy: number, dz: number, r: number, contact: number,
  ): void {
    if (r === 0) return;
    const nx = dx / r, ny = dy / r, nz = dz / r;
    const ix = 3 * i, jx = 3 * j;
    const rvn =
      (this.vel[jx] - this.vel[ix]) * nx +
      (this.vel[jx + 1] - this.vel[ix + 1]) * ny +
      (this.vel[jx + 2] - this.vel[ix + 2]) * nz;
    const mi = this.mass[i], mj = this.mass[j];
    const invSum = 1 / mi + 1 / mj;
    if (rvn < 0) {
      const impulse = (-2 * rvn) / invSum; // restitution = 1
      this.vel[ix] -= (impulse / mi) * nx;
      this.vel[ix + 1] -= (impulse / mi) * ny;
      this.vel[ix + 2] -= (impulse / mi) * nz;
      this.vel[jx] += (impulse / mj) * nx;
      this.vel[jx + 1] += (impulse / mj) * ny;
      this.vel[jx + 2] += (impulse / mj) * nz;
    }
    const overlap = contact - r;
    if (overlap > 0) {
      const wi = (1 / mi) / invSum, wj = (1 / mj) / invSum;
      this.pos[ix] -= overlap * wi * nx;
      this.pos[ix + 1] -= overlap * wi * ny;
      this.pos[ix + 2] -= overlap * wi * nz;
      this.pos[jx] += overlap * wj * nx;
      this.pos[jx + 1] += overlap * wj * ny;
      this.pos[jx + 2] += overlap * wj * nz;
    }
  }

  diagnostics(): Diagnostics {
    const soft2 = this.config.softening * this.config.softening;
    return computeDiagnostics(this.pos, this.vel, this.mass, this.n, soft2, this.time, this.baseline);
  }

  /** Current acceleration field (for vector display). */
  currentAccelerations(): Float64Array {
    const soft2 = this.config.softening * this.config.softening;
    computeAccelerations(this.pos, this.mass, this.n, soft2, this.acc);
    return this.acc;
  }

  takeEvents(): CollisionEvent[] {
    const e = this.pendingEvents;
    this.pendingEvents = [];
    return e;
  }
}

/** Shift a set of specs into barycentric coordinates: COM at origin, total momentum zero. */
export function toBarycentric(bodies: BodySpec[]): BodySpec[] {
  let M = 0;
  const cp = [0, 0, 0];
  const cv = [0, 0, 0];
  for (const b of bodies) {
    M += b.mass;
    for (let q = 0; q < 3; q++) {
      cp[q] += b.mass * b.position[q];
      cv[q] += b.mass * b.velocity[q];
    }
  }
  if (M === 0) return bodies;
  return bodies.map((b) => ({
    ...b,
    position: [b.position[0] - cp[0] / M, b.position[1] - cp[1] / M, b.position[2] - cp[2] / M],
    velocity: [b.velocity[0] - cv[0] / M, b.velocity[1] - cv[1] / M, b.velocity[2] - cv[2] / M],
  }));
}
