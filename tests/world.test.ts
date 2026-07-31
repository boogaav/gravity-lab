import { describe, expect, it } from 'vitest';
import { decodeWorld, encodeWorld, isValidSlug, slugify } from '../src/state/worldCodec';
import { analyzeWorld } from '../src/physics/analyze';
import { getPreset } from '../src/physics/presets';
import { toBarycentric } from '../src/physics/engine';
import { YEAR } from '../src/physics/constants';
import type { BodySpec, Vec3 } from '../src/physics/types';
import type { WorldConfigSlice } from '../src/state/worldCodec';

const cfg: WorldConfigSlice = {
  timeScale: 3e5,
  collisionMode: 'merge',
  radiusScale: 10,
  eta: 0.03,
  softening: 0,
  trailLength: 800,
  showVelocity: false,
  showAcceleration: false,
  showForces: false,
  showGrid: true,
  showLabels: false,
  showCom: false,
};

describe('world codec', () => {
  it('round-trips a world through encode/decode', async () => {
    const bodies = getPreset('jupiter-assist').bodies;
    const code = await encodeWorld({ bodies, config: cfg, music: 'elegy' });
    const back = await decodeWorld(code);
    expect(back).not.toBeNull();
    expect(back!.bodies).toHaveLength(bodies.length);
    expect(back!.music).toBe('elegy');
    expect(back!.config.collisionMode).toBe('merge');
    expect(back!.config.radiusScale).toBe(10);
    for (let i = 0; i < bodies.length; i++) {
      const a = bodies[i];
      const b = back!.bodies[i];
      expect(b.name).toBe(a.name);
      expect(b.type).toBe(a.type);
      // 6 significant digits of transport rounding
      expect(Math.abs(b.mass - a.mass) / Math.max(a.mass, 1)).toBeLessThan(1e-5);
      for (let q = 0; q < 3; q++) {
        const scale = Math.max(Math.abs(a.position[q]), 1);
        expect(Math.abs(b.position[q] - a.position[q]) / scale).toBeLessThan(1e-5);
        const vs = Math.max(Math.abs(a.velocity[q]), 1);
        expect(Math.abs(b.velocity[q] - a.velocity[q]) / vs).toBeLessThan(1e-5);
      }
    }
  });

  it('produces a compact code and rejects garbage', async () => {
    const code = await encodeWorld({ bodies: getPreset('sandbox').bodies, config: cfg });
    expect(code.length).toBeLessThan(600);
    expect(await decodeWorld('not-a-world')).toBeNull();
    expect(await decodeWorld('')).toBeNull();
  });

  it('slugifies names safely', () => {
    expect(slugify('My Chaotic Mess!')).toBe('my-chaotic-mess');
    expect(slugify('@Booga')).toBe('booga');
    expect(slugify('  ---  ')).toBe('');
    expect(isValidSlug('my-world')).toBe(true);
    expect(isValidSlug('a')).toBe(false);
    expect(isValidSlug('Bad Slug')).toBe(false);
  });
});

describe('world analyzer (leaderboard metrics)', () => {
  const star = (id: string, mass: number, position: Vec3, velocity: Vec3, radius = 1e6): BodySpec => ({
    id, name: id, type: 'star', mass, radius, position, velocity,
    color: '#fff', showTrail: true, showVectors: false,
  });

  it('rates a two-body orbit as regular and intact', () => {
    const s = analyzeWorld(getPreset('two-body').bodies);
    expect(s.bodies).toBe(2);
    expect(s.survivors).toBe(2);
    expect(s.firstCollision).toBeNull();
    expect(s.chaos).toBeLessThan(0.1);
  });

  it('uses the true orbital period as the dynamical time (hierarchical systems)', () => {
    // Sandbox is a heavy star with one light planet at 8e10 m: a mass-weighted
    // system radius would collapse to ~0 here, so the timescale must come from
    // the pairwise orbital period instead.
    const s = analyzeWorld(getPreset('sandbox').bodies);
    expect(s.dynamicalTime).toBeGreaterThan(0.3 * YEAR);
    expect(s.dynamicalTime).toBeLessThan(1 * YEAR);
    expect(s.chaos).toBeLessThan(0.1);
  });

  it('measures a large Lyapunov exponent for the Pythagorean three-body problem', () => {
    // Burrau's problem (masses 3:4:5 at rest): the textbook chaotic system,
    // which ends by ejecting its members.
    const S = 1e11;
    const s = analyzeWorld(
      toBarycentric([
        star('m3', 3e30, [S, 3 * S, 0], [0, 0, 0]),
        star('m4', 4e30, [-2 * S, -S, 0], [0, 0, 0]),
        star('m5', 5e30, [S, -S, 0], [0, 0, 0]),
      ]),
    );
    expect(s.chaos).toBeGreaterThan(0.5);
    expect(s.chaosWindow).toBeGreaterThan(1);
    expect(s.escapees).toBeGreaterThan(0);
  });

  it('detects a collision in the colliding preset', () => {
    const s = analyzeWorld(getPreset('flyby-collide').bodies);
    expect(s.firstCollision).not.toBeNull();
    expect(s.survivors).toBe(1);
  });

  it('reports no chaos measurement when a world merges before a Lyapunov window exists', () => {
    const s = analyzeWorld(getPreset('chaotic-three').bodies);
    expect(s.survivors).toBeLessThan(3);
    expect(s.firstCollision).not.toBeNull();
    expect(s.chaosWindow).toBe(0);
    expect(s.chaos).toBe(0);
  });
});
