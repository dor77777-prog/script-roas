-- 2026-06-24 — Phase 5b follow-up: enable RLS + revoke anon on public.job_locks.
-- job_locks was created 2026-06-21 (the Inngest->QStash migration) AFTER the
-- Phase 5b lockdown (20260607140000_phase5_rls_revoke_anon), so it never got RLS
-- enabled -> Supabase's advisor flagged it as rls_disabled_in_public ("table
-- publicly accessible"). It is the ONLY public table not covered by Phase 5b.
--
-- Same treatment as every other public table: enable RLS (no policies =>
-- deny-all to anon/PUBLIC; service_role BYPASSES RLS, so acquire_job_lock + the
-- /api/cron/* and /api/worker/* routes -- all service-role -- are unaffected) +
-- revoke anon/PUBLIC grants. Touches grants/RLS only, never data.
-- REVERSIBLE: ALTER TABLE public.job_locks DISABLE ROW LEVEL SECURITY; + re-GRANT.
ALTER TABLE public.job_locks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.job_locks FROM anon;
REVOKE ALL ON public.job_locks FROM PUBLIC;
