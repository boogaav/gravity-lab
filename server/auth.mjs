/**
 * Privy authentication.
 *
 * Access tokens issued by Privy are ES256 JWTs. We verify them against the
 * app's public JWKS — no app secret is needed on this server, and no token
 * ever leaves it. If PRIVY_APP_ID is unset the whole feature is disabled and
 * the app falls back to anonymous secret-key ownership.
 */
import { createPublicKey, verify as cryptoVerify } from 'node:crypto';

export const PRIVY_APP_ID = process.env.PRIVY_APP_ID || '';
export const authEnabled = () => PRIVY_APP_ID.length > 0;

const JWKS_URL = () => `https://auth.privy.io/api/v1/apps/${PRIVY_APP_ID}/jwks.json`;
const JWKS_TTL_MS = 10 * 60 * 1000;

let jwksCache = { at: 0, keys: [] };

async function getKeys(force = false) {
  const fresh = Date.now() - jwksCache.at < JWKS_TTL_MS;
  if (!force && fresh && jwksCache.keys.length) return jwksCache.keys;
  const res = await fetch(JWKS_URL(), { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`JWKS fetch failed (${res.status})`);
  const body = await res.json();
  jwksCache = { at: Date.now(), keys: body.keys || [] };
  return jwksCache.keys;
}

const b64url = (s) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

/**
 * Verify a Privy access token. Returns its claims, or throws.
 * Checks signature (ES256), issuer, audience and expiry.
 */
export async function verifyPrivyToken(token) {
  if (!authEnabled()) throw new Error('Authentication is not configured on this server.');
  if (typeof token !== 'string' || token.split('.').length !== 3) throw new Error('Malformed token.');
  const [h, p, s] = token.split('.');

  let header;
  let claims;
  try {
    header = JSON.parse(b64url(h).toString('utf8'));
    claims = JSON.parse(b64url(p).toString('utf8'));
  } catch {
    throw new Error('Malformed token.');
  }
  if (header.alg !== 'ES256') throw new Error('Unexpected token algorithm.');

  const signed = Buffer.from(`${h}.${p}`);
  const signature = b64url(s);

  const tryKeys = async (force) => {
    const keys = await getKeys(force);
    const candidates = header.kid ? keys.filter((k) => k.kid === header.kid) : keys;
    for (const jwk of candidates.length ? candidates : keys) {
      try {
        const key = createPublicKey({ key: jwk, format: 'jwk' });
        // ES256 signatures are raw r||s, not DER
        if (cryptoVerify('sha256', signed, { key, dsaEncoding: 'ieee-p1363' }, signature)) return true;
      } catch {
        /* try the next key */
      }
    }
    return false;
  };

  // A rotated signing key shows up as a miss; refetch once before giving up.
  if (!(await tryKeys(false)) && !(await tryKeys(true))) {
    throw new Error('Token signature is not valid.');
  }

  const now = Math.floor(Date.now() / 1000);
  if (typeof claims.exp === 'number' && claims.exp < now) throw new Error('Session expired — please sign in again.');
  if (claims.iss !== 'privy.io') throw new Error('Unexpected token issuer.');
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes(PRIVY_APP_ID)) throw new Error('Token was issued for a different app.');
  if (typeof claims.sub !== 'string' || !claims.sub) throw new Error('Token has no subject.');
  return claims;
}

/** Pull a bearer token off a request, if present. */
export function bearerToken(req) {
  const raw = req.headers?.authorization || '';
  const m = /^Bearer\s+(.+)$/i.exec(raw);
  return m ? m[1].trim() : null;
}
