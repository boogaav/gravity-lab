/**
 * Owner keys for published worlds.
 *
 * A key is chosen (or generated) when a world is published and is the only way
 * to edit it later. The server stores a scrypt hash, never the key itself, so a
 * lost key cannot be recovered — we keep a copy in this browser's localStorage
 * purely as a convenience so returning on the same device just works.
 */

const LS_KEY = 'gravity-lab-world-keys';

/** Unambiguous alphabet: no O/0, I/l/1 to keep hand-copied keys reliable. */
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

export const MIN_KEY_LENGTH = 6;

export function generateKey(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  const chars = Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]);
  return `${chars.slice(0, 4).join('')}-${chars.slice(4, 8).join('')}-${chars.slice(8, 12).join('')}`;
}

function readAll(): Record<string, string> {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

export function rememberKey(slug: string, key: string): void {
  try {
    const all = readAll();
    all[slug] = key;
    localStorage.setItem(LS_KEY, JSON.stringify(all));
  } catch {
    /* private browsing / storage disabled — the user still has their key */
  }
}

export function recallKey(slug: string): string | null {
  return readAll()[slug] ?? null;
}

export function forgetKey(slug: string): void {
  try {
    const all = readAll();
    delete all[slug];
    localStorage.setItem(LS_KEY, JSON.stringify(all));
  } catch {
    /* ignore */
  }
}

/** Slugs this browser holds keys for — "your worlds" on this device. */
export function myWorlds(): string[] {
  return Object.keys(readAll());
}
