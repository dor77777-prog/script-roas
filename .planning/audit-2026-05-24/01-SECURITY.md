# Security & Static Analysis Audit

Audit date: 2026-05-24 — Track 1 (Security & Static Analysis)
Scope: `/Users/dorperetz/script-roas/dashboard-web/` (single-tier Next.js 15 app)
Trust model calibration: internal admin tool, single operator, URL-obscurity. Findings rated against that baseline — auth/MFA/RBAC are intentionally out of scope.

## Summary

- Secrets hygiene is solid: `.env`, `.env.local`, and `*.env` are gitignored; no live secret material in tracked `dashboard-web/src/`; the lone test-fixture token (`shpat_TESTTOKEN…`) is clearly synthetic.
- The `/api/operator/*` and `/api/debug/*` surfaces have ZERO server-side auth checks. This is intentional per the URL-obscurity model, but pairing it with weak hardening (no `noindex`, no `Cache-Control: private`, no IP allowlist, no per-IP rate limit) means a single URL leak (Slack, screenshot, browser history sync, search-engine crawler) turns every endpoint into an open-mutator surface.
- Sentry has no `beforeSend`/PII scrubber. Fetcher error messages embed upstream response bodies (e.g. `Google Ads GAQL query failed … (HTTP 401): <text>`). When 4xx/5xx fires, those raw strings flow through `instrumentation.onRequestError → captureRequestError` un-redacted into Sentry. `userFacingError()` ONLY sanitises the response to the browser, not the Sentry payload.
- `@sentry/nextjs ^8.40.0` is exposed to GHSA-mw96-cpmx-2vgc (rollup arbitrary file write via path traversal, High). Fix is a single major bump to `@sentry/nextjs@^10.53.1`.
- Apps Script cleanup is 99% complete. Only `.claspignore` at repo root remains as a stale post-Phase-11 artefact. No `.gs`, `appsscript.json`, `.clasprc.json`, or `READ_FROM=sheets` runtime references found.

## P0 findings (immediate fix)

None. Calibrated to the trust model, no finding is "drop everything and fix now". The closest candidate (Sentry PII scrubbing) is P1 because the data already flows through gated infra (Vercel + Sentry org tenancy) and the operator is the only blast-radius target.

## P1 findings (next phase)

### P1-01 — Sentry has no `beforeSend` scrubber; raw fetcher errors leak upstream secrets
- `dashboard-web/sentry.server.config.ts:5-10` and `sentry.edge.config.ts:5-10` call `Sentry.init({ dsn, tracesSampleRate, environment })` with no `beforeSend`, no `denyUrls`, no PII filter.
- `dashboard-web/instrumentation.ts:30-40` forwards every server error to `captureRequestError(err, request, context)` — `request.url` (query string with `?from=&to=&storeId=`) and `err.message` both reach Sentry verbatim.
- The error messages contain raw upstream HTTP bodies, e.g. `dashboard-web/src/lib/fetchers/googleAds.ts:233-235` (`Google Ads OAuth refresh failed … (HTTP {status}): {text}`), `googleAds.ts:319` (GAQL query), `dashboard-web/src/lib/fetchers/meta.ts:344,453,533` (Meta Graph), `dashboard-web/src/lib/fetchers/tiktok.ts:159,167,243`, `dashboard-web/src/lib/fetchers/shopifyAuth.ts:70,90,100`. The Google Ads file even has an inline comment (line 228-231) acknowledging "Body may contain Google's own diagnostic — include it because it never contains the refresh-token value" — that contract holds for Google's OAuth endpoint but is not enforced across the other 4 providers.
- Remediation: add a `beforeSend(event)` hook in `sentry.server.config.ts` and `sentry.edge.config.ts` that (a) regex-scrubs known token prefixes (`shpat_`, `shpss_`, `EAA[A-Za-z0-9]{20,}`, `ya29\.`, `1//[A-Za-z0-9_-]+`) from `event.exception.values[*].value`, and (b) strips the request URL down to pathname only (drop search-string). Mirrors the protection `userFacingError()` already provides on the wire.

### P1-02 — `/api/debug/shopify-fetch` is a permanent unauthenticated diagnostic endpoint
- `dashboard-web/src/app/api/debug/shopify-fetch/route.ts:62-125` — labelled "One-time debug endpoint (Phase 05.7.6 — 2026-05-22 incident)" but is still live. It accepts `?storeId=&date=YYYY-MM-DD`, reads `<STORE>_SHOPIFY_DOMAIN` + `<STORE>_SHOPIFY_TOKEN` from env, fires a Shopify Admin REST call, and returns:
  - the constructed Shopify URL with the operator's myshopify.com domain,
  - the full first sample order JSON (`sampleOrder`),
  - the first 500 bytes of raw upstream body (`bodyPrefix`).
- Post-fix the token is no longer leaked (good), but the route still exposes Shopify order detail (customer names if present, totals, financial_status) to anyone who hits the URL. Combined with no auth, this is a real read-only data-exfil surface.
- Remediation: either delete the route now that the 2026-05-22 incident is closed, OR gate it behind a header check (`x-operator-secret` compared against an env var) that mirrors anything else added in P1-04. Delete is preferred — the diagnostic value lives only in the git history.

### P1-03 — Inngest signing-key verification is implicit; one missing env var = silently open webhook
- `dashboard-web/src/app/api/inngest/route.ts:96-125` relies on `serve({ client, functions })` from `inngest/next` reading `INNGEST_SIGNING_KEY` automatically. The comment on lines 122-124 asserts "serve() validates X-Inngest-Signature on every POST and rejects requests with bad / missing signatures".
- The SDK's behaviour when the env var is ABSENT (e.g. accidental rotation, Vercel preview env drift) is not pinned by a test, and a quick grep finds no boot-time check that fails the deploy. If `INNGEST_SIGNING_KEY` is empty in a preview / branch deploy, the SDK falls back to permissive mode in older versions and would accept any signed-looking POST — anyone who knows the route can fire arbitrary `event/*` payloads (e.g. trigger 365-day backfills, drain quota).
- Remediation: add a `require-env` check that throws at module load if `INNGEST_SIGNING_KEY` is missing AND `NODE_ENV === 'production'`, OR pass `signingKey: process.env.INNGEST_SIGNING_KEY` explicitly to `serve()` with the same throw. Either way, add a unit test asserting `serve()` rejects an unsigned POST in production mode.

### P1-04 — `/api/operator/*` has no auth check beyond URL obscurity; no rate limit; no `X-Robots-Tag`
- All seven routes under `dashboard-web/src/app/api/operator/` (`reset`, `sync-now`, `backfill`, `token-failures`, `jobs`, `manual-overrides`, `notifications/send`) plus the `/operator` UI page render and mutate without checking any request header, cookie, or IP.
- The `reset/route.ts:107-206` validator requires the literal confirmation token in the body — good UI-replay defence — but `sync-now` (line 61-108), `backfill` (line 82-165), `notifications/send` (line 26-61), and `manual-overrides` POST/PATCH/DELETE have no such gate. Anyone who learns the prod URL can fire `event/backfill` for the full 24-day window or push fake spend rows.
- There is no `next.config.ts` `headers()` block, no middleware, no `robots.txt`, no `X-Robots-Tag: noindex`. The URL IS the only secret; nothing is stopping Vercel preview branches, Google's crawler, or Slack link unfurls from indexing it.
- Remediation (calibrated, in order of cost):
  1. Add `X-Robots-Tag: noindex, nofollow` to a middleware (covers every route, ~10 LoC).
  2. Add a single shared `requireOperatorSecret(req)` helper that compares `req.headers.get('x-operator-secret')` against `process.env.OPERATOR_SHARED_SECRET`, invoked from every `/api/operator/*` and `/api/debug/*` POST/DELETE/PATCH. The operator console reads the secret from `localStorage` and attaches it automatically. Adds 1 env var, ~30 LoC.
  3. Optional: Vercel Edge Config IP allowlist for `/api/operator/*` and `/operator` (zero-cost if operator works from a stable IP).

### P1-05 — `@sentry/nextjs ^8.40.0` carries High-severity advisory (rollup path traversal)
- `dashboard-web/package.json:14` pins `"@sentry/nextjs": "^8.40.0"`. `npm audit` reports `@sentry/nextjs` → `@sentry/webpack-plugin` → `rollup` chain affected by GHSA-mw96-cpmx-2vgc (arbitrary file write via path traversal, High). Fix available: `@sentry/nextjs@10.53.1` (semver-major bump).
- Remediation: bump to `^10.53.1` in a dedicated PR (the Sentry 9 → 10 changelog touched the `instrumentation.ts` API; coordinate with `instrumentation.ts:30-40` and the `sentry.*.config.ts` triplet during the bump).

## P2 findings (cleanup)

### P2-01 — `docs/PROPS-MAP.md` is stale relative to actually-referenced env vars
- The catalog (`docs/PROPS-MAP.md`) lists 43 rows but is missing every env var added post-Phase-05.5:
  - `META_GLOBAL_TOKEN` (referenced in `cronDaily.ts`, `cronLive.ts`)
  - `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `NOTIFICATION_RECIPIENT_ALLOWLIST` (`dashboard-web/src/lib/notifications/whatsapp.ts`)
  - `INNGEST_SIGNING_KEY`, `INNGEST_EVENT_KEY` (`api/inngest/route.ts`, `api/operator/jobs/route.ts:98`)
  - `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN` (`next.config.ts`, `sentry.*.config.ts`)
  - `<STORE>_TIKTOK_ACCESS_TOKEN`, `<STORE>_TIKTOK_ADVERTISER_ID` (`dashboard-web/src/lib/fetchers/tiktok.ts:117-118`)
- Conversely the catalog still names `SPREADSHEET_ID`, `ARCHIVE_SPREADSHEET_ID`, `GOOGLE_CLIENT_EMAIL`, `GOOGLE_PRIVATE_KEY`, Twilio (rows 14-16) as live destinations — all of those are post-Phase-11 dead. `dashboard-web/src/lib/apiErrors.ts:27` still regex-matches the deprecated names, which is harmless but noisy.
- Remediation: regenerate PROPS-MAP from a `grep -ohE 'process\.env\.\w+|process\.env\[\`\$\{[^}]+\}_[A-Z_]+\`\]' src/` pass; remove the dead-tier rows; mark the new ones as required-in-prod.

### P2-02 — Leftover `.claspignore` at repo root
- `/Users/dorperetz/script-roas/.claspignore` is a 3-line file (`**/**`, `!*.gs`, `!appsscript.json`) that has no purpose after Phase 11. Delete it. Pair with a grep gate ensuring `clasp`/`appsscript.json` never reappears.

### P2-03 — `Math.random()` ID generation in `annotations.ts` / `billing.ts`
- `dashboard-web/src/lib/annotations.ts:96` and `dashboard-web/src/lib/billing.ts:122` generate IDs as `${Date.now().toString(36)}-${Math.random().toString(36).slice(2,…)}`. For a single-user internal tool with collision space of ~6-8 base36 chars per call this is functionally fine, but `Math.random()` is non-cryptographic. If these IDs ever flow into an externally-addressable key (URL fragment, audit log lookup), swap to `crypto.randomUUID()` (zero-cost in Node 16+ and browsers ≥ Chrome 92).

### P2-04 — `tracesSampleRate: 0.1` in all 3 Sentry configs sends URL query strings
- `dashboard-web/sentry.{client,server,edge}.config.ts` enable performance tracing for 10% of transactions. Sentry's default transaction name for Next.js includes the full pathname + query string. For an internal tool the operator's `from=2026-01-01&to=2026-05-24&storeId=uzoshop` filter selections are not sensitive, but if a future feature ever puts a user email or order id into a query param, it will silently start flowing to Sentry. Pair with the P1-01 `beforeSend` work to also drop `event.request.query_string` if you do not actively need it.

### P2-05 — `userFacingError` regex-matches deprecated Google Sheets error strings
- `dashboard-web/src/lib/apiErrors.ts:27` still maps `Missing GOOGLE_CLIENT_EMAIL|GOOGLE_PRIVATE_KEY|SPREADSHEET_ID` → Hebrew "missing env vars" message. Those env vars no longer exist post-Phase 11. The line is harmless (will never match), but it is dead code that misleads grep-based maintenance. Drop it; rely on the broader `Missing GOOGLE_` and Supabase-aware matchers.

### P2-06 — `dangerouslySetInnerHTML` in `CampaignsTable.tsx:1723` is safe but worth pinning
- The source string comes from `buildHiddenColumnsCss(prefs.hidden)` in `dashboard-web/src/lib/campaignsColumnPrefs.ts:283`, which filters every column id through `/^[a-zA-Z0-9_-]+$/.test(id)`. That is correct allowlist sanitisation. Add a unit test that pins the regex so a future "let users name custom columns" change cannot silently re-open this. (No remediation beyond the test.)

## Semgrep results (top 10 if any)

Semgrep was not run. Attempt 1: `npx --yes -p semgrep@1.94.0 semgrep …` — `semgrep` is a Python package and not on the npm registry, so `npm error code ETARGET / no matching version`. Attempt 2: no `semgrep` binary on PATH, no `pipx`, no `pip install --user` permitted within audit scope. Per the task brief "If semgrep isn't installed or times out, document the attempt and move on" — documenting and moving on.

A manual grep pass for the obvious anti-patterns Semgrep would catch was performed:
- `eval(`, `new Function(`, `child_process` → 0 hits in `src/`
- `innerHTML` / `outerHTML` / `document.write` → 0 hits outside the one audited `dangerouslySetInnerHTML` in P2-06
- raw SQL / Supabase `.rpc()` → 0 hits; every Supabase call uses parameterised `.from().select().eq()` / `.upsert()` / `.delete().eq()`
- `Math.random` in security-relevant paths → only the two ID generators flagged in P2-03

## npm audit summary

`cd dashboard-web && npm audit --json` (run 2026-05-24):
- 16 vulnerabilities total. 14 moderate, 2 HIGH, 0 critical.
- HIGH-1: `@sentry/nextjs` (range `6.3.6 - 10.39.0`) — see P1-05. Fix: `@sentry/nextjs@10.53.1` (semver-major).
- HIGH-2: `rollup` (range `3.0.0 - 3.29.5`) — GHSA-mw96-cpmx-2vgc, arbitrary file write via path traversal. Pulled in transitively via `@sentry/nextjs → @sentry/webpack-plugin → rollup`. Fixed by the same Sentry bump above.
- 14 moderate are all transitive build-time only (Next/eslint/postcss chain) and do not affect production runtime; defer to a routine `npm audit fix` sweep alongside the Sentry bump.

## Notes for other tracks

- Perf track: the 50k-row "consider pagination" warnings in `/api/data` (`route.ts:52`), `/api/ads` (`route.ts:39`), `/api/campaigns` (`route.ts:69`), `/api/products` (`route.ts:45`), `/api/orders-attribution` (`route.ts:48`), `/api/product-catalog` (`route.ts:21`), `/api/store-meta` (`route.ts:15`) are all soft warnings that never enforce a cap. With no auth on the URL surface (P1-04) and no per-request size cap, a `?from=0001-01-01` style request that does pass the `isRealDate` gate at the extremes can trigger expensive Supabase reads. Date-range upper-bound (e.g. clamp `to - from <= 730 days`) belongs in `dateRange.ts:parseRangeParams` and would close both perf and security angles in one change.
- Algorithm/data-quality track: `dashboard-web/src/app/api/operator/manual-overrides/route.ts:171-178` got an AUDIT API-26 fix that swapped `parseFloat` for `parseStrictNumeric` on `spend`. Worth confirming the same strictness applies to `data_daily` / `campaigns_daily` writers — `parseFloat('1500NIS')` returning 1500 may still be a source of silent corruption elsewhere if the writer side trusts upstream-provided numerics without the same regex.
- Docs track: `docs/PROPS-MAP.md` and `dashboard-web/src/components/SyncIndicator.tsx:157-158` both still reference the post-Phase-11 dead env vars (`GOOGLE_CLIENT_EMAIL`, `GOOGLE_PRIVATE_KEY`). User-facing doc cleanup belongs in that track; P2-01 here covers the catalog side of the same divergence.
- Ops/cron track: confirm that token-failure alert recipient `+972524809540` (`dashboard-web/src/lib/notifications/tokenFailures.ts:85` and 4 other files) is intentionally hardcoded and never reaches a Sentry breadcrumb or the wire surface of any unrelated route. The number is a real personal mobile and would be PII under EU GDPR if shipped accidentally.
