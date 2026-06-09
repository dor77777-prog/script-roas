/**
 * 2026-06-09 (Task 2 / consistency audit) — some API routes return HTTP **200**
 * with a JSON body carrying an `error` string on failure (e.g. /api/ads returns
 * `{ rows: [], error }` with status 200 so the client can render a message). A
 * naive fetcher that only throws on `!r.ok` resolves that 200-with-error as
 * success, and the empty `rows` then masquerade as a legitimate "no data" state
 * — masking a real DB failure.
 *
 * Call this on the parsed JSON body so SWR's error state fires instead:
 *   const r = await fetch(url); if (!r.ok) throw ...; return throwOnErrorBody(await r.json());
 *
 * Pure → unit-testable in the node suite.
 */
export function throwOnErrorBody<T>(body: T): T {
  if (body && typeof body === 'object' && 'error' in body) {
    const e = (body as { error?: unknown }).error;
    if (e) throw new Error(String(e));
  }
  return body;
}
