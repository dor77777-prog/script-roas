-- DQ-3: audit columns for manual_overrides (nullable, idempotent, no backfill).
ALTER TABLE manual_overrides ADD COLUMN IF NOT EXISTS updated_at timestamptz;
ALTER TABLE manual_overrides ADD COLUMN IF NOT EXISTS applies_to text;
