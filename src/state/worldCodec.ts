import type { BodySpec, BodyType, CollisionMode, Vec3 } from '../physics/types';

/**
 * Compact, self-contained serialization of a world (bodies + presentation
 * settings) for URLs and the published-worlds database.
 *
 * Format: `<version><flag><base64url payload>` where flag `z` = deflate-raw
 * compressed JSON and `j` = plain JSON. Keys are shortened and floats are
 * rounded to 6 significant digits: that is a DISPLAY/TRANSPORT rounding of the
 * initial conditions only — the engine still integrates in full double
 * precision from whatever values it receives.
 */

export const WORLD_CODEC_VERSION = 1;

export interface WorldConfigSlice {
  timeScale: number;
  collisionMode: CollisionMode;
  radiusScale: number;
  eta: number;
  softening: number;
  trailLength: number;
  showVelocity: boolean;
  showAcceleration: boolean;
  showForces: boolean;
  showGrid: boolean;
  showLabels: boolean;
  showCom: boolean;
}

export interface World {
  bodies: BodySpec[];
  config: WorldConfigSlice;
  music?: string;
}

const r6 = (x: number): number => {
  if (!isFinite(x)) return 0;
  if (x === 0) return 0;
  return Number(x.toPrecision(6));
};
const r6v = (v: Vec3): Vec3 => [r6(v[0]), r6(v[1]), r6(v[2])];

const TYPES: BodyType[] = ['star', 'planet', 'moon', 'asteroid', 'spacecraft', 'particle'];
const MODES: CollisionMode[] = ['stop', 'merge', 'elastic', 'none'];

interface CompactWorld {
  v: number;
  b: Array<[string, number, number, number, Vec3, Vec3, string, number]>;
  c: [number, number, number, number, number, number, number];
  f: number; // bit flags for the boolean display toggles
  m?: string;
}

function toCompact(w: World): CompactWorld {
  const c = w.config;
  const flags =
    (c.showVelocity ? 1 : 0) |
    (c.showAcceleration ? 2 : 0) |
    (c.showForces ? 4 : 0) |
    (c.showGrid ? 8 : 0) |
    (c.showLabels ? 16 : 0) |
    (c.showCom ? 32 : 0);
  return {
    v: WORLD_CODEC_VERSION,
    b: w.bodies.map((b) => [
      b.name,
      Math.max(TYPES.indexOf(b.type), 0),
      r6(b.mass),
      r6(b.radius),
      r6v(b.position),
      r6v(b.velocity),
      b.color,
      (b.showTrail ? 1 : 0) | (b.showVectors ? 2 : 0),
    ]),
    c: [
      r6(c.timeScale),
      Math.max(MODES.indexOf(c.collisionMode), 0),
      r6(c.radiusScale),
      r6(c.eta),
      r6(c.softening),
      c.trailLength,
      0,
    ],
    f: flags,
    m: w.music,
  };
}

function fromCompact(k: CompactWorld): World {
  const [timeScale, modeIdx, radiusScale, eta, softening, trailLength] = k.c;
  return {
    bodies: k.b.map((b, i) => ({
      id: `w${i}-${b[0].toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'body'}`,
      name: b[0],
      type: TYPES[b[1]] ?? 'planet',
      mass: b[2],
      radius: b[3],
      position: b[4],
      velocity: b[5],
      color: b[6],
      showTrail: (b[7] & 1) !== 0,
      showVectors: (b[7] & 2) !== 0,
    })),
    config: {
      timeScale,
      collisionMode: MODES[modeIdx] ?? 'merge',
      radiusScale,
      eta,
      softening,
      trailLength,
      showVelocity: (k.f & 1) !== 0,
      showAcceleration: (k.f & 2) !== 0,
      showForces: (k.f & 4) !== 0,
      showGrid: (k.f & 8) !== 0,
      showLabels: (k.f & 16) !== 0,
      showCom: (k.f & 32) !== 0,
    },
    music: k.m,
  };
}

// ---------------------------------------------------------------- base64url

function bytesToB64url(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function deflate(text: string): Promise<Uint8Array | null> {
  if (typeof CompressionStream === 'undefined') return null;
  try {
    const cs = new CompressionStream('deflate-raw');
    const stream = new Blob([text]).stream().pipeThrough(cs);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    return null;
  }
}

async function inflate(bytes: Uint8Array): Promise<string | null> {
  if (typeof DecompressionStream === 'undefined') return null;
  try {
    const ds = new DecompressionStream('deflate-raw');
    const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const stream = new Blob([buf]).stream().pipeThrough(ds);
    return await new Response(stream).text();
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- public API

export async function encodeWorld(w: World): Promise<string> {
  const json = JSON.stringify(toCompact(w));
  const packed = await deflate(json);
  if (packed) return `${WORLD_CODEC_VERSION}z${bytesToB64url(packed)}`;
  return `${WORLD_CODEC_VERSION}j${bytesToB64url(new TextEncoder().encode(json))}`;
}

export async function decodeWorld(code: string): Promise<World | null> {
  try {
    const m = /^(\d+)([zj])(.+)$/.exec(code.trim());
    if (!m) return null;
    const bytes = b64urlToBytes(m[3]);
    const json = m[2] === 'z' ? await inflate(bytes) : new TextDecoder().decode(bytes);
    if (!json) return null;
    const parsed = JSON.parse(json) as CompactWorld;
    if (!Array.isArray(parsed.b) || parsed.b.length === 0) return null;
    return fromCompact(parsed);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- slugs

/** `My Chaotic Mess!` → `my-chaotic-mess`. Empty result means invalid. */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/^@+/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
}

export const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,31}$/;

export function isValidSlug(s: string): boolean {
  return SLUG_RE.test(s);
}
