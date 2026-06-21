import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

/**
 * Per-(store,jobType) advisory lock backed by the `job_locks` table.
 * Replaces Inngest's concurrency:{key:storeId,limit:1}. Correctness does NOT
 * depend on this (all writers are ON CONFLICT idempotent) — it only avoids
 * wasted concurrent work / reduces races.
 *
 * `acquireJobLock` returns true if this caller now holds the lock (no live
 * lock, or it stole one older than `ttlSec`), false if another run holds a
 * fresh lock. `releaseJobLock` deletes the lock row.
 */
export async function acquireJobLock(key: string, ttlSec = 300): Promise<boolean> {
  const sb = getSupabaseAdmin();
  const { data, error } = await sb.rpc('acquire_job_lock', { p_key: key, p_ttl_sec: ttlSec });
  if (error) {
    console.warn('[acquireJobLock] rpc error:', error.message);
    return false;
  }
  return data === true;
}

export async function releaseJobLock(key: string): Promise<void> {
  const sb = getSupabaseAdmin();
  const { error } = await sb.from('job_locks').delete().eq('key', key);
  if (error) {
    console.warn('[releaseJobLock] delete error:', error.message);
  }
}
