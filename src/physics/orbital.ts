import { G } from './constants';
import type { Vec3 } from './types';

/**
 * Osculating two-body orbital elements of the RELATIVE orbit of body b about body a,
 * computed from instantaneous state. Exact for an isolated pair; an approximation
 * (osculating elements) when other bodies perturb the pair.
 */
export interface PairOrbit {
  mu: number; // G(m1+m2)
  r: number; // separation, m
  vRel: number; // relative speed, m/s
  specificEnergy: number; // J/kg  (v^2/2 - mu/r)
  specificAngMom: number; // m^2/s |r x v|
  eccentricity: number;
  semiMajorAxis: number; // m (negative for hyperbolic)
  periapsis: number; // m
  apoapsis: number; // m (Infinity if unbound)
  classification: 'bound' | 'parabolic' | 'hyperbolic';
  vInfinity: number; // m/s (0 if bound)
  impactParameter: number; // m = h/vInf (hyperbolic only, else 0)
  deflectionAngle: number; // rad, total asymptote turn = 2 asin(1/e) (hyperbolic only)
  escapeVelocityHere: number; // m/s = sqrt(2 mu / r)
  relPosition: Vec3;
  relVelocity: Vec3;
  orbitNormal: Vec3; // unit vector along h
}

export function pairOrbit(
  m1: number, p1: Vec3, v1: Vec3,
  m2: number, p2: Vec3, v2: Vec3,
): PairOrbit {
  const mu = G * (m1 + m2);
  const rx = p2[0] - p1[0], ry = p2[1] - p1[1], rz = p2[2] - p1[2];
  const vx = v2[0] - v1[0], vy = v2[1] - v1[1], vz = v2[2] - v1[2];
  const r = Math.hypot(rx, ry, rz);
  const v = Math.hypot(vx, vy, vz);
  const eps = 0.5 * v * v - mu / r;
  // h = r x v
  const hx = ry * vz - rz * vy;
  const hy = rz * vx - rx * vz;
  const hz = rx * vy - ry * vx;
  const h = Math.hypot(hx, hy, hz);
  // eccentricity from e^2 = 1 + 2 eps h^2 / mu^2
  const e2 = 1 + (2 * eps * h * h) / (mu * mu);
  const e = Math.sqrt(Math.max(0, e2));
  const a = Math.abs(eps) > 1e-12 * (mu / r) ? -mu / (2 * eps) : Infinity;
  const PARABOLIC_TOL = 1e-6;
  const classification: PairOrbit['classification'] =
    Math.abs(e - 1) < PARABOLIC_TOL ? 'parabolic' : e < 1 ? 'bound' : 'hyperbolic';
  const periapsis = isFinite(a) ? Math.abs(a * (1 - e)) : (h * h) / (2 * mu); // parabola: rp = h^2/(2mu)
  const apoapsis = classification === 'bound' && isFinite(a) ? a * (1 + e) : Infinity;
  const vInf = eps > 0 ? Math.sqrt(2 * eps) : 0;
  const impactParameter = vInf > 0 ? h / vInf : 0;
  const deflectionAngle = e > 1 ? 2 * Math.asin(1 / e) : 0;
  return {
    mu, r, vRel: v,
    specificEnergy: eps,
    specificAngMom: h,
    eccentricity: e,
    semiMajorAxis: a,
    periapsis, apoapsis,
    classification,
    vInfinity: vInf,
    impactParameter,
    deflectionAngle,
    escapeVelocityHere: Math.sqrt((2 * mu) / r),
    relPosition: [rx, ry, rz],
    relVelocity: [vx, vy, vz],
    orbitNormal: h > 0 ? [hx / h, hy / h, hz / h] : [0, 0, 1],
  };
}

/** Analytical deflection estimate from impact parameter and v-infinity: delta = 2 atan(mu/(b vInf^2)). */
export function analyticDeflection(mu: number, b: number, vInf: number): number {
  if (b <= 0 || vInf <= 0) return 0;
  return 2 * Math.atan(mu / (b * vInf * vInf));
}

/** Sphere of influence (Laplace, analytical approximation): r_SOI = a (m/M)^(2/5). */
export function sphereOfInfluence(a: number, mBody: number, mPrimary: number): number {
  return a * Math.pow(mBody / mPrimary, 2 / 5);
}

/** Hill sphere (analytical approximation): r_H = a (m / 3M)^(1/3). */
export function hillSphere(a: number, mBody: number, mPrimary: number): number {
  return a * Math.cbrt(mBody / (3 * mPrimary));
}

/** Angle between two vectors, rad. */
export function angleBetween(a: Vec3, b: Vec3): number {
  const la = Math.hypot(...a), lb = Math.hypot(...b);
  if (la === 0 || lb === 0) return 0;
  const dot = (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (la * lb);
  return Math.acos(Math.min(1, Math.max(-1, dot)));
}
