import { create } from 'zustand';
import { API_BASE } from './api';
import { accessToken, setTokenProvider } from './authToken';

/**
 * Account session. Privy handles the login itself; this module owns the bridge
 * between a Privy access token and a Gravity Lab account (handle + worlds).
 *
 * Auth is optional: when no Privy app is configured the app runs exactly as
 * before, with secret keys as the ownership mechanism.
 */

export const PRIVY_APP_ID: string = (import.meta as any).env?.VITE_PRIVY_APP_ID ?? '';
export const authConfigured = () => PRIVY_APP_ID.length > 0;

export interface Account {
  did: string;
  handle: string;
  displayName: string;
  createdAt: number;
}

interface SessionState {
  ready: boolean;
  account: Account | null;
  worldCount: number;
  error: string | null;
  busy: boolean;
}

export const useSession = create<SessionState>(() => ({
  ready: false,
  account: null,
  worldCount: 0,
  error: null,
  busy: false,
}));





/** fetch() with the caller's Privy token attached when signed in. */
export async function authFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = await accessToken();
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    ...((init.headers as Record<string, string>) ?? {}),
  };
  if (token) headers.authorization = `Bearer ${token}`;
  return fetch(`${API_BASE}${path}`, { ...init, headers });
}

async function json<T>(res: Response): Promise<T> {
  const text = await res.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    /* ignore */
  }
  if (!res.ok) throw new Error(body?.error || `Request failed (${res.status})`);
  return body as T;
}

export { setTokenProvider, accessToken };

export const session = {
  /** Exchange the current Privy token for a Gravity Lab account (creating it on first sign-in). */
  async sync(suggestedHandle?: string): Promise<Account | null> {
    if (!authConfigured()) {
      useSession.setState({ ready: true });
      return null;
    }
    const token = await accessToken();
    if (!token) {
      useSession.setState({ ready: true, account: null, worldCount: 0 });
      return null;
    }
    useSession.setState({ busy: true, error: null });
    try {
      const res = await authFetch('/api/me', {
        method: 'POST',
        body: JSON.stringify({ handle: suggestedHandle }),
      });
      const data = await json<{ user: Account; worlds: number }>(res);
      useSession.setState({ ready: true, account: data.user, worldCount: data.worlds, busy: false });
      return data.user;
    } catch (err) {
      useSession.setState({
        ready: true,
        busy: false,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  },

  clear(): void {
    useSession.setState({ account: null, worldCount: 0, error: null, ready: true });
  },

  async rename(patch: { handle?: string; displayName?: string }): Promise<Account> {
    const res = await authFetch('/api/me', { method: 'PATCH', body: JSON.stringify(patch) });
    const data = await json<{ user: Account }>(res);
    useSession.setState({ account: data.user });
    return data.user;
  },

  async myWorlds() {
    const res = await authFetch('/api/me/worlds');
    return json<{ user: Account; worlds: any[] }>(res);
  },
};

/** Does this server have accounts switched on? (Cheap, cached.) */
let serverAuth: boolean | null = null;
export async function serverAuthEnabled(): Promise<boolean> {
  if (serverAuth !== null) return serverAuth;
  try {
    const res = await fetch(`${API_BASE}/api/config`);
    const body = await res.json();
    serverAuth = !!body.auth;
  } catch {
    serverAuth = false;
  }
  return serverAuth;
}
