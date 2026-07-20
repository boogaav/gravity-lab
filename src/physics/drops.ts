import type { BodySpec, BodyType, Vec3 } from './types';

/**
 * Sandbox "drops": hold time maps to mass on a log scale (~1.45 decades/sec),
 * from a small asteroid (1e22 kg) up to a star (2.5e30 kg ≈ 1.26 M☉).
 * Radii follow rough real-world mass–radius relations per regime, and are the
 * REAL radii used for collision physics — not just visuals.
 */
export const MAX_HOLD_SEC = 6;

export interface DropTier {
  mass: number;
  radius: number;
  type: BodyType;
  color: string;
  label: string;
}

export function dropFromHold(holdSec: number): DropTier {
  const h = Math.min(Math.max(holdSec, 0), MAX_HOLD_SEC);
  const mass = Math.min(1e22 * Math.pow(10, 1.45 * h), 2.5e30);
  if (mass < 1e24) {
    return { mass, radius: 4e5 * Math.cbrt(mass / 1e22), type: 'asteroid', color: '#b8a68f', label: 'asteroid' };
  }
  if (mass < 5e26) {
    return { mass, radius: 6.4e6 * Math.cbrt(mass / 6e24), type: 'planet', color: '#6fa8ff', label: 'rocky planet' };
  }
  if (mass < 5e28) {
    return { mass, radius: 7e7 * Math.cbrt(mass / 1.9e27), type: 'planet', color: '#e8b98a', label: 'gas giant' };
  }
  return { mass, radius: 7e8 * Math.pow(mass / 2e30, 0.8), type: 'star', color: '#ffd27a', label: 'star' };
}

let dropSeq = 0;

export function makeDrop(holdSec: number, position: Vec3, velocity: Vec3): BodySpec {
  const tier = dropFromHold(holdSec);
  dropSeq += 1;
  return {
    id: `drop-${Date.now().toString(36)}-${dropSeq}`,
    name: `Drop ${dropSeq}`,
    type: tier.type,
    mass: tier.mass,
    radius: tier.radius,
    position,
    velocity,
    color: tier.color,
    showTrail: true,
    showVectors: true,
  };
}
