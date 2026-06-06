> Cost-optimization research generated 2026-06-06 (5-agent workflow: Inngest/Vercel-Cron/QStash/Supabase/Trigger.dev pricing + codebase op-count). Verify pricing live before acting.

# Cutting the ~$75/mo Inngest Bill on a 10-Minute Ingestion Pipeline

**Bottom line up front:** Your ~$75/mo is the Inngest **Pro base fee**, not metered overage — so trimming steps will *not* lower it while you stay on Pro. There is no Inngest plan between $0 (Hobby, 50K executions) and $75 (Pro, 1M). The only real win is to **eliminate Inngest entirely** and fold scheduling into the **Vercel Pro plan you already pay $20 for**, re-creating Inngest's retry/idempotency/concurrency guarantees with a thin Postgres-backed layer your codebase is already 90% built for. Realistic target: **~$20/mo total (≈$55/mo, ≈$660/yr saved)**, cadence and correctness preserved.

---

## 1. The math: why it costs ~$75

Inngest bills on **executions**, defined as *each run plus each step* — every `step.run()` is a separate billed HTTP round-trip back to your app. Their own worked example: `(30,000 runs × 2 steps) + 30,000 runs = 90,000 executions`. Rule of thumb: a function with **N** `step.run()` calls ≈ **N+1** executions.

Applying that to the registered functions (13 function files, 16 registered functions confirmed in `src/app/api/inngest/route.ts`):

| Source | Frequency | Exec/fire (≈) | Exec/day | Exec/mo |
|---|---|---|---|---|
| cron-tick-orchestrator | 144 ticks/day | ~7 (6 steps + run) | ~1,008 | ~30K |
| → fan-out: 3 stores × 3 platforms × 2 scopes = **18 workers/tick** | 144 × 18 | ~3 each (2 steps + run) | ~7,776 | **~233K** |
| cron-live (3 stores) | */10 | ~17 (16 steps + run) | ~2,448 | ~73K |
| cron-daily | daily | ~19 | ~19 | ~0.6K |
| cron-yesterday-refresh (3 stores, every 2h) | 12×/day/store | ~3 | ~108 | ~3K |
| cohort / whatsapp / oauth-canary / backfill | various | — | — | ~2K |
| **Total** | | | **~11K/day** | **~340K/mo** |

That lands squarely in the **300–400K executions/mo** band you reported.

**The decisive fact:** 340K is *comfortably under* the 1M executions Pro includes. You are paying the **$75 flat base fee** — the floor — with **zero overage**. The cost driver is not cron frequency; it is the **18-way fan-out × multi-step shape** that puts you above the 50K free cap and therefore onto the $75 tier. **Cutting 340K → 170K changes nothing** — you'd still pay $75.

---

## 2. Can we hit < $20 total? Be honest: no — $20 *is* the target

- **Inngest can never be ~$20.** There is no tier between Hobby ($0 / 50K execs) and Pro ($75 / 1M). "Tune Inngest down to $20" is structurally impossible. The only sub-$75 Inngest outcome is **$0 on Hobby**, which requires cutting executions **~85–90%** (to <50K/mo) *and* living with Hobby's hard ceilings (5 concurrent steps vs your 18-wide burst, 3 workers, 24h trace retention, 3 users). That sacrifices the per-leg retry isolation and observability your billing-correctness-sensitive pipeline depends on. **Not recommended.**

- **Vercel Pro's $20 is the practical floor for commercial 10-min crons.** Vercel Hobby crons are limited/best-effort and not licensed for commercial use; a real 10-min commercial schedule needs Pro ($20/mo, which *includes* $20 usage credit + cron jobs at **zero** incremental charge). You're already paying it.

So the achievable goal is **≈$20/mo total by deleting the $75 Inngest line item**, not by going under $20. The win is **eliminating $75**, not shaving Vercel. Say it plainly: **target ≈ $20/mo total.**

---

## 3. Options compared

| Option | Est. $/mo (total) | Preserves correctness? | Migration effort | Risk |
|---|---|---|---|---|
| **(A) Optimize & stay on Inngest** | **$75** (unchanged) | ✅ Yes — native retries/memoization/concurrency | Low (tune fan-out/steps) | Low — but **saves $0** while under 1M cap. Only the $0-Hobby variant saves money, and it breaks correctness (5-concurrent ceiling vs 18 burst). |
| **(B) Vercel Cron + plain functions** *(folds into the $20 Pro)* | **~$20** (cron free; ~78K invocations/mo ≪ 1M; I/O-bound → trivial Active CPU; inside the $20 credit) | ✅ **If** you add idempotency keys + self-retry + a lock + watermark catch-up (you already have `dedupe_key` / `minute_bucket_epoch()` / `agg_data_daily_for_date`) | **Moderate** — keep workers, replace trigger/fan-out/retry layer | Medium — Vercel cron is best-effort (can **miss** *and* **double-fire**); no native retry; 800s duration cap; you own observability. All mitigable. |
| **(C) Upstash QStash (PAYG)** | **~$21–24** ($20 Vercel + ~$1–4 QStash; ~78–105K msgs × $1/100K) | ✅ Yes — built-in retries + `Upstash-Deduplication-Id` map ~1:1 to Inngest | **Low–moderate** — least rewrite; `runTickOnce` already injects `sendEvent` | Medium-low — **each retry is a billed message** (cap `Upstash-Retries`, use 489 non-retryable for auth fails); 10-min dedup window only (keep DB guards). |
| **(D) Supabase pg_cron + pgmq + Edge Fn** | **~$20–22** ($20 Vercel or use existing $25 Supabase Pro; extensions free, +$0–2) | ✅ Yes — pgmq gives true at-least-once visibility-timeout retries; idempotency already lives in your DB | **Moderate** — new consumer wiring; `pg_net` is fire-and-forget (record status in `data_freshness`) | Medium — longest jobs (cohort Bulk, `eventBackfill` ~50 pages) need decomposition; loses durable step-replay. |
| **(E) Trigger.dev (Hobby)** | **~$30** ($20 Vercel + $10 Hobby; ~78K runs fits the $10 credit) | ✅ Yes — closest turnkey Inngest replacement (durable steps) | **Low** — least conceptual change | Low — but **you re-pay for durable compute**; doesn't hit the $20 target and just swaps one vendor floor for another. |

---

## 4. Recommendation

**Primary: Option (B) — Vercel Cron on the $20 Pro plan you already own, with a thin Postgres-backed durability layer.** This is the only path that reaches **≈$20 total** while keeping everything inside infrastructure you already operate and pay for. Your idempotency guarantees already live in Postgres (`dedupe_key`, `minute_bucket_epoch()`, `agg_data_daily_for_date(d)` — 45 references confirmed), not in Inngest, so the durable engine is the only thing you're actually removing.

**Fallback: Option (C) — Upstash QStash PAYG (~$1–4/mo)** if, during the soak, the hand-rolled retry/lock layer proves fiddly. QStash's retry + `Upstash-Deduplication-Id` model maps almost 1:1 onto Inngest's `send`/retry, `runTickOnce` already injects `sendEvent`, and it's the least code rewrite — at the cost of ~$1–4/mo over pure Vercel.

### Hard constraints the recommendation must preserve (all met)
- **10-min server cadence:** one `*/10 * * * *` cron (Vercel Pro min interval = 1 min, ≤100 crons/project). ✅
- **2-min client cadence:** untouched — that's frontend polling, independent of the scheduler. ✅
- **No double-writes / idempotency:** every write stays `UPSERT` / `INSERT … ON CONFLICT DO NOTHING` on `dedupe_key`. ✅
- **Retries & correctness:** rebuilt explicitly (below). ✅

### How to reproduce each Inngest guarantee on Vercel Cron

1. **Single orchestrator route + auth.** Add one cron in `dashboard-web/vercel.json` → `/api/cron/tick`. Secure with `CRON_SECRET` (`Authorization: Bearer …`) **and add it to `isDashboardAuthAllowlisted`** — per your 2026-06-03 incident, an un-allowlisted externally-called route silently 401s the scheduler. Verify the QStash/Vercel signature exactly as you verify `X-Inngest-Signature` today.

2. **Concurrency control (no overlap).** First statement in the route takes a **Postgres advisory lock** keyed by the tick bucket: `pg_try_advisory_xact_lock(minute_bucket_epoch())`. If not acquired, the invocation no-ops and returns 200. This replaces Inngest concurrency keys and neutralizes Vercel's double-fire.

3. **Self-retry with bounded backoff.** Vercel will **not** retry a failed cron. Wrap each per-unit fetch in a bounded retry (e.g. 3 tries, 12s timeout per fetcher — you already apply 12s in `cronLive.ts`), with non-retryable short-circuit on permanent auth errors so you don't burn the duration budget.

4. **Fan-out within the duration limit.** Pro max duration is **800s (~13 min)** — enough to run all ~18 units inline. Because work is I/O-bound and CPU billing pauses during I/O waits, Active CPU per tick is tiny → stays inside the $20 credit. **If any tick approaches 800s**, split the cron into a thin **dispatcher** that fires internal `fetch()` to per-worker routes (Vercel's recommended pattern) — each worker independently idempotent. This also relieves the existing **60s function budget** that `cronDaily` already fights: keep each sub-route small and single-purpose rather than one fat handler.

5. **Self-healing for missed ticks (watermark catch-up).** Make every tick **reconciliation-based**: "process all outstanding work since the last successful watermark" (you already have `data_freshness`). A best-effort *missed* delivery self-heals on the next tick; a *duplicate* delivery is harmless via `dedupe_key`. This is the at-least-once + idempotent pairing that makes a best-effort scheduler safe.

6. **Dead-man's-switch.** Vercel logs **nothing** for a non-delivered tick, so ping an external monitor (e.g. healthchecks.io) at the end of each successful tick; alarm if no ping in ~25 min. Replaces Inngest's run dashboard.

---

## 5. Migration plan (phased, low-risk)

Work on a branch; commit per task; nothing irreversible until cutover. Inngest and Vercel Cron run **in parallel** during soak.

**Phase 0 — Scaffold (no behavior change).** Add `CRON_SECRET`, the advisory-lock helper keyed on `minute_bucket_epoch()`, the bounded-retry wrapper, and the dead-man's-switch ping. Add routes to `isDashboardAuthAllowlisted`. Ship; nothing is scheduled yet.

**Phase 1 — Low-risk daily/weekly crons first.** Migrate `cron-daily`, `cron-yesterday-refresh`, `cron-cohort-refresh`, `cron-oauth-canary`, `cron-whatsapp` to Vercel cron entries. These are infrequent, non-fan-out, and low blast-radius. **Disable their Inngest twins** once green. Verify each writes identical rows.

**Phase 2 — The 10-min hot path.** Stand up `/api/cron/tick` (orchestrator + 18-way fan-out + lock + self-retry + watermark) **scheduled in parallel** with the Inngest orchestrator, writing to the **same** tables. Because all writes are `ON CONFLICT DO NOTHING` on `dedupe_key`, parallel writers are safe — whichever fires first wins, the other no-ops. Soak ≥48h.

**Phase 3 — Parity verification (reuse existing harness).** Run `npm run audit:reconcile` and `npm run audit:reconcile:hot-vs-heavy` to confirm row-for-row parity: `campaigns_daily` SUM == `data_daily`, freshness coverage green, no `BACKFILL_UNKNOWN` regressions. Spot-check `data_freshness` over a multi-day window. **Cutover only when parity is clean.**

**Phase 4 — Cut over & remove Inngest.** Disable all Inngest functions, then delete: the `inngest ^4.4.0` dependency, `src/inngest/`, `/api/inngest/route.ts`, and the ~25 Inngest-semantics test files in `src/inngest/functions/__tests__`. Update the `JobsTable`/`FreshnessPanel`/`SyncNow` UI to read state from `data_freshness` instead of Inngest events, and update **ARCHITECTURE.md §27/§32** and the User Manual.

**Rollback:** At any phase, re-enable the Inngest twin and disable the Vercel cron (or vice versa). Both are idempotent against the same tables, so flipping back is a config change, not a data migration. Keep Inngest installed until Phase 4 passes a full soak.

---

## 6. Risks & what could break

- **Missed ticks (best-effort delivery).** Vercel can silently skip a fire with no log. **Mitigated** by watermark catch-up (next tick reprocesses) + dead-man's-switch alarm.
- **Double-fire / overlap.** Vercel can invoke the same tick twice, or a slow tick can overlap the next. **Mitigated** by the advisory lock + `dedupe_key` idempotency. Never relax those DB guards "as cleanup" — they are load-bearing for at-least-once safety.
- **800s / 60s duration pressure.** `cronDaily` already nears 60s; one hung upstream call could push a fat handler past budget. **Mitigated** by tight per-call timeouts (12s) and the dispatcher + per-worker split if any tick trends long. Provisioned-memory bills for the *whole* instance lifetime including I/O waits, so keep timeouts tight.
- **Long one-shot jobs (`eventBackfill` ~50 Shopify pages, cohort Bulk export).** These leaned on Inngest's durable `step.run` memoization. On Vercel they must be **decomposed into self-chaining requests** or moved to a Supabase Edge Function (longer runtime). This is the **riskiest** part — do it deliberately, test against the existing backfill output.
- **UTC vs Israel time.** Vercel cron schedules are always UTC and don't support day-of-month + day-of-week together. Keep IL-aware date logic **inside the handler** via `getTodayInIsraelTz()` — never in the cron expression.
- **Lost observability.** No Inngest step timeline/replay dashboard. **Mitigated** by structured logs (you already log `fan_out` counts), `data_freshness`, and the dead-man's-switch.
- **Sunk migration cost.** 16 functions + ~25 test files + UI + docs is real work. Savings are ~$55/mo (~$660/yr); engineering time may exceed a year of savings, so **bundle this with already-planned pipeline work** rather than as a standalone effort — or take Option (C)/(E) for a faster, lower-effort partial win.
- **Auth allowlist trap.** Every new `/api/cron/*` (and any QStash receiver) **must** be in `isDashboardAuthAllowlisted` or the password gate silently 401s the scheduler (2026-06-03 incident).

---

## 7. References

**Inngest pricing & execution model**
- https://www.inngest.com/pricing
- https://www.inngest.com/docs/learn/how-functions-are-executed
- https://www.inngest.com/docs/learn/inngest-steps
- https://www.inngest.com/docs/usage-limits/inngest

**Vercel Cron & function billing**
- https://vercel.com/docs/cron-jobs/usage-and-pricing
- https://vercel.com/docs/cron-jobs
- https://vercel.com/docs/cron-jobs/manage-cron-jobs
- https://vercel.com/docs/functions/usage-and-pricing
- https://vercel.com/docs/functions/configuring-functions/duration
- https://vercel.com/docs/plans/pro-plan
- https://vercel.com/changelog/cron-jobs-now-support-100-per-project-on-every-plan

**Upstash QStash (fallback)**
- https://upstash.com/docs/qstash/overall/pricing
- https://upstash.com/docs/qstash/features/retry
- https://upstash.com/docs/qstash/features/deduplication

**Supabase pg_cron + pgmq**
- https://supabase.com/pricing
- https://supabase.com/docs/guides/functions/pricing
- https://supabase.com/docs/guides/queues/pgmq
- https://supabase.com/docs/guides/database/extensions/pg_cron

**Trigger.dev**
- https://trigger.dev/pricing

**GitHub Actions (rejected as primary — scheduling delays / private-repo outages)**
- https://docs.github.com/en/actions/concepts/billing-and-usage
- https://github.com/orgs/community/discussions/185373

---
*Codebase facts confirmed in `/Users/dorperetz/script-roas/dashboard-web`: 16 registered Inngest functions (`src/inngest/functions/`, `src/app/api/inngest/route.ts:141`); idempotency primitives `dedupe_key` / `minute_bucket_epoch()` / `agg_data_daily_for_date` present (45 references); parity harness `npm run audit:reconcile` available; `inngest ^4.4.0`.*
