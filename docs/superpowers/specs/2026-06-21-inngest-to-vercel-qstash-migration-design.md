# Design: Migrate the data pipeline off Inngest → Vercel Cron + QStash

**Date:** 2026-06-21
**Status:** Approved (design) — pending spec review → writing-plans
**Goal:** Eliminate the $75/mo Inngest Pro base fee by replacing Inngest's
scheduling + fan-out + retry runtime with **Vercel Cron** (scheduling, $0,
included in the existing Vercel Pro plan) + **Upstash QStash** (fan-out +
retries, ~$1–4/mo). Target: **~$70/mo saved (~$840/yr)** with **zero data
breakage and zero freshness/speed degradation**.

## 1. Why (cost rationale, verified)

Inngest usage (this month, from the operator's dashboard): **138,204 executions
of 1,000,000 included · 0 overage · 67,793 runs · 1,560 steps**. The $75 is a
flat **Pro base fee**; the account runs at ~14% of the included quota, so
trimming calls saves $0. Inngest has **no middle tier** — Free covers only
50,000 executions/mo (the pipeline does ~200K), then it jumps to Pro $75.
Therefore the only way to cut cost is to **leave Inngest**.

## 2. Current Inngest surface (inventory)

**Cron-triggered (8 active; `cronLiveHeavy` is disabled — NOT migrated):**

| Function | Schedule (IL) | Action |
|---|---|---|
| `cronDailyScheduler` | `5 0 * * *` (00:05) | fan-out `cron/daily.store.requested` per store |
| `cronLiveScheduler` | `*/10 * * * *` | fan-out `cron/live.store.requested` per store |
| `cronYesterdayRefreshScheduler` | ~every 2h | fan-out `cron/yesterday.store.requested` per store |
| `cronTickOrchestrator` | `*/10 * * * *` (UTC) | fan-out `META/GOOGLE/TIKTOK_JOB_REQUESTED` per store×platform×scope |
| `cronOauthCanary` | `0 0 * * *` (00:00) | standalone (token canary) |
| `cronCohortRefresh` | `0 4 * * 1` (Mon 04:00) | standalone (weekly cohort rebuild) |
| `whatsappNoon` / `whatsappEvening` / `whatsappEod` | `0 12` / `0 18` / `30 0` | standalone (digest sends) |

**Event-triggered workers (concurrency-keyed by store, limit 1):**
`cronDailyWorker` (`cron/daily.store.requested`), `cronLiveWorker`
(`cron/live.store.requested`), `cronYesterdayRefreshWorker`
(`cron/yesterday.store.requested`), `metaWorker` (`META_JOB_REQUESTED`),
`googleWorker` (`GOOGLE_JOB_REQUESTED`), `tiktokWorker` (`TIKTOK_JOB_REQUESTED`).

**Operator-button events (emitted via `inngest.send` from API routes):**
`eventSyncNow` (`event/sync-now` ← `/api/operator/sync-now`), `eventBackfill`
(`event/backfill` ← `/api/operator/backfill`), `eventWhatsappSendNow`
(`notifications/whatsapp.send-now` ← `/api/operator/notifications/send`).

**Inngest features relied on:** cron triggers; event fan-out (`step.sendEvent`
at outer level); per-store concurrency=1 (serialization); automatic retries on
throw; durable steps (`step.run`) — but only **1,560 steps/mo**, i.e. ~1–2 step
boundaries per run, so durable-step replay is a thin surface.

## 3. Target architecture

```
Vercel Cron (vercel.json, UTC)  ──hits──▶  /api/cron/*  (scheduler routes)
                                              │
            light crons (whatsapp/canary/cohort): run work INLINE ($0)
            heavy crons (live/daily/yesterday/tick): publish 1 msg/job ─▶ QStash
                                                                            │
                                              QStash (HTTP delivery + retry) │
                                                                            ▼
                                                        /api/worker/*  (worker routes)
                                                        = existing handler logic
                                                        (verify QStash signature)
```

- **Scheduling** → Vercel Cron entries in `vercel.json` → `/api/cron/*` routes.
- **Fan-out** → heavy cron routes publish one QStash message per job (per store,
  or per store×platform×scope) instead of `step.sendEvent`. QStash delivers each
  as an independent HTTP POST to a `/api/worker/*` route → independent function
  invocation (own timeout + retry) → **preserves the parallelism/speed** Inngest
  gave.
- **Workers** → `/api/worker/*` routes wrap the EXISTING handler functions
  (`runLiveForStore`, the daily/yesterday/meta/google/tiktok handlers). Business
  logic is unchanged; only the trigger/transport wrapper changes.
- **Operator buttons** → the three operator API routes publish to QStash (to the
  same worker routes) instead of `inngest.send`.

## 4. Key technical decisions

### 4.1 DST / UTC (Vercel Cron is UTC-only, Israel observes DST)
The `*/10` crons (live, tick) are DST-agnostic (a 10-min cadence is identical in
any whole-hour offset) → plain `*/10 * * * *` UTC. The **fixed-IL-time** crons
(daily 00:05, oauth 00:00, cohort Mon 04:00, whatsapp 12:00/18:00/00:30) are
scheduled at **both candidate UTC times** (winter IL=UTC+2, summer IL=UTC+3), and
the handler **gates on actual Israel local time** (`getTodayInIsraelTz` +
IL-hour check) and is **idempotent** (skips if today's IL date already
processed). Worst case a handler fires twice across the DST seam — harmless
because the pipeline is idempotent (`ON CONFLICT`). (Implementation may instead
use a QStash schedule if QStash's TZ support is confirmed to cleanly cover this —
to be validated in the plan; the Vercel dual-fire + IL-gate is the robust
default.)

### 4.2 Per-store concurrency = 1 (serialization)
Inngest serialized per-store work (`concurrency: key=storeId, limit=1`) to avoid
two ticks racing the same store's rows. Replacement: a **lightweight per-(store,
jobType) lock** acquired at the top of each data-writer worker route — a Postgres
advisory lock (or a `job_locks` row with stale-takeover) — that **skips** the run
if another is in flight (the next tick re-derives; freshness self-heals). The
**correctness backstop is the existing idempotency** (`ON CONFLICT`) + the
resilient-agg pass, so even a missed lock cannot corrupt data. Exact lock
mechanism finalized in the plan.

### 4.3 Security / auth
- **Worker routes** verify the **QStash request signature** (`Upstash-Signature`,
  via QStash's verification key) and reject unsigned requests.
- **Cron routes** verify a **shared secret** (Vercel Cron sends an
  `Authorization: Bearer <CRON_SECRET>` header; verify it) so only Vercel's
  scheduler can trigger them.
- **Both route families MUST be added to `isDashboardAuthAllowlisted`** (like the
  current `/api/inngest`) — otherwise the dashboard password gate silently 401s
  them. A test asserts every `/api/cron/*` and `/api/worker/*` path is
  allowlisted.

### 4.4 Retries & durability
QStash retries failed worker deliveries (configurable retry count + backoff),
replacing Inngest's auto-retry. Durable `step.run` replay is dropped, but: (a)
step usage is minimal (1,560/mo), (b) the pipeline is idempotent, (c) the
freshness `transient_error` system + next-tick self-heal already recover partial
failures. Net: equivalent resilience.

## 5. Staged cutover (the "no-break" guarantee)

We do **NOT** run both systems in parallel (that would double ad-platform API
calls + race writes). Instead, **cut over one cron family at a time**, with a
soak between stages; each cron runs on EITHER Inngest OR the new system, never
both. Inngest functions stay in the codebase (and registered) until Stage 4, so
each stage is **reversible** (flip the registration back).

- **Stage 1 — low-risk standalone crons:** whatsapp ×3, oauth-canary, cohort.
  Move to Vercel Cron inline routes; remove their Inngest registrations. Soak
  (verify a digest sends, a canary runs, the weekly cohort rebuild runs).
- **Stage 2 — the heavy data pipeline:** live, daily, yesterday, tick → Vercel
  Cron + QStash workers. Remove their Inngest registrations. **Soak with the
  `audit:reconcile` harness + freshness checks + before/after `data_daily`
  comparison**; confirm live freshness cadence unchanged.
- **Stage 3 — operator buttons:** sync-now, backfill, whatsapp-send-now → publish
  to QStash. Verify each button end-to-end.
- **Stage 4 — decommission:** remove the Inngest client, `/api/inngest`, the
  `createFunction` wrappers, and the `inngest` dependency. **Downgrade/cancel the
  Inngest plan → $75 → $0.** The saving is realized HERE, after full soak.

## 6. Verification ("no break, no speed")

- **Data integrity:** `npm run audit:reconcile` (now with the today/yesterday
  window) + direct PostgREST `data_daily == SUM(campaigns_daily)` checks after
  each stage; the recent-window invariant catches any divergence.
- **Freshness/speed:** confirm `data_freshness.last_success_at` keeps advancing
  on the same ~10-min cadence post-cutover; the per-platform freshness liveness
  gate (already shipped) flags any stall.
- **Each worker route** keeps the existing freshness recording + transient_error
  semantics, so observability is preserved.

## 7. Cost outcome
Vercel Cron: $0 (included in Pro). QStash: ~$1–4/mo at this volume (free up to
~15K msgs/mo; the heavy fan-out is ~80–200K msgs/mo). Inngest: $0 after Stage 4.
**Net ≈ $70/mo saved.**

## 8. Scope
**In:** the 8 active crons, 6 workers, 3 operator buttons; new `/api/cron/*` +
`/api/worker/*` routes; `vercel.json` cron entries; QStash publish/verify
helpers; allowlist updates; per-stage soak.
**Out (YAGNI):** `cronLiveHeavy` (already disabled — delete, don't migrate); any
change to the business-logic handlers beyond the trigger/transport wrapper; any
change to the data model.

## 9. Risks & rollback
- **DST drift** → dual-fire UTC + idempotent IL-gate (§4.1).
- **Concurrency race** → per-store lock + idempotency (§4.2).
- **QStash delivery failure** → QStash retries + freshness self-heal (§4.4).
- **Worker timeout** → fan-out keeps per-worker scope small; set `maxDuration`.
- **Allowlist miss** → explicit allowlist + a guard test (§4.3).
- **Rollback:** Inngest stays registered until Stage 4; any stage reverts by
  re-enabling the Inngest registration for that cron family and disabling the new
  route (a config flip, no data migration).

## 10. Open items (resolve in writing-plans)
- Confirm QStash pricing tier + whether QStash schedules' TZ support can replace
  the Vercel dual-fire for TZ-sensitive crons.
- Final per-store lock mechanism (advisory lock vs `job_locks` row).
- Exact route inventory + whether whatsapp noon/evening/eod is one route
  (param'd) or three.
- `maxDuration` per worker route.
