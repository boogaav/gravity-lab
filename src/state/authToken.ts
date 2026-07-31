/**
 * Standalone holder for the current access token.
 *
 * Kept dependency-free so both the API client and the session store can use it
 * without an import cycle. The Privy provider installs the getter on sign-in.
 */
let provider: (() => Promise<string | null>) | null = null;

export function setTokenProvider(fn: (() => Promise<string | null>) | null): void {
  provider = fn;
}

export async function accessToken(): Promise<string | null> {
  if (!provider) return null;
  try {
    return await provider();
  } catch {
    return null;
  }
}
