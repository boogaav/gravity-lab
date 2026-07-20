import { G } from './constants';

/**
 * Newtonian pairwise gravitational accelerations.
 *   a_i = G * sum_{j!=i} m_j (r_j - r_i) / (|r_j - r_i|^2 + soft^2)^{3/2}
 * soft2 = 0 in the physically-correct celestial mode; a nonzero value is
 * only used in the explicitly-labeled point-particle approximation mode.
 * Writes into `acc` (length 3n). O(n^2), symmetric (Newton's third law exact).
 */
export function computeAccelerations(
  pos: Float64Array,
  mass: Float64Array,
  n: number,
  soft2: number,
  acc: Float64Array,
): void {
  acc.fill(0);
  for (let i = 0; i < n; i++) {
    const ix = 3 * i;
    for (let j = i + 1; j < n; j++) {
      const jx = 3 * j;
      const dx = pos[jx] - pos[ix];
      const dy = pos[jx + 1] - pos[ix + 1];
      const dz = pos[jx + 2] - pos[ix + 2];
      const r2 = dx * dx + dy * dy + dz * dz + soft2;
      const r = Math.sqrt(r2);
      const inv3 = 1 / (r2 * r);
      const si = G * mass[j] * inv3;
      const sj = G * mass[i] * inv3;
      acc[ix] += si * dx;
      acc[ix + 1] += si * dy;
      acc[ix + 2] += si * dz;
      acc[jx] -= sj * dx;
      acc[jx + 1] -= sj * dy;
      acc[jx + 2] -= sj * dz;
    }
  }
}

/** Total gravitational potential energy: U = -G sum_{i<j} m_i m_j / r_ij (J). */
export function potentialEnergy(
  pos: Float64Array,
  mass: Float64Array,
  n: number,
  soft2: number,
): number {
  let U = 0;
  for (let i = 0; i < n; i++) {
    const ix = 3 * i;
    for (let j = i + 1; j < n; j++) {
      const jx = 3 * j;
      const dx = pos[jx] - pos[ix];
      const dy = pos[jx + 1] - pos[ix + 1];
      const dz = pos[jx + 2] - pos[ix + 2];
      const r = Math.sqrt(dx * dx + dy * dy + dz * dz + soft2);
      U -= (G * mass[i] * mass[j]) / r;
    }
  }
  return U;
}

/** Gravitational force vector exerted ON body i BY body j (N). */
export function pairForce(
  pos: Float64Array,
  mass: Float64Array,
  i: number,
  j: number,
  soft2: number,
): [number, number, number] {
  const ix = 3 * i;
  const jx = 3 * j;
  const dx = pos[jx] - pos[ix];
  const dy = pos[jx + 1] - pos[ix + 1];
  const dz = pos[jx + 2] - pos[ix + 2];
  const r2 = dx * dx + dy * dy + dz * dz + soft2;
  const r = Math.sqrt(r2);
  const s = (G * mass[i] * mass[j]) / (r2 * r);
  return [s * dx, s * dy, s * dz];
}
