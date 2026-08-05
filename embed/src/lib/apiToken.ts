/**
 * Cached token client for the CinePro embed player.
 *
 * Fetches a short-lived signed token from /v1/token and caches it until
 * 60 s before expiry, then auto-refreshes. Concurrent callers share one
 * in-flight request so the endpoint is never hammered.
 */

const apiBase = (import.meta.env.VITE_OMSS_URL as string) || '';
const REFRESH_BUFFER = 60; // seconds before expiry to pre-fetch a new token

interface TokenCache {
  token: string;
  expiresAt: number; // unix seconds
}

let cache: TokenCache | null = null;
let inflight: Promise<string> | null = null;

async function fetchFreshToken(): Promise<string> {
  const res = await fetch(`${apiBase}/v1/token`);
  if (!res.ok) throw new Error(`Token fetch failed: ${res.status}`);
  const data = await res.json() as { token: string; expiresAt: string };
  cache = {
    token: data.token,
    expiresAt: Math.floor(new Date(data.expiresAt).getTime() / 1000),
  };
  return cache.token;
}

/** Returns a valid token, fetching a new one if needed. */
export async function getToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cache && cache.expiresAt - now > REFRESH_BUFFER) {
    return cache.token;
  }
  // Deduplicate concurrent callers
  if (!inflight) {
    inflight = fetchFreshToken().finally(() => {
      inflight = null;
    });
  }
  return inflight;
}

/** Convenience — returns { Authorization: 'Bearer ...' } ready to spread into fetch options. */
export async function authHeaders(): Promise<Record<string, string>> {
  const token = await getToken();
  return { Authorization: `Bearer ${token}` };
}
