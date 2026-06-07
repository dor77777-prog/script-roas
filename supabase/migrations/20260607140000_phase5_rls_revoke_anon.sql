-- Phase 5b — security lockdown: enable RLS on every public table + revoke ALL
-- anon access (schema-wide) + make the enriched views run as caller.
--
-- WHY THIS IS SAFE (nothing breaks): the dashboard's reads were cut over to the
-- service-role client in Phase 5a (getSupabase() now uses SUPABASE_SERVICE_ROLE_KEY),
-- and service_role BYPASSES RLS. All writes + RPCs already use service-role. The
-- anon key is server-only (not NEXT_PUBLIC), there is no client-side Supabase and
-- no realtime publication, so the `anon` role has NO legitimate use. After this
-- migration anon has ZERO access; reads + writes (all service-role) are unaffected.
--
-- REVERSIBLE: this touches grants/RLS only, never DATA. Down-migration =
-- `ALTER TABLE ... DISABLE ROW LEVEL SECURITY` on each table below +
-- re-GRANT the anon grants (originals in migrations 20260521075741 / 20260523080000
-- / 20260530230000 / 20260530270000 / 20260605120000 / 20260605130000 / 20260606160000
-- / customer_first_order + customer_cohort_monthly ledgers + the *_hot_set / agg /
-- recompute function GRANTs) + `ALTER VIEW ... SET (security_invoker = off)`.

-- 1. Enable RLS on every public table (no policies → deny-all to anon; service_role
--    bypasses RLS entirely, so server-side reads/writes are unaffected).
ALTER TABLE public.stores                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.manual_overrides        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.data_daily              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products_daily          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaigns_daily         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ads_daily               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders_attribution      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_catalog         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dashboard_state         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_config     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.token_failures          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_registry       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.adset_registry          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ad_registry             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_status_events  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cron_tick_snapshots     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_ad_state          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_first_order    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_cohort_monthly ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_secrets           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_webhooks          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_events            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meta_buc_usage          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.data_freshness          ENABLE ROW LEVEL SECURITY;

-- 2. Revoke ALL anon access, schema-wide (exhaustive — covers every table/view,
--    sequence, and function, including any not individually listed). anon has no
--    legitimate use; this is the real lockdown. service_role is unaffected.
REVOKE ALL ON ALL TABLES    IN SCHEMA public FROM anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM anon;

-- 3. Enriched views: run with the caller's privileges (clears the Supabase
--    "Security Definer View" advisor; moot once anon is revoked, but correct).
ALTER VIEW public.campaigns_enriched SET (security_invoker = on);
ALTER VIEW public.adsets_enriched    SET (security_invoker = on);
ALTER VIEW public.ads_enriched       SET (security_invoker = on);
