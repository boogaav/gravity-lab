import { potentialEnergy } from './forces';
import type { Diagnostics, Vec3 } from './types';

export interface DiagnosticBaseline {
  energy: number;
  angMom: number; // |L|
  energyScale: number; // denominator guard for drift %
}

export function computeDiagnostics(
  pos: Float64Array,
  vel: Float64Array,
  mass: Float64Array,
  n: number,
  soft2: number,
  time: number,
  baseline: DiagnosticBaseline | null,
): Diagnostics {
  let K = 0;
  let Mtot = 0;
  const P: Vec3 = [0, 0, 0];
  const L: Vec3 = [0, 0, 0];
  const comP: Vec3 = [0, 0, 0];
  const comV: Vec3 = [0, 0, 0];
  const perBodyK: number[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const ix = 3 * i;
    const m = mass[i];
    const vx = vel[ix], vy = vel[ix + 1], vz = vel[ix + 2];
    const px = pos[ix], py = pos[ix + 1], pz = pos[ix + 2];
    const k = 0.5 * m * (vx * vx + vy * vy + vz * vz);
    perBodyK[i] = k;
    K += k;
    Mtot += m;
    P[0] += m * vx; P[1] += m * vy; P[2] += m * vz;
    // L = sum m (r x v)
    L[0] += m * (py * vz - pz * vy);
    L[1] += m * (pz * vx - px * vz);
    L[2] += m * (px * vy - py * vx);
    comP[0] += m * px; comP[1] += m * py; comP[2] += m * pz;
    comV[0] += m * vx; comV[1] += m * vy; comV[2] += m * vz;
  }
  if (Mtot > 0) {
    for (let q = 0; q < 3; q++) {
      comP[q] /= Mtot;
      comV[q] /= Mtot;
    }
  }
  const U = potentialEnergy(pos, mass, n, soft2);
  const E = K + U;
  const Lmag = Math.hypot(L[0], L[1], L[2]);
  let energyDrift = 0;
  let angMomDrift = 0;
  if (baseline) {
    energyDrift = (E - baseline.energy) / baseline.energyScale;
    angMomDrift = baseline.angMom > 0 ? (Lmag - baseline.angMom) / baseline.angMom : 0;
  }
  return {
    time,
    kinetic: K,
    potential: U,
    total: E,
    momentum: P,
    angularMomentum: L,
    comPosition: comP,
    comVelocity: comV,
    totalMass: Mtot,
    energyDrift,
    angMomDrift,
    perBodyKinetic: perBodyK,
  };
}

export function makeBaseline(
  pos: Float64Array,
  vel: Float64Array,
  mass: Float64Array,
  n: number,
  soft2: number,
): DiagnosticBaseline {
  const d = computeDiagnostics(pos, vel, mass, n, soft2, 0, null);
  const Lmag = Math.hypot(...d.angularMomentum);
  // Guard: total E can legitimately be near zero (parabolic systems); use K+|U| as scale then.
  const scale = Math.max(Math.abs(d.total), 1e-3 * (d.kinetic + Math.abs(d.potential)), 1e-300);
  return { energy: d.total, angMom: Lmag, energyScale: scale };
}
