import type { WorldStats } from '../physics/analyze';
import { accessToken } from './authToken';

/**
 * Client for the published-worlds registry. When the app is served from a
 * static host (GitHub Pages) the API lives on the canonical deployment, so
 * shared links and the leaderboard keep working from either origin.
 */
const CANONICAL_API = 'https://gravity.booga.me';

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
  updatedAt: number | null;
  hasThumb: boolean;
  ownerHandle: string | null;
  /** Whether this world was published with an owner key (and so can be edited). */
  editable: boolean;
}

export interface WorldRecord extends WorldCard {
  data: string;
  liked: boolean;
}

export type SortKey = 'new' | 'top' | 'chaos' | 'big' | 'carnage';

export const SORTS: Array<{ key: SortKey; label: string; tip: string }> = [
  { key: 'new', label: 'Newest', tip: 'Most recently published worlds first.' },
  { key: 'top', label: 'Top', tip: 'Most liked worlds, then most viewed.' },
  { key: 'chaos', label: 'Most chaotic', tip: 'Highest measured Lyapunov exponent: worlds where a one-in-a-billion nudge grows fastest into a completely different future.' },
  { key: 'big', label: 'Biggest', tip: 'Worlds containing the most gravitating bodies.' },
  { key: 'carnage', label: 'Most carnage', tip: 'Worlds that lost the most bodies to collisions when run forward.' },
];

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  // A signed-in caller proves ownership with their token; anonymous callers
  // fall back to the world's secret key.
  const token = await accessToken();
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    ...((init?.headers as Record<string, string>) ?? {}),
  };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });
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
    key: string;
  }) => req<{ slug: string; url: string }>('/api/worlds', { method: 'POST', body: JSON.stringify(payload) }),

  update: (
    slug: string,
    payload: {
      title: string;
      author: string;
      data: string;
      thumb: string | null;
      stats: WorldStats;
      key: string;
    },
  ) =>
    req<{ slug: string; url: string; updated: boolean }>(`/api/worlds/${encodeURIComponent(slug)}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),

  remove: (slug: string, key: string) =>
    req<{ deleted: boolean; slug: string }>(`/api/worlds/${encodeURIComponent(slug)}`, {
      method: 'DELETE',
      body: JSON.stringify({ key }),
    }),

  auth: (slug: string, key: string) =>
    req<{ ok: boolean }>(`/api/worlds/${encodeURIComponent(slug)}/auth`, {
      method: 'POST',
      body: JSON.stringify({ key }),
    }),

  health: () => req<{ ok: boolean; worlds: number }>('/api/health'),
};

export const worldUrl = (slug: string) => `${SITE_ORIGIN}/@${slug}`;
export const thumbUrl = (slug: string) => `${API_BASE}/api/worlds/${slug}/thumb.jpg`;
