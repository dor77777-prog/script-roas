-- job_locks — lightweight per-(store,jobType) advisory lock for the
-- post-Inngest pipeline. Replaces Inngest's concurrency:{key:storeId,limit:1}.
-- Acquire = INSERT, or steal a stale lock older than the TTL. Correctness does
-- NOT depend on this (all writers are ON CONFLICT idempotent) — it only avoids
-- wasted concurrent work / reduces races.
CREATE TABLE IF NOT EXISTS job_locks (
  key        text PRIMARY KEY,
  locked_at  timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON job_locks TO service_role;

-- Conditional upsert as an RPC (cleaner than a client-side raw upsert via
-- supabase-js). Insert a fresh lock, OR steal one whose locked_at is older than
-- the TTL. Returns true iff this caller now holds the lock.
CREATE OR REPLACE FUNCTION acquire_job_lock(p_key text, p_ttl_sec int)
RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE got boolean;
BEGIN
  INSERT INTO job_locks(key, locked_at) VALUES (p_key, now())
  ON CONFLICT (key) DO UPDATE SET locked_at = now()
    WHERE job_locks.locked_at < now() - make_interval(secs => p_ttl_sec)
  RETURNING true INTO got;
  RETURN COALESCE(got, false);
END $$;
GRANT EXECUTE ON FUNCTION acquire_job_lock(text,int) TO service_role;
