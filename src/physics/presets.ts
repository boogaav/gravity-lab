import { AU, EARTH, G, JUPITER, MOON, SUN } from './constants';
import { toBarycentric } from './engine';
import type { BodySpec, CollisionMode, Vec3 } from './types';
import type { FrameSel } from './frames';

export interface Preset {
  id: string;
  name: string;
  description: string;
  bodies: BodySpec[]; // barycentric: total momentum zero unless stated
  timeScale: number; // sim-seconds per real-second (initial suggestion)
  collisionMode: CollisionMode;
  featuredPair?: [string, string]; // pair analyzed in the encounter panel
  defaultFrame: FrameSel;
  predictionDuration: number; // s of ghost-trajectory lookahead
  /** For "repeat with variation": applies a small labeled change to the ICs. */
  variation?: { label: string; apply: (bodies: BodySpec[]) => BodySpec[] };
}

let uid = 0;
function body(p: Partial<BodySpec> & Pick<BodySpec, 'name' | 'mass' | 'radius' | 'position' | 'velocity'>): BodySpec {
  return {
    id: p.id ?? `${p.name.toLowerCase().replace(/\s+/g, '-')}-${uid++}`,
    type: p.type ?? 'planet',
    color: p.color ?? '#8fb4ff',
    showTrail: p.showTrail ?? true,
    showVectors: p.showVectors ?? true,
    ...p,
  } as BodySpec;
}

/** Relative circular/elliptical two-body velocities split about the COM. */
function twoBodyOrbit(): BodySpec[] {
  const M = 1.9885e30, m = 9.5e28; // star + heavy companion (~5% mass) so the star's motion is visible
  const a = AU, e = 0.4;
  const rApo = a * (1 + e);
  const mu = G * (M + m);
  const vApo = Math.sqrt((mu * (1 - e)) / (a * (1 + e))); // relative speed at apoapsis
  return toBarycentric([
    body({ id: 'star', name: 'Star', type: 'star', mass: M, radius: SUN.radius, color: '#ffd27a',
      position: [0, 0, 0], velocity: [0, -vApo * (m / (M + m)), 0] }),
    body({ id: 'planet', name: 'Companion', type: 'planet', mass: m, radius: 7.1e7, color: '#7ad0ff',
      position: [rApo, 0, 0], velocity: [0, vApo * (M / (M + m)), 0] }),
  ]);
}

function mutualFlyby(): BodySpec[] {
  const m = 5e27, R = 7.2e7;
  const vx = 6000, b = 5e9, d = 2.4e10;
  return toBarycentric([
    body({ id: 'p1', name: 'Rogue A', mass: m, radius: R, color: '#7ad0ff',
      position: [-d, -b / 2, 0], velocity: [vx, 0, 0] }),
    body({ id: 'p2', name: 'Rogue B', mass: m, radius: R, color: '#ff9d7a',
      position: [d, b / 2, 0], velocity: [-vx, 0, 0] }),
  ]);
}

function jupiterAssist(): BodySpec[] {
  const aJ = JUPITER.a, vJ = Math.sqrt((G * (SUN.mass + JUPITER.mass)) / aJ);
  // Spacecraft defined in Jupiter's frame: vInf = 6 km/s along +x, offset -y so it
  // passes BEHIND Jupiter (Jupiter moves +y) and gains heliocentric energy.
  const vInf = 6000, d = 1.5e10;
  const muJ = G * JUPITER.mass;
  const rp = 4e8; // target periapsis ~5.7 Jupiter radii
  const e = 1 + (rp * vInf * vInf) / muJ;
  const bImp = (muJ / (vInf * vInf)) * Math.sqrt(e * e - 1);
  const vApproach = Math.sqrt(vInf * vInf + (2 * muJ) / d); // energy-consistent speed at distance d
  return toBarycentric([
    body({ id: 'sun', name: 'Sun', type: 'star', mass: SUN.mass, radius: SUN.radius, color: '#ffd27a',
      position: [0, 0, 0], velocity: [0, 0, 0] }),
    body({ id: 'jupiter', name: 'Jupiter', type: 'planet', mass: JUPITER.mass, radius: JUPITER.radius, color: '#e8b98a',
      position: [aJ, 0, 0], velocity: [0, vJ, 0] }),
    body({ id: 'craft', name: 'Voyager', type: 'spacecraft', mass: 825, radius: 4, color: '#9dffb0',
      position: [aJ - d, -bImp, 0], velocity: [vApproach, vJ, 0] }),
  ]);
}

function earthMoonCraft(): BodySpec[] {
  const muE = G * EARTH.mass;
  const rp = 6.578e6; // 200 km altitude perigee
  const ra = 3.9e8; // apogee just past the Moon's orbit
  const a = (rp + ra) / 2;
  const vp = Math.sqrt(muE * (2 / rp - 1 / a));
  const tTransfer = Math.PI * Math.sqrt((a * a * a) / muE); // half-period to apogee
  const nMoon = MOON.vOrbit / MOON.a;
  const phase = Math.PI - nMoon * tTransfer; // Moon arrives near apogee as the craft does
  const mp: Vec3 = [MOON.a * Math.cos(phase), MOON.a * Math.sin(phase), 0];
  const mv: Vec3 = [-MOON.vOrbit * Math.sin(phase), MOON.vOrbit * Math.cos(phase), 0];
  return toBarycentric([
    body({ id: 'earth', name: 'Earth', type: 'planet', mass: EARTH.mass, radius: EARTH.radius, color: '#6fa8ff',
      position: [0, 0, 0], velocity: [0, 0, 0] }),
    body({ id: 'moon', name: 'Moon', type: 'moon', mass: MOON.mass, radius: MOON.radius, color: '#cfcfcf',
      position: mp, velocity: mv }),
    body({ id: 'craft', name: 'Probe', type: 'spacecraft', mass: 2000, radius: 3, color: '#9dffb0',
      position: [rp, 0, 0], velocity: [0, vp, 0] }),
  ]);
}

function binaryEncounter(): BodySpec[] {
  const m1 = 1.5e30, m2 = 1.0e30, sep = 0.4 * AU;
  const mu = G * (m1 + m2);
  const vRel = Math.sqrt(mu / sep);
  const f1 = m2 / (m1 + m2), f2 = m1 / (m1 + m2);
  return toBarycentric([
    body({ id: 'a', name: 'Binary A', type: 'star', mass: m1, radius: 8e8, color: '#ffd27a',
      position: [-sep * f1, 0, 0], velocity: [0, -vRel * f1, 0] }),
    body({ id: 'b', name: 'Binary B', type: 'star', mass: m2, radius: 6.5e8, color: '#ff8f6b',
      position: [sep * f2, 0, 0], velocity: [0, vRel * f2, 0] }),
    body({ id: 'intruder', name: 'Intruder', type: 'star', mass: 8e29, radius: 6e8, color: '#b48fff',
      position: [-4 * AU, 1.2 * AU, 0], velocity: [20000, -4000, 0] }),
  ]);
}

function chaoticThreeBody(delta = 0): BodySpec[] {
  const m = 1e30, R = 6.5e8;
  return toBarycentric([
    body({ id: 'c1', name: 'Alpha', type: 'star', mass: m, radius: R, color: '#ffd27a',
      position: [-4e10 + delta, 0, 0], velocity: [0, -2500, 0] }),
    body({ id: 'c2', name: 'Beta', type: 'star', mass: m, radius: R, color: '#7ad0ff',
      position: [4e10, 0, 0], velocity: [0, 2500, 0] }),
    body({ id: 'c3', name: 'Gamma', type: 'star', mass: m, radius: R, color: '#ff8f6b',
      position: [0, 6.5e10, 0], velocity: [1800, 0, 0] }),
  ]);
}

function collisionOrFlyby(b: number): BodySpec[] {
  const m = 3e25, R = 1e7, v = 3000, d = 1.5e9;
  return toBarycentric([
    body({ id: 'r1', name: 'Impactor A', mass: m, radius: R, color: '#7ad0ff',
      position: [-d, -b / 2, 0], velocity: [v, 0, 0] }),
    body({ id: 'r2', name: 'Impactor B', mass: m, radius: R, color: '#ff9d7a',
      position: [d, b / 2, 0], velocity: [-v, 0, 0] }),
  ]);
}

function escapeThreshold(): BodySpec[] {
  const M = 6e24, R = 6.371e6, r0 = 2e7;
  const vEsc = Math.sqrt((2 * G * M) / r0);
  const probe = (id: string, name: string, factor: number, z: number, color: string) =>
    body({ id, name, type: 'spacecraft', mass: 1, radius: 2, color,
      position: [r0, 0, z], velocity: [0, factor * vEsc, 0] });
  // NOT barycentric on purpose: probes are 1 kg, planet at rest is effectively the COM.
  return [
    body({ id: 'planet', name: 'Planet', type: 'planet', mass: M, radius: R, color: '#6fa8ff',
      position: [0, 0, 0], velocity: [0, 0, 0] }),
    probe('probe-sub', 'Sub-escape (0.85 v_esc)', 0.85, -3e5, '#ff8f6b'),
    probe('probe-at', 'At escape (1.00 v_esc)', 1.0, 0, '#ffd27a'),
    probe('probe-super', 'Super-escape (1.15 v_esc)', 1.15, 3e5, '#9dffb0'),
  ];
}

function sandboxWorld(): BodySpec[] {
  const M = 1.5e30;
  const m = 6e24, a = 8e10;
  const mu = G * (M + m);
  const vRel = Math.sqrt(mu / a);
  return toBarycentric([
    body({ id: 'sol', name: 'Sol', type: 'star', mass: M, radius: 6.5e8, color: '#ffd27a',
      position: [0, 0, 0], velocity: [0, -vRel * (m / (M + m)), 0] }),
    body({ id: 'home', name: 'Home', type: 'planet', mass: m, radius: 6.4e6, color: '#6fa8ff',
      position: [a, 0, 0], velocity: [0, vRel * (M / (M + m)), 0] }),
  ]);
}

export const PRESETS: Preset[] = [
  {
    id: 'sandbox',
    name: '0 · Sandbox — drop worlds',
    description: 'A star and one planet to get you started. Press and hold in empty space to grow a new body (longer hold = more mass, from asteroid to star), drag to aim its velocity, release to launch. Everything obeys the same N-body gravity.',
    bodies: sandboxWorld(),
    timeScale: 3e5, collisionMode: 'merge',
    featuredPair: ['sol', 'home'], defaultFrame: { kind: 'inertial' },
    predictionDuration: 3e7,
  },
  {
    id: 'two-body',
    name: '1 · Two-Body Orbit',
    description: 'A star and a heavy companion orbit their shared center of mass on an e=0.4 ellipse. Watch kinetic and potential energy trade back and forth each orbit while their sum stays constant.',
    bodies: twoBodyOrbit(),
    timeScale: 2e6, collisionMode: 'stop',
    featuredPair: ['star', 'planet'], defaultFrame: { kind: 'com' },
    predictionDuration: 4e7,
  },
  {
    id: 'mutual-flyby',
    name: '2 · Mutual Planetary Flyby',
    description: 'Two free planets on unbound trajectories swing past each other. Both paths bend around the common center of mass — neither body is a fixed anchor.',
    bodies: mutualFlyby(),
    timeScale: 4e5, collisionMode: 'stop',
    featuredPair: ['p1', 'p2'], defaultFrame: { kind: 'com' },
    predictionDuration: 1.2e7,
    variation: {
      label: 'Halve the impact parameter',
      apply: (bs) => bs.map((b) => ({ ...b, position: [b.position[0], b.position[1] / 2, b.position[2]] as Vec3 })),
    },
  },
  {
    id: 'jupiter-assist',
    name: '3 · Jupiter Gravity Assist',
    description: 'A spacecraft passes behind Jupiter (relative to its orbital motion) and steals a little of its orbital momentum, gaining heliocentric energy. Switch between the Jupiter-centered and Sun-centered frames to see why: in Jupiter\'s frame speed in ≈ speed out, only the direction turns.',
    bodies: jupiterAssist(),
    timeScale: 4e5, collisionMode: 'stop',
    featuredPair: ['jupiter', 'craft'], defaultFrame: { kind: 'body', id: 'jupiter' },
    predictionDuration: 1e7,
    variation: {
      label: 'Pass ahead of Jupiter instead (lose energy)',
      apply: (bs) => bs.map((b) =>
        b.id === 'craft' ? { ...b, position: [b.position[0], -b.position[1] + 2 * bs.find(x => x.id === 'jupiter')!.position[1], b.position[2]] as Vec3 } : b),
    },
  },
  {
    id: 'earth-moon',
    name: '4 · Earth–Moon–Spacecraft',
    description: 'A probe on a highly eccentric geocentric orbit reaches apogee just as the Moon arrives. The Moon\'s gravity visibly perturbs the geocentric trajectory.',
    bodies: earthMoonCraft(),
    timeScale: 2e4, collisionMode: 'stop',
    featuredPair: ['moon', 'craft'], defaultFrame: { kind: 'body', id: 'earth' },
    predictionDuration: 1.8e6,
  },
  {
    id: 'binary-encounter',
    name: '5 · Binary Star Encounter',
    description: 'A third star dives through a tight binary. Energy and momentum slosh between all three bodies — one star may be ejected while the others bind tighter.',
    bodies: binaryEncounter(),
    timeScale: 1.5e6, collisionMode: 'merge',
    featuredPair: ['a', 'b'], defaultFrame: { kind: 'com' },
    predictionDuration: 6e7,
  },
  {
    id: 'chaotic-three',
    name: '6 · Chaotic Three-Body',
    description: 'Three comparable stars in a sensitive configuration. Use "Repeat with variation" to shift one star by 1000 km and watch the trajectories diverge — deterministic chaos.',
    bodies: chaoticThreeBody(),
    timeScale: 1.5e6, collisionMode: 'merge',
    featuredPair: ['c1', 'c2'], defaultFrame: { kind: 'com' },
    predictionDuration: 5e7,
    variation: { label: 'Shift Alpha by 1000 km', apply: () => chaoticThreeBody(1e6) },
  },
  {
    id: 'flyby-deflect',
    name: '7a · Close Flyby (deflection)',
    description: 'Two rocky worlds pass with an impact parameter large enough that gravitational focusing bends them ~86° but they never touch. Compare with 7b.',
    bodies: collisionOrFlyby(1.2e8),
    timeScale: 3e4, collisionMode: 'merge',
    featuredPair: ['r1', 'r2'], defaultFrame: { kind: 'com' },
    predictionDuration: 2e6,
  },
  {
    id: 'flyby-collide',
    name: '7b · Collision (same encounter, smaller offset)',
    description: 'The identical encounter with the aim offset reduced from 120,000 km to 30,000 km: gravitational focusing pulls the periapsis inside the combined radii and the bodies merge, conserving mass and momentum.',
    bodies: collisionOrFlyby(3e7),
    timeScale: 3e4, collisionMode: 'merge',
    featuredPair: ['r1', 'r2'], defaultFrame: { kind: 'com' },
    predictionDuration: 2e6,
  },
  {
    id: 'escape',
    name: '8 · Escape Threshold',
    description: 'Three 1 kg probes launched at 0.85×, 1.00× and 1.15× the local escape velocity: bound ellipse, near-parabolic edge case, and hyperbolic escape.',
    bodies: escapeThreshold(),
    timeScale: 6e3, collisionMode: 'stop',
    featuredPair: ['planet', 'probe-at'], defaultFrame: { kind: 'body', id: 'planet' },
    predictionDuration: 4e5,
  },
];

export function getPreset(id: string): Preset {
  const p = PRESETS.find((x) => x.id === id);
  if (!p) throw new Error(`Unknown preset ${id}`);
  return p;
}
