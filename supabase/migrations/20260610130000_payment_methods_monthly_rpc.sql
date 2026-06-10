-- P0-1 (2026-06-10) — agg_payment_methods_monthly RPC.
--
-- readPaymentMethodsByMonth (postgresReaders.ts) used to paginate() the
-- ENTIRE orders_attribution table (no date bound, ordered store_id, order_id
-- ASC) and GROUP BY month × store × gateway-category in JS. paginate()
-- hard-caps at 50 chunks × 1000 = 50,000 rows and (pre-P0-1) exited SILENTLY
-- at the cap. orders_attribution is at ~46.8k rows and growing ~2,100/month,
-- so by ~Aug 2026 the lexicographically-LAST store's (zolplus) NEWEST orders
-- would have been silently dropped from the תשלומים tab.
--
-- This function moves the GROUP BY into SQL: one output row per
-- month × store × RAW gateway (a few hundred rows total, unbounded by table
-- growth). The reader keeps categorizing the raw gateway in code via
-- categorizePaymentGateway (regex-based — deliberately NOT replicated in SQL
-- so categorization stays adjustable, per payments.ts).
--
-- Semantics replicated EXACTLY from the JS aggregation:
--   - month        = to_char(date, 'YYYY-MM')   — same as String(date).slice(0, 7);
--                    orders_attribution.date is DATE NOT NULL (initial schema),
--                    so every emitted month is a well-formed 7-char key (the
--                    reader's malformed-month skip guard never triggers).
--   - gateway      = COALESCE(payment_gateway, '') — NULL and '' are
--                    indistinguishable to categorizePaymentGateway (both fall
--                    into the falsy `if (!raw) return 'other'` branch), so
--                    collapsing NULL into '' preserves the bucket output
--                    byte-for-byte while keeping the GROUP BY key non-null.
--   - orders       = COUNT(*)                    — every row counted once,
--                    even when total_cad is NULL (JS did `orders += 1`
--                    unconditionally).
--   - revenue_cad  = SUM(COALESCE(total_cad, 0)) — JS coerced NULL/'' to 0
--                    via toNumber() before summing.
--
-- ORDER BY is cosmetic (the reader re-sorts months ascending), but kept so
-- ad-hoc psql runs read naturally.

CREATE OR REPLACE FUNCTION public.agg_payment_methods_monthly()
RETURNS TABLE(month text, store_id text, gateway text, orders bigint, revenue_cad numeric)
LANGUAGE sql
STABLE
AS $$
  SELECT to_char(oa.date, 'YYYY-MM')             AS month,
         oa.store_id                             AS store_id,
         COALESCE(oa.payment_gateway, '')        AS gateway,
         COUNT(*)::bigint                        AS orders,
         SUM(COALESCE(oa.total_cad, 0))::numeric AS revenue_cad
    FROM orders_attribution oa
   GROUP BY 1, 2, 3
   ORDER BY 1, 2, 3;
$$;

-- The reader calls this through getSupabase(), which is the SERVICE-ROLE
-- client (Phase 5a repoint; anon SELECT was revoked in Phase 5b).
GRANT EXECUTE ON FUNCTION public.agg_payment_methods_monthly() TO service_role;
