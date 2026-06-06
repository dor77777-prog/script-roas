-- supabase/migrations/20260606140000_add_source_to_store_events.sql
-- Activity-feed source attribution (2026-06-06): per-event ad-platform source.
-- Values mirror OrderSource (meta-paid/google-paid/tiktok-paid/direct/…); null
-- for refunds + unclassified. Additive + nullable → no writer/reader breaks.
-- store_events is read directly (service-role) — no view to rebuild.
ALTER TABLE store_events ADD COLUMN IF NOT EXISTS source TEXT;
