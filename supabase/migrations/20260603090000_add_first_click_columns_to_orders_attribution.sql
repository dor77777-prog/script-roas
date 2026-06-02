-- Phase 4 (first-click lens) — additive, nullable columns on orders_attribution.
-- Pre-migration rows keep NULL = "no first-click signal" (NOT 'direct').
-- READ-ONLY toward ad platforms: these are populated only from Shopify cart
-- attributes (ft_*) folded into the order's note_attributes; nothing is ever
-- sent to any pixel/CAPI.

ALTER TABLE orders_attribution
  ADD COLUMN IF NOT EXISTS first_touch_source    text,
  ADD COLUMN IF NOT EXISTS first_fbclid_present   boolean,
  ADD COLUMN IF NOT EXISTS first_gclid_present    boolean,
  ADD COLUMN IF NOT EXISTS first_ttclid_present   boolean,
  ADD COLUMN IF NOT EXISTS first_utm_source       text,
  ADD COLUMN IF NOT EXISTS first_utm_medium       text,
  ADD COLUMN IF NOT EXISTS first_utm_campaign     text,
  ADD COLUMN IF NOT EXISTS first_utm_content      text,
  ADD COLUMN IF NOT EXISTS first_utm_id           text,
  ADD COLUMN IF NOT EXISTS first_utm_term         text,
  ADD COLUMN IF NOT EXISTS first_seen_at          text;

COMMENT ON COLUMN orders_attribution.first_touch_source IS
  'Phase 4 first-click lens: classified source of the customer''s FIRST touch (ft_* cart attributes). NULL = no first-click signal captured (NOT direct).';
