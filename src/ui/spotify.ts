/**
 * Spotify soundtrack.
 *
 * Authorization Code with PKCE, run entirely in the browser — no client secret
 * exists in this app and no token ever reaches the Gravity Lab server. Playback
 * uses the Web Playback SDK, which turns the tab into a Spotify Connect device.
 *
 * Two constraints are Spotify's, not ours, and are surfaced to the user:
 *   • in-browser playback requires a Spotify **Premium** account;
 *   • while the Spotify app is in development mode only allowlisted accounts
 *     can authorise it.
 * When either bites, the app falls back to its own generated piano tracks.
 */
import { create } from 'zustand';

export const SPOTIFY_CLIENT_ID: string = (import.meta as any).env?.VITE_SPOTIFY_CLIENT_ID ?? '';
export const spotifyConfigured = () => SPOTIFY_CLIENT_ID.length > 0;

const SCOPES = [
  'streaming',
  'user-read-email',
  'user-read-private',
  'user-read-playback-state',
  'user-modify-playback-state',
  'playlist-read-private',
  'playlist-read-collaborative',
  'user-library-read',
].join(' ');

const TOKEN_KEY = 'gravity-lab-spotify-token';
const VERIFIER_KEY = 'gravity-lab-spotify-verifier';
const STATE_KEY = 'gravity-lab-spotify-state';

const redirectUri = () => `${location.origin}/`;

export interface SpotifyPlaylist {
  id: string;
  name: string;
  uri: string;
  tracks: number;
  image: string | null;
}

export interface NowPlaying {
  title: string;
  artist: string;
  art: string | null;
  paused: boolean;
}

interface SpotifyState {
  connected: boolean;
  connecting: boolean;
  ready: boolean;
  /** Premium is required by the Web Playback SDK; free accounts can still browse. */
  premium: boolean | null;
  displayName: string;
  playlists: SpotifyPlaylist[];
  nowPlaying: NowPlaying | null;
  error: string | null;
}

export const useSpotify = create<SpotifyState>(() => ({
  connected: false,
  connecting: false,
  ready: false,
  premium: null,
  displayName: '',
  playlists: [],
  nowPlaying: null,
  error: null,
}));

// ---------------------------------------------------------------- token store

interface StoredToken {
  access: string;
  refresh: string;
  expiresAt: number;
}

function readToken(): StoredToken | null {
  try {
    const raw = localStorage.getItem(TOKEN_KEY);
    return raw ? (JSON.parse(raw) as StoredToken) : null;
  } catch {
    return null;
  }
}

function writeToken(t: StoredToken | null): void {
  try {
    if (t) localStorage.setItem(TOKEN_KEY, JSON.stringify(t));
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* private browsing */
  }
}

// ---------------------------------------------------------------- PKCE

function randomString(len: number): string {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~'[b % 66]).join('');
}

async function challengeFrom(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  let s = '';
  new Uint8Array(digest).forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Send the user to Spotify to authorise. */
export async function connectSpotify(): Promise<void> {
  if (!spotifyConfigured()) {
    useSpotify.setState({ error: 'Spotify is not configured on this deployment.' });
    return;
  }
  const verifier = randomString(64);
  const state = randomString(16);
  sessionStorage.setItem(VERIFIER_KEY, verifier);
  sessionStorage.setItem(STATE_KEY, state);
  const params = new URLSearchParams({
    client_id: SPOTIFY_CLIENT_ID,
    response_type: 'code',
    redirect_uri: redirectUri(),
    scope: SCOPES,
    code_challenge_method: 'S256',
    code_challenge: await challengeFrom(verifier),
    state,
  });
  location.assign(`https://accounts.spotify.com/authorize?${params}`);
}

async function exchange(body: Record<string, string>): Promise<StoredToken | null> {
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: SPOTIFY_CLIENT_ID, ...body }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.access_token) {
    useSpotify.setState({ error: data?.error_description || 'Spotify sign-in failed.' });
    return null;
  }
  const token: StoredToken = {
    access: data.access_token,
    refresh: data.refresh_token ?? readToken()?.refresh ?? '',
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000 - 60_000,
  };
  writeToken(token);
  return token;
}

/** A valid access token, refreshing if needed. */
export async function accessToken(): Promise<string | null> {
  const t = readToken();
  if (!t) return null;
  if (Date.now() < t.expiresAt) return t.access;
  if (!t.refresh) return null;
  const refreshed = await exchange({ grant_type: 'refresh_token', refresh_token: t.refresh });
  return refreshed?.access ?? null;
}

/** Handle the `?code=…` Spotify sends back. Returns true if this was a callback. */
export async function completeSpotifyLogin(): Promise<boolean> {
  const url = new URL(location.href);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const err = url.searchParams.get('error');
  if (!code && !err) return false;

  // clean the URL whatever happens, so a refresh doesn't retry a used code
  url.searchParams.delete('code');
  url.searchParams.delete('state');
  url.searchParams.delete('error');
  history.replaceState({}, '', url.pathname + url.search + url.hash);

  if (err) {
    useSpotify.setState({ error: err === 'access_denied' ? 'Spotify authorisation was cancelled.' : err });
    return true;
  }
  const verifier = sessionStorage.getItem(VERIFIER_KEY);
  const expected = sessionStorage.getItem(STATE_KEY);
  sessionStorage.removeItem(VERIFIER_KEY);
  sessionStorage.removeItem(STATE_KEY);
  if (!verifier || (expected && state !== expected)) {
    useSpotify.setState({ error: 'Spotify sign-in could not be verified — please try again.' });
    return true;
  }
  useSpotify.setState({ connecting: true });
  const token = await exchange({
    grant_type: 'authorization_code',
    code: code!,
    redirect_uri: redirectUri(),
    code_verifier: verifier,
  });
  useSpotify.setState({ connecting: false });
  if (token) await initSpotify();
  return true;
}

export function disconnectSpotify(): void {
  writeToken(null);
  player?.disconnect();
  player = null;
  deviceId = null;
  useSpotify.setState({
    connected: false,
    ready: false,
    premium: null,
    displayName: '',
    playlists: [],
    nowPlaying: null,
    error: null,
  });
}

// ---------------------------------------------------------------- web api

async function api<T>(path: string, init?: RequestInit): Promise<T | null> {
  const token = await accessToken();
  if (!token) return null;
  const res = await fetch(`https://api.spotify.com/v1${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (res.status === 204) return null;
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error?.message || `Spotify request failed (${res.status})`);
  }
  return (await res.json().catch(() => null)) as T;
}

async function loadProfileAndPlaylists(): Promise<void> {
  const me = await api<any>('/me');
  if (!me) return;
  useSpotify.setState({
    connected: true,
    displayName: me.display_name || me.id || 'Spotify',
    premium: me.product === 'premium',
    error:
      me.product === 'premium'
        ? null
        : 'Spotify only allows in-browser playback for Premium accounts — the generated tracks stay available.',
  });
  const lists = await api<any>('/me/playlists?limit=50').catch(() => null);
  if (lists?.items) {
    useSpotify.setState({
      playlists: lists.items
        .filter((p: any) => p && p.uri)
        .map((p: any) => ({
          id: p.id,
          name: p.name,
          uri: p.uri,
          tracks: p.tracks?.total ?? 0,
          image: p.images?.[0]?.url ?? null,
        })),
    });
  }
}

// ---------------------------------------------------------------- playback

declare global {
  interface Window {
    Spotify?: any;
    onSpotifyWebPlaybackSDKReady?: () => void;
  }
}

let player: any = null;
let deviceId: string | null = null;
let sdkPromise: Promise<void> | null = null;

function loadSdk(): Promise<void> {
  if (window.Spotify) return Promise.resolve();
  if (sdkPromise) return sdkPromise;
  sdkPromise = new Promise<void>((resolve, reject) => {
    window.onSpotifyWebPlaybackSDKReady = () => resolve();
    const el = document.createElement('script');
    el.src = 'https://sdk.scdn.co/spotify-player.js';
    el.async = true;
    el.onerror = () => reject(new Error('Could not load the Spotify player.'));
    document.head.appendChild(el);
    window.setTimeout(() => reject(new Error('Spotify player timed out.')), 15000);
  });
  return sdkPromise;
}

async function startPlayer(): Promise<void> {
  if (player) return;
  await loadSdk();
  player = new window.Spotify.Player({
    name: 'Gravity Lab',
    getOAuthToken: (cb: (t: string) => void) => {
      void accessToken().then((t) => t && cb(t));
    },
    volume: 0.5,
  });

  player.addListener('ready', ({ device_id }: any) => {
    deviceId = device_id;
    useSpotify.setState({ ready: true });
  });
  player.addListener('not_ready', () => useSpotify.setState({ ready: false }));
  player.addListener('player_state_changed', (s: any) => {
    if (!s?.track_window?.current_track) {
      useSpotify.setState({ nowPlaying: null });
      return;
    }
    const t = s.track_window.current_track;
    useSpotify.setState({
      nowPlaying: {
        title: t.name,
        artist: (t.artists ?? []).map((a: any) => a.name).join(', '),
        art: t.album?.images?.[0]?.url ?? null,
        paused: !!s.paused,
      },
    });
  });
  const fail = (msg: string) => (e: any) =>
    useSpotify.setState({ error: e?.message ? `${msg}: ${e.message}` : msg, ready: false });
  player.addListener('initialization_error', fail('Spotify player could not start'));
  player.addListener('authentication_error', fail('Spotify session expired — reconnect'));
  player.addListener('account_error', () =>
    useSpotify.setState({
      premium: false,
      ready: false,
      error: 'Spotify in-browser playback requires Premium. The generated tracks still work.',
    }),
  );
  player.addListener('playback_error', fail('Playback error'));

  await player.connect();
}

/** Restore a stored session on page load. */
export async function initSpotify(): Promise<void> {
  if (!spotifyConfigured()) return;
  const token = await accessToken();
  if (!token) return;
  try {
    await loadProfileAndPlaylists();
    if (useSpotify.getState().premium) await startPlayer();
  } catch (err) {
    useSpotify.setState({ error: err instanceof Error ? err.message : String(err) });
  }
}

/** Play a playlist (or Liked Songs) on this tab. */
export async function playContext(contextUri: string | null): Promise<void> {
  try {
    if (!useSpotify.getState().premium) {
      useSpotify.setState({ error: 'Spotify in-browser playback requires Premium.' });
      return;
    }
    if (!player) await startPlayer();
    if (!deviceId) {
      useSpotify.setState({ error: 'Spotify player is still starting — try again in a moment.' });
      return;
    }
    // make this tab the active Spotify device
    await api(`/me/player`, { method: 'PUT', body: JSON.stringify({ device_ids: [deviceId], play: false }) });

    let body: string;
    if (contextUri) {
      body = JSON.stringify({ context_uri: contextUri });
    } else {
      // Liked Songs has no context uri; queue the most recent saved tracks
      const saved = await api<any>('/me/tracks?limit=50');
      const uris = (saved?.items ?? []).map((i: any) => i.track?.uri).filter(Boolean);
      if (!uris.length) {
        useSpotify.setState({ error: 'No liked songs found on this account.' });
        return;
      }
      body = JSON.stringify({ uris });
    }
    await api(`/me/player/play?device_id=${deviceId}`, { method: 'PUT', body });
    useSpotify.setState({ error: null });
  } catch (err) {
    useSpotify.setState({ error: err instanceof Error ? err.message : String(err) });
  }
}

export const playback = {
  toggle: () => player?.togglePlay(),
  next: () => player?.nextTrack(),
  previous: () => player?.previousTrack(),
  setVolume: (v: number) => player?.setVolume(Math.max(0, Math.min(1, v))),
  stop: async () => {
    try {
      await player?.pause();
    } catch {
      /* nothing playing */
    }
  },
};
