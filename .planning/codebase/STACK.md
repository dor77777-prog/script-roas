# Technology Stack

**Analysis Date:** 2026-05-24

> Post-Phase-11 state. The Apps Script tier (Shopify.gs / Config.gs / MetaAds.gs / GoogleAds.gs / Notifications.gs / DailyUpdate.gs / FX.gs / ManualOverrides.gs / Main.gs / appsscript.json / .clasp.json) was removed in Phase 11 (commit 1973d06, 2026-05-24). `lib/sheets.ts` was deleted; `readFrom()` feature flag was removed; `READ_FROM=postgres` is the only path. The system is now SINGLE-TIER: Next.js + Inngest + Supabase Postgres.

## Languages

**Primary:**
- TypeScript 5 — every runtime + test module under `dashboard-web/src/**`
- TSX — React 19 client + server components (UI under `dashboard-web/src/app/**`, `dashboard-web/src/components/**`)

**Secondary:**
- SQL — Supabase migrations only (`supabase/migrations/*.sql`, 13 forward-only files)

## Runtime

**Environment:**
- Node.js — implied by Next.js 15 (uses Node runtime for server / API routes / Inngest handler)
- Browser — React 19 client bundle

**Package Manager:**
- npm — `dashboard-web/package.json` + `dashboard-web/package-lock.json`
- Lockfile: present (`dashboard-web/package-lock.json`)
- Root-level `package.json` + `package-lock.json` also exist (workspace shell; no published deps used at runtime)

## Frameworks

**Core (UI + server):**
- Next.js 15 (`^15.5.0`) — App Router. Entry: `dashboard-web/src/app/page.tsx`, `dashboard-web/src/app/layout.tsx`. API routes: `dashboard-web/src/app/api/**/route.ts`
- React 19 (`^19.0.0`) + React DOM 19 — Hebrew RTL dashboard
- Tailwind CSS 3 (`^3.4.17`) — single config at `dashboard-web/tailwind.config.ts` (custom navy + ROAS-semantic color palette, Heebo font, tabular-nums)
- `clsx` (`^2.1.1`) + `tailwind-merge` (`^2.6.0`) — class composition
- `lucide-react` (`^0.469.0`) — icon set
- `recharts` (`^2.15.0`) — daily reconciliation / trend charts
- SWR (`^2.3.0`) — client-side data fetching + revalidation on the dashboard tabs
- `date-fns` (`^4.1.0`) — date manipulation in formatters / range helpers

**Job scheduler:**
- Inngest (`^4.4.0`) — cron + event-triggered functions. Client: `dashboard-web/src/inngest/client.ts:18`. Webhook: `dashboard-web/src/app/api/inngest/route.ts:112`. Functions: `dashboard-web/src/inngest/functions/{cronDaily,cronLive,cronWhatsapp,eventSyncNow,eventBackfill}.ts`

**Database client:**
- `@supabase/supabase-js` (`^2.106.1`) — wrapped by two server-only factories: `dashboard-web/src/lib/supabase.ts:30` (anon, reads) and `dashboard-web/src/lib/supabaseAdmin.ts:32` (service_role, writes + Inngest writers)

**Observability:**
- `@sentry/nextjs` (`^8.40.0`) — three init files (client/server/edge): `dashboard-web/sentry.client.config.ts`, `dashboard-web/sentry.server.config.ts`, `dashboard-web/sentry.edge.config.ts`. Wired through `dashboard-web/next.config.ts:15` via `withSentryConfig`. `tracesSampleRate=0.1`; no session replay (privacy decision documented in client config)

**Auxiliary Google client:**
- `googleapis` (`^144.0.0`) — declared as dependency but no direct imports remain after Phase 11. (Google Ads access in `dashboard-web/src/lib/fetchers/googleAds.ts:187` uses raw `fetch()` against OAuth2 + GAQL endpoints, not this SDK.) Candidate for removal.

**Testing:**
- Vitest 2 (`^2.1.0`) — runner. Config: `dashboard-web/vitest.config.ts` (Node env; globs `src/lib/**/__tests__/**/*.test.{ts,tsx}` + `src/inngest/**/__tests__/**/*.test.{ts,tsx}`; explicit imports, no globals)
- `@vitest/coverage-v8` (`^2.1.0`) — `npm run test:coverage`

**Build/Dev:**
- TypeScript 5 (`^5`) — `dashboard-web/tsconfig.json`: target ES2022, strict, `paths: { "@/*": ["./src/*"] }`, `moduleResolution: "bundler"`
- ESLint 9 (`^9`) + `eslint-config-next` (`^15.5.0`) — `npm run lint`
- PostCSS (`^8.5.1`) + autoprefixer (`^10.4.20`) — Tailwind pipeline
- `@types/node` 22, `@types/react` 19, `@types/react-dom` 19

## Key Dependencies

**Data plane (runtime-critical):**
- `inngest` `^4.4.0` — cron + event scheduler; without this, no Shopify / Meta / Google / TikTok / FX / WhatsApp data flows into Supabase
- `@supabase/supabase-js` `^2.106.1` — single backing store for `data_daily`, `products_daily`, `campaigns_daily`, `ads_daily`, `orders_attribution`, `product_catalog`, `manual_overrides`, `notification_config`, `dashboard_state`, `stores`, `token_failures` (13 migrations)
- `@sentry/nextjs` `^8.40.0` — only error surfacing for the operator (no separate logs tab post-Phase-11)

**UI-critical:**
- `next` `^15.5.0` — App Router + RSC + Server Actions disabled (`next.config.ts:4-9` comment notes no Server Actions)
- `react` `^19.0.0` — concurrent features used by drawer stacks + presets
- `swr` `^2.3.0` — every dashboard tab's data fetch
- `recharts` `^2.15.0` — Pearson reconciliation panels, time-series surfaces

**Infrastructure (declared but unused):**
- `googleapis` `^144.0.0` — leftover from pre-Phase-11 Google Sheets reader. No imports remain. Candidate for removal in a follow-up.

## Configuration

**TypeScript:**
- `dashboard-web/tsconfig.json` — strict, ES2022, alias `@/* → src/*`, JSX preserve, `noEmit: true`

**Next.js:**
- `dashboard-web/next.config.ts` — `reactStrictMode: true`. Wrapped in `withSentryConfig` (`silent: !CI`, `hideSourceMaps: true`, `widenClientFileUpload: true`). No `experimental.serverActions` block (no Server Actions in repo)

**Tailwind:**
- `dashboard-web/tailwind.config.ts` — content glob `./src/**/*.{js,ts,jsx,tsx,mdx}`; custom navy primary, ROAS semantic palette (`roas.red/orange/green/blue` + `*Bg`), Heebo font stack, cool-tinted shadows, ease-out-cubic transitions

**PostCSS:**
- `dashboard-web/postcss.config.mjs`

**Vitest:**
- `dashboard-web/vitest.config.ts` — Node env; alias `@ → ./src`; globs both `src/lib/**/__tests__` and `src/inngest/**/__tests__`; `globals: false`

**Sentry:**
- Three runtime configs (client / server / edge). Server + edge gate on `SENTRY_DSN || NEXT_PUBLIC_SENTRY_DSN`; client gates on `NEXT_PUBLIC_SENTRY_DSN` only. All three use `tracesSampleRate: 0.1`. Client explicitly does NOT use replay integration (privacy / consent rationale in `dashboard-web/sentry.client.config.ts:10-16`)
- Instrumentation entry: `dashboard-web/instrumentation.ts`

**Environment:**
- Example template: `dashboard-web/.env.local.example`
- Local secrets: `dashboard-web/.env.local` (gitignored, never read here)
- Production secrets live in Vercel env vars. Authoritative classification list: `docs/PROPS-MAP.md` (43 rows: SECRET / CONFIG / DATA)

**Vercel route segment config (one-off):**
- `dashboard-web/src/app/api/inngest/route.ts:110` — `export const maxDuration = 60` (Vercel Pro ceiling; Shopify pagination needs > 10s Hobby cap)

## Platform Requirements

**Development:**
- Node + npm (`npm run dev` → Next dev server on default port)
- Local Supabase optional (Supabase CLI present per `supabase/config.toml` + `supabase/MIGRATION-DISCIPLINE.md`); production data plane points to hosted Supabase

**Production:**
- **Hosting:** Vercel (Next.js — Pro plan implied by `maxDuration = 60`)
- **Database:** Supabase hosted Postgres (free tier, single project) — URL via `SUPABASE_URL` env var
- **Scheduler:** Inngest Cloud (free tier; ~27K execs/month forecast per `cronDaily.ts:22-26` and `cronLive.ts:18-26` budget notes) — bound to Vercel via the Inngest-Vercel marketplace integration (`INNGEST_EVENT_KEY` + `INNGEST_SIGNING_KEY` auto-injected)
- **Error reporting:** Sentry (optional — silent no-op when DSN absent)

**No-longer-used (Phase 11 removed):**
- Google Apps Script runtime
- `clasp` CI deployment
- Google Sheets as a data store
- Twilio (notification_config row stays inactive; `metacloud` only)

## NPM Scripts

```bash
cd dashboard-web
npm run dev              # Next dev server
npm run build            # Next build (+ Sentry wrapper)
npm start                # Next prod server
npm run lint             # eslint via eslint-config-next
npm test                 # vitest run --passWithNoTests
npm run test:watch       # vitest (watch)
npm run test:coverage    # vitest run --coverage (v8)
```

---

*Stack analysis: 2026-05-24*
