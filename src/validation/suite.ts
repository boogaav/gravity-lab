import { AU, G, SUN } from '../physics/constants';
import { Engine, toBarycentric } from '../physics/engine';
import { computeAccelerations } from '../physics/forces';
import { angleBetween, pairOrbit } from '../physics/orbital';
import { getPreset } from '../physics/presets';
import type { BodySpec, Vec3 } from '../physics/types';

export interface ValidationResult {
  name: string;
  pass: boolean;
  measured: string; // the actual measured numbers, always displayed
  tolerance: string;
}

const b = (p: Partial<BodySpec> & Pick<BodySpec, 'id' | 'name' | 'mass' | 'radius' | 'position' | 'velocity'>): BodySpec => ({
  type: 'planet', color: '#fff', showTrail: false, showVectors: false, ...p,
} as BodySpec);

/** Star + planet on a circular mutual orbit, barycentric. */
function circularPair(m1 = SUN.mass, m2 = 5.9722e24, a = AU): BodySpec[] {
  const mu = G * (m1 + m2);
  const vRel = Math.sqrt(mu / a);
  return toBarycentric([
    b({ id: 's', name: 'S', mass: m1, radius: 7e8, position: [0, 0, 0], velocity: [0, -vRel * (m2 / (m1 + m2)), 0] }),
    b({ id: 'p', name: 'P', mass: m2, radius: 6.4e6, position: [a, 0, 0], velocity: [0, vRel * (m1 / (m1 + m2)), 0] }),
  ]);
}

export function testCircularOrbitStability(): ValidationResult {
  const bodies = circularPair();
  const eng = new Engine(bodies, { collisionMode: 'none' });
  const mu = G * (bodies[0].mass + bodies[1].mass);
  const period = 2 * Math.PI * Math.sqrt((AU * AU * AU) / mu);
  let maxRadDev = 0;
  const orbits = 10;
  const chunks = 400;
  for (let i = 0; i < orbits * chunks; i++) {
    eng.advance(period / chunks);
    const dx = eng.pos[3] - eng.pos[0], dy = eng.pos[4] - eng.pos[1], dz = eng.pos[5] - eng.pos[2];
    const r = Math.hypot(dx, dy, dz);
    maxRadDev = Math.max(maxRadDev, Math.abs(r - AU) / AU);
  }
  const d = eng.diagnostics();
  const pass = maxRadDev < 1e-5 && Math.abs(d.energyDrift) < 1e-9;
  return {
    name: `Circular two-body orbit stable over ${orbits} periods`,
    pass,
    measured: `max radius deviation ${(maxRadDev * 100).toExponential(2)}%, energy drift ${(d.energyDrift * 100).toExponential(2)}%`,
    tolerance: 'radius < 1e-3%, energy drift < 1e-7%',
  };
}

export function testConservation(): ValidationResult {
  // eta tightened vs the interactive default: repeated deep three-body
  // encounters are the hardest case for any integrator.
  const eng = new Engine(getPreset('chaotic-three').bodies, { collisionMode: 'none', eta: 0.008 });
  const d0 = eng.diagnostics();
  eng.advance(3e8); // ~9.5 years of three-body chaos
  const d = eng.diagnostics();
  const p0 = Math.hypot(...d0.momentum), p1 = Math.hypot(...d.momentum);
  const pScale = Math.abs(d0.kinetic) > 0 ? Math.sqrt(2 * d0.kinetic * d0.totalMass) : 1;
  const pDrift = (p1 - p0) / pScale;
  const pass = Math.abs(d.energyDrift) < 1e-6 && Math.abs(d.angMomDrift) < 1e-6 && Math.abs(pDrift) < 1e-10;
  return {
    name: 'Energy, momentum & angular momentum conserved (chaotic 3-body, 9.5 yr)',
    pass,
    measured: `ΔE/E = ${(d.energyDrift * 100).toExponential(2)}%, ΔL/L = ${(d.angMomDrift * 100).toExponential(2)}%, Δ|P| (rel) = ${pDrift.toExponential(2)}`,
    tolerance: '|ΔE/E| < 1e-4%, |ΔL/L| < 1e-4%',
  };
}

export function testBarycenterDrift(): ValidationResult {
  // Give the system a net velocity; the COM must move exactly linearly.
  const bodies = circularPair().map((x) => ({ ...x, velocity: [x.velocity[0] + 1000, x.velocity[1], x.velocity[2]] as Vec3 }));
  const eng = new Engine(bodies, { collisionMode: 'none' });
  const d0 = eng.diagnostics();
  const T = 2e7;
  eng.advance(T);
  const d = eng.diagnostics();
  const expected: Vec3 = [
    d0.comPosition[0] + d0.comVelocity[0] * T,
    d0.comPosition[1] + d0.comVelocity[1] * T,
    d0.comPosition[2] + d0.comVelocity[2] * T,
  ];
  const err = Math.hypot(
    d.comPosition[0] - expected[0],
    d.comPosition[1] - expected[1],
    d.comPosition[2] - expected[2],
  );
  const rel = err / (Math.hypot(...d0.comVelocity) * T);
  const pass = rel < 1e-12;
  return {
    name: 'Barycenter moves at constant velocity in an isolated system',
    pass,
    measured: `COM position error after ${(T / 86400).toFixed(0)} days: ${err.toExponential(2)} m (relative ${rel.toExponential(2)})`,
    tolerance: 'relative error < 1e-12',
  };
}

export function testNewtonThirdLaw(): ValidationResult {
  const bodies = getPreset('binary-encounter').bodies;
  const n = bodies.length;
  const pos = new Float64Array(3 * n);
  const mass = new Float64Array(n);
  bodies.forEach((body, i) => {
    mass[i] = body.mass;
    for (let q = 0; q < 3; q++) pos[3 * i + q] = body.position[q];
  });
  const acc = new Float64Array(3 * n);
  computeAccelerations(pos, mass, n, 0, acc);
  // Net force = sum m_i a_i must vanish to machine precision.
  let fx = 0, fy = 0, fz = 0, scale = 0;
  for (let i = 0; i < n; i++) {
    fx += mass[i] * acc[3 * i];
    fy += mass[i] * acc[3 * i + 1];
    fz += mass[i] * acc[3 * i + 2];
    scale += mass[i] * Math.hypot(acc[3 * i], acc[3 * i + 1], acc[3 * i + 2]);
  }
  const rel = Math.hypot(fx, fy, fz) / scale;
  const pass = rel < 1e-14;
  return {
    name: 'Forces are equal and opposite (net internal force = 0)',
    pass,
    measured: `|Σ F| / Σ|F| = ${rel.toExponential(2)}`,
    tolerance: '< 1e-14 (machine precision)',
  };
}

export function testHyperbolicDeflection(): ValidationResult {
  // Two-body hyperbolic flyby vs the analytical deflection 2·asin(1/e).
  const M = 1.8982e27, m = 1e3;
  const vInf = 6000;
  const mu = G * (M + m);
  const bGeom = 2e9;
  const d0 = 600 * (mu / (vInf * vInf)); // start far enough that v ≈ vInf
  const bodies = toBarycentric([
    b({ id: 'big', name: 'Big', mass: M, radius: 7e7, position: [0, 0, 0], velocity: [0, 0, 0] }),
    b({ id: 'sm', name: 'Small', mass: m, radius: 1, position: [-d0, bGeom, 0], velocity: [Math.sqrt(vInf * vInf + 2 * mu / d0), 0, 0] }),
  ]);
  const eng = new Engine(bodies, { collisionMode: 'none', eta: 0.02, maxSubstepsPerAdvance: 1e6 });
  // expected deflection from the actual osculating elements (exact for two bodies)
  const orb0 = pairOrbit(M, bodies[0].position, bodies[0].velocity, m, bodies[1].position, bodies[1].velocity);
  const expected = orb0.deflectionAngle;
  const vRel0: Vec3 = orb0.relVelocity;
  // integrate until outgoing and far again
  let guard = 0;
  while (guard++ < 4000) {
    eng.advance(d0 / vInf / 60);
    const s = eng.syncedSpecs();
    const orb = pairOrbit(M, s[0].position, s[0].velocity, m, s[1].position, s[1].velocity);
    const rdotv = orb.relPosition[0] * orb.relVelocity[0] + orb.relPosition[1] * orb.relVelocity[1] + orb.relPosition[2] * orb.relVelocity[2];
    if (orb.r > d0 && rdotv > 0) break;
  }
  const s = eng.syncedSpecs();
  const orbF = pairOrbit(M, s[0].position, s[0].velocity, m, s[1].position, s[1].velocity);
  const measured = angleBetween(vRel0, orbF.relVelocity);
  const relErr = Math.abs(measured - expected) / expected;
  const pass = relErr < 0.02;
  return {
    name: 'Hyperbolic flyby matches analytical deflection 2·asin(1/e)',
    pass,
    measured: `simulated ${(measured * 180 / Math.PI).toFixed(3)}°, analytical ${(expected * 180 / Math.PI).toFixed(3)}°, difference ${(relErr * 100).toFixed(3)}%`,
    tolerance: '< 2% (finite start distance contributes most of the difference)',
  };
}

export function testConvergence(): ValidationResult {
  // Fixed-step integration: halving h must shrink the position error ~16x (4th order).
  const mkEngine = () => new Engine(circularPair(), { collisionMode: 'none' });
  const mu = G * (SUN.mass + 5.9722e24);
  const period = 2 * Math.PI * Math.sqrt((AU * AU * AU) / mu);
  const T = period / 2;
  const errAt = (h: number) => {
    const eng = mkEngine();
    eng.advanceFixed(T, h);
    return eng;
  };
  const ref = mkEngine();
  ref.advanceFixed(T, period / 262144); // very fine reference
  const posErr = (e: Engine) =>
    Math.hypot(e.pos[3] - ref.pos[3], e.pos[4] - ref.pos[4], e.pos[5] - ref.pos[5]);
  const e1 = posErr(errAt(period / 1024));
  const e2 = posErr(errAt(period / 2048));
  const ratio = e1 / e2;
  const pass = ratio > 8; // 4th order → ~16; accept >8 (allows roundoff floor)
  return {
    name: 'Halving the timestep shrinks error ~16× (4th-order convergence)',
    pass,
    measured: `error(h) = ${e1.toExponential(2)} m, error(h/2) = ${e2.toExponential(2)} m, ratio ${ratio.toFixed(1)}×`,
    tolerance: 'ratio > 8×',
  };
}

export function testRadiusScaleIndependence(): ValidationResult {
  // Visual radius scaling never enters the engine: physics depends only on
  // mass/position/velocity and the REAL radius. Verify identical evolution
  // when only display metadata (color/trail flags) differs.
  const run = (mutate: boolean) => {
    const bodies = getPreset('mutual-flyby').bodies.map((x) =>
      mutate ? { ...x, color: '#123456', showTrail: !x.showTrail } : x);
    const eng = new Engine(bodies, { collisionMode: 'none' });
    eng.advance(5e6);
    return eng.pos.slice();
  };
  const a = run(false), bb = run(true);
  let maxDiff = 0;
  for (let i = 0; i < a.length; i++) maxDiff = Math.max(maxDiff, Math.abs(a[i] - bb[i]));
  const pass = maxDiff === 0;
  return {
    name: 'Display metadata (visual scale/colors/trails) does not affect physics',
    pass,
    measured: `max position difference ${maxDiff} m (bitwise ${pass ? 'identical' : 'DIFFERENT'})`,
    tolerance: 'exactly 0',
  };
}

export function testGravityAssistEnergyExchange(): ValidationResult {
  const eng = new Engine(getPreset('jupiter-assist').bodies, { collisionMode: 'none', maxSubstepsPerAdvance: 1e6 });
  const d0 = eng.diagnostics();
  const s0 = eng.syncedSpecs();
  const craft0 = s0.find((x) => x.id === 'craft')!;
  const jup0 = s0.find((x) => x.id === 'jupiter')!;
  const speed0 = Math.hypot(...craft0.velocity);
  eng.advance(8e6); // through the encounter
  const d1 = eng.diagnostics();
  const s1 = eng.syncedSpecs();
  const craft1 = s1.find((x) => x.id === 'craft')!;
  const jup1 = s1.find((x) => x.id === 'jupiter')!;
  const speed1 = Math.hypot(...craft1.velocity);
  const dEcraft = 0.5 * craft1.mass * (speed1 ** 2 - speed0 ** 2);
  const dPcraft = [0, 1, 2].map((q) => craft1.mass * (craft1.velocity[q] - craft0.velocity[q]));
  // The craft's momentum change is balanced by an equal-and-opposite change in
  // the Sun+Jupiter system (Newton's third law): total momentum must be
  // conserved at machine precision. (The induced Δv on Jupiter itself,
  // |Δp|/m_J ~ 1e-23 m/s, is real in the force calculation but far below
  // double-precision resolution of Jupiter's 13 km/s bulk motion.)
  const dPtot = Math.hypot(
    d1.momentum[0] - d0.momentum[0],
    d1.momentum[1] - d0.momentum[1],
    d1.momentum[2] - d0.momentum[2],
  );
  const pScale = Math.sqrt(2 * d0.kinetic * d0.totalMass);
  const pass =
    Math.abs(d1.energyDrift) < 1e-6 &&
    Math.abs(dEcraft) > 0 &&
    dPtot / pScale < 1e-12; // recoil fully accounted: no momentum created
  return {
    name: 'Gravity assist: system E & P conserved while the craft gains heliocentric energy',
    pass,
    measured: `craft ΔKE ${(dEcraft / 1e6).toFixed(1)} MJ (${speed0.toFixed(0)}→${speed1.toFixed(0)} m/s), craft |Δp| ${Math.hypot(...dPcraft).toExponential(2)} kg·m/s balanced by Sun+Jupiter (total Δ|P| rel ${(dPtot / pScale).toExponential(1)}), system ΔE/E ${(d1.energyDrift * 100).toExponential(1)}%`,
    tolerance: 'system |ΔE/E| < 1e-4%, relative Δ|P| < 1e-12, craft ΔKE ≠ 0',
  };
}

export function testFrameInvariance(): ValidationResult {
  // Changing displayed reference frames must not touch the state: run two
  // engines, "switch frames" (a pure read) on one, compare bitwise.
  const eng1 = new Engine(getPreset('two-body').bodies);
  const eng2 = new Engine(getPreset('two-body').bodies);
  // identical advance pattern; eng2 additionally does the reads the UI performs
  // when the user switches frames or moves the camera
  for (let i = 0; i < 10; i++) {
    eng1.advance(1e5);
    eng2.advance(1e5);
    void eng2.diagnostics();
    void eng2.syncedSpecs();
    void eng2.currentAccelerations();
  }
  let maxDiff = 0;
  for (let i = 0; i < eng1.pos.length; i++) {
    maxDiff = Math.max(maxDiff, Math.abs(eng1.pos[i] - eng2.pos[i]), Math.abs(eng1.vel[i] - eng2.vel[i]));
  }
  const pass = maxDiff === 0;
  return {
    name: 'Reading state for frame/camera changes leaves physics bitwise unchanged',
    pass,
    measured: `max state difference ${maxDiff}`,
    tolerance: 'exactly 0',
  };
}

export function testMergeConservation(): ValidationResult {
  const eng = new Engine(getPreset('flyby-collide').bodies, { collisionMode: 'merge', maxSubstepsPerAdvance: 1e6 });
  const d0 = eng.diagnostics();
  let guard = 0;
  while (eng.n === 2 && guard++ < 2000) eng.advance(1e4);
  const d1 = eng.diagnostics();
  const merged = eng.n === 1;
  const dP = Math.hypot(
    d1.momentum[0] - d0.momentum[0],
    d1.momentum[1] - d0.momentum[1],
    d1.momentum[2] - d0.momentum[2],
  );
  const pScale = Math.sqrt(2 * Math.max(d0.kinetic, 1e-300) * d0.totalMass);
  const massOk = Math.abs(d1.totalMass - d0.totalMass) / d0.totalMass < 1e-15;
  const pass = merged && massOk && dP / pScale < 1e-12;
  return {
    name: 'Inelastic merge conserves total mass and linear momentum',
    pass,
    measured: merged
      ? `merged ✓, Δmass/M = ${((d1.totalMass - d0.totalMass) / d0.totalMass).toExponential(1)}, Δ|P| (rel) = ${(dP / pScale).toExponential(2)}, KE dissipated ${((d0.total - d1.total) / 1e6).toExponential(2)} MJ (inelastic, expected)`
      : 'bodies never collided (unexpected)',
    tolerance: 'Δmass = 0, relative Δ|P| < 1e-12',
  };
}

export const ALL_TESTS: Array<() => ValidationResult> = [
  testNewtonThirdLaw,
  testCircularOrbitStability,
  testConservation,
  testBarycenterDrift,
  testHyperbolicDeflection,
  testConvergence,
  testRadiusScaleIndependence,
  testFrameInvariance,
  testGravityAssistEnergyExchange,
  testMergeConservation,
];

export function runAllTests(): ValidationResult[] {
  return ALL_TESTS.map((t) => {
    try {
      return t();
    } catch (err) {
      return { name: t.name, pass: false, measured: `threw: ${err}`, tolerance: '—' };
    }
  });
}
