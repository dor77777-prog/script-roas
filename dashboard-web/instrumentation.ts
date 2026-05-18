/**
 * Next.js instrumentation hooks.
 *
 * register():     Runs once on server boot. Loads the appropriate Sentry
 *                 config for the current runtime. Sentry.init() is itself
 *                 a no-op when SENTRY_DSN is absent (see sentry.*.config.ts).
 *
 * onRequestError: Invoked by Next.js on every server-side request error.
 *                 Lazy-imports @sentry/nextjs AND gates on DSN presence
 *                 BEFORE calling captureRequestError — so localhost without
 *                 a DSN truly does zero Sentry work (no module load cost,
 *                 no captureRequestError side effects).
 *
 * Previously this file used a top-level `await import('@sentry/nextjs')`
 * to assign onRequestError, which (a) made the whole module fail if
 * @sentry/nextjs failed to load, and (b) wired captureRequestError to
 * run on every request error regardless of DSN — contradicting the
 * "silent no-op without DSN" guarantee. See WR-01 in 02-foundations/02-REVIEW.md.
 */

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config');
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config');
  }
}

export async function onRequestError(
  err: unknown,
  request: Parameters<NonNullable<typeof import('@sentry/nextjs').captureRequestError>>[1],
  context: Parameters<NonNullable<typeof import('@sentry/nextjs').captureRequestError>>[2],
) {
  // Skip the dynamic import entirely when there is no DSN configured —
  // localhost without Sentry stays at zero overhead.
  if (!process.env.SENTRY_DSN && !process.env.NEXT_PUBLIC_SENTRY_DSN) return;
  const { captureRequestError } = await import('@sentry/nextjs');
  return captureRequestError(err, request, context);
}
