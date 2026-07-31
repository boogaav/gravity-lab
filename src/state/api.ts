import type { WorldStats } from '../physics/analyze';

/**
 * Client for the published-worlds registry. When the app is served from a
 * static host (GitHub Pages) the API lives on the canonical deployment, so
 * shared links and the leaderboard keep working from either origin.
 */
const CANONICAL_API = 'https://gravity-lab.fly.dev';

export const API_BASE = (() => {
  if (typeof location === 'undefined') return CANONICAL_API;
  const staticHost = /github\.io$/.test(location.hostname) || location.protocol === 'file:';
  return staticHost ? CANONICAL_API : '';
})();

export const SITE_ORIGIN = API_BASE || (typeof location !== 'undefined' ? location.origin : CANONICAL_API);

export interface WorldCard {
  slug: string;
  title: string;
  author: string;
  bodies: number;
  totalMass: number;
  chaos: number;
  chaosWindow: number;
  survivors: number;
  escapees: number;
  firstCollision: number | null;
  dynamicalTime: number;
  views: number;
  likes: number;
  createdAt: number;
  hasThumb: boolean;
}

export interface WorldRecord extends WorldCard {
  data: string;
  liked: boolean;
}

export type SortKey = 'new' | 'top' | 'chaos' | 'big' | 'carnage';

export const SORTS: Array<{ key: SortKey; label: string; hint: string }> = [
  { key: 'new', label: 'Newest', hint: 'Most recently published' },
  { key: 'top', label: 'Top', hint: 'Most liked' },
  { key: 'chaos', label: 'Most chaotic', hint: 'Highest measured Lyapunov exponent' },
  { key: 'big', label: 'Biggest', hint: 'Most bodies' },
  { key: 'carnage', label: 'Most carnage', hint: 'Most bodies lost to collisions' },
];

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  const text = await res.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON error page */
  }
  if (!res.ok) throw new Error(body?.error || `Request failed (${res.status})`);
  return body as T;
}

export const api = {
  list: (sort: SortKey = 'new', limit = 60) =>
    req<{ sort: SortKey; total: number; worlds: WorldCard[] }>(`/api/worlds?sort=${sort}&limit=${limit}`),

  get: (slug: string) => req<WorldRecord>(`/api/worlds/${encodeURIComponent(slug)}`),

  available: (slug: string) =>
    req<{ available: boolean; reason: string | null }>(`/api/worlds/${encodeURIComponent(slug)}/available`),

  like: (slug: string) =>
    req<{ likes: number; liked: boolean }>(`/api/worlds/${encodeURIComponent(slug)}/like`, { method: 'POST' }),

  publish: (payload: {
    slug: string;
    title: string;
    author: string;
    data: string;
    thumb: string | null;
    stats: WorldStats;
  }) => req<{ slug: string; url: string }>('/api/worlds', { method: 'POST', body: JSON.stringify(payload) }),

  health: () => req<{ ok: boolean; worlds: number }>('/api/health'),
};

export const worldUrl = (slug: string) => `${SITE_ORIGIN}/@${slug}`;
export const thumbUrl = (slug: string) => `${API_BASE}/api/worlds/${slug}/thumb.jpg`;
