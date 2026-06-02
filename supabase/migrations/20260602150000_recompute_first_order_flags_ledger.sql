-- Phase 3 (2026-06-02) — LEDGER-BASED rewrite of recompute_first_order_flags().
--
-- Additive + idempotent. CREATE OR REPLACE only — same name/signature
-- (recompute_first_order_flags(p_store_id text) RETURNS void). No DROP /
-- DELETE / TRUNCATE (per supabase/MIGRATION-DISCIPLINE.md, additive-only).
--
-- WHY THIS REPLACES THE WINDOW-MIN VERSION
-- ----------------------------------------
-- orders_attribution is a ROLLING WINDOW (only the recent ~weeks of orders
-- are retained — ~1.2k rows — while a store like uzoshop has ~40k+ orders in
-- Shopify history). The previous body derived is_first_order from a window-MIN
-- over orders_attribution, which is WRONG for any customer whose true first
-- order predates the window: it mislabels a RETURNING customer's recent order
-- as "first".
--
-- FIX: derive is_first_order from the durable per-(store, customer) ledger
-- customer_first_order (see 20260602140000_customer_first_order_ledger.sql),
-- which is SEEDED once from FULL Shopify history (Bulk Operations backfill)
-- and MAINTAINED additively here. The ledger min only ever LOWERS, never
-- raises — so the rolling window can refine an older first-order but can never
-- clobber the full-history seed.
--
-- Called from (unchanged callers):
--   • cronDaily.ts runDailyForStore (after orders_attribution UPSERT)
--   • cronLive.ts persist step       (after today's orders_attribution UPSERT)
-- Safe to run repeatedly — fully idempotent.
--
-- THREE STEPS
-- -----------
--   1) Maintain the ledger ADDITIVELY from the current window: upsert the
--      earliest (store, customer) candidate seen in the window; ON CONFLICT
--      only LOWER the stored min (older candidate wins), NEVER raise it.
--   2) Derive is_first_order on orders_attribution from the ledger: an order
--      is "first" iff its order_id == the ledger's first_order_id for that
--      (store, customer).
--   3) Guests (customer_id NULL) stay unclassifiable → is_first_order NULL.

CREATE OR REPLACE FUNCTION public.recompute_first_order_flags(p_store_id text)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  --------------------------------------------------------------------------
  -- STEP 1 — Maintain the ledger ADDITIVELY from the rolling window.
  --
  -- For this store, pick each customer's earliest window candidate
  -- (ROW_NUMBER ORDER BY order_created_at ASC NULLS LAST, order_id ASC; rn=1
  -- is the deterministic earliest). Upsert it into the ledger.
  --
  -- ON CONFLICT: only LOWER the stored min — overwrite the ledger row ONLY
  -- when the incoming candidate is strictly OLDER than what's stored
  -- (EXCLUDED.first_created_at < existing). This protects the full-history
  -- backfill seed: a narrow window can refine downward but never raise the
  -- min above the true lifetime first order.
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
  -- STEP 2 — Derive is_first_order from the ledger.
  --
  -- An order is the customer's first-ever for this store iff its order_id
  -- equals the ledger's first_order_id. Joins on (store_id, customer_id);
  -- guests (customer_id NULL) are excluded here and handled in STEP 3.
  --------------------------------------------------------------------------
  UPDATE orders_attribution oa
     SET is_first_order = (oa.order_id = l.first_order_id)
    FROM customer_first_order l
   WHERE oa.store_id    = p_store_id
     AND oa.customer_id IS NOT NULL
     AND oa.store_id    = l.store_id
     AND oa.customer_id = l.customer_id;

  --------------------------------------------------------------------------
  -- STEP 3 — Guests (customer_id NULL) stay unclassifiable.
  --------------------------------------------------------------------------
  UPDATE orders_attribution
     SET is_first_order = NULL
   WHERE store_id = p_store_id
     AND customer_id IS NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION public.recompute_first_order_flags(text)
  TO anon, service_role;
