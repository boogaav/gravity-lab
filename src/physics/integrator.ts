import { computeAccelerations } from './forces';

/**
 * 4th-order Yoshida symplectic integrator (composition of three leapfrogs).
 * Symplectic integrators preserve the phase-space structure of Hamiltonian
 * systems, so energy error stays bounded (oscillates) instead of drifting
 * secularly — essential for long-term orbital stability.
 *
 * Coefficients (Yoshida 1990):
 *   w1 = 1 / (2 - 2^(1/3)),  w0 = -2^(1/3) / (2 - 2^(1/3))
 */
const CBRT2 = Math.cbrt(2);
const W1 = 1 / (2 - CBRT2);
const W0 = -CBRT2 / (2 - CBRT2);
export const YOSHIDA_C = [W1 / 2, (W0 + W1) / 2, (W0 + W1) / 2, W1 / 2];
export const YOSHIDA_D = [W1, W0, W1];

/** One Yoshida-4 substep of size h. Uses 3 force evaluations. Mutates pos/vel; `acc` is scratch. */
export function yoshida4Substep(
  pos: Float64Array,
  vel: Float64Array,
  acc: Float64Array,
  mass: Float64Array,
  n: number,
  h: number,
  soft2: number,
): void {
  const m = 3 * n;
  for (let k = 0; k < 4; k++) {
    const ch = YOSHIDA_C[k] * h;
    for (let q = 0; q < m; q++) pos[q] += ch * vel[q];
    if (k < 3) {
      computeAccelerations(pos, mass, n, soft2, acc);
      const dh = YOSHIDA_D[k] * h;
      for (let q = 0; q < m; q++) vel[q] += dh * acc[q];
    }
  }
}
