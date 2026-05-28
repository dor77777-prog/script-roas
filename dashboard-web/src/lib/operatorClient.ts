// dashboard-web/src/lib/operatorClient.ts
//
// Security hardening FIX 3 — operator-secret client helper.
//
// Provides:
//   OPERATOR_SECRET_STORAGE_KEY — localStorage key for the operator secret
//   getOperatorSecret()         — read from localStorage (SSR-safe)
//   setOperatorSecret(s|null)   — write / clear from localStorage (SSR-safe)
//   operatorFetch(input, init)  — drop-in fetch() wrapper that always injects
//                                 the 'x-operator-secret' header when set
//
// Usage: replace every direct `fetch('/api/operator/...')` call in operator
// SPA components with `operatorFetch('/api/operator/...')`. The middleware
// enforces the secret server-side when OPERATOR_SECRET env is set; when the
// env var is not set the header is harmless and the gate passes through.

export const OPERATOR_SECRET_STORAGE_KEY = 'operatorSecret';

/**
 * Reads the operator secret from localStorage.
 * Returns null when running server-side (SSR/RSC) or when not set.
 */
export function getOperatorSecret(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(OPERATOR_SECRET_STORAGE_KEY);
  } catch {
    // Private browsing / storage quota — fail silently.
    return null;
  }
}

/**
 * Writes (or removes) the operator secret in localStorage.
 * - setOperatorSecret('value') → stores the value
 * - setOperatorSecret(null)    → removes the key
 * No-ops when running server-side (SSR/RSC).
 */
export function setOperatorSecret(secret: string | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (secret) {
      window.localStorage.setItem(OPERATOR_SECRET_STORAGE_KEY, secret);
    } else {
      window.localStorage.removeItem(OPERATOR_SECRET_STORAGE_KEY);
    }
  } catch {
    // Private browsing / quota exhausted — silently ignore.
  }
}

/**
 * Wrapper around fetch() that always injects the 'x-operator-secret' header
 * when a secret is stored in localStorage.
 *
 * Use for every /api/operator/* call from the SPA. The middleware enforces
 * the secret server-side when OPERATOR_SECRET env is set; when the env var
 * is not set, the header is harmless and the request passes through.
 *
 * Drop-in replacement: `operatorFetch(url, init)` has the same signature as
 * `fetch(url, init)` and returns the same `Promise<Response>`.
 */
export async function operatorFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const secret = getOperatorSecret();
  const headers = new Headers(init?.headers);
  if (secret) {
    headers.set('x-operator-secret', secret);
  }
  return fetch(input, { ...init, headers });
}
