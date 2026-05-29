-- Phase A backfill: anything strictly before yesterday is treated as finalized
-- by cron-daily. One-shot; new rows after this point are written with
-- explicit source values by cron-daily / cron-live.

UPDATE data_daily       SET is_finalized = true, source = 'daily_reconcile', reconciled_at = updated_at WHERE date < CURRENT_DATE - 1 AND is_finalized = false;
UPDATE campaigns_daily  SET is_finalized = true, source = 'daily_reconcile', reconciled_at = updated_at WHERE date < CURRENT_DATE - 1 AND is_finalized = false;
UPDATE ads_daily        SET is_finalized = true, source = 'daily_reconcile', reconciled_at = updated_at WHERE date < CURRENT_DATE - 1 AND is_finalized = false;
UPDATE products_daily   SET is_finalized = true, source = 'daily_reconcile', reconciled_at = updated_at WHERE date < CURRENT_DATE - 1 AND is_finalized = false;
