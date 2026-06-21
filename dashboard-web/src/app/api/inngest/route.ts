// dashboard-web/src/app/api/inngest/route.ts
//
// Phase 05.6 Plan 11 — Inngest webhook endpoint.
//
// This is the ONE Vercel serverless function that Inngest cloud calls into
// for every function invocation. The serve() helper from inngest/next
// returns { GET, POST, PUT } — Next.js app router auto-wires these.
//
//   PUT: Inngest cloud calls during a Vercel deploy to register / update
//        functions. After the next Vercel CI auto-deploys this commit,
//        Inngest's PUT lands here and all 8 functions appear in the
//        Inngest dashboard (Plan 22 smoke test confirms).
//
//   GET: Returns function metadata + (in dev only) the Inngest landing
//        page. URL-obscurity trust model (Threat T-05.6-11-I2 accepted):
//        the operator's User Manual section 1.7 (plan 22) documents this
//        exposure.
//
//   POST: Actual function invocation entry point. Inngest cloud signs each
//         request with the signing-key env var; the serve() SDK validates
//         the X-Inngest-Signature header automatically and rejects
//         mismatches (Threat T-05.6-11-S1 mitigated by default).
//
// Environment variables (both auto-injected by the Inngest-Vercel
// marketplace integration per Plan 01 SUMMARY — no manual env paste):
//   - INNGEST_EVENT_KEY    — consumed by inngest.send() at write sites
//                            (plans 14, 16); not used here directly.
//   - INNGEST_SIGNING_KEY  — consumed by serve() to validate POST
//                            signatures (auto-read from process.env at
//                            request time).
//
// =============================================================================
// Route segment config
// =============================================================================
//
// `export const maxDuration = 60`
//   Per RESEARCH §Pitfall 9. Vercel Hobby caps serverless functions at 10s;
//   Pro raises the ceiling to 60s. Large-day Shopify fetches (~50 pages ×
//   ~500ms each ≈ 25s) can exceed Hobby's cap. The operator confirmed plan
//   tier in Plan 01 Task 0 — if Hobby, the value is silently ignored and
//   step.run callbacks must decompose pagination per Pitfall 9.
//
// `dynamic` route segment — NOT SET (intentional)
//   The plan's verify block (05.6-11-PLAN.md line 125) asserts the
//   absence of any dynamic-render opt-in on this endpoint. RESEARCH
//   §Pitfall 11 forbids the dynamic opt-in plus the revalidate opt-in
//   together; the plan goes further and forbids the dynamic opt-in here
//   entirely. CHECK W3 raised the question of whether the dynamic opt-in
//   is required for serve() — the Inngest SDK's official typedef
//   (node_modules/inngest/next.d.ts lines 38-44) shows the canonical
//   serve() pattern with NO route-segment config, confirming that no
//   dynamic opt-in is required. Next.js infers dynamic rendering
//   automatically for any route that uses request.headers or
//   non-static methods (POST/PUT both qualify), so explicit opt-in is
//   unnecessary here.
//
// `revalidate` route segment — NOT SET (intentional)
//   This route is an invocation endpoint, not a cacheable GET. The
//   Inngest SDK handles its own response caching internally where
//   appropriate. Setting the revalidate opt-in would either conflict
//   with the dynamic opt-in (Pitfall 11) — which we do not set — or
//   attempt to cache responses we do not want cached. PLAN.md verify
//   also greps for absence.
//
// =============================================================================
// Function registration
// =============================================================================
//
// Registered via the `functions` array. Self-serve stores Phase 4b (Task 9)
// replaced the per-store factory crons with scheduler+worker pairs:
//
//   cronDailyScheduler /    — scheduler keeps cron TZ=Asia/Jerusalem 5 0 * * *
//   cronDailyWorker            (00:05 IL daily), loads the active store list at
//                              runtime + fans out one cron/daily.store.requested
//                              event per store; the event-driven worker runs
//                              runDailyForStore (concurrency-keyed by store).
//                              Replaces the old per-store cron-daily-{store}.
//
//   cronLiveScheduler /     — scheduler keeps the every-15-min cron + fans out
//   cronLiveWorker             per store; worker runs runLiveForStore. Replaces
//                              the old per-store cron-live-{store}.
//
//   eventSyncNow            — 1 function. Trigger: event/sync-now. Fired
//                              by the operator console "Sync now" button.
//                              Plan 10.
//
//   eventBackfill           — 1 function. Trigger: event/backfill. Fired
//                              by the operator console backfill range
//                              picker. Plan 10.
//
// Refs:
//   - 05.6-11-PLAN.md §<tasks> Task 1
//   - 05.6-RESEARCH.md §Pattern 1 lines 351-377 (serve() skeleton)
//   - 05.6-RESEARCH.md §Pitfall 9 lines 1464-1477 (maxDuration justification)
//   - 05.6-RESEARCH.md §Pitfall 11 lines 1491-1502 (no combined dynamic +
//                                                    revalidate opt-ins)
//   - 05.6-CHECK.md §W3 lines 116-119 (dynamic-opt-in resolution)
//   - 05.6-01-SUMMARY.md (env-var injection state; maxDuration=60 reminder)

import { serve } from 'inngest/next';
import { inngest } from '@/inngest/client';
// Self-serve stores Phase 4b (Task 9) — atomic serve() cutover.
// The per-store factory exports (cronDailyFunctions / cronLiveFunctions /
// cronYesterdayRefreshFunctions) are KEPT on disk as a revert lever but are
// NO LONGER registered here; the scheduler+worker pairs below replace them.
// Revert = re-add the `cron*Functions` import + spread (2 lines each).
import {
  cronDailyScheduler,
  cronDailyWorker,
} from '@/inngest/functions/cronDaily';
import {
  cronLiveScheduler,
  cronLiveWorker,
} from '@/inngest/functions/cronLive';
import { cronLiveHeavyFunctions } from '@/inngest/functions/cronLiveHeavy';
import {
  cronYesterdayRefreshScheduler,
  cronYesterdayRefreshWorker,
} from '@/inngest/functions/cronYesterdayRefresh';
import { cronTickOrchestrator } from '@/inngest/functions/cronTickOrchestrator';
import { metaWorker } from '@/inngest/functions/metaWorker';
import { googleWorker } from '@/inngest/functions/googleWorker';
import { tiktokWorker } from '@/inngest/functions/tiktokWorker';
import { eventSyncNow } from '@/inngest/functions/eventSyncNow';
import { eventBackfill } from '@/inngest/functions/eventBackfill';
// Stage 1 (Inngest → Vercel Cron migration): cronOauthCanary now runs on
// Vercel Cron (/api/cron/oauth-canary). Its createFunction export remains on
// disk for rollback but is NO LONGER imported/registered here.
// Stage 1 migration — the 3 WhatsApp digest crons now run on Vercel Cron
// (/api/cron/whatsapp?slot=…). Their createFunction exports remain on disk for
// rollback but are NO LONGER imported/registered here. eventWhatsappSendNow
// (operator "send now" button) STAYS registered until Stage 3.
import { eventWhatsappSendNow } from '@/inngest/functions/cronWhatsapp';
// Stage 1 migration — cronCohortRefresh now runs on Vercel Cron
// (/api/cron/cohort). Its createFunction export remains on disk for rollback
// but is NO LONGER imported/registered here.

// Vercel route segment config: maxDuration must be a literal number per
// Next.js's static analyzer (same constraint as the revalidate opt-in —
// RESEARCH §Pitfall 12). 60 = Vercel Pro plan ceiling.
export const maxDuration = 60;

// Phase 14 — boot-time prod assert on the signing key.
// serve() reads INNGEST_SIGNING_KEY implicitly from process.env (its public
// ServeHandlerOptions type doesn't expose a `signingKey` field). The 2026-05-24
// audit (T1) flagged that a missing env var in a preview/prod deploy would
// silently leave the webhook unauthenticated — Inngest would still respond
// to POSTs without verifying X-Inngest-Signature. We fail-fast at module
// load if running on Vercel production without the key set, so the
// deployment refuses to start instead of running unauthenticated.
// Preview / dev / test deploys with no key still work (Inngest SDK falls
// back to its unsigned mode, which is safe outside production).
if (process.env.VERCEL_ENV === 'production' && !process.env.INNGEST_SIGNING_KEY) {
  throw new Error(
    'INNGEST_SIGNING_KEY is required in production (VERCEL_ENV=production). ' +
      'Set it in Vercel → Settings → Environment Variables → Production. ' +
      'Without it, the /api/inngest webhook accepts unsigned POSTs from anyone ' +
      'who discovers the URL.',
  );
}

// Exported (named const) so the registered-set guard test can assert the
// EXACT function set without coupling to Inngest's internal serve() shape.
// serve() consumes the same array — single source of truth.
export const inngestFunctions = [
  // Phase 4b cutover (2026-06-07): factory crons → scheduler+worker pairs.
  // Each scheduler keeps the factory's EXACT cron and loads the active store
  // list at runtime, so a store added via the DB joins the cron with no deploy.
  cronDailyScheduler, // replaces ...cronDailyFunctions (cron-daily-{store}); cron 'TZ=Asia/Jerusalem 5 0 * * *'
  cronDailyWorker, // event-driven worker (cron/daily.store.requested), concurrency-keyed by store
  cronLiveScheduler, // replaces ...cronLiveFunctions (cron-live-{store})
  cronLiveWorker, // event-driven worker (cron/live.store.requested), concurrency-keyed by store
  ...cronLiveHeavyFunctions, // Phase E1 (2026-05-30) — DISABLED (empty array). cron-tick-orchestrator + hot_metrics workers cover today; cron-yesterday-refresh covers yesterday.
  cronYesterdayRefreshScheduler, // replaces ...cronYesterdayRefreshFunctions (cron-yesterday-refresh-{store}); Phase E1.5 2h cadence catching cross-day refunds + late attribution
  cronYesterdayRefreshWorker, // event-driven worker (cron/yesterday.store.requested), concurrency-keyed by store
  cronTickOrchestrator, // Phase B — 1 function (Inngest tick orchestrator: scheduler + worker fan-out)
  metaWorker, // Phase B — 1 function (Meta-platform worker invoked by orchestrator); Phase C extended with 'hot_metrics' scope
  googleWorker, // Phase C — 1 function (Google-platform worker invoked by orchestrator; handles status + hot_metrics scopes)
  tiktokWorker, // Phase C — 1 function (TikTok-platform worker invoked by orchestrator; handles status + hot_metrics scopes)
  eventSyncNow, // 1 function (operator "Sync now" button)
  eventBackfill, // 1 function (operator backfill range picker)
  // Stage 1 migration — cronOauthCanary moved to /api/cron/oauth-canary (Vercel Cron).
  // Stage 1 migration — whatsappCronFunctions moved to /api/cron/whatsapp (Vercel Cron).
  eventWhatsappSendNow, // 1 function (operator "send WhatsApp now") — stays until Stage 3
  // Stage 1 migration — cronCohortRefresh moved to /api/cron/cohort (Vercel Cron).
];

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: inngestFunctions,
});
