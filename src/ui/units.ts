import { AU, DAY, YEAR } from '../physics/constants';

/** Human-friendly display of SI quantities. Physics stays SI; only display converts. */

export function sci(x: number, digits = 3): string {
  if (!isFinite(x)) return x > 0 ? '∞' : x < 0 ? '−∞' : 'NaN';
  if (x === 0) return '0';
  const exp = Math.floor(Math.log10(Math.abs(x)));
  if (exp >= -2 && exp < 5) return x.toPrecision(digits);
  return x.toExponential(digits - 1).replace('e+', 'e');
}

export function fmtDistance(m: number): string {
  const a = Math.abs(m);
  if (a >= 0.05 * AU) return `${sci(m / AU)} AU`;
  if (a >= 1e6) return `${sci(m / 1e6)} thousand km`;
  if (a >= 1e3) return `${sci(m / 1e3)} km`;
  return `${sci(m)} m`;
}

export function fmtSpeed(ms: number): string {
  const a = Math.abs(ms);
  if (a >= 100) return `${sci(ms / 1e3)} km/s`;
  return `${sci(ms)} m/s`;
}

export function fmtTime(s: number): string {
  const a = Math.abs(s);
  if (a >= 2 * YEAR) return `${sci(s / YEAR)} yr`;
  if (a >= 2 * DAY) return `${sci(s / DAY)} d`;
  if (a >= 2 * 3600) return `${sci(s / 3600)} h`;
  if (a >= 120) return `${sci(s / 60)} min`;
  return `${sci(s)} s`;
}

export function fmtMass(kg: number): string {
  if (kg >= 1e28) return `${sci(kg / 1.9885e30)} M☉`;
  if (kg >= 1e23) return `${sci(kg / 5.9722e24)} M⊕`;
  return `${sci(kg)} kg`;
}

export function fmtEnergy(j: number): string {
  return `${sci(j)} J`;
}

export function fmtAngle(rad: number): string {
  return `${(rad * 180 / Math.PI).toFixed(2)}°`;
}

export function fmtPct(x: number, digits = 2): string {
  return `${(x * 100).toExponential(digits)}%`;
}
