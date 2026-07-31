import { G, YEAR } from './constants';
import { Engine } from './engine';
import type { BodySpec, Vec3 } from './types';

/**
 * Measured dynamical summary of a world, computed by actually integrating it.
 * These are the leaderboard's ranking quantities: no vanity counters — the
 * numbers come from the same engine that runs the live simulation.
 */
export interface WorldStats {
  bodies: number;
  totalMass: number; // kg
  /** Characteristic orbital timescale (median pairwise period), s. */
  dynamicalTime: number;
  /** How far the analysis actually integrated, s. */
  horizon: number;
  /** Sim-seconds until the first contact, or null if none within the horizon. */
  firstCollision: number | null;
  /** Bodies still present at the end of the horizon (after merges). */
  survivors: number;
  /** Bodies on unbound outbound trajectories at the end. */
  escapees: number;
  /**
   * Finite-time Lyapunov exponent in units of 1/dynamicalTime, measured
   * against a twin world displaced by 1 part in 10^9. ~0 for regular
   * (quasi-periodic) motion, >~0.3 for chaotic motion.
   */
  chaos: number;
  /** Dynamical times over which `chaos` was measured (0 = not measurable). */
  chaosWindow: number;
  /** True if the integration hit its compute budget before the full horizon. */
  truncated: boolean;
}

/** Total substeps allowed across all three integrations, to bound publish latency. */
const SUBSTEP_BUDGET = 400_000;
const HORIZON_IN_DYN_TIMES = 200;
const CHUNKS = 300;

function centerOfMass(bodies: BodySpec[]): { M: number; com: Vec3 } {
  let M = 0;
  const com: Vec3 = [0, 0, 0];
  for (const b of bodies) {
    M += b.mass;
    for (let q = 0; q < 3; q++) com[q] += b.mass * b.position[q];
  }
  if (M > 0) for (let q = 0; q < 3; q++) com[q] /= M;
  return { M, com };
}

/**
 * Characteristic timescale: the MEDIAN two-body orbital period over all pairs,
 * T_ij = 2π √(r³ / G(m_i+m_j)). Unlike a mass-weighted radius this stays
 * meaningful for hierarchical systems with extreme mass ratios (a star with a
 * distant light planet), where the heavy body sits essentially at the
 * barycenter and would otherwise imply a near-zero system size.
 */
function characteristicTime(bodies: BodySpec[]): number {
  const periods: number[] = [];
  for (let i = 0; i < bodies.length; i++) {
    for (let j = i + 1; j < bodies.length; j++) {
      const a = bodies[i], b = bodies[j];
      const r = Math.hypot(
        b.position[0] - a.position[0],
        b.position[1] - a.position[1],
        b.position[2] - a.position[2],
      );
      const gm = G * (a.mass + b.mass);
      if (r > 0 && gm > 0) periods.push(2 * Math.PI * Math.sqrt((r * r * r) / gm));
    }
  }
  if (!periods.length) return YEAR;
  periods.sort((x, y) => x - y);
  return periods[Math.floor(periods.length / 2)];
}

/** Spatial extent: the largest distance from the barycenter. */
function extent(bodies: BodySpec[]): number {
  const { com } = centerOfMass(bodies);
  let max = 0;
  for (const b of bodies) {
    max = Math.max(max, Math.hypot(b.position[0] - com[0], b.position[1] - com[1], b.position[2] - com[2]));
  }
  return Math.max(max, 1);
}

function countEscapees(eng: Engine, size: number): number {
  const n = eng.n;
  if (n < 2) return 0;
  let M = 0;
  const comV: Vec3 = [0, 0, 0];
  const comP: Vec3 = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    M += eng.mass[i];
    for (let q = 0; q < 3; q++) {
      comP[q] += eng.mass[i] * eng.pos[3 * i + q];
      comV[q] += eng.mass[i] * eng.vel[3 * i + q];
    }
  }
  for (let q = 0; q < 3; q++) {
    comP[q] /= M;
    comV[q] /= M;
  }
  let escaped = 0;
  for (let i = 0; i < n; i++) {
    const dx = eng.pos[3 * i] - comP[0];
    const dy = eng.pos[3 * i + 1] - comP[1];
    const dz = eng.pos[3 * i + 2] - comP[2];
    const r = Math.hypot(dx, dy, dz);
    if (r < 3 * size) continue;
    const vx = eng.vel[3 * i] - comV[0];
    const vy = eng.vel[3 * i + 1] - comV[1];
    const vz = eng.vel[3 * i + 2] - comV[2];
    const eps = 0.5 * (vx * vx + vy * vy + vz * vz) - (G * (M - eng.mass[i])) / r;
    if (eps > 0 && dx * vx + dy * vy + dz * vz > 0) escaped++;
  }
  return escaped;
}

function separation(a: Engine, b: Engine): number {
  const n = Math.min(a.n, b.n);
  let acc = 0;
  for (let i = 0; i < 3 * n; i++) {
    const d = a.pos[i] - b.pos[i];
    acc += d * d;
  }
  return Math.sqrt(acc);
}

/**
 * Integrate the world — plus a minutely perturbed twin — forward to
 * characterize it. Runs synchronously within a bounded substep budget;
 * typical cost is a few hundred milliseconds.
 *
 * Both the reference and the twin use the world's real collision handling, so
 * the divergence is measured on physically valid trajectories. (Disabling
 * collisions would let bodies pass through one another at arbitrarily small
 * separations, producing enormous unphysical accelerations.) The comparison
 * window therefore ends at the first merge, and `chaosWindow` reports how many
 * dynamical times it covered.
 */
export function analyzeWorld(bodies: BodySpec[]): WorldStats {
  const { M } = centerOfMass(bodies);
  const dynamicalTime = characteristicTime(bodies);
  const size = extent(bodies);
  const horizon = HORIZON_IN_DYN_TIMES * dynamicalTime;
  const stats: WorldStats = {
    bodies: bodies.length,
    totalMass: M,
    dynamicalTime,
    horizon: 0,
    firstCollision: null,
    survivors: bodies.length,
    escapees: 0,
    chaos: 0,
    chaosWindow: 0,
    truncated: false,
  };
  if (bodies.length < 2) return stats;

  const cfg = { collisionMode: 'merge' as const, eta: 0.05, maxSubstepsPerAdvance: 20_000 };
  const real = new Engine(bodies, cfg);

  // Twin: displace the lightest body by 1 part in 1e9 of the system's extent.
  const delta0 = Math.max(size * 1e-9, 1e-3);
  let lightest = 0;
  bodies.forEach((b, i) => {
    if (b.mass < bodies[lightest].mass) lightest = i;
  });
  const twin = new Engine(
    bodies.map((b, i) =>
      i === lightest ? { ...b, position: [b.position[0] + delta0, b.position[1], b.position[2]] as Vec3 } : b,
    ),
    cfg,
  );

  const n0 = bodies.length;
  const dt = horizon / CHUNKS;
  let spent = 0;
  let elapsed = 0;
  let divergence = 0;
  let divergedAt = 0;
  /** Divergence saturates once it reaches the system scale; stop measuring there. */
  const satur = 0.3 * size;

  for (let c = 0; c < CHUNKS; c++) {
    if (spent > SUBSTEP_BUDGET) {
      stats.truncated = true;
      break;
    }
    spent += real.advance(dt).substeps;
    spent += twin.advance(dt).substeps;
    elapsed += dt;

    const ev = real.takeEvents();
    if (ev.length && stats.firstCollision === null) stats.firstCollision = ev[0].time;

    if (real.n === n0 && twin.n === n0 && divergence < satur) {
      const d = separation(real, twin);
      if (isFinite(d) && d > delta0) {
        divergence = d;
        divergedAt = elapsed;
      }
    }
    if (real.stopped) break;
  }

  stats.horizon = elapsed;
  stats.survivors = real.n;
  stats.escapees = countEscapees(real, size);
  const window = divergedAt / dynamicalTime;
  // A finite-time Lyapunov estimate needs at least a dynamical time to mean anything.
  if (window >= 1 && divergence > delta0) {
    stats.chaos = Math.log(divergence / delta0) / window;
    stats.chaosWindow = window;
  }
  if (!isFinite(stats.chaos) || stats.chaos < 0) {
    stats.chaos = 0;
    stats.chaosWindow = 0;
  }
  return stats;
}

/** Short human summary used on leaderboard cards. */
export function describeStats(s: WorldStats): string {
  const parts: string[] = [`${s.bodies} bodies`];
  if (s.firstCollision !== null) {
    parts.push(`first impact ${(s.firstCollision / YEAR).toPrecision(3)} yr`);
  } else if (s.escapees > 0) {
    parts.push(`${s.escapees} ejected`);
  } else {
    parts.push('intact');
  }
  if (s.chaosWindow > 0) {
    parts.push(s.chaos > 0.3 ? 'chaotic' : s.chaos > 0.1 ? 'unsettled' : 'regular');
  }
  return parts.join(' · ');
}
