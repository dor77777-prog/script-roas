# Inngest → Vercel Cron + QStash Migration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax. Spec: `docs/superpowers/specs/2026-06-21-inngest-to-vercel-qstash-migration-design.md`.

**Goal:** Replace Inngest's scheduling + fan-out + retry runtime with Vercel Cron (scheduling, $0 on Pro) + Upstash QStash (fan-out + retries, ~$1–4/mo), removing the $75/mo Inngest base fee with zero data breakage and zero freshness loss.

**Architecture:** Vercel Cron entries (`vercel.json`, UTC) hit `/api/cron/*` scheduler routes. Light crons run work inline; heavy crons publish one QStash message per job → QStash delivers each as an HTTP POST to a `/api/worker/*` route (independent invocation, own timeout + retry) → the route runs the EXISTING handler logic unchanged. Cutover is staged per-cron-family (never both systems at once); Inngest stays registered until Stage 4 (reversible).

**Tech Stack:** Next.js App Router (route handlers), `@upstash/qstash` (Client + Receiver), Vercel Cron, Supabase/Postgres (existing handlers + a new `job_locks` table), TypeScript, vitest.

## Global Constraints

- Work on `main`, commit per task, **do NOT push/deploy** until the operator asks (deploy = `git push origin main` only). Per-stage cutover is deployed + soaked before the next stage.
- **Reuse existing handler logic** — the business logic in `src/inngest/functions/*` (e.g. `runLiveForStore`, the daily/yesterday/meta/google/tiktok handlers) is moved/called unchanged. Only the trigger/transport wrapper changes. No data-model changes.
- **Every `/api/cron/*` and `/api/worker/*` path MUST be in `isDashboardAuthAllowlisted`** or the password gate 401s it (same requirement as `/api/inngest`). A guard test enforces this.
- **Idempotency is the correctness backstop:** all writers already use `ON CONFLICT`; the freshness `transient_error` + next-tick self-heal recover partial failures. Never rely on a lock for correctness, only to reduce wasted concurrent work.
- **TZ:** business dates use `getTodayInIsraelTz` (`src/lib/dateRange.ts`). Vercel Cron is UTC — TZ-sensitive crons fire at BOTH DST UTC offsets + the handler gates on Israel local time and is idempotent.
- `tsc --noEmit`, `npm test` (node) + `npx vitest run --config vitest.config.dom.ts` (dom), `npm run lint`, and `node scripts/docs-currency.mjs` are the pre-push gates — keep them green.
- Pre-push tsc reads `.next/types`; do NOT leave a stale `.next` build dir before pushing (run `rm -rf dashboard-web/.next` if you ran `npm run build`).

---

## File Structure

**New (foundation):**
- `dashboard-web/src/lib/jobs/qstash.ts` — `publishJob()` (publish to a worker route) + `workerUrl()` (absolute URL builder).
- `dashboard-web/src/lib/jobs/verifyQstash.ts` — `verifyQstashRequest(req)` (signature verify, returns raw body).
- `dashboard-web/src/lib/jobs/verifyCron.ts` — `verifyCronRequest(req)` (Vercel Cron `CRON_SECRET` bearer check).
- `dashboard-web/src/lib/jobs/lock.ts` — `acquireJobLock(key, ttlSec)` / `releaseJobLock(key)` (per-store serialization via `job_locks`).
- `supabase/migrations/<TS>_job_locks.sql` — the `job_locks` table.

**New (routes) — created per stage:**
- Stage 1: `src/app/api/cron/whatsapp/route.ts`, `src/app/api/cron/oauth-canary/route.ts`, `src/app/api/cron/cohort/route.ts`.
- Stage 2 (cron): `src/app/api/cron/live/route.ts`, `src/app/api/cron/daily/route.ts`, `src/app/api/cron/yesterday/route.ts`, `src/app/api/cron/tick/route.ts`.
- Stage 2 (workers): `src/app/api/worker/live-store/route.ts`, `src/app/api/worker/daily-store/route.ts`, `src/app/api/worker/yesterday-store/route.ts`, `src/app/api/worker/meta/route.ts`, `src/app/api/worker/google/route.ts`, `src/app/api/worker/tiktok/route.ts`.
- Stage 3 (workers): `src/app/api/worker/backfill/route.ts` (sync-now reuses daily/live worker routes; whatsapp-send reuses the whatsapp send helper).

**Modified:**
- `dashboard-web/vercel.json` — add `crons` array (replaces the Inngest schedules).
- `dashboard-web/src/lib/auth/*` (the `isDashboardAuthAllowlisted` source) — allowlist `/api/cron/*` + `/api/worker/*`.
- `src/app/api/operator/sync-now/route.ts`, `/api/operator/backfill/route.ts`, `/api/operator/notifications/send/route.ts` — publish to QStash instead of `inngest.send` (Stage 3).
- `src/app/api/inngest/route.ts` — drop registrations per stage; deleted in Stage 4.
- Handler files in `src/inngest/functions/*` — export their pure handlers (if not already) for the routes to import; Inngest `createFunction` wrappers removed in Stage 4.

**Deleted (Stage 4):** `src/app/api/inngest/route.ts`, `src/inngest/client.ts`, the `createFunction` wrappers, `src/inngest/functions/cronLiveHeavy.ts`, the `inngest` dependency.

---

## STAGE 0 — Foundation (shared primitives)

### Task 0.1: `job_locks` table migration

**Files:**
- Create: `supabase/migrations/<TS>_job_locks.sql` (TS = a unique timestamp later than the newest existing migration)

**Interfaces:**
- Produces: table `job_locks(key text primary key, locked_at timestamptz not null default now())`.

- [ ] **Step 1: Write the migration**

```sql
-- job_locks — lightweight per-(store,jobType) advisory lock for the
-- post-Inngest pipeline. Replaces Inngest's concurrency:{key:storeId,limit:1}.
-- Acquire = INSERT, or steal a stale lock older than the TTL. Correctness does
-- NOT depend on this (all writers are ON CONFLICT idempotent) — it only avoids
-- wasted concurrent work / reduces races.
CREATE TABLE IF NOT EXISTS job_locks (
  key        text PRIMARY KEY,
  locked_at  timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON job_locks TO service_role;
```

- [ ] **Step 2: Commit** (do NOT apply yet — applied with Stage 2 deploy via the documented `supabase db push` procedure)

```bash
git add supabase/migrations && git commit -m "feat(jobs): job_locks table for post-Inngest per-store serialization"
```

### Task 0.2: QStash publish helper

**Files:**
- Create: `dashboard-web/src/lib/jobs/qstash.ts`
- Test: `dashboard-web/src/lib/jobs/__tests__/qstash.test.ts`

**Interfaces:**
- Produces:
  - `workerUrl(path: string): string` — absolute URL to a worker route (e.g. `workerUrl('/api/worker/meta')`).
  - `publishJob(path: string, body: unknown, opts?: { retries?: number; delayseconds?: number }): Promise<void>` — publishes one QStash message that POSTs `body` (JSON) to `workerUrl(path)`. In local/test (no `QSTASH_TOKEN`) it throws a clear error so callers can branch to inline mode.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, vi } from 'vitest';

describe('workerUrl', () => {
  it('builds an absolute https worker URL from ROAS_BASE_URL', async () => {
    vi.stubEnv('ROAS_BASE_URL', 'https://roas-dashboard-smoky.vercel.app');
    const { workerUrl } = await import('../qstash');
    expect(workerUrl('/api/worker/meta')).toBe('https://roas-dashboard-smoky.vercel.app/api/worker/meta');
  });
});
```

- [ ] **Step 2: Run test, verify it fails** — `npx vitest run src/lib/jobs/__tests__/qstash.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement**

```typescript
import { Client } from '@upstash/qstash';

/** Absolute base URL of the deployed dashboard (QStash needs absolute URLs). */
function baseUrl(): string {
  const b = process.env.ROAS_BASE_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '');
  if (!b) throw new Error('ROAS_BASE_URL (or VERCEL_URL) required for QStash worker URLs');
  return b.replace(/\/$/, '');
}

export function workerUrl(path: string): string {
  return `${baseUrl()}${path.startsWith('/') ? path : `/${path}`}`;
}

let _client: Client | null = null;
function client(): Client {
  if (!process.env.QSTASH_TOKEN) throw new Error('QSTASH_TOKEN not set');
  if (!_client) _client = new Client({ token: process.env.QSTASH_TOKEN });
  return _client;
}

/** Publish ONE job: QStash will POST `body` as JSON to workerUrl(path), with retries. */
export async function publishJob(
  path: string,
  body: unknown,
  opts: { retries?: number; delayseconds?: number } = {},
): Promise<void> {
  await client().publishJSON({
    url: workerUrl(path),
    body,
    retries: opts.retries ?? 3,
    ...(opts.delayseconds ? { delay: opts.delayseconds } : {}),
  });
}
```

- [ ] **Step 4: Add dependency + run test** — `cd dashboard-web && npm i @upstash/qstash` then `npx vitest run src/lib/jobs/__tests__/qstash.test.ts` → PASS.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(jobs): QStash publish helper + workerUrl"`

### Task 0.3: QStash signature-verify guard (worker auth)

**Files:**
- Create: `dashboard-web/src/lib/jobs/verifyQstash.ts`
- Test: `dashboard-web/src/lib/jobs/__tests__/verifyQstash.test.ts`

**Interfaces:**
- Produces: `verifyQstashRequest(req: Request): Promise<{ ok: true; raw: string } | { ok: false }>` — reads the `Upstash-Signature` header + raw body, verifies via `Receiver`. Returns the raw body string on success (handler parses it). In local/test without signing keys, returns `{ ok:false }` unless `ALLOW_UNSIGNED_JOBS==='1'` (dev escape hatch).

- [ ] **Step 1: Write the failing test** (a missing/invalid signature → `{ ok:false }`)

```typescript
import { describe, it, expect } from 'vitest';
import { verifyQstashRequest } from '../verifyQstash';

it('rejects a request with no Upstash-Signature header', async () => {
  const req = new Request('https://x/api/worker/meta', { method: 'POST', body: '{}' });
  const r = await verifyQstashRequest(req);
  expect(r.ok).toBe(false);
});
```

- [ ] **Step 2: Run, verify fail** → FAIL (module missing).

- [ ] **Step 3: Implement**

```typescript
import { Receiver } from '@upstash/qstash';

let _receiver: Receiver | null = null;
function receiver(): Receiver | null {
  const cur = process.env.QSTASH_CURRENT_SIGNING_KEY;
  const nxt = process.env.QSTASH_NEXT_SIGNING_KEY;
  if (!cur || !nxt) return null;
  if (!_receiver) _receiver = new Receiver({ currentSigningKey: cur, nextSigningKey: nxt });
  return _receiver;
}

export async function verifyQstashRequest(
  req: Request,
): Promise<{ ok: true; raw: string } | { ok: false }> {
  const raw = await req.text();
  if (process.env.ALLOW_UNSIGNED_JOBS === '1') return { ok: true, raw }; // dev only
  const sig = req.headers.get('Upstash-Signature');
  const r = receiver();
  if (!sig || !r) return { ok: false };
  try {
    const valid = await r.verify({ body: raw, signature: sig });
    return valid ? { ok: true, raw } : { ok: false };
  } catch {
    return { ok: false };
  }
}
```

- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit** — `feat(jobs): QStash signature verify guard`.

### Task 0.4: Vercel Cron secret guard

**Files:**
- Create: `dashboard-web/src/lib/jobs/verifyCron.ts`
- Test: `dashboard-web/src/lib/jobs/__tests__/verifyCron.test.ts`

**Interfaces:**
- Produces: `verifyCronRequest(req: Request): boolean` — true iff `Authorization: Bearer ${CRON_SECRET}` matches (Vercel Cron sends this when `CRON_SECRET` is set). If `CRON_SECRET` unset, returns false (fail-closed in prod).

- [ ] **Step 1: failing test** (wrong/no bearer → false; correct → true, with `CRON_SECRET` stubbed).
- [ ] **Step 2: verify fail.**
- [ ] **Step 3: Implement**

```typescript
export function verifyCronRequest(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.ALLOW_UNSIGNED_JOBS === '1';
  return req.headers.get('authorization') === `Bearer ${secret}`;
}
```

- [ ] **Step 4: verify pass.** **Step 5: Commit.**

### Task 0.5: Per-store job lock helper

**Files:**
- Create: `dashboard-web/src/lib/jobs/lock.ts`
- Test: `dashboard-web/src/lib/jobs/__tests__/lock.test.ts`

**Interfaces:**
- Consumes: `job_locks` table (Task 0.1), the Supabase admin client (`getSupabaseAdmin`).
- Produces:
  - `acquireJobLock(key: string, ttlSec?: number): Promise<boolean>` — true if acquired (no live lock), false if another run holds a fresh lock. Steals a lock older than `ttlSec` (default 300).
  - `releaseJobLock(key: string): Promise<void>` — deletes the lock row.

- [ ] **Step 1: failing test** — mock the Supabase client; assert acquire returns true on insert, false when a fresh lock exists, true when stealing a stale one. (Mirror the repo's existing Supabase-mock test style, e.g. `freshness.test.ts`.)
- [ ] **Step 2: verify fail.**
- [ ] **Step 3: Implement** (acquire = `INSERT ... ON CONFLICT (key) DO UPDATE SET locked_at=now() WHERE job_locks.locked_at < now() - interval`, `RETURNING key`; row returned ⇒ acquired). Use a Postgres RPC `acquire_job_lock(p_key text, p_ttl_sec int)` if a raw conditional upsert is awkward via supabase-js — define that RPC in the Task 0.1 migration. **Decision: implement the conditional upsert as an RPC in the migration** (cleaner than client-side). Update Task 0.1 to add:

```sql
CREATE OR REPLACE FUNCTION acquire_job_lock(p_key text, p_ttl_sec int)
RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE got boolean;
BEGIN
  INSERT INTO job_locks(key, locked_at) VALUES (p_key, now())
  ON CONFLICT (key) DO UPDATE SET locked_at = now()
    WHERE job_locks.locked_at < now() - make_interval(secs => p_ttl_sec)
  RETURNING true INTO got;
  RETURN COALESCE(got, false);
END $$;
GRANT EXECUTE ON FUNCTION acquire_job_lock(text,int) TO service_role;
```

`acquireJobLock` calls `supabase.rpc('acquire_job_lock', { p_key, p_ttl_sec })`. `releaseJobLock` does `delete from job_locks where key=`.

- [ ] **Step 4: verify pass.** **Step 5: Commit.**

### Task 0.6: Allowlist `/api/cron/*` + `/api/worker/*` + guard test

**Files:**
- Modify: the `isDashboardAuthAllowlisted` source (find via `grep -rn "isDashboardAuthAllowlisted" src/lib`).
- Test: `dashboard-web/src/lib/__tests__/jobRoutesAllowlist.guard.test.ts`

**Interfaces:**
- Consumes: `isDashboardAuthAllowlisted(pathname: string): boolean`.

- [ ] **Step 1: failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { isDashboardAuthAllowlisted } from '@/lib/auth/<file>'; // resolve exact path

it('allowlists every cron + worker route family', () => {
  for (const p of ['/api/cron/live', '/api/cron/daily', '/api/cron/tick', '/api/worker/meta', '/api/worker/live-store', '/api/worker/backfill']) {
    expect(isDashboardAuthAllowlisted(p)).toBe(true);
  }
});
```

- [ ] **Step 2: verify fail** (routes not yet allowlisted).
- [ ] **Step 3: Implement** — add `pathname.startsWith('/api/cron/') || pathname.startsWith('/api/worker/')` to the allowlist predicate (alongside the existing `/api/inngest` rule). These routes are self-authenticating (cron secret / QStash signature), so the password gate must skip them.
- [ ] **Step 4: verify pass.** **Step 5: Commit.**

### Task 0.7: Env + ops doc

- [ ] Document the new env vars (operator sets them in Vercel + Upstash): `QSTASH_TOKEN`, `QSTASH_CURRENT_SIGNING_KEY`, `QSTASH_NEXT_SIGNING_KEY`, `CRON_SECRET` (random), and confirm `ROAS_BASE_URL=https://roas-dashboard-smoky.vercel.app`. Add to `docs/ARCHITECTURE.md` ops section + the README env list. Commit. (Operator action: create an Upstash QStash project, copy the token + signing keys into Vercel env; generate a `CRON_SECRET`.)

---

## STAGE 1 — Low-risk standalone crons (no fan-out)

> Pattern for an inline cron route: verify cron secret → run the existing handler inline → return 200. Add a `vercel.json` cron entry (UTC, dual-fire for TZ-sensitive). Remove the Inngest registration for that function. Deploy + soak.

### Task 1.1: WhatsApp digests → `/api/cron/whatsapp`

**Files:**
- Create: `src/app/api/cron/whatsapp/route.ts`
- Modify: `vercel.json`, `src/app/api/inngest/route.ts` (remove `whatsappCronFunctions` registration), `src/inngest/functions/cronWhatsapp.ts` (ensure the send handler is exported as a plain async fn)
- Test: `src/app/api/cron/__tests__/whatsappRoute.test.ts`

**Interfaces:**
- Consumes: the existing WhatsApp send handler (the body of `whatsappNoon/Evening/Eod`), `verifyCronRequest`, `getTodayInIsraelTz`.

- [ ] **Step 1: failing test** — POST without cron secret → 401; with secret + `slot=noon` → calls the send handler once. (Inject the handler via a thin exported `runWhatsappSlot(slot)`.)
- [ ] **Step 2: verify fail.**
- [ ] **Step 3: Implement route** — `route.ts` reads `?slot=noon|evening|eod`, verifies cron secret, gates on Israel local hour (noon→12, evening→18, eod→00:30 IL; skip if not within the slot's IL window — handles DST dual-fire), calls `runWhatsappSlot(slot)`. Extract `runWhatsappSlot` from `cronWhatsapp.ts` (the existing per-slot logic), imported by both the route and (until removed) the Inngest fn.
- [ ] **Step 4: vercel.json** — add three cron entries hitting `/api/cron/whatsapp?slot=…`, each at BOTH winter+summer UTC offsets for the IL target time (noon 12:00 IL → `0 9 * * *` + `0 10 * * *`; evening 18:00 → `0 15` + `0 16`; eod 00:30 → `30 21` + `30 22`). The IL-hour gate makes the off-DST fire a no-op.
- [ ] **Step 5: remove Inngest registration** — delete `whatsappCronFunctions` from `inngestFunctions` (keep `eventWhatsappSendNow` for now — operator button, Stage 3).
- [ ] **Step 6: tsc + tests + commit.** Deploy + soak (verify one real digest sends at the right IL time, no double-send).

### Task 1.2: OAuth canary → `/api/cron/oauth-canary`
Same pattern. IL 00:00 → `0 21 * * *` + `0 22 * * *` UTC + IL-hour gate. Extract `runOauthCanary()` from `cronOauthCanary.ts`; route verifies cron secret + gate + calls it. Remove `cronOauthCanary` registration. Test (401 without secret; runs with). Commit, deploy, soak.

### Task 1.3: Cohort refresh → `/api/cron/cohort`
Same pattern. IL Mon 04:00 → `0 1 * * 1` + `0 2 * * 1` UTC + IL-day/hour gate. Extract `runCohortRefresh()` from `cronCohortRefresh.ts`; route verifies + gate + calls. Remove `cronCohortRefreshFunctions` registration. Test. Commit, deploy, soak.

**Stage 1 gate:** all three run on Vercel Cron; their Inngest versions are off; verified over a full day. No data pipeline touched yet.

---

## STAGE 2 — Heavy data pipeline (fan-out via QStash)

> Pattern: a `/api/cron/*` scheduler route (verify cron secret → for each store [×platform×scope], `publishJob('/api/worker/…', { … })`) + a `/api/worker/*` route (verify QStash signature → parse body → `acquireJobLock` → run the existing per-store handler → `releaseJobLock`). Each worker route reuses the EXISTING handler unchanged.

### Task 2.1: Live worker route + live cron route
**Files:** Create `src/app/api/worker/live-store/route.ts`, `src/app/api/cron/live/route.ts`; Modify `vercel.json`, `inngest/route.ts` (remove `cronLiveScheduler`+`cronLiveWorker`); Test both routes.
- Worker: `verifyQstashRequest` → `{ storeId }` → `acquireJobLock('live:'+storeId)` (skip if not acquired) → `await runLiveForStore(storeId)` (existing handler) → `releaseJobLock`. Set `export const maxDuration = 300`.
- Cron: `verifyCronRequest` → `for (const storeId of await loadActiveStoreIds()) await publishJob('/api/worker/live-store', { storeId })`.
- vercel.json: `*/10 * * * *` (UTC; DST-agnostic) → `/api/cron/live`.
- [ ] failing tests (worker: bad signature→401, good→calls runLiveForStore once under lock; cron: no secret→401, good→publishes one job per active store [mock publishJob + loadActiveStoreIds]) → fail → implement → pass → commit.

### Task 2.2: Daily worker + daily cron
Same pattern. Worker `/api/worker/daily-store` → `runDailyForStore(storeId)`. Cron `/api/cron/daily` fans out per store. vercel.json: IL 00:05 → `5 21 * * *` + `5 22 * * *` UTC + (the cron route gates on IL date/hour, idempotent). Remove `cronDailyScheduler`+`cronDailyWorker`. Tests, commit.

### Task 2.3: Yesterday-refresh worker + cron
Same pattern. Worker `/api/worker/yesterday-store` → existing yesterday handler. Cron `/api/cron/yesterday` fans out per store on the ~2h cadence → `0 */2 * * *` UTC (cadence, DST-agnostic). Remove the two yesterday fns. Tests, commit.

### Task 2.4: Platform workers (meta/google/tiktok) + tick cron
**Files:** Create `src/app/api/worker/{meta,google,tiktok}/route.ts`, `src/app/api/cron/tick/route.ts`; Modify `vercel.json`, `inngest/route.ts` (remove `cronTickOrchestrator`, `metaWorker`, `googleWorker`, `tiktokWorker`); Tests.
- Each platform worker: `verifyQstashRequest` → `{ store_id, scope }` → `acquireJobLock(platform+':'+store_id+':'+scope)` → run the existing platform handler (status/hot_metrics) → release. `maxDuration=300`.
- Tick cron: `verifyCronRequest` → reuse the EXISTING orchestrator planning logic (`cronTickOrchestrator`'s pure planner that builds the event list from freshness/BUC/stores) but replace its `sendEvent(events)` with `for (const e of events) await publishJob('/api/worker/'+platformOf(e), e.data)`. The orchestrator's planner is already factored (it takes a `sendEvent` injectable — pass a QStash-publishing `sendEvent`).
- vercel.json: `*/10 * * * *` UTC → `/api/cron/tick`.
- [ ] failing tests (each worker signature + handler call + lock; tick cron publishes the planned jobs) → fail → implement → pass → commit.

### Task 2.5: Apply migrations + Stage 2 deploy + SOAK
- [ ] Apply `job_locks` migration to prod via the documented `supabase db push` procedure (hide `.env`, move aside the dup-timestamp gap files, push only the new file, restore).
- [ ] Set the Upstash/QStash + `CRON_SECRET` env vars in Vercel (operator).
- [ ] Deploy. **SOAK:** run `npm run audit:reconcile` (today/yesterday window) + direct PostgREST `data_daily == SUM(campaigns_daily)` checks; confirm `data_freshness.last_success_at` advances on the ~10-min cadence (freshness liveness gate stays green); watch for ≥24h with no divergence/stall before Stage 3.

---

## STAGE 3 — Operator buttons → QStash

### Task 3.1: sync-now
Modify `src/app/api/operator/sync-now/route.ts`: replace `inngest.send(events)` with `publishJob('/api/worker/live-store', …)` and/or `/api/worker/daily-store` per the existing event shape. Test: the route publishes the right jobs. Remove `eventSyncNow` registration. Commit.

### Task 3.2: backfill
Create `src/app/api/worker/backfill/route.ts` wrapping the existing `eventBackfill` handler (verify QStash sig → run). Modify `/api/operator/backfill/route.ts`: `publishJob('/api/worker/backfill', data)` instead of `inngest.send`. Remove `eventBackfill` registration. Test. Commit.

### Task 3.3: whatsapp send-now
Modify `/api/operator/notifications/send/route.ts`: call `runWhatsappSlot`/the send helper inline (or `publishJob('/api/cron/whatsapp'...)` — inline is fine, it's a single send). Remove `eventWhatsappSendNow` registration. Test. Commit. Deploy + verify each button end-to-end.

---

## STAGE 4 — Decommission Inngest

### Task 4.1: Remove the runtime
- [ ] Delete `src/app/api/inngest/route.ts`, `src/inngest/client.ts`, `src/inngest/functions/cronLiveHeavy.ts`, and the `createFunction` wrapper exports (keep the extracted pure handlers the routes import — move them to `src/lib/jobs/handlers/` if cleaner). Remove the `inngest` + `inngest/next` imports everywhere (grep `from 'inngest'`). Remove the `inngest` dependency from `package.json`.
- [ ] Remove the now-dead `INNGEST_*` env references from docs.
- [ ] tsc + full test suite + lint green. Commit.

### Task 4.2: Deploy + cancel Inngest plan
- [ ] Deploy. Verify the whole pipeline runs on Vercel Cron + QStash for ≥24h (reconcile + freshness green).
- [ ] **Operator action:** downgrade/cancel the Inngest plan → $75 → $0. Update the cost memory.

---

## Self-Review

**Spec coverage:** every spec section maps to a task — §3 architecture → Stage 0 helpers + the cron/worker route pattern; §4.1 DST → dual-fire + IL-gate in 1.1–1.3 & 2.2; §4.2 concurrency → Task 0.5 lock + per-worker `acquireJobLock`; §4.3 security → 0.3/0.4 guards + 0.6 allowlist; §4.4 retries → `publishJob` retries + existing freshness; §5 staged cutover → Stages 1–4; §6 verification → Task 2.5 soak; §8 scope (drop cronLiveHeavy) → Task 4.1. ✓
**Placeholders:** the per-cron tasks in Stage 1/2 use a stated pattern with the function-specific values given (schedule, handler, fan-out keys); the controller briefs each subagent with the full route template from Task 2.1/1.1 at dispatch. The one cross-task helper (`runWhatsappSlot`, `runOauthCanary`, `runCohortRefresh`, `runLiveForStore`, `runDailyForStore`, platform handlers) names are fixed here and reused consistently. ✓
**Type consistency:** `publishJob(path, body, opts)`, `verifyQstashRequest(req)→{ok,raw}`, `verifyCronRequest(req)→boolean`, `acquireJobLock(key,ttlSec)→boolean` are used identically across all consuming tasks. ✓
**Open items resolved:** lock = `acquire_job_lock` RPC (0.5); TZ = Vercel dual-fire + IL-gate (1.x/2.2); routes = the File Structure list; `maxDuration=300` on heavy workers. ✓
