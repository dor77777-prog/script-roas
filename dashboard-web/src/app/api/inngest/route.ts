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
// 8 functions total, registered via the `functions` array:
//
//   ...cronDailyFunctions   — 3 functions (one per store: uzoshop / zolplus
//                              / usmile360). Cron: TZ=Asia/Jerusalem 5 0 * * *
//                              = 00:05 Israel local time daily. Plan 08.
//
//   ...cronLiveFunctions    — 3 functions (one per store). Cron:
//                              TZ=Asia/Jerusalem star-slash-15 * * * *
//                              = every 15 minutes. Plan 09.
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
import { cronDailyFunctions } from '@/inngest/functions/cronDaily';
import { cronLiveFunctions } from '@/inngest/functions/cronLive';
import { eventSyncNow } from '@/inngest/functions/eventSyncNow';
import { eventBackfill } from '@/inngest/functions/eventBackfill';
import { cronOauthCanary } from '@/inngest/functions/cronOauthCanary';
import {
  whatsappCronFunctions,
  eventWhatsappSendNow,
} from '@/inngest/functions/cronWhatsapp';

// Vercel route segment config: maxDuration must be a literal number per
// Next.js's static analyzer (same constraint as the revalidate opt-in —
// RESEARCH §Pitfall 12). 60 = Vercel Pro plan ceiling.
export const maxDuration = 60;

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    ...cronDailyFunctions, // 3 functions (uzoshop / zolplus / usmile360)
    ...cronLiveFunctions, // 3 functions (uzoshop / zolplus / usmile360)
    eventSyncNow, // 1 function (operator "Sync now" button)
    eventBackfill, // 1 function (operator backfill range picker)
    cronOauthCanary, // 1 function (Phase 13.4 — Google OAuth refresh-token canary, 00:00 IL daily)
    ...whatsappCronFunctions, // 3 functions (12:00, 18:00, 00:10 IL)
    eventWhatsappSendNow, // 1 function (operator "send WhatsApp now")
  ],
  // INNGEST_SIGNING_KEY auto-read from process.env at request time;
  // serve() validates X-Inngest-Signature on every POST and rejects
  // requests with bad / missing signatures (Threat T-05.6-11-S1).
});
