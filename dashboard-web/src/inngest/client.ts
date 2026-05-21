// dashboard-web/src/inngest/client.ts
//
// Inngest client singleton. Imported by:
//   - dashboard-web/src/inngest/functions/*.ts (cron + event functions, plans 08-11)
//   - dashboard-web/src/app/api/inngest/route.ts (serve() webhook, plan 04)
//   - dashboard-web/src/app/api/operator/sync-now/route.ts (plan 14)
//   - dashboard-web/src/app/api/operator/backfill/route.ts (plan 14)
//
// INNGEST_EVENT_KEY auto-read from process.env at runtime (Vercel marketplace
// integration injects this — see plan 01 Task 0). No eventKey arg needed when
// the env var is set (Inngest SDK reads it via Inngest.send() internally).
//
// id: 'roas-dashboard' — Inngest "app" identifier visible in the dashboard
// sidebar. Lowercase-with-dash per Inngest convention.

import { Inngest } from 'inngest';

export const inngest = new Inngest({
  id: 'roas-dashboard',
});
