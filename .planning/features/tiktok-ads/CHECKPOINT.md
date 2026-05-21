---
feature: tiktok-ads
status: awaiting-tiktok-app-approval
last_updated: 2026-05-22
owner: dor77777-prog
---

# TikTok Ads Integration — Feature Checkpoint

> **Quick read**: 4-phase integration to add TikTok Ads as a first-class paid platform alongside Meta + Google. Phases A + B-scaffold are shipped (commits `62393e1` + `6da8592`). Blocked on TikTok App approval (1-3 business days). When approval arrives: OAuth handshake → paste token to Vercel → Phase B execution (~6h) → Phase C (UI, ~4h) → Phase D (WhatsApp template re-approval, ~1h code + 1-12h Meta wait).

## TL;DR — pick up from here in 3 sentences

1. Phase A (schema + source classifier) and Phase B scaffold (fetcher + OAuth callback + tests) are on `main`, deployed to prod. Nothing user-visible yet — fetcher throws `Missing TikTok creds` when called.
2. TikTok Marketing API App is **IN REVIEW** at [business-api.tiktok.com/portal/apps](https://business-api.tiktok.com/portal/apps) — App name `ROAS Tracker — uzoshop`, scopes `Ad Account Management` + `Reporting`, single advertiser (uzoshop only).
3. When approval lands: follow [§ After approval](#after-approval) (9 steps, ~10 min user time + ~6h Claude time for Phase B execution).

---

## Goal

Add TikTok Ads as a first-class paid platform on the ROAS dashboard so that:
- `data_daily.tt_spend_cad` populates daily for uzoshop (the only store running TikTok)
- Orders classified by ad click ID (`ttclid`) / `utm_source=tiktok` / `source_name=tiktok` → bucketed as `tiktok-paid` (separate from `meta-paid` / `google-paid` / `other-paid`)
- Dashboard UI shows a TikTok column in detail tables + KPI cards + campaigns filter
- WhatsApp daily summary shows a 4th source bucket (טיקטוק) alongside פייסבוק/גוגל/אחרים

Same data shape and operator-facing surface as the existing Meta + Google integrations.

---

## Architecture

```
TikTok Marketing API v1.3
  ├─ /advertiser/info/                    → currency, timezone (cached per process)
  └─ /report/integrated/get/              → spend + per-ad insights
        │
        ▼
src/lib/fetchers/tiktok.ts                ← Phase B scaffold (in main)
        │
        ▼
[NOT YET WIRED] cronDaily.ts + cronLive.ts ← Phase B execution
        │
        ▼
data_daily.tt_spend_cad (Phase A schema)
campaigns_daily WHERE platform='tiktok'
        │
        ▼
[NOT YET BUILT] Dashboard UI columns       ← Phase C
[NOT YET BUILT] WhatsApp 4-bucket template ← Phase D
```

---

## 4-Phase Plan

### ✅ Phase A — Schema + Classifier (SHIPPED, commit `62393e1`)

**What changed:**
- Migration `20260522002225_add_data_daily_tiktok_spend.sql` — adds `data_daily.tt_spend_cad NUMERIC(14, 4)` (nullable)
- `src/lib/ordersAttribution.ts` — `OrderSource` union adds `'tiktok-paid'`
- `src/lib/fetchers/shopify.ts:classifyOrderAttribution` — 3 detection paths to `'tiktok-paid'`:
  1. `source_name === 'tiktok'` (Shopify TikTok channel)
  2. `ttclid` in landing URL (TikTok ad click ID, parallel to fbclid/gclid)
  3. `utm_source === 'tiktok'` (with OR without utm_medium=cpc)
- Organic referrer `tiktok.com` (no ttclid/UTM) → `'other-referral'`, NOT `'tiktok-paid'`
- `src/lib/notifications/summary.ts` — counts `tiktok-paid` in a separate bucket (alongside facebook/google)
- `src/lib/notifications/templateParams.ts` — currently COMBINES `tiktok + other` in WhatsApp output ("אחרים") to keep behavior consistent until Phase D template ships
- `src/components/MetaShopifyReconciliation.tsx:isOrganicSource` — excludes `tiktok-paid` from organic
- 6 new vitest cases for TikTok detection + reconciliation sweep

**Effect today:** Once uzoshop starts running TikTok ads with click-IDs intact, those orders correctly classify to `tiktok-paid` in `orders_attribution`. Until Phase B+C ship, the impact is only visible via direct SQL query — UI still buckets them under "other" implicitly.

### ✅ Phase B Scaffold — fetcher + OAuth callback (SHIPPED, commit `6da8592`)

**What changed:**
- `src/lib/fetchers/tiktok.ts` (~280 lines) — full Marketing API v1.3 client:
  - `fetchTikTokAdvertiserInfo(storeId)` — currency + timezone lookup, process-cached
  - `fetchTikTokSpendForDay(storeId, dateStr)` — store-level daily total
  - `fetchTikTokAdInsights(storeId, dateStr)` — per-ad rows
  - Reads `${STORE}_TIKTOK_ADVERTISER_ID` + `..._ACCESS_TOKEN` env vars
  - TikTok envelope `{ code, message, request_id, data }` error handling
  - Throws clear "Missing TikTok creds" when env vars unset
- `src/app/api/oauth/tiktok/callback/route.ts` — receives `?auth_code=XXX`, renders Hebrew HTML page with the auth_code + ready-to-paste curl command for the one-time exchange
- `.env.local.example` — documents 4 env vars (WhatsApp × 2 + TikTok × 2)
- 5 new vitest cases for TikTok fetcher (auth header, envelope errors, row parsing)

**NOT wired into cronDaily/cronLive** — wiring is Phase B execution (after token in hand). Calling the fetcher today raises `Missing TikTok creds: UZOSHOP_TIKTOK_ADVERTISER_ID, UZOSHOP_TIKTOK_ACCESS_TOKEN`.

### ⏳ Phase B Execution (BLOCKED on TikTok approval, ~6h Claude time)

Once `UZOSHOP_TIKTOK_ADVERTISER_ID` + `UZOSHOP_TIKTOK_ACCESS_TOKEN` are in Vercel env, do:

1. **Wire fetcher into `cronDaily.ts` Step 3:**
   - Add `fetchTikTokSpendForDay('uzoshop', dateStr)` to the Promise.all alongside Meta + Google
   - Convert advertiser-currency spend → CAD via existing `getFxRate` helper
   - Write `tt_spend_cad: ttSpendCad` in the data_daily upsert payload
   - Update `total_spend_cad` formula: `fbSpendCad + gaSpendCad + ttSpendCad`
   - Skip for zolplus + usmile360 (no TikTok creds → silent no-op via try/catch + warn)

2. **Wire fetcher into `cronLive.ts` (same pattern, every 15 min):**
   - Same Promise.all extension
   - Same tt_spend_cad write to data_daily payload (Phase 05.7.4-fix: cronLive MUST write all spend columns together to preserve invariants)

3. **Wire `fetchTikTokAdInsights` into `cronDaily.ts` Step 5:**
   - Per-ad row write to `campaigns_daily WHERE platform='tiktok'`
   - Same shape as the existing Meta + Google ad writers
   - Per-ad: campaign/adgroup/ad IDs + names, spend (CAD), impressions, clicks, conversions, conversion_value

4. **Add 3-5 new vitest cases:**
   - cronDaily Step 3 calls `fetchTikTokSpendForDay` for uzoshop only
   - cronDaily Step 5 writes campaigns_daily rows with platform='tiktok'
   - cronLive includes tt_spend_cad in data_daily payload

5. **Trigger Backfill on 7 recent days** to populate historical TikTok rows.

### ⏳ Phase C — Dashboard UI (BLOCKED on Phase B execution, ~4h)

Once tt_spend_cad has values, add UI surfaces:

- `DetailTable.tsx` — column "טיקטוק" between "גוגל" and "סה"כ הוצאה" (only renders if store has TikTok activity)
- `MonthlyTables.tsx` — same column in per-store monthly blocks
- `KpiCards.tsx` — TikTok spend KPI card (only when totalTtSpend > 0)
- `CampaignsTable.tsx` — `platform` filter pill: All / Meta / Google / TikTok
- `PnLBreakdown.tsx` — TikTok spend row in the cost stack
- `postgresReaders.ts` — surface `tt_spend_cad` in `DailyRow.ttSpend`
- `lib/types.ts` — add `ttSpend: number` to `DailyRow`

### ⏳ Phase D — WhatsApp Template w/ 4 source buckets (BLOCKED on Phase B execution, ~1h code + 1-12h Meta wait)

Currently the approved Meta template `roas_daily_summary` body has 5 placeholders; the store-block parameter shows `(פייסבוק: X, גוגל: Y, אחרים: Z)` — 3 source buckets. Phase D:

1. **Submit a new template body** to Meta WhatsApp Manager:
   ```
   🏪 uzoshop: • הוצאה: C$X • הכנסות: C$Y • ROAS: Z • הזמנות: N  (פייסבוק: A, גוגל: B, טיקטוק: T, אחרים: O)
   ```
   New name suggestion: `roas_daily_summary_v2`

2. **Wait for Meta approval** (~1-12h SLA for Utility)

3. **Update Postgres:**
   ```sql
   UPDATE notification_config SET template_name = 'roas_daily_summary_v2' WHERE provider = 'metacloud';
   ```

4. **Update `templateParams.ts`** — remove `combinedOther()` wrapper, render `s.tiktok` as its own field, `s.other` separately.

5. **Test via /operator → "שלח כמו 12:00"** — verify the 4-bucket message arrives.

---

## Status snapshot (2026-05-22)

### ✅ Done

- [x] Phase A — schema + classifier shipped (`62393e1`)
- [x] Phase B scaffold — fetcher + OAuth callback + tests shipped (`6da8592`)
- [x] Migration `20260522002225_add_data_daily_tiktok_spend.sql` applied to prod Supabase
- [x] TikTok App registered at TikTok Developers Portal (`business-api.tiktok.com/portal/apps`)
  - App name: `ROAS Tracker — uzoshop`
  - Description: read-only reporting dashboard for single advertiser
  - Redirect URLs: `https://roas-dashboard-smoky.vercel.app/api/oauth/tiktok/callback` (both Advertiser + Account Holder fields)
  - App logo: cropped from existing dashboard
  - Scopes: `Ad Account Management` + `Reporting` (read-only, 2 scopes only)

### ⏳ Blocked — awaiting external party

- [ ] TikTok approval email (typical SLA 1-3 business days)
  - Check status: [business-api.tiktok.com/portal/apps](https://business-api.tiktok.com/portal/apps)
  - Approval email comes from `developers@tiktok-business.com`
  - On rejection (rare for read-only + 2 scopes): TikTok will state the reason; common fixes are tightening the description or replacing the logo.

### 🔜 After approval — 9 steps

See [§ After approval](#after-approval) below.

---

## Configuration

### TikTok Developer Portal assets (created during App registration)

| Asset | Where | Notes |
|---|---|---|
| App ID | TikTok Developer Portal → Apps → ROAS Tracker — uzoshop | Public identifier, OK to commit if needed |
| App Secret | Same place, **hidden by default — click "View" to reveal** | NEVER commit. Used ONCE during OAuth exchange, then can be forgotten. |
| Advertiser Redirect URL | Set during registration | `https://roas-dashboard-smoky.vercel.app/api/oauth/tiktok/callback` |
| TikTok Account Holder Redirect URL | Set during registration | Same as above (we don't use account-holder flow) |
| Scopes | Set during registration | `Ad Account Management` + `Reporting` |

### Vercel env vars (NOT YET SET — set after OAuth)

| Name | Value source | Required for |
|---|---|---|
| `UZOSHOP_TIKTOK_ADVERTISER_ID` | `advertiser_ids[0]` from OAuth exchange JSON | All TikTok fetcher calls |
| `UZOSHOP_TIKTOK_ACCESS_TOKEN` | `access_token` from OAuth exchange JSON | All TikTok fetcher calls |

Convention: PROPS-MAP `${STORE}_PLATFORM_FIELD` (uppercase store, snake_case field). Matches Meta + Google + Shopify env-var shape.

### Postgres `notification_config` (UNCHANGED in Phase B — Phase D updates)

| Field | Current value | Phase D change |
|---|---|---|
| `template_name` | `roas_daily_summary` | → `roas_daily_summary_v2` (after new template approved) |

---

## After Approval

When TikTok sends the approval email, execute these 9 steps (user time ~10 min, Claude time ~6h for Phase B execution):

### Step 1 — Confirm App is approved

1. Open [business-api.tiktok.com/portal/apps](https://business-api.tiktok.com/portal/apps)
2. Find `ROAS Tracker — uzoshop` in the list
3. Status badge should say "Approved" (green)
4. Click the App → note the **App ID** and **App Secret** (click "Show" on secret)

### Step 2 — Start the OAuth authorization flow

Construct the auth URL manually (TikTok doesn't provide a "click here" button for self-service apps):

```
https://business-api.tiktok.com/portal/auth?app_id=<APP_ID>&state=csrf-nonce-2026-05-22&redirect_uri=https%3A%2F%2Froas-dashboard-smoky.vercel.app%2Fapi%2Foauth%2Ftiktok%2Fcallback
```

Replace `<APP_ID>` with the actual ID. Paste into browser address bar.

### Step 3 — Authorize the App for uzoshop

1. TikTok login prompt → log in with the uzoshop TikTok account credentials
2. Consent screen → review scopes (Ad Account Management + Reporting)
3. Click "Confirm" / "Authorize"

### Step 4 — Land on the callback endpoint

TikTok redirects to:
```
https://roas-dashboard-smoky.vercel.app/api/oauth/tiktok/callback?auth_code=ABCDEFG...&state=csrf-nonce-2026-05-22
```

The endpoint renders a Hebrew HTML page with:
- The `auth_code` in a copy-able `<pre>` block
- A ready-to-paste curl command (with `<APP_ID>` + `<APP_SECRET>` placeholders)
- Step-by-step instructions for what to do with the JSON response

### Step 5 — Exchange auth_code → access_token (CLI, one-time)

Open Terminal and paste the curl command from the callback page, after filling in App ID + App Secret:

```bash
curl -X POST 'https://business-api.tiktok.com/open_api/v1.3/oauth2/access_token/' \
  -H 'Content-Type: application/json' \
  -d '{"app_id":"<YOUR_APP_ID>","secret":"<YOUR_APP_SECRET>","auth_code":"<auth_code from page>"}'
```

Response shape:

```json
{
  "code": 0,
  "message": "OK",
  "data": {
    "access_token": "<long permanent token>",
    "scope": ["Ad Account Management","Reporting"],
    "advertiser_ids": ["<numeric advertiser id>"]
  }
}
```

> **CRITICAL**: This is a ONE-TIME exchange. The `auth_code` expires after 1 hour and is single-use. If the curl fails for any reason (typo, network), restart from Step 2 — there's no "re-exchange" path.

### Step 6 — Save the access_token + advertiser_id

1. Open Vercel → Project `roas-dashboard-smoky` → Settings → Environment Variables
2. Add `UZOSHOP_TIKTOK_ADVERTISER_ID` = `advertiser_ids[0]` value (all 3 environments: Production, Preview, Development)
3. Add `UZOSHOP_TIKTOK_ACCESS_TOKEN` = `access_token` value (all 3 environments)
4. Save → Deployments → Redeploy latest with "Use existing Build Cache"

### Step 7 — Verify via /operator > ריצות אחרונות

After redeploy (~1 min), trigger a manual Sync from `/operator` → "Sync now (uzoshop)". The eventSyncNow handler runs the cronDaily code path. Since Phase B execution hasn't shipped yet, this won't write tt_spend_cad — but it WILL surface any auth issue with the TikTok credentials.

### Step 8 — Notify Claude on `main` to execute Phase B

Write to Claude: "סיימתי OAuth, הטוקן ב-Vercel". Claude will then:

1. Modify `cronDaily.ts` to fetch TikTok spend + per-ad insights (Promise.all alongside Meta + Google)
2. Modify `cronLive.ts` to include tt_spend_cad in data_daily upsert payload
3. Add vitest cases for the new wiring
4. Push to prod (~6 hours of work, single commit)

### Step 9 — Trigger Backfill for the last 7 days

Once Phase B execution lands and deploys, go to `/operator` → Backfill → range 7 days back → "uzoshop only" → Run. Inngest queues 7 daily backfill jobs; each populates `data_daily.tt_spend_cad` for uzoshop. Verify in Supabase Studio that `tt_spend_cad` is non-null on those dates.

---

## After Phase B Execution

Once tt_spend_cad is populated, proceed to:

- **Phase C** (UI, ~4h): dashboard columns, KPI cards, campaigns filter — Claude can execute in one session.
- **Phase D** (WhatsApp, ~1h code + Meta wait): submit `roas_daily_summary_v2` template to Meta, wait for approval, update `notification_config.template_name`, remove `combinedOther()` wrapper in `templateParams.ts`.

---

## Troubleshooting

### App rejected by TikTok

Read the rejection email — TikTok explicitly states the reason. Common fixes:

| Reason | Fix |
|---|---|
| Description too vague | Rewrite to be more specific: read-only, single advertiser, what data is read, what it's used for |
| Logo unclear / generic | Upload a clearer logo with the product name visible |
| Scopes don't match described use case | Remove scopes that aren't justified in the description |
| Redirect URL invalid | Verify the URL is HTTPS and reachable (curl it — should return a 400 "missing auth_code" page) |

Re-submit with the fix; review usually completes faster the second time.

### auth_code exchange fails with code !== 0

| TikTok code | Meaning | Fix |
|---|---|---|
| 40000 | Bad request | Verify the curl body is valid JSON with app_id + secret + auth_code |
| 40001 | Invalid auth_code | The auth_code is either expired (>1 hour since redirect) or already used. Restart from Step 2. |
| 40015 | App not approved | The App is still in review. Wait for the approval email. |
| 40002 | Scope mismatch | The App was approved with different scopes than what the OAuth URL requested. Recreate the auth URL with the actual approved scopes. |

### Phase B fetcher returns 0 spend but TikTok Ads Manager shows real spend

- Check `UZOSHOP_TIKTOK_ADVERTISER_ID` matches the advertiser_id in TikTok Ads Manager → Account info
- Check the access_token has `Reporting` scope (not just `Ad Account Management`)
- Check the date — TikTok reporting uses the advertiser's account timezone, NOT UTC. Our cronDaily passes `dateStr` in `Asia/Jerusalem`; if uzoshop's TikTok account is set to a different TZ, daily boundaries shift.
- Run the curl in Step 5 again on the response JSON to verify the token is still valid

---

## Code references

### Files touched

**Phase A (commit `62393e1`):**
- `supabase/migrations/20260522002225_add_data_daily_tiktok_spend.sql`
- `dashboard-web/src/lib/ordersAttribution.ts`
- `dashboard-web/src/lib/fetchers/shopify.ts`
- `dashboard-web/src/lib/notifications/summary.ts`
- `dashboard-web/src/lib/notifications/templateParams.ts`
- `dashboard-web/src/components/MetaShopifyReconciliation.tsx`
- `dashboard-web/src/lib/fetchers/__tests__/shopify.test.ts`
- `dashboard-web/src/lib/__tests__/buildReconciliation.test.ts`

**Phase B scaffold (commit `6da8592`):**
- `dashboard-web/src/lib/fetchers/tiktok.ts` (NEW)
- `dashboard-web/src/app/api/oauth/tiktok/callback/route.ts` (NEW)
- `dashboard-web/src/lib/fetchers/__tests__/tiktok.test.ts` (NEW)
- `dashboard-web/.env.local.example`

### Recent commits

| Commit | Message |
|---|---|
| `6da8592` | chore(tiktok): Phase B scaffold — fetcher + OAuth callback + env example |
| `62393e1` | feat(tiktok): Phase A — schema + classifier for tiktok-paid source |

---

## How to resume work from this checkpoint

Whoever picks this up (you in a future session, future-Claude):

1. Read this whole file.
2. Check TikTok Developer Portal for App status: [business-api.tiktok.com/portal/apps](https://business-api.tiktok.com/portal/apps).
3. If `APPROVED` → execute [§ After approval](#after-approval) (9 steps).
4. If still `IN REVIEW` → wait or check again later.
5. If `REJECTED` → read the rejection reason in the email, apply the matching fix from [§ Troubleshooting](#troubleshooting), resubmit.
6. Once Phase B execution + Phase C + Phase D ship, the dashboard has TikTok as a fully first-class platform on parity with Meta + Google.

---

## Future enhancements (not blocking)

- [ ] Multi-store TikTok support (currently uzoshop only — zolplus/usmile360 fetcher calls throw "Missing creds")
- [ ] TikTok Pixel verification — surface in dashboard whether the conversion tracking pixel is firing
- [ ] TikTok Campaign Budget Optimization (CBO) vs Ad Group Budget Optimization (ABO) split, like the Meta budgets feature in Phase 05.7.2
- [ ] Per-creative-ID asset metadata (similar to Meta's creative fetcher) for the campaigns table thumbnails
- [ ] Webhook receiver for delivery confirmation on the WhatsApp template (Phase 05.7.4 also lacks this)
