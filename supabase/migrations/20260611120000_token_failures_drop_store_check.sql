-- 2026-06-11 (multi-tenant readiness audit, MT-0) — drop the hardcoded
-- 3-store CHECK on token_failures.store_id.
--
-- BUG (live, self-serve): 20260523080000 created
--   CHECK (store_id IN ('uzoshop', 'zolplus', 'usmile360', 'global'))
-- predating the self-serve store project. Any store added via the add-store
-- wizard gets its token-failure upserts REJECTED by this constraint; the
-- notifier deliberately swallows alerting errors ("alerting must never break
-- the pipeline"), so the new store silently gets NO failure alerts and NO
-- throttle log — the operator would never know its tokens are dying.
--
-- FIX: replace the closed-list CHECK with a shape check (non-empty). Note a
-- FK to stores(id) is deliberately NOT used: 'global' is a reserved pseudo
-- store for platform-wide failures (FX/WhatsApp), and failure HISTORY must
-- survive a store's hard delete.
--
-- The provider CHECK stays: providers are a code-level closed enum — adding
-- one requires a deploy anyway, and the lockstep migration is the documented
-- procedure.

DO $$
DECLARE
  c RECORD;
BEGIN
  FOR c IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.token_failures'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%store_id%IN%'
  LOOP
    EXECUTE format('ALTER TABLE public.token_failures DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE public.token_failures
  ADD CONSTRAINT token_failures_store_id_nonempty CHECK (store_id <> '');
