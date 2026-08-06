/**
 * Universe colour schemes — how *space itself* is drawn.
 *
 * Purely presentational: not one value here reaches the physics engine. Each
 * scheme sets the void, the reference grid, the starfield and the colours of
 * the analysis overlays (centre of mass, closest approach, asymptotes).
 */

export type UniverseId =
  | 'observatory'
  | 'daylight'
  | 'blueprint'
  | 'phosphor'
  | 'amber'
  | 'nebula'
  | 'engraving'
  | 'infrared';

export interface UniverseScheme {
  id: UniverseId;
  name: string;
  blurb: string;
  /** True when the void is light, so trails and labels must darken to stay readable. */
  lightVoid: boolean;
  void: string;
  gridMajor: string;
  gridMinor: string;
  /** null hides the starfield entirely. */
  stars: string | null;
  starSize: number;
  ambient: number;
  keyLight: number;
  /** Ink used for labels and for darkening trails over a light void. */
  ink: string;
  com: string;
  closestApproach: string;
  asymptote: string;
  dropGuide: string;
  /** How strongly trails are mixed toward `ink` (0 = keep the body's own colour). */
  trailInk: number;
  trailOpacity: number;
}

export const UNIVERSES: UniverseScheme[] = [
  {
    id: 'observatory',
    name: 'Observatory',
    blurb: 'Deep black sky with a cold blue survey grid — the default, closest to what a telescope shows.',
    lightVoid: false,
    void: '#04060c',
    gridMajor: '#1b2740',
    gridMinor: '#0e1524',
    stars: '#3a4763',
    starSize: 1.4,
    ambient: 0.35,
    keyLight: 1.2,
    ink: '#cfe0ff',
    com: '#ffffff',
    closestApproach: '#ffe066',
    asymptote: '#8899bb',
    dropGuide: '#ffffff',
    trailInk: 0,
    trailOpacity: 0.55,
  },
  {
    id: 'daylight',
    name: 'Daylight',
    blurb: 'Space as a clean white page. Orbits read like printed diagrams — good for slides and screenshots.',
    lightVoid: true,
    void: '#f7f9fc',
    gridMajor: '#c3cede',
    gridMinor: '#dfe6f0',
    stars: null,
    starSize: 1,
    ambient: 0.9,
    keyLight: 1.4,
    ink: '#1b2540',
    com: '#1b2540',
    closestApproach: '#c2185b',
    asymptote: '#7a89a6',
    dropGuide: '#1b2540',
    trailInk: 0.45,
    trailOpacity: 0.85,
  },
  {
    id: 'blueprint',
    name: 'Blueprint',
    blurb: 'Drafting-table cyanotype: white linework on engineering blue, as if the solar system were a machine drawing.',
    lightVoid: false,
    void: '#0d2f5e',
    gridMajor: '#4d86c9',
    gridMinor: '#255089',
    stars: '#8fc0f0',
    starSize: 1.2,
    ambient: 0.55,
    keyLight: 1.1,
    ink: '#eaf3ff',
    com: '#ffffff',
    closestApproach: '#ffd166',
    asymptote: '#a8cdf5',
    dropGuide: '#ffffff',
    trailInk: 0.3,
    trailOpacity: 0.8,
  },
  {
    id: 'phosphor',
    name: 'Phosphor',
    blurb: 'A 1970s radar scope: everything drawn by a single green electron beam on black glass.',
    lightVoid: false,
    void: '#000806',
    gridMajor: '#0f4f34',
    gridMinor: '#07281a',
    stars: '#1f6e4a',
    starSize: 1.2,
    ambient: 0.5,
    keyLight: 0.9,
    ink: '#7dffb0',
    com: '#7dffb0',
    closestApproach: '#d6ff4a',
    asymptote: '#2f8f60',
    dropGuide: '#7dffb0',
    trailInk: 0.75,
    trailOpacity: 0.75,
  },
  {
    id: 'amber',
    name: 'Amber',
    blurb: 'Mission-control monochrome — warm amber on near-black, like a terminal from the Apollo era.',
    lightVoid: false,
    void: '#0a0600',
    gridMajor: '#5c3708',
    gridMinor: '#2a1904',
    stars: '#8a5b16',
    starSize: 1.2,
    ambient: 0.5,
    keyLight: 1,
    ink: '#ffc46b',
    com: '#ffd79a',
    closestApproach: '#fff0c2',
    asymptote: '#9a6a25',
    dropGuide: '#ffc46b',
    trailInk: 0.7,
    trailOpacity: 0.75,
  },
  {
    id: 'nebula',
    name: 'Nebula',
    blurb: 'Deep violet gas and hot magenta light — the sky as an emission nebula rather than empty vacuum.',
    lightVoid: false,
    void: '#0c0518',
    gridMajor: '#3d2168',
    gridMinor: '#1d0f33',
    stars: '#b98fe8',
    starSize: 1.6,
    ambient: 0.45,
    keyLight: 1.3,
    ink: '#f0dcff',
    com: '#ffffff',
    closestApproach: '#ff5ecb',
    asymptote: '#7a5aa8',
    dropGuide: '#ffb8f0',
    trailInk: 0,
    trailOpacity: 0.7,
  },
  {
    id: 'engraving',
    name: 'Engraving',
    blurb: 'A 19th-century star atlas: sepia ink on aged paper, with the stars printed as dark specks.',
    lightVoid: true,
    void: '#efe6d2',
    gridMajor: '#c3b192',
    gridMinor: '#ddd0b6',
    stars: '#8a7550',
    starSize: 1.5,
    ambient: 0.95,
    keyLight: 1.3,
    ink: '#3d2f1c',
    com: '#3d2f1c',
    closestApproach: '#a33b1f',
    asymptote: '#9b8763',
    dropGuide: '#3d2f1c',
    trailInk: 0.6,
    trailOpacity: 0.9,
  },
  {
    id: 'infrared',
    name: 'Infrared',
    blurb: 'False-colour thermal imaging: a cold indigo void with everything hot rendered in fire tones.',
    lightVoid: false,
    void: '#07021f',
    gridMajor: '#2b1d6b',
    gridMinor: '#140b3a',
    stars: '#ff6b3d',
    starSize: 1.8,
    ambient: 0.4,
    keyLight: 1.5,
    ink: '#ffd9a0',
    com: '#fffbe6',
    closestApproach: '#ff3d00',
    asymptote: '#6e5bc4',
    dropGuide: '#ffae57',
    trailInk: 0,
    trailOpacity: 0.75,
  },
];

export const DEFAULT_UNIVERSE: UniverseId = 'observatory';

export function getUniverse(id: string | null | undefined): UniverseScheme {
  return UNIVERSES.find((u) => u.id === id) ?? UNIVERSES[0];
}

// ---------------------------------------------------------------- colour maths

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full.slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const toHex = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');

/** Blend two hex colours; t = 0 keeps `a`, t = 1 gives `b`. */
export function mixHex(a: string, b: string, t: number): string {
  const [r1, g1, b1] = hexToRgb(a);
  const [r2, g2, b2] = hexToRgb(b);
  const k = Math.max(0, Math.min(1, t));
  return `#${toHex(r1 + (r2 - r1) * k)}${toHex(g1 + (g2 - g1) * k)}${toHex(b1 + (b2 - b1) * k)}`;
}

/**
 * A body's trail colour under a given scheme. Over a light void, or in the
 * monochrome schemes, the body's own colour is mixed toward the scheme ink so
 * thin lines stay legible.
 */
export function trailColorFor(bodyColor: string, scheme: UniverseScheme): string {
  return scheme.trailInk > 0 ? mixHex(bodyColor, scheme.ink, scheme.trailInk) : bodyColor;
}
