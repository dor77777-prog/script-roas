-- Self-serve stores Phase 1 — additive lifecycle + config columns. Defaults +
-- backfill keep the 3 existing stores byte-identical to today's hardcoded reality.
ALTER TABLE public.stores
  ADD COLUMN IF NOT EXISTS status        TEXT NOT NULL DEFAULT 'active',  -- 'active' | 'archived'
  ADD COLUMN IF NOT EXISTS archived_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS brand_color   TEXT,
  ADD COLUMN IF NOT EXISTS is_headless   BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS has_tiktok    BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS display_order INTEGER;

-- Backfill the 3 existing stores to match the current hardcoded config exactly.
UPDATE public.stores SET is_headless = FALSE, has_tiktok = TRUE,  brand_color = 'var(--store-uzo)', display_order = 1 WHERE id = 'uzoshop';
UPDATE public.stores SET is_headless = FALSE, has_tiktok = FALSE, brand_color = 'var(--store-3)',   display_order = 2 WHERE id = 'zolplus';
UPDATE public.stores SET is_headless = TRUE,  has_tiktok = TRUE,  brand_color = 'var(--store-usm)', display_order = 3 WHERE id = 'usmile360';
