import type { BodySpec, Vec3 } from './types';

/**
 * Reference frames are PRESENTATION ONLY. They transform displayed positions,
 * velocities and trails; the underlying physical state is never modified.
 */
export type FrameSel =
  | { kind: 'inertial' } // raw simulation coordinates (presets initialize these barycentric)
  | { kind: 'com' } // instantaneous center-of-mass frame
  | { kind: 'body'; id: string } // centered on and co-moving with one body
  | { kind: 'rotating'; a: string; b: string }; // co-rotating with the a-b line, origin at pair COM

export interface FrameTransform {
  origin: Vec3; // position subtracted
  originVel: Vec3; // velocity subtracted
  /** rotation angle about +z to UNDO (rotating frame only), else 0 */
  angle: number;
  omega: number; // rad/s of the rotating frame (0 otherwise)
}

export function frameLabel(f: FrameSel, bodies: BodySpec[]): string {
  const name = (id: string) => bodies.find((b) => b.id === id)?.name ?? id;
  switch (f.kind) {
    case 'inertial': return 'Inertial (simulation frame)';
    case 'com': return 'Center-of-mass frame';
    case 'body': return `${name(f.id)}-centered frame`;
    case 'rotating': return `Rotating ${name(f.a)}–${name(f.b)} frame`;
  }
}

/** Compute the transform for a frame from the CURRENT physical state. */
export function computeFrameTransform(
  f: FrameSel,
  ids: string[],
  pos: Float64Array,
  vel: Float64Array,
  mass: Float64Array,
  comPos: Vec3,
  comVel: Vec3,
): FrameTransform {
  const idx = (id: string) => ids.indexOf(id);
  switch (f.kind) {
    case 'inertial':
      return { origin: [0, 0, 0], originVel: [0, 0, 0], angle: 0, omega: 0 };
    case 'com':
      return { origin: comPos, originVel: comVel, angle: 0, omega: 0 };
    case 'body': {
      const i = idx(f.id);
      if (i < 0) return { origin: [0, 0, 0], originVel: [0, 0, 0], angle: 0, omega: 0 };
      return {
        origin: [pos[3 * i], pos[3 * i + 1], pos[3 * i + 2]],
        originVel: [vel[3 * i], vel[3 * i + 1], vel[3 * i + 2]],
        angle: 0,
        omega: 0,
      };
    }
    case 'rotating': {
      const i = idx(f.a), j = idx(f.b);
      if (i < 0 || j < 0) return { origin: [0, 0, 0], originVel: [0, 0, 0], angle: 0, omega: 0 };
      const mi = mass[i], mj = mass[j], M = mi + mj;
      const origin: Vec3 = [
        (mi * pos[3 * i] + mj * pos[3 * j]) / M,
        (mi * pos[3 * i + 1] + mj * pos[3 * j + 1]) / M,
        (mi * pos[3 * i + 2] + mj * pos[3 * j + 2]) / M,
      ];
      const originVel: Vec3 = [
        (mi * vel[3 * i] + mj * vel[3 * j]) / M,
        (mi * vel[3 * i + 1] + mj * vel[3 * j + 1]) / M,
        (mi * vel[3 * i + 2] + mj * vel[3 * j + 2]) / M,
      ];
      const dx = pos[3 * j] - pos[3 * i];
      const dy = pos[3 * j + 1] - pos[3 * i + 1];
      const dvx = vel[3 * j] - vel[3 * i];
      const dvy = vel[3 * j + 1] - vel[3 * i + 1];
      const r2 = dx * dx + dy * dy;
      const angle = Math.atan2(dy, dx);
      const omega = r2 > 0 ? (dx * dvy - dy * dvx) / r2 : 0; // planar approximation about +z
      return { origin, originVel, angle, omega };
    }
  }
}

/** Transform one world position into frame coordinates. */
export function toFramePos(p: Vec3, t: FrameTransform): Vec3 {
  const x = p[0] - t.origin[0];
  const y = p[1] - t.origin[1];
  const z = p[2] - t.origin[2];
  if (t.angle === 0) return [x, y, z];
  const c = Math.cos(-t.angle), s = Math.sin(-t.angle);
  return [x * c - y * s, x * s + y * c, z];
}

/** Transform one world velocity into frame coordinates (includes -omega x r for rotating frames). */
export function toFrameVel(p: Vec3, v: Vec3, t: FrameTransform): Vec3 {
  const x = p[0] - t.origin[0];
  const y = p[1] - t.origin[1];
  let vx = v[0] - t.originVel[0];
  let vy = v[1] - t.originVel[1];
  const vz = v[2] - t.originVel[2];
  if (t.angle === 0 && t.omega === 0) return [vx, vy, vz];
  vx -= -t.omega * y;
  vy -= t.omega * x;
  const c = Math.cos(-t.angle), s = Math.sin(-t.angle);
  return [vx * c - vy * s, vx * s + vy * c, vz];
}
