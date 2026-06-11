-- 2026-06-11 (MT-0, take 2) — actually drop the hardcoded 3-store CHECK.
--
-- 20260611120000 was a silent NO-OP: its matcher looked for '%store_id%IN%'
-- in pg_get_constraintdef(), but Postgres normalizes `IN (...)` to
-- `= ANY (ARRAY[...])` when storing the constraint — no 'IN' substring
-- survives, the loop matched nothing, and the legacy CHECK kept rejecting
-- every non-founding store (verified live: insert for store 'mt0-verify-store'
-- still failed 23514 after the push).
--
-- This version matches on the one thing only the legacy constraint contains —
-- the literal founding-store id 'uzoshop' — and then SELF-VERIFIES, raising
-- loudly if any such constraint survived (no more silent no-ops).

DO $$
DECLARE
  c RECORD;
  leftover INTEGER;
BEGIN
  FOR c IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.token_failures'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%uzoshop%'
  LOOP
    EXECUTE format('ALTER TABLE public.token_failures DROP CONSTRAINT %I', c.conname);
    RAISE NOTICE 'dropped legacy constraint: %', c.conname;
  END LOOP;

  SELECT COUNT(*) INTO leftover
  FROM pg_constraint
  WHERE conrelid = 'public.token_failures'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%uzoshop%';
  IF leftover > 0 THEN
    RAISE EXCEPTION 'token_failures still has % legacy store CHECK constraint(s)', leftover;
  END IF;
END $$;

-- The nonempty shape check from 20260611120000 already exists; keep it.
-- (That migration's ADD ran fine — only its DROP matcher was wrong.)
