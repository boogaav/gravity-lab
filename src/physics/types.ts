export type Vec3 = [number, number, number];

export type BodyType = 'star' | 'planet' | 'moon' | 'asteroid' | 'spacecraft' | 'particle';

/** Full editable specification of one body. SI units throughout. */
export interface BodySpec {
  id: string;
  name: string;
  type: BodyType;
  mass: number; // kg
  radius: number; // m — REAL physical radius, used for collisions. Never visual.
  position: Vec3; // m
  velocity: Vec3; // m/s
  color: string;
  showTrail: boolean;
  showVectors: boolean;
}

export type CollisionMode = 'stop' | 'merge' | 'elastic' | 'none';

export interface EngineConfig {
  /** Adaptive accuracy factor: substep h = eta * (shortest local gravitational timescale). */
  eta: number;
  /** Plummer softening length (m). 0 = physically correct celestial mode. */
  softening: number;
  collisionMode: CollisionMode;
  /** Cap on substeps per advance() call, to keep a real-time tick bounded. */
  maxSubstepsPerAdvance: number;
  /** Hard bounds on the substep (s). */
  minDt: number;
  maxDt: number;
}

export interface CollisionEvent {
  time: number;
  aId: string;
  bId: string;
  aName: string;
  bName: string;
  mode: CollisionMode;
  relSpeed: number; // m/s at contact
  impactEnergy: number; // J, kinetic energy in the pair's COM frame at contact
  position: Vec3; // m, contact point on the line of centers (for illustrative FX only)
}

export interface Diagnostics {
  time: number;
  kinetic: number; // J
  potential: number; // J
  total: number; // J
  momentum: Vec3; // kg m/s
  angularMomentum: Vec3; // kg m^2/s (about origin)
  comPosition: Vec3;
  comVelocity: Vec3;
  totalMass: number;
  /** Fractional drift since the run's initial conditions. */
  energyDrift: number;
  angMomDrift: number;
  perBodyKinetic: number[];
}
