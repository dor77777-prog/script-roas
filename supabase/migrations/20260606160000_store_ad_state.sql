-- store_ad_state — operator toggle for "is advertising ON for a (store, platform)".
-- Additive, nullable-safe. MISSING ROW OR enabled=TRUE ⇒ ON (default), so an empty
-- table means the whole system behaves exactly as today. 2026-06-06 (ads-off Phase 1).
CREATE TABLE IF NOT EXISTS public.store_ad_state (
  store_id    TEXT NOT NULL,
  platform    TEXT NOT NULL,                 -- 'meta' | 'google' | 'tiktok'
  enabled     BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (store_id, platform)
);

COMMENT ON TABLE public.store_ad_state IS
  'Operator toggle: is advertising ON for a (store, platform). Missing row = ON (default). ads-off 2026-06-06.';

-- Match the grants the other operator-written tables get (anon SELECT; writes via service_role).
GRANT SELECT ON public.store_ad_state TO anon;
