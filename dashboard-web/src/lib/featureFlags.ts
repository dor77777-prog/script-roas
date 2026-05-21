// dashboard-web/src/lib/featureFlags.ts

/**
 * READ_FROM feature flag — controls whether dashboard reads from Sheets
 * (current default, Apps Script-written) or Postgres (Phase 05.6 dormant,
 * Phase 05.7 default-flipped).
 *
 * IMPORTANT: this function evaluates process.env at CALL TIME, not at
 * module import. Vercel env-var changes take effect on the next request
 * (no redeploy needed). RESEARCH §Pitfall 14.
 *
 * Defaults to 'sheets' for safety — any unrecognized value also returns
 * 'sheets'. Phase 05.7 changes the Vercel env var to 'postgres'.
 *
 * Locked by Phase 05.6 D-E2.
 */
export function readFrom(): 'sheets' | 'postgres' {
  return process.env.READ_FROM === 'postgres' ? 'postgres' : 'sheets';
}
