# Technology Stack

**Analysis Date:** 2026-05-18

This repository hosts **two distinct, co-located codebases** under one git repo:

1. **Apps Script collector** — root-level `*.gs` files + `appsscript.json`. Runs on Google's Apps Script V8 runtime, triggered daily at 00:05 Asia/Jerusalem + every 15 min. Pulls Shopify orders, Meta Ads insights, Google Ads spend, FX rates; writes to a Google Sheets spreadsheet.
2. **Next.js dashboard** — `dashboard-web/`. Next.js 15.5 App Router + React 19 + TypeScript + Tailwind. Deployed on Vercel; reads the same spreadsheet via a Google service account.

The two share no code (no shared `package.json`, no monorepo tooling). They communicate only through the spreadsheet.

## Languages

**Primary:**
- **TypeScript ^5** — `dashboard-web/` (`dashboard-web/tsconfig.json` — `target: ES2022`, `strict: true`, `moduleResolution: bundler`, `paths: { "@/*": ["./src/*"] }`)
- **JavaScript (V8)** — Apps Script side. All `.gs` files are plain JS executed under Google's V8 runtime (`appsscript.json` → `"runtimeVersion": "V8"`)

**Secondary:**
- **JSON** — manifests (`appsscript.json`, `dashboard-web/package.json`, `dashboard-web/tsconfig.json`)
- **CSS** — `dashboard-web/src/app/globals.css` (Tailwind directives)

## Runtime

**Apps Script (`appsscript.json`):**
- **Runtime:** Google Apps Script V8 (`runtimeVersion: "V8"`)
- **Time zone:** `Asia/Jerusalem` (manifest-level; all triggers + `Utilities.formatDate` calls inherit this)
- **Exception logging:** `STACKDRIVER` (Google Cloud Logging)
- **OAuth scopes (manifest):** `script.external_request`, `spreadsheets`, `drive`, `script.scriptapp`, `script.send_mail`, `userinfo.email`
- **Execution model:** Each function invocation is a fresh process. Module-level globals are re-evaluated on every call. **Hard 6-minute wall-clock limit per execution** — drives the backfill chunking strategy (`backfillRange` is meant to be split into 1-2 day batches).

**Next.js dashboard:**
- **Runtime:** Node.js — Vercel managed runtime. No `engines` pin in `dashboard-web/package.json`; defaults to Vercel's current LTS.
- **DevDeps:** `@types/node: ^22` (signals the team is on Node 22).
- **Server functions:** All `dashboard-web/src/app/api/*/route.ts` are Node serverless functions. The `googleapis` SDK requires Node (not Edge) because it depends on `node:crypto` / GoogleAuth.
- **Render mode:** Each API route declares its own caching (`export const revalidate = N`); routes that need user-driven dynamic POSTs (`/api/dashboard-state`) use plain ISR via `Cache-Control` headers (see `dashboard-web/src/app/api/dashboard-state/route.ts` for the explicit comment "Removed `force-dynamic` because it conflicted with that header").

**Package Manager:**
- **npm** for `dashboard-web/` (`package-lock.json` present at `dashboard-web/package-lock.json`)
- **No package manager for the Apps Script side** — `appsscript.json` has `"dependencies": {}`. All Apps Script services (`UrlFetchApp`, `SpreadsheetApp`, `PropertiesService`, `CacheService`, `ScriptApp`, `Utilities`, `Session`, `Logger`) are global built-ins.

## Frameworks

### Apps Script side

**No framework.** Plain JS using Google's built-in globals. There is no test runner, no build step, no module system (see "Quirks" below). Files are uploaded individually to a script.google.com project via copy-paste or `clasp` (note: `.clasp.json` is gitignored at root).

### Next.js dashboard (versions from `dashboard-web/package.json`)

**Core:**
- **`next ^15.5.0`** — App Router. Configured via `dashboard-web/next.config.ts`:
  - `reactStrictMode: true`
  - `experimental.serverActions.bodySizeLimit: '2mb'`
- **`react ^19.0.0`** + **`react-dom ^19.0.0`** — paired with `@types/react ^19`. The codebase uses 'use client' directives extensively (e.g. `dashboard-web/src/components/Dashboard.tsx`, `dashboard-web/src/components/CampaignsTable.tsx`).

**UI / styling:**
- **`tailwindcss ^3.4.17`** — config at `dashboard-web/tailwind.config.ts`. Custom design tokens (cool-tinted off-white background `#f6f9fc`, deep-navy primary `#0d3680`, ROAS-semantic colors). Heebo font loaded via `next/font/google` in `dashboard-web/src/app/layout.tsx`.
- **`autoprefixer ^10.4.20`** + **`postcss ^8.5.1`** — `dashboard-web/postcss.config.mjs` (standard Next.js PostCSS chain).
- **`clsx ^2.1.1`** + **`tailwind-merge ^2.6.0`** — class-name composition. The `cn` helper in `dashboard-web/src/lib/utils.ts` combines them.
- **`lucide-react ^0.469.0`** — icon set.

**Data layer:**
- **`swr ^2.3.0`** — client-side data fetching for every API route. See `dashboard-web/src/components/Dashboard.tsx` (root `useSWR`), plus `CampaignsTable`, `BillingSettings`, `ProductsTable`, `InsightsBoard`, `CommandPalette`, `ProductPickerModal`. Dedupe interval is route-specific (30-60s short routes, 5min for ads/orders-attribution).
- **`googleapis ^144.0.0`** — used **server-side only** in `dashboard-web/src/lib/sheets.ts` (`import { google } from 'googleapis'`). Auth via service-account credentials in env vars.

**Charts / dates:**
- **`recharts ^2.15.0`** — used in `HeroOverview`, `RoasChart`, `Sparkline`, `MonthlyTables`, `CampaignDrawer` daily charts.
- **`date-fns ^4.1.0`** — date formatting and arithmetic throughout the dashboard.

**Testing:**
- **None.** `dashboard-web/package.json` has zero test dependencies (no jest/vitest/playwright/mocha). No `*.test.*` or `*.spec.*` files exist anywhere in the repo. No `tests/` or `__tests__/` directories. Apps Script side has manual diagnostic functions (`verifyConfig`, `printCurrentSpreadsheetId`) but no automated test harness.
- This is a known trade-off — see `.planning/codebase/CONCERNS.md` for the impact.

**Build/Dev:**
- **`next` CLI** (no custom build tool). Scripts in `dashboard-web/package.json`:
  - `npm run dev` → `next dev`
  - `npm run build` → `next build`
  - `npm run start` → `next start`
  - `npm run lint` → `next lint`
- **TypeScript ^5** with `noEmit: true`, `incremental: true` — type-checking only, Next.js's SWC handles the transpile. `dashboard-web/tsconfig.tsbuildinfo` is the incremental cache.

**Linting / formatting:**
- **`eslint ^9`** + **`eslint-config-next ^15.5.0`** — invoked via `next lint`. **No ESLint config file is checked in** at `dashboard-web/.eslintrc*` or `dashboard-web/eslint.config.*`; the rules come entirely from the `eslint-config-next` preset. The `.eslintrc` files inside `node_modules` are unrelated package-internal configs.
- **No Prettier, no Biome, no `editorconfig`.** Formatting is whatever Next.js / the editor enforces.

## Key Dependencies

**Critical:**
- **`googleapis ^144.0.0`** — single dependency for all Google Sheets read/write from the server. Located in `dashboard-web/src/lib/sheets.ts`. Used with two distinct scopes: `spreadsheets.readonly` for reads (cheap, low risk) and `spreadsheets` (write) for `upsertDashboardStateKey` only. Auth: `google.auth.GoogleAuth` with `credentials: { client_email, private_key }` — both injected via env vars.
- **`swr ^2.3.0`** — the dashboard's "live" feel depends entirely on SWR's revalidate-on-focus + polling.

**Infrastructure (no runtime deps — all built into Apps Script):**
- `UrlFetchApp` — used by `fetchWithRetry_` (`Config.gs:115`) for every external HTTP call.
- `PropertiesService.getScriptProperties()` — every credential lives here (`getProp` / `setProp` / `requireProp` in `Config.gs`).
- `CacheService.getScriptCache()` — used by `FX.gs` (21600s TTL on Frankfurter rates) and `GoogleAds.gs:getGoogleAdsAccessToken_` (caches refresh-token-issued access tokens for `expires_in - 120` seconds).

## Configuration

**Apps Script (`Config.gs`):**

| Constant | Value | Where used |
|----------|-------|-----------|
| `TZ` | `'Asia/Jerusalem'` | Date math, trigger scheduling |
| `SUMMARY_TAB` | `'סיכום'` (Hebrew) | Legacy summary tab name |
| `DAILY_FLAT_TAB` | `'data-daily'` | Dashboard's primary source-of-truth tab |
| `PRODUCTS_DAILY_TAB` | `'products-daily'` | Per-product per-day sales |
| `STORE_META_TAB` | `'store-meta'` | Per-store plan + ad-account metadata |
| `SHOPIFY_API_VERSION` | `'2024-10'` | All Shopify REST/GraphQL calls |
| `META_API_VERSION` | `'v20.0'` | All Meta Marketing API calls |
| `GOOGLE_ADS_API_VERSION` | `'v20'` | All Google Ads API calls |
| `COGS_RATE_OF_REVENUE` | `0.25` | Estimated COGS (25% of revenue) |
| `STORES` | 3-element array | `[{id:'uzoshop', hasGoogleAds:true}, {id:'zolplus', hasGoogleAds:false}, {id:'usmile360', hasGoogleAds:false}]` |
| `COL` | `{DATE:1, SPENT:2, REVENUE:3, ROAS:4}` | Column indices on legacy per-store tabs |
| `ROAS_COLORS` | red/orange/green/blue hex map | Conditional formatting rules |

Credentials live in Apps Script's `PropertiesService` (not in code, not committed). See `SETUP.md` for the full key list. `Config.gs:verifyConfig` (`Config.gs:148`) prints which props are set/missing and is the canonical readiness check.

**Dashboard (`dashboard-web/.env.local.example`):**

Required env vars (read in `dashboard-web/src/lib/sheets.ts`):

| Variable | Purpose |
|----------|---------|
| `GOOGLE_CLIENT_EMAIL` | Service account email (e.g. `roas-dashboard-reader@roas-tracker-ga.iam.gserviceaccount.com`) |
| `GOOGLE_PRIVATE_KEY` | Service account private key. Vercel-style escaped newlines (`\n` → `\n`) are normalized at load |
| `SPREADSHEET_ID` | The single source-of-truth spreadsheet ID. Must match Apps Script's `spreadsheet.id` Script Property exactly — otherwise the dashboard reads from a different sheet than the collector writes to |

**Sensitive files (never committed):**
- `.env.local` — gitignored in `dashboard-web/.gitignore`
- `.clasp.json` — gitignored at repo root (Apps Script CLI metadata)
- `.env.local.example` (committed) contains placeholders only

**Build:**
- `dashboard-web/next.config.ts` — minimal (strict mode + body size limit only)
- `dashboard-web/tsconfig.json` — strict TS, ES2022 target, `paths: { "@/*": ["./src/*"] }`
- `dashboard-web/tailwind.config.ts` — extensive design tokens, `content: ['./src/**/*.{js,ts,jsx,tsx,mdx}']`
- `dashboard-web/postcss.config.mjs` — tailwindcss + autoprefixer

## State Management

The dashboard uses a **three-layer hybrid** that is unusual enough to call out:

1. **SWR client cache** — every API route has a `useSWR` consumer with per-route dedupe (30s for `/api/data`, `/api/campaigns`, `/api/products`; 5min for `/api/ads`, `/api/orders-attribution`; 1h for `/api/store-meta`; 10s for `/api/dashboard-state`).

2. **`localStorage` as a synchronous cache** for user-driven state. 7 keys live here, all prefixed `roas-dashboard:` — see `dashboard-web/src/lib/cloudSync.ts` `STATE_KEYS`:
   - `billing-recurring`
   - `billing-onetime`
   - `annotations`
   - `monthly-revenue-goal`
   - `insight-states`
   - `campaign-optimized`
   - `campaign-product-map`

3. **Cloud sync via Google Sheets `dashboard-state` tab.** `dashboard-web/src/lib/cloudSync.ts`:
   - On mount: `hydrateFromCloud()` GETs `/api/dashboard-state`, writes each key to `localStorage`, dispatches a per-key change event so components re-read.
   - On any write: `localStorage` first (immediate, synchronous), then debounced 400ms `pushCloudKey()` → POST `/api/dashboard-state` → `upsertDashboardStateKey` (`dashboard-web/src/lib/sheets.ts`) appends to the sheet.
   - Every 30s + on window focus: re-hydrate to pick up edits from other devices.
   - Conflict policy: **last-write-wins**, with an 8s `lastPushAt` grace window so a re-hydrate poll doesn't stomp the user's own in-flight push.
   - Server-side defense: `ALLOWED_STATE_KEYS` allowlist (`dashboard-web/src/lib/sheets.ts:231`) blocks prototype-pollution via `__proto__`/`constructor` keys, and `Object.create(null)` is used for the kv map.

4. **URL state** — `dashboard-web/src/lib/urlState.ts` serializes the active tab + filters into URL params so refresh preserves view.

## Platform Requirements

**Apps Script (development):**
- Google account with access to script.google.com
- The script must run under a user who is Editor on the target spreadsheet (otherwise `SpreadsheetApp.openById` fails).
- `clasp` (Google's CLI) is supported but not required — files can be pasted manually.

**Apps Script (production):**
- Triggers run under the script owner's identity, with the OAuth scopes the owner approved on first install.
- Hard limits enforced by Google:
  - 6 minutes per execution
  - Daily UrlFetch quota (sufficient for 3 stores × hourly polling; current `Utilities.sleep(1500)` between stores + `sleep(500)` between major writes is a quota relief measure documented in `SYSTEM_OVERVIEW.md`)
  - 20 triggers per script per user

**Dashboard (development):**
- Node.js (Vercel's current LTS — matches `@types/node ^22`)
- `npm install` then `npm run dev` from `dashboard-web/`
- A `dashboard-web/.env.local` with the three env vars (`GOOGLE_CLIENT_EMAIL`, `GOOGLE_PRIVATE_KEY`, `SPREADSHEET_ID`)

**Dashboard (production):**
- **Vercel** (per `dashboard-web/README.md`, project name `roas-dashboard`, deployed URL `https://roas-dashboard-smoky.vercel.app`)
- Auto-deploys on `git push` to the `main` branch (Vercel project pre-configured)
- Env vars stored in Vercel's encrypted env store

## Quirks Worth Knowing

These are project-specific choices that surprise readers and matter for any new feature:

### Apps Script — V8 quirks

- **No module system.** Every function is a global. There is no `import` / `export` / `require` / ES modules support in Apps Script V8. Files are concatenated by Google at load time, so a function defined in `Config.gs` can call one defined in `Shopify.gs` directly. Name collisions silently win on whichever file was last loaded.
- **No `npm`, no `node_modules`.** All HTTP via `UrlFetchApp.fetch`; all JSON via global `JSON.parse`; no SDKs (no `@shopify/shopify-api`, no `googleapis` — direct REST + signed headers).
- **Globals re-execute every invocation.** Module-level statements (e.g. `const TZ = 'Asia/Jerusalem'`) run on every trigger fire — there is no warm container reuse.
- **Triggers are configured in code, not manifest.** `Main.gs:installDailyTrigger` and `installLiveTrigger` use `ScriptApp.newTrigger(...).timeBased()...create()`. The manifest only enumerates OAuth scopes.
- **Error notification email** falls through a 3-tier resolver in `DailyUpdate.gs:notifyError_`: explicit `notification.email` Script Property → `Session.getActiveUser().getEmail()` → script owner.

### Cross-system

- **Hebrew RTL UI.** `dashboard-web/src/app/layout.tsx` sets `<html lang="he" dir="rtl">`. All copy is Hebrew. Tab names in the spreadsheet are Hebrew (`'סיכום'`). Many code comments are Hebrew. Tailwind config uses Heebo as the primary sans font for proper Hebrew rendering.
- **Reporting currency is CAD.** All three stores are CAD-native; ad-platform spend in ILS/USD/EUR is converted via Frankfurter rates daily (`FX.gs`).
- **COGS is a global constant: 25% of revenue.** Defined twice — once in `Config.gs:COGS_RATE_OF_REVENUE` (for new daily rows written by Apps Script) and once in `dashboard-web/src/lib/analytics.ts:COGS_RATE_OF_REVENUE` (for historical rows that pre-date the field). Both must change together — explicit comment in both files calls this out.
- **`FROZEN_USD_TO_CAD = 1.36`** — `dashboard-web/src/lib/constants.ts`. Used only for *reproducible* suggestion math (Shopify plan price suggestions, CSV preview), never for production P&L. Production P&L uses the live Frankfurter rate written by Apps Script.
- **Transaction fees: 6.5% of revenue** — `dashboard-web/src/lib/costs.ts:TRANSACTION_FEES_RATE`. Email cost per store: 20 CAD/month.
- **Idempotent writes.** Every `write*ForDay` function in `SheetBuilder.gs` (campaigns, ads, products, orders-attribution) clears rows matching `dateStr` first, then appends new ones. Rows with unparseable dates are preserved (Round 5 fix WR5-02).
- **Phantom-spreadsheet protection.** `Config.gs:resetSpreadsheetIdToKnownGood` + `printCurrentSpreadsheetId` exist solely to recover from a historical bug where a Sheets-API timeout was misinterpreted as "not found" and a new spreadsheet got created. The canonical ID now lives in a Script Property (`spreadsheet.canonical-id`), not hardcoded in source.
- **Bayesian-flavored attribution confidence**, **multi-window stability**, **outlier detection** — implemented in `dashboard-web/src/lib/attributionAnalysis.ts` (~746 LOC). Uses normal-approximation 95% CI on AOV; computes σ of coverage across 7-day buckets to flag `volatile` ad sets; flags days where Meta-claimed conversion-value is >2.5σ above a trailing 14-day baseline.

---

*Stack analysis: 2026-05-18*
