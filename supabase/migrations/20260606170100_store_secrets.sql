-- Encrypted per-store secrets (AES-256-GCM ciphertext). NO anon grant: encrypted
-- AND ungranted = two walls. Writes via service_role only. Self-serve Phase 1.
CREATE TABLE IF NOT EXISTS public.store_secrets (
  store_id    TEXT NOT NULL,
  secret_key  TEXT NOT NULL,          -- e.g. 'SHOPIFY_DOMAIN', 'META_ACCESS_TOKEN'
  ciphertext  TEXT NOT NULL,          -- base64
  iv          TEXT NOT NULL,          -- base64 (12 bytes)
  tag         TEXT NOT NULL,          -- base64 (GCM auth tag)
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (store_id, secret_key)
);
COMMENT ON TABLE public.store_secrets IS 'AES-256-GCM encrypted per-store secrets. NO anon grant. self-serve 2026-06-06.';
-- intentionally NO "GRANT SELECT ... TO anon" — service_role only.
