-- Phase 3 (2026-06-02) — first-order-EVER flagging RPC.
--
-- Idempotent. For ONE store, recompute is_first_order over the FULL per-store
-- history (UNFILTERED by date — "first ever" is a lifetime property, so a
-- new order can demote a previously-flagged later order). Definition:
--
--   is_first_order = (order_created_at = MIN(order_created_at)
--                       OVER (PARTITION BY store_id, customer_id))
--
-- Deterministic order_id tiebreak: when two orders share the exact MIN
-- timestamp for a customer, the lexicographically-smallest order_id wins —
-- so exactly ONE row per (store, customer) is TRUE regardless of tie order.
--
-- NULL where customer_id IS NULL (guest checkout → unclassifiable; never
-- silently "returning").
--
-- Called from:
--   • cronDaily.ts runDailyForStore (after orders_attribution UPSERT)
--   • cronLive.ts persist step (after today's orders_attribution UPSERT)
-- Safe to run repeatedly — it fully recomputes the boolean each call.

CREATE OR REPLACE FUNCTION public.recompute_first_order_flags(p_store_id text)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  WITH ranked AS (
    SELECT
      store_id,
      order_id,
      ROW_NUMBER() OVER (
        PARTITION BY store_id, customer_id
        ORDER BY order_created_at ASC NULLS LAST, order_id ASC
      ) AS rn
    FROM orders_attribution
    WHERE store_id = p_store_id
      AND customer_id IS NOT NULL
  )
  UPDATE orders_attribution oa
     SET is_first_order = (r.rn = 1)
    FROM ranked r
   WHERE oa.store_id = r.store_id
     AND oa.order_id = r.order_id;

  -- Guest checkouts (customer_id NULL) stay unclassifiable.
  UPDATE orders_attribution
     SET is_first_order = NULL
   WHERE store_id = p_store_id
     AND customer_id IS NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION public.recompute_first_order_flags(text)
  TO anon, service_role;
