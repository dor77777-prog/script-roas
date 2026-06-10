-- 2026-06-10 (P1-17 / full-system audit) — stop the every-10-min full-table
-- rewrite inside recompute_first_order_flags().
--
-- BUG: STEP 2 UPDATEd EVERY classified row for the store (no change check)
-- and STEP 3 re-wrote EVERY guest row to NULL unconditionally, on EVERY
-- cron-live tick (~10 min) and again in cron-daily. Written when
-- orders_attribution held ~1.2k rolling rows; since the deep backfill it
-- holds ~46k+ — so the function now generates millions of dead tuples/day
-- (vacuum pressure, table bloat) while changing almost nothing.
--
-- FIX (additive, CREATE OR REPLACE only, same name/signature):
--   STEP 2 gains `AND oa.is_first_order IS DISTINCT FROM (oa.order_id =
--   l.first_order_id)` — only rows whose flag actually CHANGES are written.
--   STEP 3 gains `AND is_first_order IS NOT NULL` — guests already NULL are
--   untouched.
-- Semantics are byte-identical post-run; only the write set shrinks.
-- STEP 1 (ledger maintenance) is unchanged.

CREATE OR REPLACE FUNCTION public.recompute_first_order_flags(p_store_id text)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  --------------------------------------------------------------------------
  -- STEP 1 — Maintain the ledger ADDITIVELY from the rolling window.
  -- (Unchanged from 20260602150000 — ON CONFLICT only LOWERS the stored min.)
  --------------------------------------------------------------------------
  INSERT INTO customer_first_order AS l
    (store_id, customer_id, first_order_id, first_created_at)
  SELECT
    c.store_id,
    c.customer_id,
    c.order_id        AS first_order_id,
    c.order_created_at AS first_created_at
  FROM (
    SELECT
      store_id,
      customer_id,
      order_id,
      order_created_at,
      ROW_NUMBER() OVER (
        PARTITION BY store_id, customer_id
        ORDER BY order_created_at ASC NULLS LAST, order_id ASC
      ) AS rn
    FROM orders_attribution
    WHERE store_id = p_store_id
      AND customer_id IS NOT NULL
      AND order_created_at IS NOT NULL
  ) c
  WHERE c.rn = 1
  ON CONFLICT (store_id, customer_id) DO UPDATE
    SET first_order_id   = EXCLUDED.first_order_id,
        first_created_at = EXCLUDED.first_created_at
    WHERE EXCLUDED.first_created_at < l.first_created_at;

  --------------------------------------------------------------------------
  -- STEP 2 — Derive is_first_order from the ledger — CHANGED ROWS ONLY.
  --
  -- P1-17: `IS DISTINCT FROM` guard — NULL-safe inequality so a row whose
  -- flag is already correct (including a NULL flag that must become
  -- true/false) is written exactly once and never again.
  --------------------------------------------------------------------------
  UPDATE orders_attribution oa
     SET is_first_order = (oa.order_id = l.first_order_id)
    FROM customer_first_order l
   WHERE oa.store_id    = p_store_id
     AND oa.customer_id IS NOT NULL
     AND oa.store_id    = l.store_id
     AND oa.customer_id = l.customer_id
     AND oa.is_first_order IS DISTINCT FROM (oa.order_id = l.first_order_id);

  --------------------------------------------------------------------------
  -- STEP 3 — Guests stay unclassifiable — only rows not already NULL.
  --------------------------------------------------------------------------
  UPDATE orders_attribution
     SET is_first_order = NULL
   WHERE store_id = p_store_id
     AND customer_id IS NULL
     AND is_first_order IS NOT NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION public.recompute_first_order_flags(text)
  TO anon, service_role;
