# ROAS Dashboard — Architecture & System Reference

> **קהל יעד**: מפתחים, מי שמתחזק את הקוד, AI agents שעובדים על הריפו.
> זה לא user manual — לזה יש את [docs/ROAS-Dashboard-User-Manual.md](ROAS-Dashboard-User-Manual.md).
>
> **גרסה**: 1.5 · **תאריך**: 2026-06-04 · **בסיס קוד**: Phase 05.7.x + mesh exact re-skin + NC-ROAS / first-click + Wave 2 customer-value (cohorts / LTV) tab + תשלומים (payment-method breakdown) tab

---

## 1. סקירה כללית

מערכת ROAS Tracker היא:
- **Internal tool** למפעיל יחיד (URL-obscurity trust model — אין login, אין multi-user).
- אוספת אוטומטית נתוני פרסום (Meta / Google / TikTok) + מכירות (Shopify) + שערי FX.
- אגרגציה ב-Supabase Postgres.
- Dashboard ב-Next.js + React שמציג גרפים/טבלאות + מקבל החלטות תקציב.

**Production**: `https://roas-dashboard-smoky.vercel.app`
**Repo**: `https://github.com/dor77777-prog/script-roas`

---

## 2. דיאגרמת זרימת דאטה (Phase 05.7+)

```
┌──────────────┐  ┌───────────┐  ┌──────────────┐  ┌───────────┐  ┌──────┐
│   Shopify    │  │ Meta Ads  │  │  Google Ads  │  │  TikTok   │  │  FX  │
│ Admin REST   │  │   v25.0   │  │     v24      │  │  v1.3     │  │OXR   │
│   2026-04    │  │           │  │              │  │           │  │      │
└──────┬───────┘  └─────┬─────┘  └─────┬────────┘  └────┬──────┘  └──┬───┘
       └────────────────┴───────────────┴────────────────┴────────────┘
                                  │
                       ┌──────────▼──────────┐
                       │   Inngest Cloud     │
                       │   cron-daily   ×3   │  (00:05 IL — fetch + write)
                       │   cron-live    ×3   │  (כל 10 דק׳)
                       │   sync-now (event)  │
                       │   backfill (event)  │
                       │   whatsapp ×3       │  (12:00 / 18:00 / 00:10)
                       └──────────┬──────────┘
                                  │
                       ┌──────────▼──────────┐
                       │ Supabase Postgres   │
                       │  10 tables          │
                       └──────────┬──────────┘
                                  │
                       ┌──────────▼──────────┐
                       │  Next.js API routes │
                       │  (Vercel ISR 60s)   │
                       └──────────┬──────────┘
                                  │
                       ┌──────────▼──────────┐
                       │  Dashboard (RTL)    │
                       └─────────────────────┘

Sheets path (deprecated 05.7): ה-spreadsheet עדיין קיים אבל הדשבורד לא קורא ממנו.
Apps Script triggers יורדים ידנית במהלך 28.4 cutover.
```

---

## 3. Storage — Supabase Postgres

10 טבלאות (מאז Phase 05.5):

| טבלה | תוכן | מי כותב | מי קורא |
|---|---|---|---|
| `stores` | 3 שורות חנות + FK target | seed migration | כל route |
| `data_daily` | פר (date, store): `fb_spend_cad`, `ga_spend_cad`, `tt_spend_cad`, `total_spend_cad`, `fb_impressions`, `ga_impressions`, `tt_impressions`, `revenue_cad`, `gross_revenue_cad`, `refund_deduction_cad` | Inngest cron-daily + cron-live | `/api/data` |
| `campaigns_daily` | פר (date, store, platform, campaign, ad_set): `spend`, `impressions`, `clicks`, `conversions`, `conversion_value`, `budget`, `effective_status` | Inngest cron-daily + cron-live | `/api/campaigns` |
| `ads_daily` | פר (date, store, platform, campaign, ad_set, ad): spend/impressions/etc | Inngest cron-live (Meta-only) | `/api/ads` |
| `products_daily` | פר (date, store, product): units/orders/revenue/refunds | Inngest cron-daily | `/api/products` |
| `orders_attribution` | פר order: `source` (meta-paid / google-paid / tiktok-paid / direct / etc), `utm_id`, `utm_campaign`, `fbclid`, `gclid`, `customer_id`/`order_created_at`/`is_first_order` (NC-ROAS), `first_*` (first-click), `payment_gateway` (שם-שער התשלום הגולמי — תשלומים) | Inngest cron-daily + cron-live | `/api/orders-attribution`, `/api/payment-methods` |
| `customer_cohort_monthly` | פר (store, first_order_month, month_since 0..11): `active_customers`, `orders`, `gross_cad`, `net_cad` — אגרגט cohort/LTV (Wave 2) | `cron-cohort-refresh` (weekly) + seed runner | `/api/cohorts` |
| `product_catalog` | מטא של מוצרי Shopify | Inngest cron-daily | `/api/product-catalog` |
| `manual_overrides` | שורות `manual-spend` ידני | `/operator` UI | קריאה: `/api/data` (merged into daily totals) |
| `dashboard_state` | UI prefs (annotations, goals, mappings) | `/api/dashboard-state` POST | `/api/dashboard-state` GET |
| `notification_config` | provider/template/phone numbers | seed + Supabase Studio | WhatsApp cron |

**מיגרציות**: `supabase/migrations/*.sql`. נדחפות ל-production עם `supabase db push --linked --include-all`.

**אבטחה (RLS)**: RLS **כבוי בכוונה** על כל 10 הטבלאות. מודל האמון = URL-obscurity יחיד-משתמש. `anon key` ב-Vercel היא ה-credential היחיד שמגיע ל-Supabase. ה-`anon` role יכול לבצע SELECT בלבד (לא DELETE/INSERT). DML מתבצע עם `SUPABASE_SERVICE_ROLE_KEY` server-side בלבד.

Supabase Security Advisor יראה 10 אזהרות `0013_rls_disabled_in_public` — תקין ומכוון. אל תפעיל RLS ללא policies — זה ישבור את `/api/health` ping (`SELECT count(*) FROM stores`) ויהפוך את ה-SyncIndicator לצהוב.

---

## 4. Inngest Functions

### 4.1 12 פונקציות הליבה (כולל OAuth canary של Phase 13.4 + cron-live-heavy של Phase 13.9)

| Function ID | תזמון | תוכן |
|---|---|---|
| `cron-daily-uzoshop` | `5 0 * * *` IL | Shopify + Meta + Google + TikTok + FX לכל ה-yesterday (fetch-shopify split ל-day/orders/catalog בparallel — Phase 13.4) |
| `cron-daily-zolplus` | `5 0 * * *` IL | אותו דבר ל-zolplus |
| `cron-daily-usmile360` | `5 0 * * *` IL | אותו דבר ל-usmile360 |
| `cron-live-uzoshop` | `*/10 * * * *` | rolling 3-day Shopify + Meta + Google + TikTok spend + orders_attribution של היום + refresh effective_status (כל השורות הקיימות per ad-set, ללא lookback — Phase 12.5 fix; bulk UPDATE per (platform, status) — incident fix 2026-05-25) |
| `cron-live-zolplus` | `*/10 * * * *` | אותו דבר |
| `cron-live-usmile360` | `*/10 * * * *` | אותו דבר |
| `cron-live-heavy-uzoshop` | `*/30 * * * *` IL | Phase 13.9 — Meta adset+ad insights + budgets, Google ad-group+ad insights, TikTok ad insights → `persistCampaignsLive()` UPSERT ל-`campaigns_daily` + `ads_daily` בטווח [היום, אתמול] |
| `cron-live-heavy-zolplus` | `*/30 * * * *` IL | אותו דבר ל-zolplus |
| `cron-live-heavy-usmile360` | `*/30 * * * *` IL | אותו דבר ל-usmile360 |
| `event-sync-now` | event-triggered (`event/sync-now`) | זהה ל-cron-live, ידני מ-`/operator` |
| `event-backfill` | event-triggered (`event/backfill`) | טווח תאריכים נבחר × חנויות נבחרות |
| `cron-oauth-canary` | `0 0 * * *` IL | פעם ביום 5 בדיקות פינג מקבילות לטוקנים של פלטפורמות מתחלפות: Google×uzoshop + Meta×3-stores + TikTok×uzoshop. כל בדיקה ב-step.run עצמאי עם try/catch; כשל בודד → `notifyTokenFailure` (throttled WhatsApp 1/6h) + `captureStepError` (Sentry) + ממשיך לסיבלינגים. הפונקציה לעולם לא זורקת — מסתיימת ב-`{ status: ok\|partial, passed, failed[] }`. הורחב מ-Google-בלבד ב-Phase 14 (Phase 13.4 origins). |
| `cron-cohort-refresh` | `TZ=Asia/Jerusalem 0 4 * * 1` (שני 04:00 IL) | **Wave 2 (2026-06-03).** re-aggregate שבועי מלא של `customer_cohort_monthly` פר חנות (Shopify Bulk → CAD → `aggregateCohortCells` → full-replace DELETE+INSERT). decomposed לפי-חנות (כל חנות סט-steps משלה) + poll דרך `step.sleep` כדי שאף invocation בודד לא יחרוג מ-`maxDuration=60s`; FX memoized per (currency, date). soft-fail פר-חנות + `captureStepError` ל-partial. ראה §4.4. |

**`cron-live-heavy-{store}`** (Phase 13.9 — 2026-05-27). Cron `TZ=Asia/Jerusalem */30 * * * *`. For each store × each date in [today, yesterday]: fetches Meta adset+ad insights + budgets, Google ad-group+ad insights, TikTok ad insights; calls `persistCampaignsLive()` to UPSERT `campaigns_daily` + `ads_daily`. Co-exists with cron-daily (01:00 nightly full run) and cron-live (10-min light spend + status). All three writers UPSERT the same PKs so `ON CONFLICT DO UPDATE` reconciles per-column; the latest write wins for the columns it touches. Rate-limit (429) and auth failures soft-fail per-platform → throttled WhatsApp alert via `notifyTokenFailure` → next tick retries.

Step structure per (store, date) (2026-05-28 fix — P1-7 / A7-F2):
- `fetch-{store}-{date}` — fetches all three platforms; result is memoized by Inngest across retries.
- `persist-{store}-{date}` — fires alerts then calls `persistCampaignsLive()` using the memoized fetch result; non-idempotent re-fetch is prevented.

FX-rate correctness (2026-05-28 fix — FX-date artifact / P0-3): each date's `getFx` closure calls `getFxRate(currency, 'CAD', date)` where `date` is the date being processed (today or yesterday), not the function invocation's `today`. This ensures yesterday's campaigns_daily row is FX-converted with yesterday's ILS→CAD rate, matching cron-daily's nightly authoritative write.

### 4.2 3 פונקציות WhatsApp (Phase 05.7.4)

| Function ID | תזמון | תוכן |
|---|---|---|
| `whatsapp-noon` | `0 12 * * *` IL | סנפשוט "היום עד 12:00" |
| `whatsapp-evening` | `0 18 * * *` IL | סנפשוט "היום עד 18:00" |
| `whatsapp-eod` | `10 0 * * *` IL | סיכום של אתמול ליום שלם |

### 4.3 מכסות וצריכה
- Inngest free tier: 50,000 executions/month.
- צריכה ממוצעת: ~28,000/month (56% מהמכסה). שלושת ה-cron-live × 6 calls/hr × 24 × 30 = 12,960 + cron-daily 3/day × 30 = 90 + WhatsApp 3/day × 30 = 90.

### 4.4 רישום הפונקציות
ב-`dashboard-web/src/app/api/inngest/route.ts`. כל פונקציה רשומה ב-`serve()` של inngest. רישום מתבצע אוטומטית ב-deploy של Vercel דרך marketplace integration; `INNGEST_EVENT_KEY` ו-`INNGEST_SIGNING_KEY` מוזרקים ל-Vercel env.

### 4.5 צפייה ב-runs
- Inngest Dashboard: `https://app.inngest.com`.
- בתוך הדשבורד: `/operator > ריצות אחרונות` → קורא `/api/operator/jobs` שמ-proxy ל-Inngest REST v1 (`/v1/events` + `/v1/events/{id}/runs`).

### 4.6 Sentry capture per פונקציה (Phase 13.2 + 13.2.2 + 13.2.3)
כל פונקציית Inngest עוטפת את ה-top-level שלה ב-`captureStepError({fnId, stepName:'top-level', storeId?}, err)` ואז `throw e` — שומרת על Inngest retry/dead-letter, ובמקביל מטעינה ל-Sentry לטריאז'.

| פונקציה | Phase שהוסיף Wrap | הערות |
|---|---|---|
| `cron-daily-*` × 3 | 13.2 | 5 capture-sites פנימיים + top-level |
| `cron-live-*` × 3 | 13.2 + 13.2.3 | top-level + per-platform Sentry capture (quietWhatsapp + fingerprint dedupe) |
| `cron-oauth-canary` | 13.4 | step-level capture סביב ה-canary fetch |
| `whatsapp-noon/evening/eod` | 13.2.2 | top-level wrap מעל `sendDailySummary` |
| `event-whatsapp-send-now` | 13.2.2 | top-level wrap עם trigger extra |
| `event-backfill` | 13.2.2 | top-level wrap (extracted to `runEventBackfill`); per-pair נשמרים ב-results[] + `console.warn` (לא ב-Sentry — systemic-failure threshold כבר מגן) |
| `event-sync-now` | 13.2.2 | top-level wrap עם date extra |

**Fingerprint dedupe (13.2.3):** `captureCronFetchError` ב-cron-live מקבל fingerprint יציב = `['inngest-fetcher', platform, storeId]`. כל 96 הריצות היומיות של (platform, store) שנכשלות → **issue אחד** ב-inbox של Sentry במקום 96. במקביל, `quietWhatsapp:true` מונע WhatsApp ספאם (auth-errors שומרים על ה-WhatsApp דרך הנתיב המקורי, עם 6h throttle).

### 4.7 step.run JSON-safety contract (Phase 13.4.1)
Inngest מ-serialize את ה-return של כל `step.run` callback דרך JSON. **אסור להחזיר `Map` או `Set`** — הם הופכים ל-`{}`/`[]` ב-deserialize, בלי שגיאת runtime. הצרכן רואה מבנה ריק, ו-TS casts יכולים להסתיר את אי-ההתאמה.

**כלל:** כל data שעובר step boundary חייב להיות JSON-roundtrippable (`Record` במקום `Map`, `array` במקום `Set`). הטסט החדש `cronDaily.test.ts > Test 10b` מקבע — מ-snoop על ה-return של fetch-meta ומאשר ש-`JSON.parse(JSON.stringify(x))` שווה ל-`x` ושאין `Map`/`Set` בעץ.

**תיקון 13.4.1:** ב-`cronDaily.ts:361` fallback של `fetch-meta` החזיר `{ campaigns: new Map(), adSets: new Map() }` בעת כשל Meta — TS cast הסתיר את ה-mismatch מול ה-type הראשי (`Record`). אחרי 13.4.1 ה-fallback מחזיר `{}` ו-`currency: 'ILS'` (matches `MetaBudgets`).

### 4.8 Constants source of truth (Phase 13.6)
`src/lib/platformsByStore.ts` הוא המקור היחיד לעובדות-חנות. מכיל את שני הווריאנטים שצרכנים שונים צריכים:
- **StoreName form** (`'uzoshop' | 'Zol Plus' | '360usmile'`) — לקומפוננטות, ערכי `storeName` מ-`DailyRow`. ייצוא: `STORE_NAMES`, `STORES_WITH_TIKTOK`, `storeHasTikTok()`.
- **StoreId form** (`'uzoshop' | 'zolplus' | 'usmile360'`) — ל-backend (Inngest crons, Shopify fetcher), ערכי `storeId` ב-Vercel envs. ייצוא: `type StoreId`, `STORE_ID_TO_NAME`, `STORES_WITH_TIKTOK_IDS`.

**חוק:** הוספת חנות רביעית = עריכה במקום אחד (`platformsByStore.ts`). לפני 13.6 היה צריך 4 מקומות (cronDaily, cronLive, shopify, platformsByStore) ושינוי באחד מהם בלי השאר → באג.

### 4.9 `cron-cohort-refresh` — weekly cohort/LTV re-aggregate (Wave 2, 2026-06-03)
`src/inngest/functions/cronCohortRefresh.ts`. Cron `TZ=Asia/Jerusalem 0 4 * * 1` (שני 04:00 IL, off-peak, DST-safe via `TZ=` prefix). re-aggregate **שבועי** מלא של `customer_cohort_monthly` — cohort/LTV הוא מדד אסטרטגי איטי-תנועה, שבועי טרי מספיק ונמנע מ-double-counting של עדכון-יומי-חלקי.

**Pipeline פר חנות** (אותם building blocks של `scripts/backfillCohortMonthly.ts` + `src/lib/fetchers/shopifyBulkCohort.ts` — DRY):
1. `startBulkCohortExport` → poll דרך `step.sleep` (`checkBulkCohortStatus`) → `downloadBulkCohortRows` — כל היסטוריית-ההזמנות במטבע מקור.
2. CAD-convert כל שורה (gross + refund); `net_cad = gross_cad − refund_cad`. אם **אחד** מהשניים נכשל ב-FX → השורה **מושמטת** ("stale > wrong" — מספר CAD שגוי היה משחית את התא כולו). FX **memoized** per (currency, date).
3. טעינת `firstOrderMonthByCustomer` מ-`customer_first_order` (הלדג'ר של Plan B.1).
4. `aggregateCohortCells` → תאי cohort עם ספירת-לקוחות-distinct.
5. **full replace:** DELETE שורות החנות → INSERT התאים הטריים (batched 1000).

**60s `maxDuration` budget:** ה-Inngest route מוגבל ל-60s לכל invocation, וכל `step.run` הוא invocation בודד. לכן העבודה מפורקת כך שאף invocation בודד לא יחרוג: כל **חנות** סט-steps משלה (תקציב-60s משלה, memoized על retry), ה-Bulk export מ-polled דרך `step.sleep` ברמת-הפונקציה (כל poll הוא בדיקת-status זעירה, ה-המתנה היא durable Inngest sleep — אפס runtime cost), ו-FX memoized per (currency, date) (היסטוריה מלאה ≈ #distinct-dates fetches במקום 2-per-order). **soft-fail פר-חנות:** כשל Bulk של חנות אחת לא מפיל את האחרות (try/catch פר-חנות → `failures[]` → `captureStepError` ל-partial, בלי להכשיל את כל הריצה).

**CAPI-safe:** read-only מול Shopify; אפס כתיבה לפלטפורמות-מודעות / pixels / CAPI; רק `customer.id` האטום (ללא PII). הליבה הטהורה `runCohortRefreshOnce` (ללא steps) נשמרת לנתיב ה-backfill + unit tests; `runCohortRefreshStepped` הוא ה-orchestrator הפרודקשני המפורק-ל-steps (שניהם unit-tested עם deps מוזרקים).

---

## 5. Data Source APIs

### 5.1 Shopify
- **API**: Admin REST `2026-04`.
- **Auth**: per-store access token ב-Vercel env (`UZOSHOP_SHOPIFY_ACCESS_TOKEN`, etc.).
- **Endpoints משמשים**: `/admin/api/2026-04/orders.json`, `/admin/api/2026-04/products.json`, `/admin/api/2026-04/refunds.json`.
- **חוזה החזרים**: מנכים `refund_line_items[].subtotal` (סחורה במטבע הזמנה, קבוע). ביום `refund.processed_at` לא ביום ההזמנה המקורית. הוכח אמפירית על 3/3 חנויות ב-`.planning/phases/05.2.3.0-shopify-revenue-refunds-bug-fix/05.2.3.0-PROBE-EVIDENCE.md`.
- **מטבע**: ההזמנה במטבע מקור (ILS / USD / CAD); המרה ל-CAD לפי שער FX של אותו יום.
- **Window B תיקון (Phase 05.7.3)**: `updated_at ∈ [D, today+1)` במקום `[D, D+1)` — תופס החזרים שעדכון עוקב דחף את ה-`updated_at` שלהם מעבר ליום העיבוד.

### 5.2 Meta Marketing
- **API**: `v25.0` (היה v23; כל v<v24 נסגר 2026-06-09).
- **קבצים**: `dashboard-web/src/lib/fetchers/meta.ts`, `dashboard-web/src/lib/whatsapp.ts`.
- **Endpoints**: `/act_{id}/campaigns?fields=id,name,daily_budget,effective_status,...`, `/act_{id}/adsets?fields=...`, `/{adAccount}/insights?level=ad...`.
- **Auth**: per-store access token (`UZOSHOP_META_ACCESS_TOKEN`, etc.). Meta tokens פגים כל 60 יום — לרענן ב-Meta Business Manager.
- **effective_status**: נשמר ב-`campaigns_daily.effective_status` (migration `20260522180000_add_campaigns_daily_effective_status.sql`).
- **Budgets**: ב-agorot (ILS minor unit); המרה ל-ILS אז ל-CAD לפי FX היומי.

### 5.3 Google Ads
- **API**: `v24` (יורד מהאוויר רק מאי 2027).
- **קבצים**: `dashboard-web/src/lib/fetchers/googleAds.ts`.
- **Auth**: OAuth refresh-token + developer-token. ENV: `GOOGLEADS_DEVELOPER_TOKEN`, `GOOGLEADS_CLIENT_ID`, `GOOGLEADS_CLIENT_SECRET`, `GOOGLEADS_LOGIN_CUSTOMER_ID`, `GOOGLEADS_REFRESH_TOKEN` (all global), plus `<STORE>_GOOGLEADS_CUSTOMER_ID` per store. **Active stores:** only `uzoshop` has Google Ads today (per `docs/PROPS-MAP.md` §3 + §4). usmile360 + zolplus have no Google account → the Phase C worker treats them as "not configured" and records a `success` no-op freshness row instead of attempting a fetch (see §[Phase C soak fixes](#phase-c-soak-fixes-2026-05-30)).
- **GAQL**: `SELECT campaign.id, campaign.name, campaign.status, metrics.cost_micros, ... FROM campaign ...` ו-`SELECT ad_group.id, ad_group.status, ... FROM ad_group ...`.
- **status fields**: `campaign.status` (`ENABLED` / `PAUSED` / `REMOVED`), `ad_group.status` (same).
- **Conversions**: לוקחים `conversions` + `conversions_value` ישירות מ-`metrics`.
- **`change_status` GAQL bounded-range requirement (CRIT-F-2, 2026-05-30):** the `change_status` resource requires BOTH a lower AND an upper bound on `last_change_date_time` — single-sided `>` is rejected with `CHANGE_DATE_RANGE_INFINITE`. `fetchGoogleStatusForStore` builds the upper bound from `formatGaqlDateTime(new Date())` so the bounded window matches the cutoff exactly.

### 5.4 TikTok Marketing
- **API**: `v1.3`.
- **קובץ**: `dashboard-web/src/lib/fetchers/tiktok.ts`.
- **Auth**: long-lived access token + advertiser_id. ENV: `UZOSHOP_TIKTOK_ACCESS_TOKEN`, `UZOSHOP_TIKTOK_ADVERTISER_ID` (**TikTok-on-Vercel הוא חשבון יחיד**).
- **Shared-account multi-tenant model (operator-confirmed 2026-05-30):** there is ONE TikTok ad account (uzoshop's). It contains multiple Shopify pixels — one per destination store. When the operator uploads an ad in TikTok they pick the pixel matching the relevant store. The single advertiser therefore serves **all 3 stores** simultaneously, and per-row store attribution is recovered post-fetch via the Phase A.5 v2 `campaign-store-map` (operator-tagged in `CampaignDrawer`; see §25.11). Workers for usmile360 + zolplus **never have their own TikTok env vars** — their dedicated `tiktok-worker` invocations are intentionally no-ops; the rows under their `store_id` are written by uzoshop's worker via the map. See §[Phase C soak fixes](#phase-c-soak-fixes-2026-05-30) for the `isTikTokConfiguredForStore` gate that prevents these no-op invocations from throwing.
- **Endpoints**:
  - `/open_api/v1.3/report/integrated/get/` עם `data_level=AUCTION_AD` ל-spend/impressions/clicks/conversions/value.
  - `/open_api/v1.3/adgroup/get/` ל-`secondary_status` (effective_status).
- **Metrics mapping**: `m.complete_payment` → conversions count, `m.value_per_complete_payment` × conversions → conversionValue. **חשוב**: `m.conversion` לא תואם ל-`value_per_complete_payment` (תוקן 2026-05-22 — לפני זה היה mismatch).
- **Active states**: רק `ADGROUP_STATUS_DELIVERY_OK` נחשב active. כל סטטוס אחר (`DISABLE`, `BUDGET_EXCEED`, `TIMEDOUT`, `FROZEN`, `ARCHIVED`, `DELETE`, `AUDIT`) → off.
- **רוטציית טוקן**: דרך TikTok Developers Portal → Apps → ROAS Tracker → Authorization URL → `auth_code` → POST `/v1.3/oauth2/access_token/` (ראה §11.2).

### 5.5 FX (Foreign Exchange)
- **Provider**: Frankfurter API (`https://api.frankfurter.app/{date}?from=ILS&to=CAD`).
- **תזמון**: cron-daily ב-00:05 IL.
- **שורה ב-`data_daily`** — שערים שמשמשים גם להמרת spend וגם להמרת revenue ל-CAD canonical.

---

## 6. Effective Status Pipeline (Phase 05.7.x)

### 6.1 Motivation
עד 2026-05-22 ה-chip "כבוי כרגע" בטבלת הקמפיינים הסתמך על heuristic של "2+ ימים בלי spend". זה גרם ל-2-day lag. החלפנו ב-`effective_status` אמיתי מהפלטפורמה.

### 6.2 Flow
1. **Fetcher** (Meta/Google/TikTok) מבקש את ה-status field בכל קריאה.
2. **Writer** (Inngest cron-daily / cron-live) שומר ב-`campaigns_daily.effective_status` (TEXT, nullable).
3. **Reader** (`/api/campaigns`) מחזיר את הערך לכל שורת קמפיין.
4. **UI** (`CampaignsTableRow.isCampaignOff`) ממפה לפי פלטפורמה:
   - Meta: `'ACTIVE'` → on, אחרת off.
   - Google: `'ENABLED'` → on, אחרת off.
   - TikTok: `'ADGROUP_STATUS_DELIVERY_OK'` → on, אחרת off.
5. **Fallback**: כשעדיין null (שורה לפני המיגרציה, או fetcher soft-fail) — חזרה ל-heuristic של "2+ ימים בלי spend".

### 6.2b Reader filter (Phase 05.7.x — 2026-05-23)
`postgresReaders.fetchCampaigns` keeps a row if EITHER:
- It has activity (`spend > 0 OR impressions > 0 OR conversions > 0`), OR
- Its `effective_status` is "currently active" for its platform (`Meta='ACTIVE'`, `Google='ENABLED'`, `TikTok='ADGROUP_STATUS_DELIVERY_OK'`).

Drops everything else. This is the operator spec: show campaigns with activity in the range, OR campaigns currently active (so brand-new ones appear within 10 min), but NOT paused-no-activity ad-sets that would be visual noise.

### 6.2c Active-only placeholder enrollment
cron-live's `refresh-effective-status` step UPSERTs a placeholder row for TODAY for each enumerated ad-set whose status is "active" for its platform. Paused/archived ad-sets are skipped at INSERT but their existing past-day rows still get effective_status UPDATEs (so an ad-set paused this morning lights up the off-chip on yesterday's row).

### 6.3 Freshness
- cron-daily רץ ב-00:05 IL — כותב את ה-status כחלק מהשורה היומית המלאה (יחד עם spend / impressions / etc).
- **cron-live רץ כל 10 דקות** וגם הוא מרענן `effective_status` בלבד (Phase 05.7.x). הצעד `refresh-effective-status`:
  1. שולף במקביל את ה-statuses מ-Meta (`fetchMetaBudgets`), Google (`fetchGoogleAdsAdGroupStatuses`), ו-TikTok (`fetchTikTokAdGroupStatuses`) — כל אחד עם timeout 15s ו-soft-fail.
  2. עבור כל פלטפורמה, מריץ `UPDATE campaigns_daily SET effective_status = ?` לפי `(store_id, platform, ad_set_id)` על **כל השורות הקיימות** עם `date < today` (Phase 12.5 — היה lookback של 7 ימים, ראה למטה).
  3. UPDATE (לא UPSERT) — לא יוצרים שורות phantom עם spend=0 על קמפיינים שכבר לא רצים.
- "רענן הכל" בכותרת טאב הקמפיינים מטריגר `event-sync-now` שמריץ את אותה לוגיקה של cron-live → effective_status מתעדכן מיד.

**Aggregator behaviour** (`campaignsAggregator.ts`): כשהדשבורד מציג קמפיין על פני טווח תאריכים, הוא בוחר את ה-`effective_status` של ה-**שורה הכי חדשה** (max date) שיש בה לקמפיין הזה.

### 6.3a Off-chip drift fix (Phase 12.5 — 2026-05-24)
ה-UPDATE היה מוגבל ל-7 ימים אחורה (`lookbackDays = 7`). זה גרם לבאג: קמפיין שהושהה לפני יותר משבוע שמר את הסטטוס הישן (ACTIVE) בשורות מחוץ ל-lookback, ולכן בטווחי תצוגה ארוכים (last-month / last-90-days) ה-aggregator בחר ACTIVE והצ'יפ "כבוי" נעלם בשתיקה.

**הפתרון**: הסרת ה-`.gte('date', lookbackFrom)` — כעת ה-UPDATE מכסה כל שורה קיימת לכל ad-set שמופיע ב-enumeration של הפלטפורמה. `effective_status` מעולם לא נועד להיות רשומה היסטורית "per-day"; הוא תמיד נחשב snapshot "current-as-of-last-refresh" על כל שורה. עומס: ~30 ad-sets × 3 חנויות × ~90 שורות לכל אחד × 96 ריצות/יום ≈ 770K row touches/day — סביר ל-Postgres עם אינדקס על `(store_id, platform, ad_set_id)`. ראה `cronLive.ts:1019-1024` ו-`cronLivePastRowBackfill.test.ts` לעדכון הטסטים.

### 6.3b Defensive current-status fallback (Phase 12.5.x — 2026-05-24)
ה-cron-live UPDATE pass (6.3a) מסונכרן רק כל 10 דקות, ועלול לכשול חלקית (TikTok credit error, partial enumeration, וכו'). כדי שהצ'יפ "כבוי" יהיה עמיד בפני עיכובי cron, התווסף נתיב defensive נוסף:

- **`postgresReaders.ts:fetchCurrentCampaignStatuses`** — שאילתה אחת על `campaigns_daily` ב-60 הימים האחרונים, מסוננת ל-`effective_status IS NOT NULL`, ordered by date DESC. dedup ב-JS לפי key (`storeId::Platform::campaignId::adSetId`) → המופע הראשון שורה הכי חדשה.
- **`/api/campaigns` response** — שדה חדש `currentEffectiveStatus: Record<string, string>` שמועבר ל-client. soft-fail (empty map) ב-error path.
- **`campaignsAggregator.aggregate`** — פרמטר חדש `currentEffectiveStatus?`. post-pass שעוטף את ה-`effectiveStatus` של כל aggregate עם הסטטוס מה-map הזה. ב-mode='campaign' רולאפ של ad-sets לפי הכלל "any active → active; else first off" (מתאים ל-roll-up של Meta/Google/TikTok בעצמן).
- **תוצאה**: גם אם ה-cron-live UPDATE pass נכשל ל-TikTok, הצ'יפ "כבוי" עדיין עובד כל עוד קיימת שורה בטבלה ב-60 הימים האחרונים עם הסטטוס הנוכחי (כל cron-live tick שהצליח עבור הקמפיין הזה).

עומס: שאילתה אחת לכל GET של `/api/campaigns`, ~30K שורות ב-60 ימים × revalidate=60s = השאילתה נתפסת ב-ISR cache. אינדקס קיים על `(store_id, platform, campaign_id, ad_set_id)`.

### 6.3c URL state — drill-down + mode + sort persistence (Phase 12.5.x — 2026-05-24)
ה-URL state הפנימי של טאב הקמפיינים הורחב לכלול:
- `c_mode` — `campaign` / `adset` (default `campaign` מושמט).
- `c_sort`, `c_sortDir` — מיון העמודות (default `roas` / `desc` מושמטים).
- `c_drill=storeId::Platform::campaignId` — CampaignDrawer פתוח על קמפיין מסוים.
- `c_adDrill=storeId::Platform::campaignId::adSetId` — AdsDrawer פתוח על ad-set. ה-`adSetName` לא נכנס ל-URL — נפתר מ-`data.rows` ב-effect לאחר שה-SWR טוען (drawer header מציג ID לרגע ההמתנה).

**תיקון חוצה**: `writeDashboardState` (`urlState.ts`) בנה בעבר `URLSearchParams` ריק מאפס בכל קריאה, ומחק ב-side-effect את ה-`c_*`/`p_*` שה-children writers (CampaignsTable / ProductsTable) שמרו. סדר ה-effects ב-React (ילדים קודם הורים) גרם לכך שה-write של הילד תמיד נדרס ע"י הקריאה של ההורה — וברענון, הפרמטרים הפנימיים של הטאב חזרו לדיפולט. עכשיו `writeDashboardState` מקבל את ה-`existingSearch` הנוכחי ומוחק רק את ה-`GLOBAL_PARAMS` (`tab`, `preset`, `from`, `to`, `store`), משאיר כל היתר נגיע.

### 6.4 PnL — percent-of-revenue expenses (Phase 12.5.x — 2026-05-24)

עד 12.5.x כל הוצאה חודשית הוגדרה כסכום CAD קבוע (`monthlyCAD`). עכשיו `RecurringCost` קיבל שדה optional חדש `percentOfRevenue?: number` (0–100). כששדה זה מאוכלס וחיובי, השורה נחשבת "% מהמחזור" ו-`monthlyCAD` מתעלמים ממנו.

**שינויים ב-`billing.ts:billingForRange`**:
- 2 פרמטרים אופציונליים חדשים: `revenue?: number`, `revenueByStore?: Record<string, number>`.
- בלולאה על recurring rows: אם `percentOfRevenue > 0` → `amount = revenue × percentOfRevenue / 100` (ללא day-proration; המחזור כבר אגרגציה תקופתית). אחרת → fallback ל-formula הקיימת.
- per-store split: שורה ספציפית-לחנות חישבת מול ה-`revenueByStore[store]` (fallback: split שווה של `revenue` בין החנויות). שורת "All" חישבת מול `revenue` הכולל, ואז מתחלקת שווה בשווה כמו לפני.

**call sites**:
- `analytics.ts:aggregate` מעביר את ה-`revenue` המחושב במקום.
- `PnLBreakdown.tsx` מעביר את `current.revenue` כדי שהפירוט בסעיף 5.4a יתאזן עם ה-`fixedCosts` שב-`Aggregate`.
- `aggregateByStore` לא מעביר `revenueByStore` במפורש — `aggregate` בכל bucket מקבל רק את הכנסות החנות הזו ב-`revenue`. שורות "% מהמחזור" ב-scope של חנות ספציפית מקבלות נכון; ב-scope של "All" החלוקה השווה (fallback) מתפקדת.

**UI** (`BillingSettings.tsx:RecurringEditForm`):
- 2 כפתורים: "סכום קבוע (CAD)" / "% מהמחזור". בוחר את ה-`kind` של הטופס.
- שדה הקלט משתנה בהתאם (% input מציין range 0-100 ב-validation; CAD input ללא תקרה).
- list view: אם `percentOfRevenue > 0`, מוצג "X%" + "מהמחזור"; אחרת CAD + "/חודש".

**`useBillingRecurring.totalMonthly`**: מסנן החוצה שורות % כי הסכום שלהן תלוי בהכנסה. הסכומון בכפתור "עלויות חודשיות (...)" משקף את ה-CAD הקבוע בלבד; שורות % נכנסות בכל זאת ל-`X פעילות` (הן מנויים אמיתיים).

---

## 7. Campaign Health Score (Phase 05.7.x)

### 7.1 קובץ
`dashboard-web/src/lib/campaignHealthScore.ts` — pure function `computeCampaignHealth(input) → { score: 0-100, grade: 'A'|'B'|'C'|'D'|'F'|'unknown', components: {...} }`.

### 7.2 Insufficient gate
החזרה `unknown` אם:
- spend < $30, או
- spend < $100 AND conversions === 0.

זה כדי לא להחליט "F → לעצור" על קמפיין שעדיין בתהליך learning.

### 7.3 ארבעת הרכיבים

| רכיב | משקל | חישוב |
|---|---|---|
| **profitability** | 40% | ROAS × trust modulation. עדיפות source: Shopify-deterministic → Shopify-combined → platform (×0.5 penalty כש-undocumented). ROAS 1.0 → 0 נקודות, 2.0 → 50, 3.0+ → 100 (capped). |
| **volume** | 15% | סולם הוצאה: ≥$500: 100; $200-$500: 70; $50-$200: 40; <$50: 10. |
| **trajectory** | 25% | תוצאת `analyzeCpmVsRoas` על סדרת CPM/ROAS היומית: positive→100, neutral→60, warning→40, negative→0. בלי 5+ ימים → 60 (neutral). |
| **attributionClarity** | 20% | `trust.score` (0-100) של click-id coverage. Google ללא attribution → 50 (neutral). |

### 7.4 Operator adjustment
~~`+15` אם מסומן optimized; `−30` אם `effective_status` = כבוי.~~ **הוסר ב-Phase 14** — ראה §7.8.

### 7.5 ציון סופי + grade
`score = Σ(component × weight)` clamped ל-[0,100].
- A ≥ 75
- B ≥ 60
- C ≥ 45
- D ≥ 30
- F < 30

### 7.6 Tests
39 vitest tests ב-`dashboard-web/src/lib/__tests__/campaignHealthScore.test.ts`. מכסים: shape, insufficient gate, source-of-truth priority, trust modulation, volume tiers, trajectory mapping, attribution clarity, operator adjustments, realistic scenarios.

### Score purity — Phase 14 (2026-05-28)

`computeCampaignHealth` is a pure function of campaign data. Two flags that
previously biased the score were removed:
- `optimized=true` previously added +15 — REMOVED.
- `isCurrentlyOff=true` previously subtracted 30 — REMOVED.

Both flags survive as visual annotations on each `CampaignsTable` row (the
"סמן כאופטימיזציה" checkbox + cloud-sync via `roas-campaign-optimized-changed`
event, and the off-chip from `isCampaignOff(...)`). They no longer feed into
`HealthScoreInputs` or `HealthScoreComponents`; ticking the operator mark is
now a passive annotation that does not move the score number.

The cohort adjustment (`applyCohortAdjustmentOnce`) is data-derived
(rank, cannibalization risk) and continues to apply downstream of
`computeCampaignHealth` exactly as before.

### 7.7 צריכה ב-UI
- `CampaignsTableRow` (עמודה "ציון") — באמצעות `HealthScoreBadge` (popover drilldown).
- `CampaignDrawer` ראש המגירה — `HealthScorePanel` (inline expanded).
- AI Report — מקטע "Campaign Health Score" עם טבלת top 25.

---

## 8. CPM in WhatsApp (Phase 05.7.x)

### 8.1 Formula
**Blended CPM** = Σ spend ÷ Σ impressions × 1000 (לא ממוצע פשוט של per-store CPM-ים — זה היה over-weight לחנויות עם חשיפות מעטות).

### 8.2 Implementation
- `dashboard-web/src/lib/notifications/summary.ts:buildStoreSummary`:
  - Join `campaigns_daily` ל-`data_daily` לסכימת impressions per store.
  - שדה חדש: `impressions: number`, `cpm: number` על `StoreSummary` ועל `DaySummary.totals`.
- `dashboard-web/src/lib/notifications/templateParams.ts:formatCpm`:
  - 2 decimals (`C$X.XX`).
  - `'—'` כש-impressions === 0 (לא `C$0`).
- בלוק הודעה: `🏪 storeName: • הוצאה: $X • הכנסות: $Y • ROAS: Z • CPM: $W • הזמנות: N (...)` — נוסף בין ROAS למספר הזמנות.

### 8.3 Meta template
ה-template המאושר `roas_daily_summary` לא משתנה — אותם 5 placeholders ({{1}}-{{5}}). רק התוכן בתוך כל placeholder מתרחב, ולא נדרש re-approval ב-Meta WhatsApp Manager.

### 8.4 Param constraints (Meta)
**אסור** newlines / tabs / 5+ consecutive spaces בתוך פרמטר — Meta מדחה עם error 132018. Bullet separator הוא ` • ` (space-bullet-space) inline בלבד. ה-template עצמו (ב-Meta Manager) מחזיק את ה-blank lines בין הפרמטרים.

---

## 9. WhatsApp Cloud Pipeline (Phase 05.7.4)

### 9.1 הצינור
```
Inngest cron (12:00 / 18:00 / 00:10 IL)
   ↓
sendDailySummary(dateStr, title)   ← dashboard-web/src/lib/notifications/sendDailySummary.ts
   ├─ loadActiveMetacloudConfig()  ← notification_config (active=TRUE)
   ├─ buildStoreSummary(dateStr)   ← data_daily + orders_attribution + campaigns_daily (Postgres)
   ├─ buildTemplateParameters()    ← 5-element string[]
   ↓
sendWhatsAppTemplate({to, templateName, templateLang, templateParams})
   ↓
POST https://graph.facebook.com/v25.0/{WHATSAPP_PHONE_NUMBER_ID}/messages
     Authorization: Bearer {WHATSAPP_ACCESS_TOKEN}
```

### 9.2 Env vars (Vercel)
| שם | ערך | הערה |
|---|---|---|
| `WHATSAPP_PHONE_NUMBER_ID` | `1091010644104167` | קבוע מ-Meta API Setup |
| `WHATSAPP_ACCESS_TOKEN` | `EAA...` | חייב להיות System User permanent token |

### 9.3 DB config (`notification_config` table)
| שדה | ערך נוכחי |
|---|---|
| `provider` | `metacloud` |
| `active` | `TRUE` |
| `template_name` | `roas_daily_summary` |
| `template_lang` | `he` |
| `phone1` | `+972524809540` |
| `phone2` | `+972546100067` |

### 9.4 Permanent System User Token (פעם אחת)
טוקנים רגילים פגים תוך 24 שעות. ליצור permanent:
1. `business.facebook.com/settings/system-users` → Add System User `RoasTrackerSystem`, Admin role.
2. Add Assets → Apps → `ROAS Tracker Notifications` → Full control.
3. Generate New Token → Expiration: Never, Permissions: `whatsapp_business_messaging` + `whatsapp_business_management`.
4. עדכן ב-Vercel env vars → Redeploy.

### 9.5 ביטול זמני (בלי קוד)
```sql
UPDATE notification_config SET active = FALSE WHERE provider = 'metacloud';
```
ה-cron יקבל null מ-`loadActiveMetacloudConfig` וידלג בשקט.

### 9.6 שגיאות נפוצות
| שגיאה | סיבה | תיקון |
|---|---|---|
| `missing env vars WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID` | env vars לא מוגדרים | הוסף ב-Vercel + redeploy |
| `Meta Cloud HTTP 401: invalid OAuth access token` | טוקן פג / temp expired | צור permanent System User token |
| `Meta Cloud HTTP 400: Parameter count mismatch (132012)` | מספר ה-`{{N}}` לא תואם | ראה `templateParams.ts` |
| `Meta Cloud HTTP 400: Template name does not exist (132001)` | שם ה-template ב-DB לא תואם ל-Meta | `UPDATE notification_config SET template_name = ...` |
| `Meta Cloud HTTP 400: Param newline/tab/5+ spaces (132018)` | פורמט פרמטר לא תקין | ראה §8.4 |

---

## 9.5 Token Failure Alerts (Phase 05.7.x — 2026-05-23, fully wired 2026-05-24)

Detect + persist + alert on upstream auth/API failures across all
providers. Now fully end-to-end:
- ✅ **Shipped 2026-05-23**: persistence + throttle + notifier function + /operator UI.
- ✅ **Shipped 2026-05-24 (Phase 12.5.x)**: WhatsApp template approved by Meta + fetcher wiring in `cronDaily.ts` + `cronLive.ts`. Operator alerts now reach `+972524809540` within ~10 min of a token going dead.

### 9.5.1 Schema
- Migration `supabase/migrations/20260523080000_add_token_failures.sql`.
- Table `token_failures(provider, store_id, operation, ...)` — composite PK on those 3.
- Providers: `meta` / `google` / `tiktok` / `whatsapp` / `shopify` / `fx`.
- Stores: `uzoshop` / `zolplus` / `usmile360` / `global` (last for cross-store failures like WhatsApp Cloud or OXR).

### 9.5.2 Notifier
- `dashboard-web/src/lib/notifications/tokenFailures.ts` → `notifyTokenFailure({provider, storeId, operation, errorMsg, advice?})`.
- **DQ-2 (2026-06-04) — FX-failure alert:** `dashboard-web/src/lib/notifications/fxFailure.ts` → `notifyFxFailure({currency, dateStr, errorMsg})` wraps `notifyTokenFailure` as `provider='fx'`, `storeId='global'`, `operation='fx_rate_failure'`. The Meta + TikTok CAD adapters (`getFxCadAdapterForStore` / `getTikTokFxCadAdapterForStore`) previously swallowed a Frankfurter outage with a silent `return 0` (→ understated CAD spend/ROAS/net, no signal); they now fire this alert on BOTH the throw path and the invalid-rate (`rate<=0`) path before returning 0. Inherits the (provider,store,operation) 6h throttle → one page per outage window, not per-conversion. Never throws.
- Soft-fail (never throws — caller's original exception keeps propagating).
- 6h throttle per (provider, storeId, operation) — bumps `seen_count` every call, sends WhatsApp only when `last_alert_sent_at` is null or > 6h old.
- Sends to single hard-coded recipient: `+972524809540` (operator's explicit instruction). Distinct from the daily-summary phone1/phone2 in `notification_config`.

### 9.5.3 WhatsApp template (`token_failure_alert`)
- Language `en` (4 params).
- Body (submit via Meta WhatsApp Manager → Utility category):
```
🚨 Token failure · ROAS Tracker

{{1}}

❌ Error:
{{2}}

💡 Fix:
{{3}}

{{4}}

Open /operator for details: https://roas-dashboard-smoky.vercel.app/operator
```
- Params:
  - `{{1}}` = `${PROVIDER} · ${storeId} · ${operation} @ DD/MM HH:mm`
  - `{{2}}` = sanitized error message (≤500 chars)
  - `{{3}}` = advice or `—`
  - `{{4}}` = `Seen N times. Alert #M.`

### 9.5.4 Operator console
- `/operator > בעיות טוקן` (top section, above ריצות אחרונות).
- `dashboard-web/src/components/operator/TokenFailuresTable.tsx` + endpoint `dashboard-web/src/app/api/operator/token-failures/route.ts`.
- GET returns unresolved + 7-day-resolved rows. POST `{action:'resolve'}` clears `last_alert_sent_at` so the next failure restarts the alert cycle.

### 9.5.5 Pending fetcher wiring (gated on Meta approval)
- `dashboard-web/src/lib/fetchers/googleAds.ts:getAccessToken` — detect `invalid_grant` → `notifyTokenFailure({provider:'google', operation:'oauth_refresh'})`.
- `dashboard-web/src/lib/fetchers/meta.ts` — detect 401 + subcodes 102/190 → `{provider:'meta', operation:'access_token'}`.
- `dashboard-web/src/lib/fetchers/tiktok.ts:tiktokGet` — detect codes 40104/40105 → `{provider:'tiktok', operation:'access_token'}`.
- `dashboard-web/src/lib/notifications/whatsapp.ts:sendWhatsAppTemplate` — detect 401 with `OAuth access token` body → `{provider:'whatsapp', storeId:'global', operation:'send_template'}`. CAUTION: if WhatsApp itself is dead, alert can't deliver via WhatsApp — DB row is the only signal until a future email-fallback iteration.

---

## 10. AI Report (Phase 05.7.x — v3)

### 10.1 קובץ
`dashboard-web/src/lib/aiReport.ts` — pure function `generateAiReport({storeName, range, dailyRows, productRows, campaignRows, ordersRows}) → markdown string`.

### 10.2 קומפוננטה
`dashboard-web/src/components/AiReportButton.tsx` — modal עם כפתורי "צור דוח" / "העתק" / "הורד .md".

### 10.3 Data sources (5 APIs)
- `/api/data` — daily revenue/spend/ROAS per store.
- `/api/products` — top products with margin.
- `/api/campaigns` — campaigns כולל `effective_status`.
- `/api/orders-attribution` — order-level עם source/utm/click-id (range-keyed via `buildDateRangeKey`).
- `/api/ads` — ad-level rows (`ads_daily`) ל-creative drill-down + winners/losers (range-keyed, Phase 05.7.x).

### 10.4 מקטעי הדוח (v3)

**בסיסי:**
- 📌 attribution disclaimer
- KPIs summary
- Funnel (impressions → orders)
- CPM/CTR per channel
- Daily breakdown
- Per-store breakdown
- Top 25 products
- Top 25 campaigns
- Drainers (low ROAS, high spend)
- Ad-sets for top-5-spend campaigns
- Day-of-week breakdown
- Half-1 vs Half-2 comparison
- Platform budget split
- High-margin products

**Analyst-grade (v2):**
- Traffic source breakdown (orders + AOV + % per source)
- Campaign momentum (h1 vs h2 ROAS per campaign, ≥$100 spend)
- CPM volatility (CV stddev/mean per platform)
- Anomaly days (robust z-score: median + MAD)
- Period-level Pixel ↔ Shopify gap

**Throughline integration (v3):**
- Campaign Health Score per top campaign (4 components + status)
- Per-campaign Pixel ↔ Shopify deterministic comparison (match by `utm_id`/`utm_campaign`)
- Currently-off campaigns (real `effective_status`)
- TikTok deep-dive (only when `ttSpend > 0`)

**Creative-level (v4 — 2026-05-22):**
- Per-campaign creative drill-down for top-5-spend campaigns (top 8 ads each, with CTR/CPA/ROAS)
- 🏆 Creative winners — cross-campaign top-5 by ROAS (≥$25 spend + ≥2 conversions + ROAS ≥ 2.0)
- 💸 Creative drainers — cross-campaign top-5 by waste (≥$25 spend + ROAS < 1.5, or 0 conv with ≥$100 spend)

### 10.5 Prompt
פרסונה של **Senior E-commerce Performance Strategist** ברמה של Common Thread Collective / Tier 11 / Disruptive Advertising. 8 numbered sections. Anti-platitudes: כל המלצה חייבת לכלול שם קמפיין / מוצר ומספר מהדוח.

---

## 11. Operator Console (`/operator`) — Phase 05.6

### 11.1 רכיבים
| Sub-screen | Endpoint | תפקיד |
|---|---|---|
| סנכרון עכשיו | POST `/api/operator/sync-now` `{scope}` | Inngest `event/sync-now` |
| ריצות אחרונות | GET `/api/operator/jobs` (poll 15s) | Inngest REST v1 proxy |
| Backfill טווח | POST `/api/operator/backfill` `{from,to,storeIds}` | Inngest `event/backfill` |
| manual_overrides CRUD | `/api/operator/manual-overrides` GET/POST/DELETE | ישיר ל-Supabase admin client |

> **`manual_overrides` — TikTok נתמך (Plan A, 2026-06-02):** ה-CHECK constraint על `platform` כבר התיר `tiktok` (migration `20260522102151`), אך ה-**validator בצד הלקוח** (`operatorManualOverrides.ts` `VALID_PLATFORMS`) חסם אותו ל-`meta`/`google` בלבד — שאריות מהמגבלה הישנה (A8-F4). Plan A פתח את TikTok מקצה-לקצה: validator + UI (`ManualOverridesCrud`) + מיזוג **מודע-מיפוי** ב-`mergeOverridesFromSupabase` ו-החלה ב-`cronDaily`/`cronLive` — override ל-TikTok לחנות X חל על ה-`tt_spend_cad` של אותה חנות (דרך מיפוי הקמפיינים), לא על החשבון המשותף הגולמי. fallback ללא-override: CAD-passthrough בלבד (שורד נפילת FX).
>
> **Plan A — framing + guards (2026-06-02):** נוסף guard ב-vitest שמוודא ש-`cronDaily` ו-`cronLive` כותבים את **אותו key-set** ל-`orders_attribution` (מונע dual-write drift), ו-guard נוסף שמוודא שה-SELECT string ב-`postgresReaders` כולל כל עמודה נצרכת (מונע persisted-but-invisible). שכבת ה-UI: ROAS המעורב תויג **MER**, ROAS פר-פלטפורמה הורד ל"מכוון בלבד" (directional), נוסף צ'יפ **כיסוי ייחוס** (hero בלבד, שקט), ו-`fetchJsonOrNull` איחד 4 fetchers כפולים. הכל read-only מול פלטפורמות המודעות.
>
> **Phase 0 — correctness fixes (2026-06-02, post-Plan-A):** (1) **צ'יפ כיסוי-הייחוס היה תקוע על 100%.** `hasAttributionSignal` (`lib/home/adapters.ts`) ספר `source.trim() !== ''` כסימן ייחוס — אבל ה-writer (`lib/fetchers/shopify.ts`) **לעולם לא פולט `''`**; ברירת-המחדל בסוף שרשרת הסיווג היא `'direct'`. לכן לכל הזמנה היה source לא-ריק → `covered === total` תמיד → 100% מתמטית. תוקן: `'direct'` (ו-`''`) הם דלי ה"לא ידוע" ולא נספרים כמכוסים; נספר רק **סימן חיובי אמיתי** (fbclid/gclid/utm_*/ערוץ-מזוהה כמו meta-paid/…/other-referral). ה-fixture של מבחן הכיסוי השתמש ב-`source:''` הבלתי-אפשרי בייצור והסתיר את הבאג. (2) **aiReport**: דלי המקור עכשיו מקפל `'' → 'direct'` (מתואם ל-`attributionAnalysis.ts:1205`), וה-deterministic-coverage יושר לכלול `utm_source` כפי שתיעודו תמיד טען. שתי ההתאמות **display-only** (אינן מזינות שום gate). ראה סעיף 16 לתיקון פער ה-state-keys (COGS).
>
> **Salaries — editable, true-net-only (2026-06-02):** `lib/salarySettings.ts` משקף את תבנית ה-COGS אך **ברמת-עסק בלבד**: מודל `{ default, byMonth }` של `SalaryEntry = { kind:'percent'|'amount'; value }`, ברירת מחדל **7% percent**. `salariesForRange(s, rows, range)` — לכל חודש שיש לו שורה בטווח: percent → `value% × Σ הכנסות החודש בתוך הטווח`; amount → `value × (ימי-החודש-בטווח ÷ ימי-החודש)`. `applySalaryToScope` = 4 תחולות. נשמר ב-localStorage + `pushCloudKey('roas-dashboard:salary-settings')` (סעיף 16). **הניכוי נכנס ב-`trueNetProfit` בלבד:** `aggregate()` קיבל פרמטר אופציונלי `salaries=0` (חמישי) המנוכה רק ב-`trueNetProfit` + שדה `Aggregate.salaries` חדש; **הרווח התפעולי (`revenue − adSpend − COGS` ב-`lib/home/adapters.ts`) וה-`netProfit` הישן לא נוגעים.** `Dashboard.tsx` מחשב `salariesForRange(salarySettings, cur, range)` ומשחיל אותו לשני קריאות `aggregate` (curAgg/prevAgg) — כך הניכוי מכבד את מסנני החנות/טווח, בדיוק כמו COGS. `PnLBreakdown` מציג קו "משכורות" (כש-salaries>0) בין "הוצאות קבועות" ל-"רווח נטו אמיתי", ו-`totalCosts` כולל אותו. **per-store ROAS cards לא מקבלים משכורות** (business-level בלבד).
>
> **Plan B — new-vs-returning → NC-ROAS / nCAC (Phase 3, 2026-06-02, DEPLOYED):** `orders_attribution` קיבלה 3 עמודות nullable — `customer_id TEXT`, `order_created_at TIMESTAMPTZ`, `is_first_order BOOLEAN` — + index `(store_id, customer_id)` (migration `20260602120000`), ו-RPC אידמפוטני `recompute_first_order_flags(p_store_id)` (migration `20260602130000`) שמסמן `is_first_order=TRUE` ל-MIN(order_created_at) לכל לקוח. **שתי המיגרציות הוחלו ל-prod ידנית** דרך supabase CLI (db push של 2 הקבצים בלבד; ה-`.env` בשורש מוסתר זמנית כי שמות-המשתנים שלו עם נקודות/מקפים מפילים את ה-parser של ה-CLI, ויש 2 קבצי-migration ישנים עם אותו timestamp `20260530300000` שגורמים ל-`--include-all` להיכשל על duplicate-key — לכן מסירים זמנית את ה-duplicate + `20260530310000` ודוחפים רק את 2 שלי). `fetchShopifyOrdersAttribution` (shopify.ts) נושאת `customerId`+`createdAt`; שני ה-cron (cronDaily/cronLive) עושים dual-write + קוראים ל-RPC; `postgresReaders` קורא אותן ל-`OrderAttributionRow`. **Backfill היסטורי חד-פעמי:** `lib/fetchers/shopifyBulkFirstOrder.ts` (Shopify Bulk Operations → NDJSON → MIN(createdAt) per customer) מסמן `is_first_order` להזמנות הישנות (read-only מול Shopify; רק `customer.id`, ללא PII). **Compute:** `lib/home/newCustomerMetrics.ts` (pure) — `NC-ROAS = הכנסת לקוחות-חדשים ÷ MER spend` (mapping-aware `agg.spend`, **לעולם לא** raw account totals), `nCAC = MER spend ÷ הזמנות-חדשות`, ו-`unclassifiable = is_first_order IS NULL ÷ total`. **Surface:** `CommandCenterHero` כרטיס-משנה "שאלה אחרת" עם band משלו; `StoreDetailModal` שורה per-store. כרטיסי-החנות + הגרדיאנטים לא נגעו. CAPI-safe (אפס שליחת events).

> **Wave 2 — channel-nc-roas-split (2026-06-04, DEPLOYED):** פיצול NC-ROAS/nCAC לפי ערוץ-מגייס (Meta/Google/TikTok). `FirstOrderInput` קיבל שדה אופציונלי `source?: OrderSource`; `Dashboard.firstOrderRows` מעביר אותו. **Pure compute** `lib/home/channelTruth.ts` — `sourceToChannel(meta-paid→meta, google-paid→google, tiktok-paid→tiktok, else null)` + `computeChannelTruth(rows, spendByChannel, storeName?, netAdjust=1)` → פר ערוץ `{ncRevenue, ncOrders, spend, ncRoas, nCac}`. הכנסה = סכום `totalCad` של הזמנות-ראשונות שה-source שלהן מתמפה לערוץ, מוכפל ב-`netAdjust` (אותו gross→net factor כמו ה-NC-ROAS הבלנדי, כדי שהפר-ערוץ ישב על אותו בסיס-נטו); spend פר-ערוץ = `curAgg.fbSpend/gaSpend/ttSpend` (mapping-aware, **לעולם לא** raw totals); `ncRoas` null כש-spend≤0 או 0-הכנסה; `nCac` null כש-0-הזמנות. **UI** `components/home/ChannelTruthPanel.tsx` (משותף) — 3 כרטיסי-ערוץ עם צבעי-מותג מ-`PLATFORM_TOKENS` (token-driven), band ROAS (≥3 בריא/≥2 תקין/<2 חלש), שורת-בלנדי + callout "best מסבסד worst" כשהפער ≥1. **Surfaces:** `CommandCenterHero` (business; `heroNewCustomer.channelTruth`) + `StoreDetailModal` (per-store; `toStoreDetail.channelTruth`). אותו טווח+בסיס כמו ה-NC-ROAS הבלנדי; הזמנות לא-מסווגות לא נכללות. CAPI-safe. TDD: channelTruth (6) + ChannelTruthPanel (5). **per-channel-net-profit (2026-06-04):** `computeChannelTruth` קיבל פרמטר `keepRate` (=1−COGS%−fees%) ושדה `ncNetProfit = ncRevenue×keepRate − spend` (contribution net על גיוס-לקוחות-חדשים, ללא הוצאות-קבועות/משכורות); ה-keepRate נגזר ב-call-sites מ-`curAgg.cogs/revenue` (Hero) ו-`cur.cogs/revenue` (StoreDetailModal) + `TRANSACTION_FEES_RATE`. שורת "רווח-נטו (אחרי עלויות)" בכל כרטיס-ערוץ (ירוק/אדום).
>
> **Plan B.1 — first-order ledger (2026-06-02):** `orders_attribution` הוא **חלון מתגלגל (May+ בלבד)**, ולכן MIN-מעל-החלון סימן בטעות הזמנה אחרונה של לקוח חוזר כ"הזמנה ראשונה" כשהראשונה האמיתית קדמה לחלון. התיקון: טבלת-לדג'ר עמידה `customer_first_order` `(store_id, customer_id, first_order_id, first_created_at, PK(store_id,customer_id))` שמחזיקה את ההזמנה-הראשונה-האמיתית לכל לקוח **מכל ההיסטוריה של Shopify**. `recompute_first_order_flags(p_store_id)` נכתב מחדש (אותה חתימה) ל-3 שלבים אידמפוטניים: (1) upsert אדיטיבי מהחלון ל-לדג'ר עם `ON CONFLICT … DO UPDATE … WHERE EXCLUDED.first_created_at < ...` — **רק מוריד את ה-MIN, לעולם לא מעלה** (מגן על זרע ה-backfill מההיסטוריה המלאה); (2) גזירת `is_first_order` ב-JOIN ל-לדג'ר (`oa.order_id = l.first_order_id`); (3) אורחים (`customer_id IS NULL`) → `is_first_order = NULL`. כך החלון **לא יכול לדרוס** את ה-backfill. **Seed חד-פעמי:** `scripts/backfillFirstOrderLedger.ts` (Shopify Bulk Operations → NDJSON → earliest-per-customer) מזריע את הלדג'ר מכל ההיסטוריה (read-only מול Shopify). מיגרציות אדיטיביות-בלבד `20260602140000_customer_first_order_ledger.sql` + `20260602150000_recompute_first_order_flags_ledger.sql`.
>
> **Google campaign un-exclude + Plan C first-click (Phase 4, 2026-06-02):** **(T0 — last-click)** `orderMatchesCampaign` + `analyzeAttribution` עכשיו מנתחים **קמפייני Google ברמת-קמפיין** (קודם החזירו null ל-Google). התאמה: `order.utmId === campaign.campaignId` **או** `order.utmCampaign === campaign.campaignId` (מזהה-Google מספרי; ה-utm_campaign תומך בתיוג ValueTrack של המפעיל) — **מוגבל ל-Google** כדי לא להתנגש ב-Meta (Tier-2 שלו = שם הקמפיין). **רמת-קמפיין בלבד** — אין שורות מודעות-Google ב-ads_daily, אז analyzers ברמת-מודעה/adset עדיין null ל-Google. דורש תיוג Final-URL ב-Google Ads (`utm_id={campaignid}` או `utm_campaign={campaignid}`); תופס קדימה. **(Plan C — first-click)** `classifyOrderAttribution` קורא מפתחות `ft_*` (single `_ft_` נורמליזציה) משק ה-`note_attributes` הקיים דרך שרשרת-מקור מקוצרת (ללא source_name/referrer) → שדות `first_*`. עמודות אדיטיביות `first_*` (migration `20260603090000`), dual-write בשני ה-cron, קריאה ב-`postgresReaders`/`OrderAttributionRow`. אנלייזרים-אחים `analyzeFirstClickForCampaign/Ad` (ממראים את ה-Google un-exclude), קרדיט-חנות דרך `campaignStoreMap`. UI: ROAS first-click + דלתא ליד "ROAS Shopify" ב-`CampaignsTable`+`AdsDrawer` + `FirstClickCoverageChip` (HelpTooltip, לא native title). **לכידה צד-חנות = מסמך-התקנה למפעיל בלבד (לא קוד)** — cookie write-once + `/cart/update.js {_ft_*}` ל-uzoshop/zolplus (theme/Custom-Pixel), `/api/events/cart` beacon ל-usmile (Lovable); אפס `fbq/gtag/ttq`. עד ההתקנה כיסוי first-click = 0%. CAPI-safe.
>
> **Wave 2 — Customer Value (cohorts / LTV) → "לקוחות" tab (2026-06-03):** טאב חדש שעונה על "כמה שווה לקוח לאורך זמן, ואני מגייס ברווח?" — retention + LTV + LTV:nCAC + payback. **טבלת-אגרגט חדשה** `customer_cohort_monthly` `(store_id, first_order_month 'YYYY-MM', month_since 0..11, active_customers, orders, gross_cad, net_cad, PK(store_id,first_order_month,month_since))` + index `(store_id, first_order_month)` — migration אדיטיבית `20260603100000_customer_cohort_monthly.sql` (החלה ל-prod = שלב מפעיל מפוקח). **Seed + refresh (Shopify Bulk):** `lib/fetchers/shopifyBulkCohort.ts` (port של `shopifyBulkFirstOrder.ts` — מרחיב את ה-Bulk query ל-`totalPriceSet`/`totalRefundedSet`/`currencyCode`; **Invariant #1**: gross = ה-`totalPriceSet` ה**אימוטבילי** (מקבילת-GraphQL ל-REST `total_price`), **לא** `currentTotalPriceSet` — שזה כבר מנכה refunds → שימוש בו כ-gross גורם ל-net (= gross − refund) לנכות refunds פעמיים; `parseBulkCohortNdjson` → `{orderId, createdAt, customerId, grossNative, refundNative, currency}`; רק `customer.id`, ללא PII). `lib/cohorts/cohortAggregate.ts` (pure): `monthsBetween(a,b)` (חודשים קלנדריים שלמים, floor 0) + `aggregateCohortCells(store, lines, firstOrderMonthByCustomer)` — join כל הזמנה ל-`first_order_month` של הלקוח (מהלדג'ר `customer_first_order` של Plan B.1) → `month_since = min(11, monthsBetween)` → סכימה לתאי `(store, fom, ms)` עם ספירת-לקוחות-distinct; **אורחים (`customerId=null`) ולקוחות ללא-לדג'ר מדולגים**. `scripts/backfillCohortMonthly.ts` (port של `backfillFirstOrderLedger.ts`; DRY_RUN; env-mapping note; full-replace פר-חנות). **Maintenance:** `cron-cohort-refresh` — weekly (שני 04:00 IL), ראה §4.9. FX-fail על שורה → השורה מושמטת ("stale > wrong"); FX memoized per (currency, date). **Reader + API:** `fetchCohortMonthlyFromPostgres({storeId?})` ב-`postgresReaders` (`COHORT_MONTHLY_SELECT` + `CohortMonthlyRow` camelCase, מכוסה ע"י select-string guard) → `GET /api/cohorts` (`{rows, lastUpdated}`, 5-min cache, degraded-path 200 `{rows:[], error}` כמו `/api/orders-attribution`; הלקוח חותך לפי חנות). **Pure compute:** `lib/home/customerValue.ts` — `computeCustomerValue(rows, opts)` → `{retention[], cumulativeNet[], cumulativeProfit[], ltv12Net, ltv12Profit, repeatRate, newVsOld, cohortNcac, blendedNcac, paybackMonths, ltvToNcac}`. pooled / **M0-weighted** פר month_since; **profit ב-render** = `net × (1 − cogsPct − feesRate)` עם ה-COGS הניתן-לעריכה (`effectiveCogsPct`) + שיעור-העמלות הקבוע (זהה ל-P&L, **לא** אפוי בטבלה); `ltv12` מוגבל ל**קבוצות בוגרות בלבד** (≥12 חודשים מ-`todayMonth`); **MAPPING-AWARE** — `spendByMonth` (per-cohort nCAC) ו-`blendedNcac` (headline, מ-Wave-1 `computeNewCustomerMetrics`) **מועברים פנימה, לעולם לא מחושבים מ-raw account totals**. **The May+ nCAC constraint:** היסטוריית-ההזמנות מלאה אבל היסטוריית-ההוצאה היא `data_daily` rolling (May-2026+ בלבד) → **nCAC / LTV:nCAC / payback פר-קבוצה קיימים רק לקבוצות מ-מאי+**; קבוצות לפני-מאי מציגות LTV + retention אבל `nCac=null` ("אין נתוני הוצאה"); ה-headline משתמש ב-blended nCAC הזמין. **UI:** `CustomerValueTab.tsx` (+ `CustomerValueCurve.tsx` zones-curve SVG, `CohortGridAdvanced.tsx` heatmap) — port של mockup v3c: משפט-verdict, 4 KPI cards (`<Money>`/`<Metric>`), עקומת-LTV עם אזורי amber/green נחצים ב-payback (callout פועם + hover tooltip + `prefers-reduced-motion` guard), new-vs-old bars, ו-`<details>` מקופל לרשת-cohorts המלאה. בורר profit↔revenue (ברירת מחדל profit) + בורר-היקף (מסתנכרן עם מסנן-החנות הגלובלי). token-driven (אפס צבעים קשיחים), light+dark, RTL, WCAG-AA (white on-accent ל-callout pill). **Tab wiring:** `urlState.ts` (`'customers'` ב-`TabKey`), `Sidebar.tsx` (`{key:'customers', label:'לקוחות', icon:<Users/>, slot:3}`), `Dashboard.tsx` (render על `activeTab==='customers'`). CAPI-safe לחלוטין (Shopify-only aggregate, אפס שליחת events). **Fixes 2026-06-04 (post deep-backfill):** (1) `newVsOld` ב-`customerValue.ts` נושא עכשיו **שני בסיסים** `{net[], profit[]}` (helper משותף `pooledProfitCurve`), וכרטיס חדשים-מול-ותיקים ב-UI בוחר את הבסיס הפעיל (profit כברירת-מחדל) — היה תמיד-נטו בעוד הכותרת רווח, מה שגרם ל"$86 ב-3ח" להיראות כסותר "$47 ב-12ח". (2) `CohortGridAdvanced` + footer ה-nCAC-פר-קבוצה עברו ל**אקורדיון לפי-שנה** (DESC, השנה הנוכחית פתוחה) — אפס איבוד-מידע. (3) `ratioTone` (LTV:nCAC) **עוגן-מחדש ל-×1 break-even** (ה-LTV כבר רווח): ≥3 בריא / 1–3 רווחי-מתחת-ליעד / <1 מפסידים — תיקון הסתירה "×1.4 רווחי אבל 'מתחת לסף הרווחיות'". (זה ספציפי ל-LTV:nCAC; בנדי ה-ROAS ×2/×3 לא נגעו.) (4) שורת-הסיכום מעגלת רכיבים לפני חיסור ($LTV−$nCAC) + ניסוח-payback "כבר מההזמנה הראשונה" כשמיידי. **Fixes 2026-06-05 (verdict self-consistency):** ה-verdict הציג סתירה "×0.9 מפסידים" + "מחזיר תוך 11 חודשים" כי `paybackMonths` + העקומה השתמשו ב-cumulative של **כל-הקבוצות** בעוד `ltv12`/`ratio` ב-**בוגרות בלבד**. תוקן: computeCustomerValue מחזיר `cumulativeNetMature`/`cumulativeProfitMature` (12-length); `paybackMonths` סורק את עקומת-הרווח-הבוגרת (→ null כש-ltv12Profit < nCAC, בלי "11 חודשים" מטעה). ב-`CustomerValueTab` כל הרכיבים תלויי-הבסיס מאוחדים: `displayRatio`/`displayPayback`/`netIsGood` נגזרים מה-**בסיס הפעיל** (profit/net), העקומה (`curvePoints`) משתמשת בעקומה-הבוגרת (fallback ל-all-cohort כשאין בוגרות), וה-nCAC line/callout נחסמים כש-`ratio<1` או אין-בוגרות — כך שאף שילוב לא מציג "מפסידים" + "מחזיר תוך N חודשים" יחד; verdict ריק → "לא מחזיר את עלות הגיוס תוך שנה". **Table column centering 2026-06-05:** עמודות-הנתונים ב-`CampaignsTable`/`CampaignsTableRow`/`AdSetTable` עברו מ-`align="end"`/`text-end` ל-**מרכז** (`align="center"`/`text-center`) לבקשת המפעיל — הערכים ממורכזים מתחת לכותרת (עמודת-השם נשארת start; AdsDrawer ללא שינוי). **Deep audit 2026-06-04 (13 באגים, ביקורת רב-סוכנית; כל המספרים אומתו מול ה-DB):** (A1, **P0**) `fetchCohortMonthlyFromPostgres` היה ה-reader היחיד שפלט `store_id` **גולמי** בעוד בורר-ההיקף + המסנן-הגלובלי משתמשים בשמות-תצוגה (`data.stores`) → סינון ל-zolplus/usmile360 התאים 0 שורות → טאב כל-אפסים ל-2 מתוך 3 חנויות. תוקן במיפוי `STORE_NAME_BY_ID` בגבול ה-reader (כמו כל reader-אח). (A2) `customersSpendByMonth` (Dashboard) נבנה מ-`data.rows` = **הטווח הנבחר** → רשת-ה-nCAC-פר-קבוצה הראתה מאי "אין נתונים" (בסתירה לכיתוב) ויוני $9 (יום בודד); עכשיו מחלון-ה-mai+ היציב (אותו מקור כמו ה-blended), mapping-aware; החודש הנוכחי מסומן "(חלקי)". (A3) `blendedNcac`/`spendByMonth` עקבו אחרי המסנן הגלובלי בעוד ה-LTV-compute עקב אחרי בורר-הטאב → יחס חוצה-חנויות; ה-`scope` הורם ל-Dashboard (single source of truth, prop נשלט). (A4) מצב-ריק חד-חנותי נימק את הצד-החסר הלא-נכון; עכשיו מבחין LTV-חסר מ-nCAC-חסר. (A5) `newVsOld` יושר לגבול-הבגרות (ותיק=age≥12, חדש=age∈[3,12)) + השוואה ב-`cmpDepth` משותף (בלי M1 שנישא קדימה כ-M2 מדומה), ברים מגודרים כמו המשפט, תווית כנה. (A7) היחס מוצג ב-2 ספרות ליד נקודת-האיזון (`0.9≤r<1.1`), נטו שלילי-תת-דולרי מורצף מתחת ל-$0. (**B3**) כל אלמנט-רווחיות (יחס/תווית/נטו/payback/clause) **תמיד נגזר מרווח** — הכנסה אינה רווח; הטוגל משנה רק את העקומה + מספר ה-LTV; קו-האיזון בעקומה רק בבסיס-רווח. (**B1**) הכותרת מתויגת "מבוסס על קבוצות בוגרות (12 ח׳+)"; כשהבוגרות מפסידות אבל הקבוצות החדשות כבר מחזירות את ה-nCAC, התווית האדומה המוחלטת יורדת לכתום-מתואר + שורת-גשר ל-new-vs-old. (**B2**, `cohortAggregate.ts`) הוסר ה-cap `Math.min(11, …)` שקיפל חודשים 11..N ל-M11 catch-all (ניפח את "12-חודש" ~7% + יצר hockey-stick מזויף בקצה-העקומה + עמודת-ה-retention האחרונה); עכשיו חלון-12-חודש אמיתי (`if (ms>11) continue`). ltv12Profit ירד מ-$46.54 ל-$43.48. (**A6**) שיעור-החזרה היה `Σ active(m≥1) ÷ M0` — סכום-הופעות שכופל-ספירה לקוח פעיל בכמה חודשים (ניפח ל-10%); עמודה חדשה `repeat_customers` (migration `20260604120000`, nullable) מחזיקה לקוחות-distinct שחזרו בתוך-חלון (על שורת-ה-M0 בלבד), ו-`computeCustomerValue` משתמש בה (כן: ~6.2%) עם fallback ל-proxy ל-שורות שטרם עברו backfill. **המיגרציה הוחלה ל-prod + `customer_cohort_monthly` עבר re-backfill** (395 תאים, 0 כשלי-FX, 0 null ב-repeat_customers; backfill יחיד לשני השינויים). **נדחו (P2, ל-follow-up):** A8 (תיוג-תקופה על העקומה — ברובו מיותר אחרי הסרת ה-cap + מכוסה ע"י תיוג ה-verdict ב-B1), A9 (מחיקת `value.retention` המת), A10 (COGS לפי חודש-פעילות + הסרת `stores[0]` — רדום תחת COGS-עסקי-אחיד).
>
> **תשלומים — payment-method breakdown → "תשלומים" tab (2026-06-04):** טאב חדש שמפצל מכירות לפי **שער-תשלום** (אשראי / PayPal / אחר) כ-**מספר הזמנות · הכנסה (CAD) · % נתח** פר חודש, כלל-עסק + פר-חנות. **Data model:** עמודה אדיטיבית נולבילית `orders_attribution.payment_gateway TEXT` — מאחסנת את **שם-השער הראשי הגולמי** של ההזמנה (`shopify_payments` / `paypal` / `gift_card` / `manual` …), **לא** קטגוריה אפויה-מראש, כדי שהסיווג יישאר ניתן-לכיוונון + יאפשר בעתיד פילוח עמלות-סליקה אמיתי. NULL = לא-עבר-backfill. migration `20260603110000_orders_attribution_payment_gateway.sql` (`ADD COLUMN IF NOT EXISTS`; **החלה ל-prod = שלב מפעיל מפוקח** דרך נוהל ה-Supabase המתועד). **Helpers** `lib/payments.ts` (pure): `primaryGateway(names)` — בוחר שם-שער יחיד מ-`payment_gateway_names` של Shopify (הזמנה יכולה לרשום כמה tenders): השם הראשון שאינו tender-משני (`gift_card`/`manual`/`store credit`, regex `SECONDARY`), אחרת השם הראשון; `[]`/null → null. `categorizePaymentGateway(raw): 'credit'|'paypal'|'other'` — `paypal*` → **paypal**; tender-משני (gift_card/manual/store credit) → **other** (guard מפורש לפני בדיקת ה-card, כי `"gift_card"` מכיל את התת-מחרוזת `card`); `visa|master|amex|discover|card|credit|stripe|shopify_payments|bogus` → **credit**; כל השאר (כולל NULL) → **other**. **Write path:** `fetchShopifyOrdersAttribution` (shopify.ts) הוסיף `payment_gateway_names` ל-`fields`, שדה `payment_gateway_names?: string[]` ל-`ShopifyOrderRow`-הגולמי, ו-`paymentGateway: string | null` (= `primaryGateway(o.payment_gateway_names)`) לשורה המוחזרת. שני ה-cron כותבים אותו דרך ה-mapper המשותף `toOrdersAttributionRow` (`cronDaily.ts` בעל ה-mapper, `cronLive.ts` מייבא אותו) → `payment_gateway: o.paymentGateway ?? null`; ה-guard `ordersAttributionDualWriteKeys` שומר על שוויון מפתחות (אין dual-write drift). **Reader + API:** `readPaymentMethodsByMonth()` ב-`postgresReaders` (`PAYMENT_METHODS_SELECT = 'store_id, date, total_cad, payment_gateway'`, מכוסה ע"י select-string guard; `paginate()` לעקיפת max-rows=1000) → אגרגציה **בקוד** (הסיווג regex-based, לא מתבטא זול ב-PostgREST) למבנה `PaymentMethodsByMonth = { months: [{ month 'YYYY-MM', perStore: Record<storeDisplayName, {credit,paypal,other:{orders,revenueCad}}>, business: <אותו rollup מסוכם> }] }` — **`perStore` ממופתח לפי שם-החנות לתצוגה** (`STORE_NAME_BY_ID`, למשל `Zol Plus`/`360usmile`), **לא** לפי `store_id` הגולמי, כך שהמפתחות תואמים ל-`data.stores` ולמסנן-החנות הגלובלי שכל שכבת-הלקוח עובדת בהם (תיקון 2026-06-04: מפתוח-לפי-id שבר בשקט את הבורר פר-חנות לכל חנות ששמה ≠ id — uzoshop עבד כי שם==id; zolplus/usmile360 הראו "אין נתונים". guard ב-reader-test) (חודשים עולים; הכנסה = סכום `total_cad` שכבר ב-CAD; חודש = `date.slice(0,7)`; NULL-gateway נופל ל-`other`). `GET /api/payment-methods` (`revalidate=60`, מתואם `CACHE_CONFIG.paymentMethods`) — מחזיר את האגרגט המלא + `lastUpdated`; degraded-path 200 `{months:[], lastUpdated, error}` (כמו `/api/cohorts` / `/api/orders-attribution`) עם `Cache-Control: no-store` כדי לא לנעוץ blip ב-CDN; **מאחורי שער-האימות, ללא allowlist** (internal GET). **UI:** `PaymentMethodsTab.tsx` (SWR מ-`/api/payment-methods`) — primitives קיימים בלבד (`Card`/`Heading`/`TableBase`/`Badge`/`<Money>` לכל CAD + רצועת-נתח), בורר-היקף עצמאי (business default / per-store + מסנכרן עם `filters.store`), רצועת-סיכום (סך-הכל + share bar + 3 כרטיסי-שער עם %), טבלה דו-שכבתית פר-חודש (אשראי/PayPal/אחר × הזמנות·CAD·% + total + share bar פר-שורה). **מצב חלקי לפני-backfill:** כשכל ההזמנות מסווגות `other` (= NULL-gateway) ויש הזמנות → תווית "אחר / לא ידוע" + רמז "ממתין ל-backfill". token-driven (אפס צבעים קשיחים), light+dark, RTL לוגי, WCAG-AA. **Tab wiring:** `urlState.ts` (`'payments'` ב-`TabKey`), `Sidebar.tsx` (`{key:'payments', label:'תשלומים', icon:<CreditCard/>, slot:9}`), `Dashboard.tsx` (render על `activeTab==='payments'`). **Backfill (היסטוריה, חד-פעמי מפוקח):** `scripts/backfillPaymentGateway.ts` (modeled on `backfillRecentAttribution.ts`) — לכל חנות מאתר את התאריכים המובחנים ב-`orders_attribution` שעדיין יש בהם שורה עם `payment_gateway IS NULL` (re-run מדלג חודשים שלמים), קורא `fetchShopifyOrdersAttribution(store, date)` ועושה `UPDATE … SET payment_gateway WHERE store_id, order_id AND payment_gateway IS NULL` (אידמפוטני — רק NULL → ערך, לעולם לא דורס). `--dry-run`/`DRY_RUN=1`, `--from`/`--to` (או FROM/TO env), tally פר-חנות (classified/credit/paypal/other). **לא רץ אוטומטית.** CAPI-safe (read-only מול Shopify, `read_orders` בלבד — שדה ה-gateway **לא** חסום ע"י פער ה-`read_customers`; אפס שליחת events). **By-year UI (2026-06-04):** עם היסטוריה מלאה (uzoshop מ-2023, ~46.5k הזמנות) הטבלה השטוחה (~36 שורות-חודש) הוחלפה ב-**אקורדיון לפי-שנה** — שורת-שנה מסכמת (DESC, השנה הנוכחית פתוחה) שנפתחת ל-תת-שורות ב-**רמת-פירוט נבחרת** (חודש / רבעון Q1-Q4 / שליש T1-T3 = 4-חודשים), grouping client-side ב-`PaymentMethodsTab` (helpers `groupMonthsByYear`/`groupRowsByPeriod`/`periodKey`/`periodLabel`); רצועת-הסיכום נשארת אגרגט כל-ההיסטוריה (מעל-שנה = סיכום, לא חודשים). **Historical backfill:** `scripts/backfillRecentAttribution.ts` הורחב עם `FROM`/`TO` (טווח-תאריכים) + `STORES` (סינון חנות) להזרקת ההיסטוריה העמוקה פר-חנות (fetch+upsert orders_attribution עם `payment_gateway` דרך ה-mapper המשותף + `recompute_first_order_flags`) — מה שגם מדייק retroactively את is_first_order / new-vs-returning / cohorts על פני כל ההיסטוריה.
>
> **Hotfix — stale-scope Shopify token self-heal (2026-06-03, incident):** `shopifyAuth.ts` מטמין את טוקן ה-OAuth (`client_credentials`) **ב-module scope ל-~24h**, כך שמופע Vercel/Inngest "חם" עושה exchange אחד ליום. כשהמפעיל הוסיף את הרשאת `read_customers` (כדי לאפשר את ה-backfill של NC-ROAS), מופעים חמים המשיכו להגיש טוקן שנטבע **לפני** ההרשאה → כל בקשה ל-`fetchShopifyOrdersAttribution` (שמבקשת את שדה ה-`customer`) קיבלה `400 "Access denied for customer field. Required access: read_customers"`. ה-`throw` גרם ל-`cron-live` **לדלג על כל כתיבת ה-`orders_attribution` של היום** (`todayOrders=[]` ב-catch) → הזמנות חדשות נשארו לא-מסווגות (`customer_id`/`order_created_at`/`is_first_order` = null) עד ~24h, בעוד שפטשר ההכנסות (שלא מבקש `customer`) המשיך לעדכן `data_daily`+`last_live_tick_at` — ולכן "חצי מהדשבורד התעדכן". **התיקון:** `invalidateShopifyToken(storeId)` חדש ב-`shopifyAuth` מוחק את הערך המוטמן; `fetchShopifyOrdersAttribution` מזהה שגיאת scope/auth (`401`/`403`, או `400` עם `access denied|required access|read_customers`) → invalidate + re-exchange (קולט את ההרשאה החדשה) + retry **פעם אחת** על אותו עמוד (guard `scopeRetried` מונע לולאה). כך הצינור מרפא את עצמו תוך tick אחד במקום להמתין ל-TTL. בדיקות: `shopifyOrdersAttributionScopeRetry.test.ts` + `shopifyAuth.test.ts` Test 8.
>
> **Hotfix — Inngest pinned to a pre-gate deployment (2026-06-03, סיבת-שורש עמוקה יותר):** `/api/inngest` **לא** היה ב-allowlist של ה-password-gate (`isDashboardAuthAllowlisted`). מרגע שה-gate הופעל, **ה-PUT שבו Inngest Cloud מסנכרן פונקציות בכל deploy של Vercel קיבל 401** → הסנכרון נכשל בשקט ו-Inngest נשאר **נעוץ ב-deployment האחרון שסונכרן לפני ה-gate** (קוד cron ישן, לפני ה-dual-write של Plan B). לכן קוד ה-cron החדש מעולם לא רץ בפרודקשן למרות שה-deployment של הדפדפן (alias) כן הצביע עליו — וזו הסיבה שהזמנות היום נשארו לא-מסווגות אף שה-dual-write פרוס מ-00:01. ה-workers של Phase B/C המשיכו לרוץ כי ה-deployment הנעוץ הוא אחרי Phase C. **התיקון:** הוספת `/api/inngest` ל-allowlist — הוא מוגן ע"י `X-Inngest-Signature` (`INNGEST_SIGNING_KEY`) ברמת ה-route (אותו מודל self-validating כמו ה-HMAC webhook), כך שאין רגרסיית-אבטחה. בלי זה, אם Inngest היה מסונכרן ל-deployment מגודר — גם ה-invocations (POST) היו מקבלים 401 וה-cron היה נשבר. בדיקה: `middleware.test.ts` (allowlist `/api/inngest`). אחרי ה-deploy: לוודא ש-Inngest סנכרן מחדש (Vercel→Inngest integration), אחרת Resync ידני בלוח-הבקרה של Inngest (שעכשיו לא ייחסם).
>
> **Goal — per-month, range-aware (2026-06-02):** `lib/goalSettings.ts` משקף את תבנית ה-COGS/Salaries (`useGoalSettings.ts` reactive hook על האירוע `roas-goal-changed` + storage) אבל **ברמת-עסק בלבד** — מודל `GoalSettings = { v:number; byMonth: Record<'YYYY-MM', number> }` (אין מימד פר-חנות; היעד הוא יעד-עסק יחיד). **אין DB migration** — רוכב על `dashboard_state` KV דרך `pushCloudKey('roas-dashboard:goal-settings')` (סעיף 16). **Helpers:** `effectiveGoal(s, month)` — `byMonth[month]` המדויק מנצח (`carriedFrom: null`); אחרת המפתח המוגדר האחרון **STRICTLY < month** (`carriedFrom: thatKey`, "carry-forward"); אחרת `{ value:null, carriedFrom:null }`. `monthFromRange({from,to})` מחזיר `'YYYY-MM'` רק כש-`from.slice(0,7) === to.slice(0,7)` (חודש קלנדרי בודד — מלא או חלקי), אחרת `null` (טווח חוצה-חודשים → המצב הריק של `GoalTracker`). **מיגרציה מהמפתח הישן:** ב-`readGoalSettings()` הראשון בלי `goal-settings` אבל עם הערך הישן ב-`roas-dashboard:monthly-revenue-goal` — המספר הישן מזריע את `byMonth[currentMonth]` (חודש IL נוכחי דרך `getTodayInIsraelTz()`), כך שהפייסינג של החודש הנוכחי נשמר; חודשי-עבר נשארים unset עד עריכה. המפתח הישן נקרא **למיגרציה בלבד** ונשאר ב-`cloudSync` ל-hydrate תאימות-לאחור. **UI:** `GoalTracker.tsx` קיבל prop `range` (טווח-הדף הנבחר) → `monthFromRange` בוחר את החודש; `viewMonth` מקומי (seeded מהטווח) מניע צעדן `‹ חודש ›` **בלי לדרוס את הטווח הגלובלי**. חודש נוכחי → MTD + `forecastMonthEnd` + pacing (התנהגות קיימת); חודש עבר → הכנסה סופית מול יעד + באדג' "✓ עמד / ✗ לא עמד" + עמודת "תוצאה מול יעד"; carry-forward → תגית "נגרר מ-<month>". `Dashboard.tsx` מעביר `range={filters.range}`. **business-wide בלבד** (מתעלם ממסנן החנות; ראה lock "monthly goal is global"). המפתח `goal-settings` נוסף לשתי רשימות ה-parity (סעיף 16.2 + 16.4).
| WhatsApp test | POST `/api/operator/whatsapp/send-now` | Inngest `event-whatsapp-send-now` |
| Reset Data | POST `/api/operator/reset` `{scope,confirm}` | ישיר ל-Supabase admin client |

### 11.2 Auth
**מודל ברירת מחדל: URL-obscurity** — אל תשלח את ה-URL. אופציה מתקדמת: **OPERATOR_SECRET gate** (Security hardening FIX 3, 2026-05-28) — ראה סעיף 11.2.1.

#### 11.2.1 OPERATOR_SECRET — שכבת הגנה אופציונלית
**ברירת מחדל: כבוי.** אין צורך לשנות התנהגות קיימת — ה-gate לא פעיל כאשר env var לא מוגדר.

**הפעלה:** הגדר `OPERATOR_SECRET=<strong-random-token>` ב-Vercel (Project Settings → Environment Variables).

**מנגנון:**
- Next.js Middleware (`dashboard-web/middleware.ts`) רץ על כל בקשה לנתיבים `/api/operator/*` ו-`/operator`.
- `X-Robots-Tag: noindex, nofollow` מוגדר תמיד (גם ללא secret) — מונע אינדוקס של URL אם יתגלה.
- על נתיבי `/api/operator/*` בלבד: אם `OPERATOR_SECRET` מוגדר, כל בקשה חייבת לכלול header `x-operator-secret` שמתאים בדיוק (השוואה constant-time ע"י `crypto.timingSafeEqual`). אי-התאמה → **404** (לא 401/403 — 404 לא חושף שהנתיב קיים).
- עמוד `/operator` עצמו תמיד זמין (הוא מציג את טופס הכנסת ה-secret).

**SPA integration:** כל קריאות ה-API מ-SPA מבוצעות דרך `operatorFetch()` (src/lib/operatorClient.ts) — wrapper סביב `fetch()` שמוסיף את ה-header אוטומטית כאשר ה-secret שמור ב-localStorage. המפעיל שומר את ה-secret דרך הטופס ב-`/operator` (OperatorSecretBanner component); הוא נשמר ב-localStorage של הדפדפן.

**היעדר secret ב-env:** ה-header שמגיע מ-SPA מתעלם ממנו (harmless); כל הבקשות עוברות. תאימות מלאה לאחור.

### 11.3 Secrets handling
`INNGEST_SIGNING_KEY` + `INNGEST_EVENT_KEY` + `SUPABASE_SERVICE_ROLE_KEY` + `OPERATOR_SECRET` — server-side בלבד. 0 התאמות ב-`.next/static/` לאחר build (bundle scan). `OPERATOR_SECRET` לא נשלח ל-client בשום צורה; הלקוח רק שולח אותו כ-header.

### 11.4 Sync-now semantics
POST מחזיר 202 + eventIds. לא ממתין לסיום. עקוב אחרי `/operator > ריצות אחרונות` (ריצה טיפוסית: 30-90 שניות לחנות).

### 11.5 Backfill constraints
- מינ׳ תאריך: `2026-05-01` (D-A3). enforce בקליינט (`<input type="date" min="...">`) ובשרת.
- כל cron-step ≈1-2 שניות. 21 ימים × 3 חנויות ≈ 380 step.run (פחות מ-1% ממכסת Inngest).
- אין rate limiting. שמור על טווחים סבירים (עד 30 ימים × 3).

---

## 12. Reset Data (Phase 05.7.1)

### 12.1 שני המצבים
| מצב | טוקן | טבלאות שיימחקו | נשמר |
|---|---|---|---|
| איפוס מלא | `YES-DELETE-ALL-DATA` | data_daily, products_daily, campaigns_daily, ads_daily, orders_attribution, product_catalog, manual_overrides | — |
| איפוס חלקי | `YES-DELETE-EXCEPT-MANUAL` | אותן 6 ראשונות | `manual_overrides` |

### 12.2 Protected tables
`stores`, `notification_config`, `dashboard_state` — לעולם לא נמחקות.

### 12.3 Implementation
```typescript
for (const table of tables) {
  await sb.from(table)
    .delete({ count: 'exact' })
    .not('store_id', 'is', null);  // always-true filter, supabase-js requires one
}
```

ה-filter `store_id IS NOT NULL` תמיד אמת — כל 7 הטבלאות יש להן עמודת `store_id NOT NULL`.

### 12.4 Defense-in-depth
- UI מבקש הקלדה ידנית של הטוקן.
- ה-route מאמת את הטוקן מחדש לפני DELETE. בלי טוקן נכון → 400 בלי לגעת ב-Postgres.

### 12.5 Recovery sequence
לאחר full reset: הרץ `import-manual-overrides.ts` (אופציונלי) → Backfill על הטווח הרצוי דרך `/operator`.

---

## 13. RPC / Read paths

### 13.1 קובץ
`dashboard-web/src/lib/postgresReaders.ts` — מכיל את כל ה-readers (`fetchDailyDataPostgres`, `fetchCampaignsPostgres`, etc).

### 13.2 ISR
`/api/campaigns/route.ts` משתמש ב-`export const revalidate = 60`. דאטה רענון אחת ל-60 שניות.

### 13.2.1 Client cache strategy — `no-store` fetchers + silent auto-refresh (2026-06-02)
**Problem:** on mobile the dashboard would serve stale numbers no matter how often the user refreshed — only fully closing/reopening the tab (or desktop `Cmd+Shift+R`) helped. Two causes: (1) the client fetchers used the browser's *default* cache mode, so mobile browsers served an old cached `/api/*` response; (2) SWR's `revalidateOnFocus` is unreliable on mobile because backgrounded JS is frozen, so the focus revalidation often never fired.

**Fix (two layers):**
- **`lib/fetchJson.ts`** — single helper doing `fetch(url, { cache: 'no-store' })` + JSON parse + error normalization. The three primary Dashboard fetchers (`/api/data`, `/api/orders-attribution`, `/api/campaigns`) route through it; every *other* client SWR GET fetcher across the app (~18 files: GoalTracker, MonthlyTables, ProductsTable, CampaignsTable, AdsDrawer, campaign-drawer, ActivityFeed, BillingSettings, InsightsBoard, etc.) had `{ cache: 'no-store' }` added inline. `no-store` only bypasses the **browser's** cache; the Vercel CDN still serves its `s-maxage`-fresh copy (≤60s), so origin load is unchanged. Server-side fetchers (`lib/fetchers/*`, e.g. `fx.ts`) are intentionally left as-is.
- **`lib/hooks/useAutoRefresh.ts`** — mounted once in `Dashboard`. On a fixed interval (Dashboard passes **60s**) AND on every `visibilitychange→visible` (return-to-tab / mobile reopen — fires reliably where SWR focus does not) Dashboard calls the global SWR `mutate(() => true)`, revalidating **all** keys. The latest callback is held in a ref so a changing closure doesn't tear down the interval/listener.
  - **View-reset fix (2026-06-05):** the call MUST be the single-arg `mutate(() => true)` — **NOT** `mutate(() => true, undefined, { revalidate: true })`. The 3-arg form (data=`undefined`, populateCache default true) makes SWR synchronously `set({data: undefined})` on every key BEFORE the refetch resolves, so `!data`-gated tabs/components unmount→remount and the operator's scroll / open drawer / sub-view RESET. Single-arg mutate (predicate only, &lt;3 args) takes SWR's background-revalidate path — keeps the previous data on screen, updates in place. Same fix applied to BOTH manual-refresh paths (`useDashboardRefresh.ts` "רענן הכל" + `app/operator/OperatorRefreshButton.tsx`).

The manual "רענן הכל" button (`useDashboardRefresh.ts`) additionally triggers the backend `sync-now` cron and uses a `_t=` query-buster to defeat the CDN; it now uses the same in-place `mutate(() => true)`.

### 13.2.2 Sort-header alignment + stable customer nCAC (2026-06-05)
- **Numeric column alignment** — the sort-headers (`SortHeader` CampaignsTable, `AdSetSortHeader` AdSetTable, `AdSortHeader` AdsDrawer) render the sort arrow BEFORE the label for `align==='end'` columns (label-first for start/center). The inactive `ArrowUpDown` is `opacity-0` but still occupies layout; with the Button's `justify-end` it pushed the header label ~12px inboard of the `text-end` numeric body cells. Arrow-first makes the label the flush end-element, aligned with the numbers. (NOT `.metric-cell`/container-type — ruled out by repro.)
- **Stable Customers-tab nCAC** — `customersBlendedNcac` (Dashboard) is computed over a STABLE window = full spend-history (`SPEND_HISTORY_FLOOR='2026-05-01'`..today) via two range-independent SWR fetches, NOT `filtered.curAgg.spend` (the short selected range) — so it no longer bounces ($32↔$53) and matches the all-history LTV. Helper `computeStableNcac` in `lib/home/newCustomerMetrics.ts` (numerator+denominator over the same May+ window, mapping-aware). The Home/hero nCAC stays range-specific (unchanged).

### 13.3 ה-Sheets path
- `dashboard-web/src/lib/sheets.ts` עוד קיים אבל לא נקרא מ-route handlers (tree-shake out from bundle).
- `isAllowedStateKey` נשאר ב-`sheets.ts` בשימוש כ-validator ב-`/api/dashboard-state`.
- `featureFlags.ts` נשאר כ-safety net אבל לא בשימוש.

### 13.4 Previous-period dual fetch (HeroOverview)
`/api/data` is range-filtered server-side (`fetchDailyDataFromPostgres({ range })`) — `data.rows` only contains rows for the CURRENT range. To compute previous-period deltas the hero strip uses a **second SWR fetch** keyed on `previousRange(filters.range)` and aggregates that response separately. Same pattern as the existing dual `/api/campaigns` fetch that powers the CPM delta. Filtering current-range rows by previous-range dates always returns `[]` and silently zeros every delta — that bug was the source of the always-stable hero sentence before 2026-05-26.

### 13.5 Live CPM (Phase 13.8 — 2026-05-26)
The TodayLive card (היום — חי) computes CPM from `data_daily.fb/ga/tt_impressions` rather than from `campaigns_daily`. cron-live's light fetchers — Meta `level=account` + `?fields=spend,impressions`, Google GAQL `SELECT metrics.cost_micros, metrics.impressions FROM customer`, TikTok `data_level=AUCTION_ADVERTISER` with `metrics=["spend","impressions"]` — now return impressions alongside spend in the same single API call, and the persist step writes them to data_daily on every ~10-min tick. Before this phase the LIVE CPM widget read from `campaigns_daily`, but cron-live writes only enrollment placeholder rows to that table (no metric columns), so the widget rendered "—" all day long until the overnight cron-daily run repopulated impressions per campaign. The data_daily columns are nullable; rows that pre-date the migration coerce to `null` in the reader and the renderer treats `null` like "no data yet" (renders "—") to avoid dividing by zero.

---

## 14. Refund handling (Phase 05.2.3.0)

### 14.1 Refund-day attribution
החזרים נספרים ביום `refund.processed_at` (Asia/Jerusalem TZ), לא ביום ההזמנה המקורית.

### 14.2 Source-of-truth field
- **משתמשים**: `order.total_price` (קבוע במטבע הזמנה, לא משתנה אחרי החזר).
- **לא משתמשים**: `order.current_total_price` (חי — משתנה כשהחזר נכנס) — זה היה הבאג לפני 05.2.3.0.
- **חל גם על `orders_attribution.totalCad`**: גם הפטשר של `fetchShopifyOrdersAttribution` חייב לקרוא `total_price`, לא `current_total_price`. שימוש ב-`current_total_price` כאן יגרום לכך שסכומי ייחוס היסטוריים יצטמצמו בכל פעם שיופעל cron מחדש (P0-2, תוקן 2026-05-28).

### 14.3 Deduction field
**משתמשים**: `refund_line_items[].subtotal` (סחורה במטבע הזמנה). Shopify משתמש בזה פנימית לחישוב `current_total_price`.

**לא משתמשים**: `refund.transactions[].amount` — רץ פי 2-4 מסכום אמיתי בגלל FX + duplicate-refunds artifacts.

### 14.4 New columns (`data_daily`)
- `gross_revenue_cad` — Σ `total_price` של הזמנות מאותו יום (לפני החזרים).
- `refund_deduction_cad` — Σ `refund_line_items[].subtotal` של החזרים שעובדו באותו יום (חיובי).
- אינווריאנט: `revenue_cad = gross_revenue_cad − refund_deduction_cad`.
- שתי העמודות nullable — שורות לפני המיגרציה ימשיכו להציג רק `revenue_cad`.

### 14.5 הכנסה שלילית מותרת (D-D3)
יום שבו החזרים על הזמנות ישנות > מכירות חדשות → revenue_cad שלילי. **לא Math.max(0, ...) בשום מקום בקוד**. תיעוד-של-עיצוב, לא באג.

### 14.6 Validation
מול Shopify Admin > Reports > **Net sales** (לא Gross/Total). פערים מותרים: עד ±0.50 CAD ביום ועד 5 CAD ב-30 ימים, בשל עיגול ו-FX.

### 14.7 Reconciliation gap: `data_daily.revenue` vs `Σ products_daily.netRevenue` (A4-01 / P1-3)

**Expected semantic divergence — not a bug.**

`data_daily.revenue_cad` (= `storeNetCad`) deducts ALL `refund_line_items[].subtotal` from store-level gross, including line items where `product_id` is null or missing (custom items, manual adjustments, service charges). These null-product-id refunds cannot be attributed to any product bucket.

`Σ products_daily.netRevenue` across a (date, store) is built from `byProduct[pid].netRevenueCad` — only line items with a valid product_id are tracked per-product. Null-pid refunds flow into the diagnostic-only `customItemRefundCad` field and are NOT subtracted from any product bucket.

**Consequence:**
```
Σ products_daily.netRevenue  =  data_daily.revenue_cad + customItemRefundCad
```
The gap equals `customItemRefundCad`, which at uzoshop can range from $1,500 to $5,400 per day depending on manual refund activity. This is internally consistent: both values are correct for their respective definitions; they simply measure different things.

**INV-9 (audit harness):** The reconciliation check in `reconcile.ts` compares these two figures and may fire when `customItemRefundCad > 0`. This is a known, expected gap. See the INV-9 comment in `audit/reconcile.ts` for the annotation.

**A4-05 corollary:** `products_daily.grossRevenue == netRevenue` for a given product on a given day is CORRECT whenever all refunds that day had null product_ids (custom items). In that case, the product itself had no refund deduction — its net equals its gross. The refund appears only in `data_daily.revenue` (store-level) via `customItemRefundCad`. This is not a writer bug.

### 14.8 Surfaces (Phase: refund-visibility UX — 2026-05-28)

The cross-day-refund algorithm has been correct since Phase 05.2.3.0, but until
this phase the operator could only see the result on Detail / Monthly tables
via `RefundIndicator`. The refund-visibility UX adds three additional surfaces,
all reading the already-exposed `DailyRow.refundDeduction` + `grossRevenue`:

- **`HeroOverview.tsx`** — amber chip below the revenue tile when ≥1 heavy-refund
  day exists in the selected range; story-sentence clause when any refunds exist
  at all.
- **`RoasChart.tsx`** — amber ring drawn around the line's dot on heavy-refund
  dates; tooltip body extended with the refund total for that date.
- **`PnLBreakdown.tsx`** — new "החזרים בתקופה" cascade row between revenue (now
  labelled `הכנסות (נטו)`) and ad-spend, presentational only (`running=null`
  renders an em-dash in the "נשאר" column so the cascade contract is preserved);
  running total is unchanged.

Single threshold (`refundDeduction ≥ 20% × grossRevenue` OR `≥ $500`) lives in
`src/lib/refundDayHeuristic.ts` to keep the three surfaces in lockstep.

---

## 15. Frontend stacking & z-index ladder

ב-Phase 05.7.x (2026-05-22) ארגנו מחדש כדי למנוע overlap של table headers על TabNav / Header.

| Layer | z-index | קומפוננטה |
|---|---|---|
| Modals / Drawers | 50-70 | CampaignDrawer, AdsDrawer, ProductPickerModal, AIReportButton modal |
| Sync Indicator dropdown | 40 | SyncIndicator chip |
| Header (sticky) | 30 | `<header>` בכל עמוד |
| TabNav (sticky) | 20 | TabNav |
| Table thead (sticky) | 5 | כל `<thead>` של טבלאות |
| Row body | 0-1 | `<tr>` רגיל |

**Backdrop-filter** יוצר stacking context — חשוב שלא נשתמש בו על קומפוננטים שהם child של sticky header.

---

## 16. Cloud Sync (Phase 05.4+)

### 16.1 מנגנון
`dashboard-web/src/lib/cloudSync.ts:pushCloudKey(key, value)` שולח POST ל-`/api/dashboard-state` שכותב ל-`dashboard_state` (JSONB).

### 16.2 Keys מסונכרנים
| localStorage key | Cloud? |
|---|---|
| `roas:billing:recurring` | ✅ |
| `roas:billing:oneTime` | ✅ |
| `roas:campaign-optimized` | ✅ |
| `roas:campaign-product-map` | ✅ |
| `roas:annotations` | ✅ |
| `roas:insights-states` | ✅ |
| `roas:goal` | ✅ |
| `roas:productMapChipHidden` | ❌ (per-device) |
| `roas:campaigns:columnPrefs` (visibility + order) | ✅ |
| `roas-dashboard:cogs-settings` (אחוז COGS לעריכה) | ✅ (תוקן 2026-06-02) |
| `roas-dashboard:salary-settings` (משכורות %/סכום לעריכה) | ✅ (2026-06-02) |
| `roas-dashboard:goal-settings` (יעד חודשי פר-חודש, `byMonth`) | ✅ (2026-06-02) |

### 16.3 Read pattern
ב-mount, הקומפוננטה קוראת מ-localStorage. ברקע, `useCloudSync` מבקש את ה-server value וממזג. השרת תמיד win על קונפליקט (אחרון-כותב, סינגל-משתמש מבטיח שאין race).

### 16.4 Client/server state-key parity (guard, 2026-06-02)
מפתח מסונכרן חי ב-**שתי רשימות שחייבות להסכים**: הלקוח `cloudSync.ts:STATE_KEYS` (מה נשלח), והשרת `dashboardStateKeys.ts:ALLOWED_STATE_KEYS` (ה-allowlist ש-`/api/dashboard-state` POST מאמת — מפתח לא-ברשימה מקבל **400 "unknown key"** ולא נכתב). הן לא יכולות לחלוק מערך אחד כי `cloudSync.ts` הוא browser-side (`window`/`localStorage`) וייבוא שלו לתוך ה-server bundle היה גורר client-only refs.

**באג שתוקן (2026-06-02):** `cogs-settings` היה ב-`STATE_KEYS` (הלקוח דחף) אבל **חסר** מ-`ALLOWED_STATE_KEYS` → כל שמירת COGS קיבלה 400 ונשארה מקומית-למכשיר. תוקן בהוספת המפתח ל-allowlist. כדי שזה לא יישנה, `src/lib/__tests__/stateKeysParity.test.ts` אוכף **שוויון-קבוצות דו-כיווני** בין שתי הרשימות (אחרי הסרת תחילית `roas-dashboard:`). **כל מפתח מסונכרן חדש חייב להתווסף לשתי הרשימות, אחרת ה-guard נכשל.** (ה-`OPERATOR_SECRET` בכוונה אינו מסונכרן — קרדנציאל אבטחה מקומי-למכשיר.) **עודכן 2026-06-02:** מפתח `salary-settings` (פיצ'ר המשכורות) נוסף לשתי הרשימות — ה-guard נשאר ירוק. **עודכן 2026-06-02:** מפתח `goal-settings` (יעד-חודשי פר-חודש) נוסף לשתי הרשימות גם הוא — ה-guard נשאר ירוק. (המפתח הישן `monthly-revenue-goal` נשאר ב-`STATE_KEYS` ל-hydrate תאימות-לאחור בלבד; `lib/goalSettings.ts` קורא אותו למיגרציה ל-`goal-settings` ולא נכתב יותר ע״י ה-UI.)

---

## 17. Tests

### 17.1 Test runner
vitest. ריצה: `cd dashboard-web && npx vitest run`.

### 17.2 Coverage highlights
| קובץ | תכלית |
|---|---|
| `campaignHealthScore.test.ts` | 39 tests — כל הרכיבים, gate, scenarios |
| `analyzeAttribution.test.ts` | trust score / coverage thresholds |
| `cpmRoasAnalysis.test.ts` | half-over-half + previous-period |
| `campaignsAggregator.test.ts` | drilldown aggregation |
| `operatorReset.test.ts` | 15 tests — token validation + table list |
| `shopifyRevenueRefunds.test.ts` | refund-day attribution + `total_price` vs `current_total_price` |
| `postgresReaders.test.ts` | shape + filtering of all readers |
| `featureFlags.test.ts` | runtime evaluation of READ_FROM (legacy — kept as safety) |

### 17.3 Snapshot tests
`dashboard-web/src/lib/fetchers/__tests__/snapshots/sheets-baseline-*.json` — מצב של מספרי Sheets לטווח. בשימוש לפני 05.7 ל-algorithm-parity. החל מ-05.7 לא חיוני (קוד Sheets לא רץ ב-runtime) אבל נשמר.

### 17.4 שיווק
- **אסור localhost** — verification חייבת ל-PROD URL (memory rule).
- אסור skip של hooks (`--no-verify`) ללא הסכמת משתמש.

---

## 18. Backfill internals

### 18.1 Endpoint
`POST /api/operator/backfill` → Inngest `event/backfill`.

### 18.2 Inngest function
`event-backfill` ב-`dashboard-web/src/inngest/functions/backfill.ts`. Loops על `(date, storeId)` pairs. כל step:
- `fetchShopifyForDay(storeId, date)`
- `fetchMetaForDay(storeId, date)`
- `fetchGoogleForDay(storeId, date)`
- `fetchTikTokForDay(storeId, date)` (uzoshop only)
- `upsert` ל-data_daily / campaigns_daily / ads_daily / products_daily / orders_attribution.

### 18.3 Idempotency
כל write הוא `ON CONFLICT (...) DO UPDATE`. ניתן להריץ אותו טווח שוב ושוב — אין duplicate.

### 18.4 Rollover
Backfill דורס שלוש העמודות של `data_daily` (revenue + gross + refund) בכל ריצה. שורות ישנות עם `gross/refund = null` יתמלאו אחרי backfill.

### 18.5 מגבלות
- מינ׳ `2026-05-01` (D-A3) — לפני זה אין נתונים זמינים בכלל מ-API-ים.
- אין rate limiting אקטיבי. שמור על טווחים סבירים.

---

## 19. Smoke tests (post-deploy)

חייב לרוץ מול PROD, **לא** localhost (memory rule).

```bash
PROD=https://roas-dashboard-smoky.vercel.app

# /operator loads
curl -s "$PROD/operator" | grep -q "ניהול" && echo "OK: /operator"

# Inngest registered
curl -s "$PROD/api/inngest" | jq '.functions | length'  # expect 8 (+3 whatsapp)

# Jobs proxy shape
curl -s "$PROD/api/operator/jobs?limit=10" | jq -e '.runs' >/dev/null && echo "OK: /api/operator/jobs"

# Sync-now triggers
curl -s -X POST "$PROD/api/operator/sync-now" \
  -H "Content-Type: application/json" -d '{"scope":"all"}' \
  | jq -e '.accepted == 3' && echo "OK: /api/operator/sync-now"

# manual_overrides ≥ 38 rows (after import script)
curl -s "$PROD/api/operator/manual-overrides" | jq -e '.rows | length >= 38'

# Backfill accepts 1 store
curl -s -X POST "$PROD/api/operator/backfill" \
  -H "Content-Type: application/json" \
  -d '{"from":"2026-05-15","to":"2026-05-15","storeIds":["uzoshop"]}' \
  | jq -e '.accepted == 1' && echo "OK: /api/operator/backfill"

# /api/data returns rows
curl -s "$PROD/api/data" | jq -e '.rows' >/dev/null && echo "OK: /api/data"

# Inngest dashboard manual check: https://app.inngest.com — 8 + 3 functions registered
```

לאחר Sheets cutover (Phase 05.7):
```bash
# /api/health no longer pings Sheets
curl -s "$PROD/api/health" | jq '.'
# Expected: { "sheets": "ok", "supabase": "ok|down", ... }
# שדה sheets קבוע 'ok' — backward-compat ל-SyncIndicator.

# dashboard-state POST → Supabase
curl -s -X POST "$PROD/api/dashboard-state" \
  -H "Content-Type: application/json" \
  -d '{"key":"annotations","value":{"test_post_57":"ok"}}' \
  | jq -e '.ok == true' && echo "OK: dashboard-state POST"
```

---

## 20. Phase log (highlights)

קצר מאוד — לסקירה מלאה: `.planning/phases/`.

| Phase | מה השתנה |
|---|---|
| **04.x** | Sheets-only pipeline + Apps Script triggers. ה-Dashboard קורא מ-Sheets. |
| **05.2.2.1** | FIX-01: `source=''` (classifier failure) לא נחשב Organic. |
| **05.2.3.0** | Refund-day attribution: `total_price` במקום `current_total_price`, ייחוס ביום `processed_at`, חוזה החזרים מאומת על 3/3 חנויות. |
| **05.4** | Cloud Sync דרך `dashboard_state`. |
| **05.5** | מיגרציה ראשונה ל-Supabase Postgres (10 tables seed). `/api/health` ping מקבילי Sheets+Supabase. |
| **05.6** | Inngest cron functions × 8 רצים במקביל ל-Apps Script (לא dual-write — שתי מערכות עצמאיות). `/operator` console. דגל `READ_FROM` רדום. |
| **05.7** | Cut-over: כל route קורא **רק** מ-Postgres. `READ_FROM` מוסר. `/api/health` רק Supabase. CI workflow `deploy-gs.yml` נמחק. Apps Script triggers נשארים אם המפעיל לא מבטל ידנית. |
| **05.7.1** | Reset Data באמצעות `/operator > ניקוי וריסט`. |
| **05.7.2** | Daily Budget מ-Meta `/campaigns` + `/adsets` (agorot → ILS → CAD). |
| **05.7.3** | Open-ended Window B ב-`shopify.ts:buildWindowUrl` — תופס החזרים עם `updated_at` שדחף את עצמו קדימה. |
| **05.7.4** | WhatsApp Cloud cron × 3 (12:00/18:00/00:10). תחליף ל-Apps Script `Notifications.gs`. |
| **05.7.5** | TikTok-paid bucket ב-`orders_attribution` + `data_daily.tt_spend_cad`. |
| **05.7.7** | TikTok ads spend per campaign/ad — `ads_daily.platform='tiktok'`. |
| **05.7.8** | `orders_attribution` rolling refresh ב-cron-live. |
| **05.7.9** | TikTok product-mapping (cross-platform key `(storeId, platform, campaignId)`). Refresh button removed. |
| **05.7.x** | Stacking z-index ladder. Styled column tooltips. Campaign Health Score (unified 0-100 grade). off-chip ↔ real `effective_status`. 5 sortable Shopify columns. Column reorder. TodayLive ROAS gradient. WhatsApp CPM. AI Report v3. Y-axis labels. Trust chip retired. |
| **05.7.x** | Migration `20260522180000_add_campaigns_daily_effective_status.sql`: `campaigns_daily.effective_status TEXT`. |
| **05.7.x** | Migration `20260522102151_add_tiktok_platform_check.sql`: `platform` check accepts `'tiktok'` על ads_daily / campaigns_daily / manual_overrides. |

---

## 21. Env vars reference (Vercel)

| מפתח | scope | תוכן |
|---|---|---|
| `SUPABASE_URL` | Production + Preview | `https://npegxufdupooqovrewyb.supabase.co` |
| `SUPABASE_ANON_KEY` | Production + Preview | Anon (client-readable) |
| `SUPABASE_SERVICE_ROLE_KEY` | Production + Preview (Encrypted, server-only) | service_role (DML) |
| `INNGEST_EVENT_KEY` | אוטומטי דרך marketplace | event ingest |
| `INNGEST_SIGNING_KEY` | אוטומטי דרך marketplace | webhook verify |
| `SPREADSHEET_ID` | legacy — לא בשימוש מאז 05.7 | Sheets workbook ID |
| `GOOGLE_CLIENT_EMAIL` / `GOOGLE_PRIVATE_KEY` | legacy | Service Account (Sheets) |
| `OPENEXCHANGERATES_APP_ID` | Production | FX provider |
| `UZOSHOP_SHOPIFY_ACCESS_TOKEN` / `UZOSHOP_SHOPIFY_DOMAIN` | Production | Shopify per-store |
| `UZOSHOP_META_ACCESS_TOKEN` / `UZOSHOP_META_AD_ACCOUNT_ID` | Production | Meta per-store |
| `UZOSHOP_GOOGLE_ADS_CUSTOMER_ID` / `UZOSHOP_GOOGLE_ADS_REFRESH_TOKEN` | Production | Google Ads per-store |
| `GOOGLE_ADS_DEVELOPER_TOKEN` | Production | Google Ads global |
| `UZOSHOP_TIKTOK_ACCESS_TOKEN` / `UZOSHOP_TIKTOK_ADVERTISER_ID` | Production | TikTok (uzoshop only) |
| `WHATSAPP_PHONE_NUMBER_ID` / `WHATSAPP_ACCESS_TOKEN` | Production | WhatsApp Cloud |
| `READ_FROM` | legacy — לא נקרא מאז 05.7 | feature flag (sheets/postgres) |

(אותן 3 משולשות גם ל-zolplus + usmile360.)

---

## 22. קבצי קוד מרכזיים

```
dashboard-web/
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── data/route.ts             — daily totals
│   │   │   ├── campaigns/route.ts        — campaign rows + effective_status
│   │   │   ├── ads/route.ts              — ad-level (Meta)
│   │   │   ├── products/route.ts         — product rows
│   │   │   ├── orders-attribution/route.ts — orders + source/utm/click-id
│   │   │   ├── dashboard-state/route.ts  — cloud sync read/write
│   │   │   ├── health/route.ts           — supabase ping
│   │   │   ├── inngest/route.ts          — Inngest serve()
│   │   │   └── operator/
│   │   │       ├── sync-now/route.ts
│   │   │       ├── jobs/route.ts         — Inngest REST proxy
│   │   │       ├── backfill/route.ts
│   │   │       ├── manual-overrides/route.ts
│   │   │       ├── reset/route.ts
│   │   │       └── whatsapp/send-now/route.ts
│   │   └── operator/page.tsx             — Operator Console UI
│   ├── components/
│   │   ├── CampaignsTable.tsx
│   │   ├── CampaignsTableRow.tsx         — isCampaignOff helper
│   │   ├── CampaignDrawer.tsx
│   │   ├── HealthScoreBadge.tsx
│   │   ├── HealthScorePanel.tsx
│   │   ├── AiReportButton.tsx
│   │   ├── TodayLive.tsx                 — ROAS-band gradient
│   │   ├── SyncIndicator.tsx
│   │   └── ColumnsMenu.tsx               — visibility + reorder
│   ├── lib/
│   │   ├── postgresReaders.ts            — all reads from Supabase
│   │   ├── sheets.ts                     — legacy (kept for isAllowedStateKey)
│   │   ├── featureFlags.ts               — legacy
│   │   ├── fetchers/
│   │   │   ├── meta.ts
│   │   │   ├── googleAds.ts
│   │   │   ├── tiktok.ts                 — incl. fetchTikTokAdGroupStatuses
│   │   │   ├── shopify.ts                — buildWindowUrl (Window B fix)
│   │   │   └── fx.ts
│   │   ├── notifications/
│   │   │   ├── summary.ts                — buildStoreSummary + CPM
│   │   │   ├── templateParams.ts         — buildTemplateParameters + formatCpm
│   │   │   └── sendDailySummary.ts
│   │   ├── campaignHealthScore.ts        — pure compute fn
│   │   ├── analyzeAttribution.ts         — trust score
│   │   ├── cpmRoasAnalysis.ts            — half-over-half / prev-period
│   │   ├── aiReport.ts                   — generateAiReport
│   │   ├── campaignProductMap.ts         — allocateProductRevenue (per-platform)
│   │   ├── campaignsColumnPrefs.ts       — visibility + order helpers
│   │   └── cloudSync.ts                  — pushCloudKey
│   └── inngest/
│       └── functions/
│           ├── cronDaily.ts              — per-store factory
│           ├── cronLive.ts               — per-store factory
│           ├── syncNow.ts
│           ├── backfill.ts
│           └── whatsapp.ts               — 3 cron + 1 event
├── supabase/
│   └── migrations/                       — 20260521*.sql + 20260522*.sql
└── scripts/
    ├── import-manual-overrides.ts        — one-off Sheets → Supabase
    └── capture-snapshot.ts               — Sheets baseline for parity tests
```

---

## 23. תוספות עתידיות — מקומות נוגעים

- **Real-time effective_status** (Phase TBD): כתיבת effective_status גם ב-cron-live (לא רק cron-daily) ל-15-min freshness.
- **TikTok על 360usmile + zolplus**: הוספת env vars + הפעלת fetcher (כיום `uzoshop` only).
- **Ad-level analysis ב-AI report**: דרישה לצרוך מ-`ads_daily` (קיים, רק לקרוא + לעבד).
- **Snapchat / Klaviyo attribution**: יצריך bucket חדש ב-`orders_attribution.source` enum.
- **Multi-user / Auth**: יצריך RLS על כל 10 הטבלאות + Supabase Auth + policies. כיום אין צורך (URL-obscurity מספיק).

---

## 23.5 API Parameter Contract (P1-2, 2026-05-27)

### Date parameters (?from / ?to)
All telemetry routes (`/api/data`, `/api/campaigns`, `/api/products`,
`/api/ads`, `/api/orders-attribution`) require both `?from=YYYY-MM-DD`
and `?to=YYYY-MM-DD`. Since 2026-05-28, `parseRangeParams` throws
`RangeParamError` (→ HTTP 400) when **both** params are absent, instead
of silently returning the 90-day default. A request with misnamed params
(e.g. `?range.from=`) now receives HTTP 400, making the error visible.

Client-side safety: `buildDateRangeKey` returns `null` when either date
is missing, so SWR never fires a request without both params. All SPA
call sites always emit a full `?from=…&to=…` pair.

### Store filtering (?store=)
`?store=` is intentionally **not parsed on the server** for `/api/data`
and `/api/orders-attribution`. These routes return **all stores** for the
date range; the client slices by store after receiving the full dataset.
Rationale:
- The "All Stores" aggregate needs cross-store totals computed server-side.
- Attribution analysis requires cross-store context.
- Server-side store filtering would require cache-busting per store, multiplying ISR slots.

Other routes (`/api/campaigns`, `/api/products`, `/api/ads`) DO accept
`?store=` for per-store scoping (see their respective route handlers).

---

## 24. קישורים חשובים

- **Production**: `https://roas-dashboard-smoky.vercel.app`
- **Operator**: `https://roas-dashboard-smoky.vercel.app/operator`
- **Inngest Dashboard**: `https://app.inngest.com`
- **Supabase Dashboard**: `https://supabase.com/dashboard/project/npegxufdupooqovrewyb`
- **Repo**: `https://github.com/dor77777-prog/script-roas`
- **Vercel Project**: `roas-dashboard-smoky`
- **GSD docs (planning)**: `.planning/phases/`

---

## 25. Freshness Redesign — Phase A (2026-05-29)

מענה ישיר לבעיית הייצור של `cron_live_heavy_rate_limit` panic WhatsApp — Meta BUC נגמרה ב-cron-live-heavy ושלחה התראה מיידית במקום קוד שדילג מראש. Phase A מניח את התשתית; Phases B-E יבנו עליה רישומי entity, hot-metrics, ו-rolling reconcile.

**ספק מקור:** [`docs/superpowers/specs/2026-05-29-freshness-contract-incremental-sync-design.md`](superpowers/specs/2026-05-29-freshness-contract-incremental-sync-design.md). תוכנית מקור: [`docs/superpowers/plans/2026-05-29-freshness-redesign-phase-a.md`](superpowers/plans/2026-05-29-freshness-redesign-phase-a.md).

### 25.1 חוזה ה-Freshness (per-scope)

לכל משטח דשבורד יש SLA מפורש לטריות:
- **KPI store-level (Hero, TodayLive, GoalTracker)**: live ≤ 10 דק׳ → reconciled (00:05+) → finalized
- **Campaign / Adset / Ad status**: live ≤ 10 דק׳ דרך registry (Phase B) → reconciled → finalized
- **Hot campaign/adset/ad metrics**: live ≤ 10 דק׳ (`source='live_tick'`) → reconciled (`source='daily_reconcile'`) → finalized
- **Cold metrics**: provisional מ-reconcile האחרון → reconciled → finalized
- **Products with activity today**: live ≤ 10 דק׳ (Phase D)
- **`/operator` failed reconcile**: surfaced תוך 30 דק׳ מכשל cron-daily

כשלא ניתן לעמוד ב-SLA, ה-UI מציג "stale: Meta budget" / "stale: token error" + last-fresh timestamp במקום נתון שיקרי-טרי.

### 25.2 ה-3 טבלאות החדשות

#### `meta_buc_usage` (per-(store, ad_account_id))
טרקר חיים של Meta `x-business-use-case-usage` headers. PK מרכבת `(store_id, ad_account_id)` כדי לאפשר ad-accounts מרובים לאותו store בעתיד ללא שינוי schema. כתיבה: `recordMetaBucUsage` ב-`lib/notifications/metaBucUsage.ts` נקראת מ-`fetchMeta` אחרי כל קריאה. קריאה: `getMetaBucUsageForStore(storeId)` מחזירה MAX לכל 6 ה-pct fields חוצה ad_accounts (worker חונק על ה-account הכי גרוע — pessimistic but correct).

#### `data_freshness` (per-(store, platform, scope, table_name))
ledger לכל scope של freshness. כל cron tick קורא ל-`recordFreshness({storeId, platform, scope, tableName, status, errorCode?, errorMessage?, budgetSkip?})` ב-`lib/inngest/freshness.ts` כדי לתעד את התוצאה. `getFreshness(scope?)` מחזיר את כל השורות ממויינים לפי `lag_minutes DESC NULLS LAST` (תואם ל-partial index). statuses: `success`, `transient_error`, `auth_error`, `budget_skip`, `parse_error`.

#### Provenance columns על 4 טבלאות יומיות
מיגרציה `20260530100002_add_finalization_columns.sql` הוסיפה ל-`data_daily`, `campaigns_daily`, `ads_daily`, `products_daily`:
- `source text NOT NULL DEFAULT 'live_tick'` — `live_tick` / `daily_reconcile` / `weekly_reconcile` / `backfill` / `manual_override`
- `reconciled_at timestamptz` — חתימת זמן של cron-daily
- `is_finalized boolean NOT NULL DEFAULT false`
- `last_live_tick_at timestamptz`

Backfill `20260530100003`: כל שורה קודמת ל-`CURRENT_DATE - 1` סומנה `source='daily_reconcile'` + `is_finalized=true`, כך שה-UI של Phase D מקבל היסטוריה מסומנת נכון מהיום הראשון.

### 25.3 `fetchMeta` — wrapper עם defensive header parser

`lib/fetchers/fetchMeta.ts` (Phase A — 2026-05-29) עוטף את `fetchWithBackoff` לכל קריאות Meta. הוא:

1. קורא ל-`fetchWithBackoff(url, init, { provider: 'meta' })` כרגיל.
2. בודק את ה-Response headers במאגר עדיפות: `x-business-use-case-usage` (preferred — per-BUC per-account) → `x-fb-ads-insights-throttle` (alternative for insights) → `x-app-usage` (app-wide fallback).
3. אם אף אחד לא מזוהה — שולח Sentry warning עם כל ה-headers הגולמיים (Phase A.6 follow-up אם יופיע shape רביעי).
4. ממשיך את ה-snapshot ל-`meta_buc_usage` דרך `recordMetaBucUsage` (fire-and-forget).
5. אם relevant pct (לפי URL pattern: `/insights` → `ads_insights`, else → `ads_management`) ≥ 80 — זורק `MetaBudgetHighError` עם הודעה שמתחילה ב-`META_BUDGET_HIGH:`.

הזריקה הזו זמינה ל-callers לקטוף ולנתב ל-budget_skip operation במקום rate_limit operation.

ה-6 קריאות הקיימות ב-`lib/fetchers/meta.ts` הוחלפו ל-`fetchMeta` (Task 9). שום אזור אחר בקוד לא קורא ישירות ל-`fetchWithBackoff` עבור Meta.

### 25.4 Pre-flight Meta budget gate

`cron-live-heavy` ו-`cron-daily` בודקים `getMetaBucUsageForStore(storeId)` בתחילת כל סבב. אם MAX(insights pct) ≥ 80% AND `last_updated_at` בתוך 15 דק׳ אחרונות — Meta fetch block מקצר; Google + TikTok + Shopify ממשיכים. הדילוג מתועד ב-3 דרכים:

- `failures.push({ provider: 'meta', errorMsg: 'META_BUDGET_HIGH: pre-flight skip; ...' })` שלאחר מכן ה-handler מנתב ל-`notifyTokenFailure({ operation: 'cron_*_budget_skip', ... })`
- `recordFreshness` לכל Meta scope (`campaign_metrics`, `adset_metrics`, `ad_metrics`) עם `status: 'budget_skip'`
- ב-`/operator` שני ה-panels מציגים את המצב

`detectAuthError.isRateLimitError` (`lib/notifications/detectAuthError.ts`) הוסיפה את ה-substring `meta_budget_high` ל-meta branch כדי שה-classifier נשאר נכון לכל caller.

`tokenFailures.notifyTokenFailure` (`lib/notifications/tokenFailures.ts`) הוסיפה gate: כש-`operation` תואם `/_budget_skip$/`, היא רושמת ב-DB אבל מדלגת על שליחת WhatsApp. `last_alert_sent_at` עדיין מתעדכן בכל ניסיון (שומר על invariant d/CR-09).

### 25.5 Cron stagger

`cron-live-heavy`: לפני Phase A, כל 3 ה-stores רצו ב-`*/30 * * * *` (כולם ב-:00 ו-:30 יחד). אחרי Phase A:
- `uzoshop`: `0,30 * * * *`
- `zolplus`: `10,40 * * * *`
- `usmile360`: `20,50 * * * *`

10 דק׳ של "Meta breathing room" בין ticks אחים מקטינים את הסיכוי שsupplit shared-app רייט-לימיט יתפוצץ.

`cron-live` (`*/10`) ו-`cron-daily` (`5 0 * * *`) נשארו זהים.

### 25.6 source/is_finalized/last_live_tick_at semantics

- **cron-live** כותב `last_live_tick_at: now()` בכל upsert של `data_daily` + `products_daily`. **לא** כותב `source` (נשאר default `live_tick`) ולא `is_finalized` (נשאר default false).
- **persistCampaignsLive** (נקרא מ-cron-live-heavy) כותב `last_live_tick_at: now()` בכל upsert של `campaigns_daily` + `ads_daily`. אותה גישה — defaults עושות את העבודה ל-`source` + `is_finalized`.
- **cron-daily** כותב **שלושה השדות** בכל אחד מ-6 ה-upsert sites (data_daily, products_daily, ads_daily, campaigns_daily ×3 פלטפורמות): `source: 'daily_reconcile'`, `is_finalized: true`, `reconciled_at: <single-tick-timestamp>`. כל 6 הקריאות באותו סבב משתמשות באותו `reconciledAt` ל-auditability.

מה ש-Phase D יקרא:
- `is_finalized=true` → reconciled/authoritative
- `is_finalized=false` AND `last_live_tick_at` בתוך 10 דק׳ → live/fresh
- `is_finalized=false` AND `last_live_tick_at` ישן יותר → live/stale (cron-live פספס תור)

### 25.7 Refund preservation invariant

האלגוריתם של Phase 05.2.3.0 נשמר ללא שינוי: `shopifyRevenueRefunds.computeRevenueWithCrossDayRefunds` מצמיד refund ל-`processed_at` day, פעם אחת, ללא cross-day filter. משמע: שורת `data_daily` של אתמול לא משתנה אחרי `is_finalized=true`. ה-3-day rolling window של cron-live הוא ל-order-side mutations (eventual consistency של Shopify analytics, edge cases של תשלום) — לא refund mutations.

Trade-off: סוחר ש-רוצה "כמה היום הזה שווה באמת" cohort analytics לא יכול לקבל את זה מ-`data_daily`. זה ייבנה מ-`orders_attribution` (טבלה נפרדת, לא finalization-tracked).

### 25.8 `/operator` panels

שני server components חדשים ב-`src/components/operator/`:

- **`MetaBucPanel.tsx`** — קורא `meta_buc_usage` ישירות (server-side), מציג כרטיס לכל (store, ad_account_id) עם 6 progress bars (3 metrics × 2 BUCs) ו-ETA badge כש-`estimated_time_to_regain_access > 0`. צבעים מ-OKLCH tokens: `bg-status-red` ≥80%, `bg-status-orange` ≥60%, `bg-status-green` אחרת.
- **`FreshnessPanel.tsx`** — קורא `data_freshness` דרך `getFreshness()`, מציג מטריקס ממויין לפי `lag_minutes DESC`. אייקוני סטטוס מ-lucide-react (CheckCircle2/AlertCircle/XCircle) בעקבות הקונבנציה של `TokenFailuresTable`.

ה-2 mounted ב-`operator/page.tsx` בין `TokenFailuresTable` ל-`JobsTable`. ה-page קיבל `export const dynamic = 'force-dynamic'` כדי שהרענון יחזיר נתונים טריים.

### 25.9 חוזה ה-Shopify scopes (תוספת ל-§5.1)

Phase A הבהיר את 3 ה-scopes הנפרדים של Shopify (יוצרים שניהם דרך `lib/fetchers/shopify.ts` אבל ברצוי שונה):

| Scope | Cadence | Window | Writes | Phase |
|---|---|---|---|---|
| **KPI / orders / refunds live** | `*/10` | rolling today + today-1 + today-2 | `data_daily` (`source='live_tick'`, `is_finalized=false`, `last_live_tick_at=now()`) | A (קוד כבר באוויר; Task 14 רק הוסיף את `last_live_tick_at`) |
| **Hot products live** | `*/10` (worker חדש) | products with orders today + revenue today + mapped to active campaigns + top-50 7-day revenue | `products_daily` (`source='live_tick'`, `is_finalized=false`, `last_live_tick_at=now()`) | **D** (deferred — Phase A הוסיף רק את העמודות) |
| **Daily reconcile** | `00:05` | yesterday (full re-fetch) | `data_daily` + `products_daily` (`source='daily_reconcile'`, `is_finalized=true`, `reconciled_at=now()`) | A (Task 13) |

### 25.10 Phase A acceptance + הסטוריה

הוקצה ב-16 משימות (Tasks 0-15 + Task 16 לפריסה). Tasks 0-3 (Pre-Phase A spike של real header capture) **דולגו** בהחלטת operator 2026-05-29 לטובת defensive parser ב-Task 8 שמטפל בכל 3 צורות ה-headers המתועדות. כל 13 ה-Tasks הנותרים נחתו ב-13 commits נפרדים על main. push לייצור: 2026-05-29.

**מה לא ב-Phase A** (Phases B-E):
- `campaign_registry` / `adset_registry` / `ad_registry` / `campaign_status_events` / `cron_tick_snapshots` (Phase B)
- `cron-tick-orchestrator` + workers (Phase B)
- Hot metrics SQL + decommission cron-live-heavy (Phase C)
- Hot products live worker + dashboard live/reconciled UI (Phase D)
- Rolling reconcile T-2/T-3/T-7..T-14 (Phase E)

### 25.11 Campaign↔Store mapping (Phase A.5 — 2026-05-29)

TikTok runs a single advertiser (`UZOSHOP_TIKTOK_ADVERTISER_ID`) שמשרת כיום שתי חנויות פיזיות — uzoshop + usmile360. המודל הישן (`STORES_WITH_TIKTOK = {'uzoshop'}`) הכריח כל row TikTok ל-bucket `store_id='uzoshop'`, ולכן הדשבורד הציג את ההכנסה + ההוצאה של usmile360 כאילו היו של uzoshop.

**Storage:** JSONB ב-`dashboard_state` תחת key `'campaign-store-map'`. Shape: `{ "<platform>::<advertiser_id>::<campaign_id>": "<store_id>" }`. אותו תבנית כמו `campaign-product-map` — `pushCloudKey` מ-localStorage → API → Supabase; `window` event broadcast לסנכרון cross-component.

**Helpers:**
- [`lib/campaignStoreMap.ts`](../dashboard-web/src/lib/campaignStoreMap.ts) — client-side: `readCampaignStoreMap()` / `writeCampaignStoreMap(map)` / `resolveStoreForCampaign(map, platform, advertiserId, campaignId, default)` / `campaignStoreKey(platform, advertiserId, campaignId)`.
- [`lib/inngest/campaignStoreMap.ts`](../dashboard-web/src/lib/inngest/campaignStoreMap.ts) — server-side: `loadCampaignStoreMapFromSupabase()` — קוראת ישירות מ-Supabase ל-cron handlers (אין להם גישה ל-localStorage).

**Data flow per cron tick:**

1. **Fetcher** ([`fetchTikTokAdInsights`](../dashboard-web/src/lib/fetchers/tiktok.ts)) — אחרי שמושך rows מ-`/report/integrated/get/`, קורא ל-`loadCampaignStoreMapFromSupabase` ומצרף `storeId` לכל row דרך `resolveStoreForCampaign(map, 'tiktok', advertiserId, campaignId, storeId-arg-as-fallback)`. **שינוי טייפ additive:** `TikTokAdRow.storeId: string` עכשיו required (היה משתמע כ-storeId-arg).
2. **Persister** ([`persistCampaignsLive`](../dashboard-web/src/lib/inngest/persistCampaignsLive.ts)) — TikTok rows ב-`campaigns_daily` + `ads_daily` עכשיו מקבלים `store_id: row.storeId ?? storeId` (fallback ל-arg כשהrow לא נושא value). Meta + Google נשארו `store_id: storeId-arg` (1:1 ולא צריך mapping).
3. **Aggregator** — פונקציית Postgres חדשה [`agg_tiktok_spend_per_store_for_date(d)`](../supabase/migrations/20260530120000_add_tt_spend_agg_function.sql) רצה ב-2 מעברים:
   - **Pass 1:** `UPDATE data_daily.tt_spend_cad = SUM(campaigns_daily.spend_cad)` per (date, store_id) WHERE platform='tiktok'. בלי זה — `tt_spend_cad` נשאר בערך הישן של `ttSpendCad-arg`.
   - **Pass 2:** Recompute של `total_spend_cad` + `roas` + `gross_profit_cad` + `net_profit_cad` לכל row באותו תאריך. בלי המעבר הזה — 4 עמודות-תלויות נשארות בערך upsert-time (שחושב מ-`ttSpendCad` הישן) והטבלאות החודשיות מראות "סך הוצאות פרסום" שגוי ל-usmile360.
   - שני callers משתמשים באותה פונקציה: `cron-daily` (אחרי TikTok upsert) ו-`persistCampaignsLive` (בסוף הפונקציה, אחרי upserts של campaigns_daily + ads_daily). הקריאה מ-`persistCampaignsLive` מבטיחה שטיק חי של cron-live-heavy מעדכן את `data_daily` של היום מיידית — לא רק אחרי cron-daily של למחרת.
4. **UI** ([`CampaignDrawer`](../dashboard-web/src/components/CampaignDrawer.tsx)) — סקציית **"🏪 חנות בעלת הקמפיין"** ב-drawer (גלויה רק כש-`summary.platform === 'TikTok'`), מעל סקציית "מוצרי Shopify משויכים". ה-drawer מחשב `effectiveStoreId = storeMap[key] ?? storeId-prop` (לTikTok בלבד) ומשתמש בו כ-`storeId` עבור ProductPickerModal + `setMappedProducts` + lookup של `mappedIds` — כך ש-"תייג חנות → תייג מוצרים" עובד באותו session, לא צריך לחכות 30 דק׳ לcron-live-heavy. שאר הפאנלים ב-drawer (Health Score, attribution, cohort) ממשיכים להציג נתונים של ה-storeId המקורי עד שcron-live-heavy יכתוב מחדש; חיווי כתום מודיע על מצב הביניים. ה-advertiser ID נשלף מ-`adAccounts[storeId].tiktokAdvertiserId` (כבר prop קיים).

**הערה היסטורית:** הגרסה הראשונה של Phase A.5 (commit `fee0e9b`) הוסיפה את ה-UI כעמודת טבלה ב-CampaignsTable. ב-feedback מהאופרטור 2026-05-29: "column-tagging זה anti-pattern" — מוזז ל-CampaignDrawer במקום זאת (commit `f17c7ee`). ה-CampaignsTable column הוסר.

**Hotfix `e2b17f3` (2026-05-29):** הגרסה הראשונה של ה-drawer-section שלחה את ה-dropdown במצב disabled כי `AdAccountMap` לא נשא את `tiktokAdvertiserId`. תוקן: `StoreMetaRow` הורחב עם `tiktokAdvertiserId: string | null` (הreader נשאר טהור — מחזיר null). `/api/store-meta` route מעשיר כל row מ-`process.env[\`${storeId.toUpperCase()}_TIKTOK_ADVERTISER_ID\`]?.trim() || null`. ה-CampaignsTable AdAccountMap מעביר את הערך הלאה. ה-route נבחן ע"י 5 unit tests חדשים: happy path, trim whitespace, empty → null, all other fields verbatim, error → 200 empty rows.

**🔥 ROLLBACK 2026-05-29 (אחר הצהריים) — Phase A.5 הוסר מהייצור.** הסיבה: ה-PK של `campaigns_daily` כולל את `store_id` (`(date, store_id, platform, campaign_id, ad_set_id)`), אז כשpersistCampaignsLive החל לכתוב TikTok rows תחת ה-store_id הממופה החדש, השורה הישנה תחת uzoshop **לא נמחקה** — שתי השורות co-existed. ה-RPC `agg_tiktok_spend_per_store_for_date` סוכם את שתיהן ל-data_daily → ה-spend הוכפל בייצור. נמחקו ידנית 2 שורות campaigns_daily + 12 שורות ads_daily + reset של 2 שורות data_daily + מחיקת `campaign-store-map` מ-`dashboard_state`. ה-code path: persistCampaignsLive חזר ל-`store_id: storeId` (arg, לא row); ה-RPC call הוסר מ-cronDaily ומ-persistCampaignsLive; ה-Store dropdown ב-CampaignDrawer הוסר; ה-`effectiveStoreId`/`effectiveStoreName` הוסרו. **ה-SQL function עוד קיים** ב-migration `20260530120000_add_tt_spend_agg_function.sql` (dormant — לא נקרא). **Helpers + allowlist נשארו** dormant (`lib/campaignStoreMap.ts`, server reader, dashboardStateKeys entry).

**Phase A.5 v2 דרישות עיצוב:** הPK של `campaigns_daily` חייב להשתנות ל-`(date, platform, campaign_id, ad_set_id)` ללא store_id (עם store_id כעמודה רגילה), או persistCampaignsLive חייב לבצע DELETE-then-UPSERT לכל מעבר store_id. צריך migration plan לשמירת היסטוריה של 5-7 חודשים.

**Phase A.5 v2 SHIPPED 2026-05-29.** The duplicate-row bug is fixed at the persist layer (Tasks 3 + 4 in the v2 plan): every TikTok UPSERT batch is preceded by a `DELETE FROM campaigns_daily/ads_daily WHERE store_id NOT IN (target_stores) AND campaign_id|ad_id IN (rows_being_written)`. This guarantees the campaigns_daily PK `(date, store_id, platform, campaign_id, ad_set_id)` has exactly one row per `(date, platform, campaign_id, ad_set_id)` — the store_id column becomes effectively a "current attribution" tag rather than a discriminator. The SQL function `agg_tiktok_spend_per_store_for_date` (migration `20260530120000`) is re-enabled and recomputes `data_daily.tt_spend_cad` + 4 dependents per store from the now-clean campaigns_daily slices.

**UI restored (CampaignDrawer):** the "🏪 חנות בעלת הקמפיין" section, `effectiveStoreId` resolution, `effectiveStoreName` from a 3-store display-name map, product-map migration on store change. Acceptance test [`persistCampaignsLiveRetagFlowV2.test.ts`](../dashboard-web/src/lib/inngest/__tests__/persistCampaignsLiveRetagFlowV2.test.ts) simulates tag → re-tag → re-tag and asserts campaigns_daily ends with exactly one row each time.

**Plan reference:** [`docs/superpowers/plans/2026-05-29-phase-a5-v2-campaign-store-mapping.md`](superpowers/plans/2026-05-29-phase-a5-v2-campaign-store-mapping.md).

**Evening hotfix #4 (2026-05-29) — duplication of tt_spend_cad cross-stores:** the agg RPC `agg_tiktok_spend_per_store_for_date` only UPDATED data_daily rows whose (date, store_id) appeared in the campaigns_daily subquery. Stores that LOST their TikTok activity (campaign tagged away) were skipped, leaving stale historical values → SUM across stores double-counted. Fixed in migration `20260530200000_fix_tt_spend_agg_zero_pass.sql`: Pass 1a now zeros tt_spend_cad for ALL data_daily rows of `d` before the aggregation UPDATE. cron-live ALSO contributed to the duplication: it overwrote data_daily.tt_spend_cad every 10 min with the storeId-arg's full TikTok spend (no mapping awareness). Fix: cron-live OMITs tt_spend_cad + tt_impressions + total_spend_cad from the data_daily payload (ON CONFLICT preserves the agg-RPC-set value). Trade-off: Live CPM for TikTok updates every 30 min (cron-live-heavy interval) instead of 10 min — acceptable per Phase 13.8's existing accuracy-vs-freshness trade-off contract.

**Historical attribution:** Rows ב-`campaigns_daily` / `ads_daily` שנכתבו לפני 2026-05-29 נשארים תחת `store_id='uzoshop'` עד שהמפעיל מריץ את [`scripts/backfillTikTokMapping.ts --apply`](../dashboard-web/scripts/backfillTikTokMapping.ts) (ראה evening hotfix #7 למטה). ה-`/operator` מציג chip תזכורת מעל פאנל ה-Meta BUC. ההיסטוריה תקינה תחת המודל הישן (כל ה-spend באמת מ-advertiser uzoshop); רק החלוקה ל-store_id האמיתי שונה במודל החדש.

**MonthlyTables behavior:** הקומפוננטה [`MonthlyTables.tsx`](../dashboard-web/src/components/MonthlyTables.tsx) כבר עם `hasTt = rows.some(r => (r.ttSpend ?? 0) > 0)` — עמודת TikTok נחשפת אוטומטית כשrow כלשהו בחנות/חודש מקבל ערך > 0. סיכומי החודש (`totalTt`, `totalSpend`) משתמשים ב-`r.ttSpend` + `r.totalSpend` מ-`data_daily`, שעדכנו עכשיו דרך ה-RPC. שום שינוי לא נדרש ב-MonthlyTables עצמה.

**Cron-live's data_daily writes:** [`cronLive.ts:614-615`](../dashboard-web/src/inngest/functions/cronLive.ts) ממשיכה לכתוב `tt_spend_cad` + `total_spend_cad` בריצה החיה, אבל היא משתמשת ב-`spendOverride` (sourced מ-cron-live-heavy). אחרי שcron-live-heavy סיים את batch ה-persists, ה-RPC משכתב את הערכים האלה לערך הנכון (per-store). יש חלון של עד 30 דקות בין tick של cron-live-heavy שבו ה-data_daily עשוי להציג ערך לא מסונכרן — מקובל ל-MVP.

**Evening hotfix #6 (2026-05-29 night) — TikTok CPM stuck at "—" everywhere:** hotfix #4's cron-live OMIT pattern dropped `tt_impressions` alongside `tt_spend_cad` on the assumption that the agg RPC would write both. The original RPC (migration `20260530120000`) and its zero-pass successor (`20260530200000`) only touched `tt_spend_cad`, never `tt_impressions` — so the impressions column stayed at 0 / NULL and every CPM rendered as "—". Fixed in migration [`20260530220000_agg_tt_impressions.sql`](../supabase/migrations/20260530220000_agg_tt_impressions.sql): Pass 1a zeros both columns; Pass 1b sums both from campaigns_daily per `(date, store_id)` with `SUM(impressions)::bigint` matching the data_daily column type. Validated on prod: 29/05 usmile360 tt_impressions=15,579, CPM=$2.88.

**Evening hotfix #7 (2026-05-29 night) — historical campaigns_daily / ads_daily store_id leakage:** persistCampaignsLive's DELETE-then-UPSERT only fires for the `dateStr` being persisted (today / yesterday). When a TikTok campaign that ran for several days is moved to a new store via the campaign-store-map, only today + yesterday's rows get the new store_id. Older rows remain under the pre-mapping store_id. Worse, if TikTok stops returning the campaign for older dates after the move (paused, zero spend), the DELETE never reaches those historical rows AT ALL — so even days inside the rolling 2-day window can leak. Net effect: `agg_tiktok_spend_per_store_for_date` sums historical rows under the OLD store_id AND newer rows under the NEW store_id → both data_daily totals show the same spend → double-counting in monthly tables.

**Fix:** new pure helpers in [`src/lib/backfill/tiktokMapping.ts`](../dashboard-web/src/lib/backfill/tiktokMapping.ts) (`extractTikTokMappingSteps` + `classifyStaleRows`) + runner script [`dashboard-web/scripts/backfillTikTokMapping.ts`](../dashboard-web/scripts/backfillTikTokMapping.ts). The runner reads `dashboard_state.campaign-store-map`, finds stale `campaigns_daily` / `ads_daily` rows whose `store_id != mapped_store_id`, and classifies each:
- `toDelete` — a target-store row already exists at the same `(date, ad_set_id|ad_id)`. UPDATE-to-target would violate the PK; DELETE the stale duplicate.
- `toUpdate` — no target counterpart. Safe to move the row's `store_id`.

After per-row execution, the runner re-runs `agg_tiktok_spend_per_store_for_date` for every affected date so data_daily reflects the corrected per-store attribution. Supports `--dry-run` (default) and `--apply`. First production run (2026-05-29 night): 4 campaigns_daily rows + 10 ads_daily rows deleted, 2 dates re-aggregated. Operator runs the script ad-hoc after each material mapping change to a multi-day campaign.

**Defense-in-depth in the aggregator:** [`campaignsAggregator.ts`](../dashboard-web/src/lib/campaignsAggregator.ts) now accepts two optional params (`effectiveStoreByCampaignId` + `storeDisplayNames`). When supplied, the aggregator swaps a row's `storeId` and `storeName` to the operator-mapped target BEFORE computing the dedup key — so historical rows still under the pre-mapping store collapse with newer rows under the target store into ONE aggregate entry. Currently unwired from CampaignsTable.tsx (the existing `effectiveStoreByRowKey` overlay handles display swap only; the post-backfill DB state means the aggregator and overlay paths converge to the same result). Reserved for the window between an operator mapping change and the next backfill run.

**Out of scope:**
- Backfill היסטורי (rejected explicit).
- Pixel-based auto-detection (revisit אחרי חודש אם operator מתלונן).
- אותה מנגנון ל-Meta / Google (כיום הם 1:1; ה-helpers generic-keyed ולכן הוספה עתידית תהיה 1-2 שורות).

## Phase B (2026-05-30) — Registries + Meta status discovery (backend-only)

Phase B introduces the new persistent layer for entity status, decoupled from `campaigns_daily`'s spend-per-day shape. Five new tables + a 10-minute `cron-tick-orchestrator` + a `meta-worker` Inngest function that consumes orchestrator events and writes registries / status events.

**New tables** (migration `20260530230000_phase_b_registries.sql`):
- `campaign_registry` / `adset_registry` / `ad_registry` — one row per entity, perpetual. PK `(store_id, platform, entity_id)`. 4 timestamps per row distinguish observation vs status-change vs platform-edit cadence.
- `campaign_status_events` — append-only audit log. `dedupe_key` is a STORED generated column bucketing `occurred_at` to the minute so flapping observations near review-state edges coalesce.
- `cron_tick_snapshots` — one row per orchestrator run, keyed by 10-min-floored `tick_id`.

**Inngest functions:**
- [`cron-tick-orchestrator`](../dashboard-web/src/inngest/functions/cronTickOrchestrator.ts) — `*/10 * * * *`. Reads `data_freshness` + `meta_buc_usage`, fans out `meta/job.requested` events via the dynamic-threshold strategy below, writes a snapshot row. **Step layout** (Phase B hotfix 2026-05-30): three flat top-level `step.*` calls — `step.run('compute-events')` → `step.sendEvent('fan-out', ...)` → `step.run('snapshot')`. `step.sendEvent` is intentionally NOT nested inside a `step.run` because Inngest forbids nested step calls and the nested form hangs the Vercel runtime to the 60s timeout (no snapshot row written). The pure `runTickOnce` helper is retained for unit tests but no longer invoked by the Inngest wrapper.
- [`meta-worker`](../dashboard-web/src/inngest/functions/metaWorker.ts) — event-triggered. BUC pre-flight (Layer 1 hard gate), Meta Graph API batch fetch, diff against registries, write status events with `ON CONFLICT (dedupe_key) DO NOTHING`, upsert registries, mark `data_freshness` success for the 3 status scopes.

**Dynamic threshold strategy** — see also [`docs/superpowers/specs/2026-05-30-phase-b-registries-meta-status-design.md`](superpowers/specs/2026-05-30-phase-b-registries-meta-status-design.md) §"Dynamic threshold strategy". No static `BUC_SKIP_THRESHOLD = 80%`. Instead:
- Layer 1 (orchestrator + worker, hard gate): `eta_minutes > 0` OR `pct >= 95` → skip.
- Layer 2 (orchestrator, tiered cooldown): `pct < 30%` → 5 min; `30–60%` → 8 min; `60–80%` → 15 min; `≥80%` → skip. If Meta raises the underlying limit, observed pct drops → cooldown shortens → more calls. If Meta lowers, pct rises → cooldown extends.
- Layer 3 (Inngest): throttle `900/h` per `event.data.store_id` — safety net that should never bind under normal operation.

**Operator UI** ([`/operator`](../dashboard-web/src/app/operator/page.tsx)):
- Existing [`FreshnessPanel`](../dashboard-web/src/components/operator/FreshnessPanel.tsx) auto-picks up the new `campaign_status` / `adset_status` / `ad_status` rows in `data_freshness`. No code change.
- New [`StatusEventsFeed`](../dashboard-web/src/components/operator/StatusEventsFeed.tsx) — last 50 entries from `campaign_status_events`.
- New [`CronTickSnapshotsViewer`](../dashboard-web/src/components/operator/CronTickSnapshotsViewer.tsx) — table of last 144 ticks (24h × 6).

**Out of scope** (deferred):
- Google / TikTok / Shopify workers → Phase C / D.
- Hot-metrics scope on any worker → Phase C.
- `CampaignsTable` / `CampaignDrawer` integration with registry-based status → Phase D.
- Decommission of `cron-live-heavy` → Phase C.
- Rolling reconcile T-2..T-14 + `cron-weekly-reconcile` → Phase E.

**Acceptance (verified post-deploy):**
- `cron_tick_snapshots` accumulates rows at ~6/h.
- `campaign_registry` populated for all 3 stores' Meta campaigns within 10 min.
- `campaign_status_events` shows `first_seen` entries from the initial tick.
- `data_freshness` shows green dots (`lag_minutes < 15`) for the 3 status scopes per store.

## Phase C (2026-05-30) — Hot metrics + Google/TikTok workers (pre-decommission)

Phase C extends the orchestrator + single-platform worker pair of Phase B to all three ad platforms (Meta + Google + TikTok) and introduces a new `scope='hot_metrics'` that samples only the high-spend ("hot") entities of each store. This delivers sub-10-minute refresh on live KPIs without exhausting Meta/Google/TikTok API quotas. `cron-live-heavy` continues to run in parallel for a **3-day canary period** (decommission lands in Phase C.5).

**Spec:** [`docs/superpowers/specs/2026-05-30-phase-c-hot-metrics-design.md`](superpowers/specs/2026-05-30-phase-c-hot-metrics-design.md).
**Plan:** [`docs/superpowers/plans/2026-05-30-phase-c-hot-metrics.md`](superpowers/plans/2026-05-30-phase-c-hot-metrics.md).

**3 Postgres hot-set functions** (migration `supabase/migrations/20260530240000_phase_c_hot_set_functions.sql`):
- `get_hot_campaign_ids(store_id, platform)` / `get_hot_adset_ids(...)` / `get_hot_ad_ids(...)` — each returns the set of entity ids the workers should refresh on the current tick. 5-branch UNION: status-active ∪ recently status-changed ∪ recently first-seen ∪ activity-today ∪ yesterday-tail.

**5 new fetchers** (all in `dashboard-web/src/lib/fetchers/`):
- `fetchMetaHotMetricsForStore` — single-batch Graph Insights API call filtered by hot ids at adset + ad level.
- `fetchGoogleStatusForStore` — `change_status` GAQL query with entity follow-up.
- `fetchGoogleHotMetricsForStore` — GAQL Insights query against the hot adset/ad sets.
- `fetchTikTokStatusForStore` — TikTok Marketing API status discovery.
- `fetchTikTokHotMetricsForStore` — TikTok Insights API filtered by hot ids.

All 5 fetchers return `{adsets, ads}` — **no campaign-level rows** (CRIT-B: the `campaigns_daily` table has NOT NULL on `ad_set_id` for these granularities; campaign aggregates are derived via SQL views at read time).

**2 new Inngest workers** (registered in [`src/app/api/inngest/route.ts`](../dashboard-web/src/app/api/inngest/route.ts)):
- [`google-worker`](../dashboard-web/src/inngest/functions/googleWorker.ts) — handles `scope='status'` and `scope='hot_metrics'`.
- [`tiktok-worker`](../dashboard-web/src/inngest/functions/tiktokWorker.ts) — handles `scope='status'` and `scope='hot_metrics'`.

Both follow the same flat `step.run` pattern as Phase B's `metaWorker` (no nested step calls — Phase B hotfix lesson).

**meta-worker extended:** the existing [`meta-worker`](../dashboard-web/src/inngest/functions/metaWorker.ts) now handles `scope='hot_metrics'` in addition to the Phase B `scope='status'`. The hot_metrics branch: BUC pre-flight → resolve hot ids via the hot-set RPCs → `fetchMetaHotMetricsForStore` → upsert `campaigns_daily` (aggregated) + `adsets_daily` + `ads_daily` rows with `source='live_tick'` + `last_live_tick_at = NOW()` → mark `campaign_metrics` freshness success.

**Orchestrator fan-out:** [`cronTickOrchestrator.ts`](../dashboard-web/src/inngest/functions/cronTickOrchestrator.ts) now emits **up to 6 events per tick** = 3 platforms (meta/google/tiktok) × 2 scopes (status/hot_metrics). Per-(platform, scope) cooldown is tiered.

**Dynamic threshold cooldown tiers for `hot_metrics`:**
- `pct < 30` → 180s cooldown
- `pct 30–60` → 300s cooldown
- `pct 60–80` → 600s cooldown
- `pct ≥ 80` → skip

This adapts Meta's bucket usage automatically — when usage drops, refresh frequency rises; when Meta raises rate limits, observed pct drops → cooldown shrinks → more refreshes.

**6 critical bugs caught + fixed pre-deploy** (cross-cutting commits before Task 15):
- **CRIT-A** — `ad_set_id` schema mismatch between fetcher output and `campaigns_daily` columns.
- **CRIT-B** — Workers were upserting campaign-level rows; the destination tables enforce NOT NULL on `ad_set_id` at the granular levels. Fix: drop campaign-level rows; derive at read time.
- **CRIT-C** — Google JSON response uses camelCase, not snake_case the GAQL query string suggests. Fixed in `fetchGoogleStatusForStore` + `fetchGoogleHotMetricsForStore`.
- **CRIT-D** — Meta `omni_purchase` priority chain was incorrect for conversion-value reporting (was reading first-of-action_values; corrected to omni_purchase → omni_purchase_post_engagement → purchase priority chain).
- **CRIT-E** — Meta `account_currency` is not always USD; the fetcher was hard-coding USD and bypassing the per-account currency lookup. Fixed via reading `account.currency` from the same Insights response.
- **CRIT-F** — GAQL date literal syntax error (single vs double quotes) crashed the worker on first call.

**4 IMP items also addressed** (see commit history for `cross-cutting` tag).

**Audit reconcile script:** `npm run audit:reconcile:hot-vs-heavy` — new for Phase C.5 canary drift checks. Compares hot-metrics writes against the parallel cron-live-heavy writes for the 3-day overlap window.

**Out of scope** (deferred to Phase C.5 / D):
- `cron-live-heavy` decommission → Phase C.5 (after 3-day canary clean reconcile).
- Full UI registry-status read path (CampaignsTable + CampaignDrawer fully wired to registries instead of legacy fields) → Phase D.
- Shopify worker on the orchestrator → Phase D.

## Phase C soak fixes (2026-05-30)

Eight hours after the Phase C deploy the soak verification queries surfaced three production failures that all rendered as "empty `data_freshness` rows" in the operator panel. Root cause for each was a worker throwing **before** reaching its `recordFreshness` call.

**Findings (from production Inngest logs):**

1. **`CHANGE_DATE_RANGE_INFINITE` on Google `change_status`** — uzoshop's status-branch GAQL had only `last_change_date_time > 'X'`. Google's `change_status` resource rejects single-sided ranges. Operator panel symptom: zero `google {campaign,adset,ad}_status` rows for **all 3 stores** (uzoshop hit the query error; usmile360 + zolplus hit issue 2 below).
2. **Missing `USMILE360_GOOGLEADS_CUSTOMER_ID`** (and same for `zolplus`) — only `uzoshop` has Google Ads (per §5.3 + PROPS-MAP §3/§4). The orchestrator naively fanned out for all (store, platform, scope) combos; `safeCustomer` threw, no freshness recorded.
3. **Missing `USMILE360_TIKTOK_*`** (and same for `zolplus`) — only `uzoshop` has TikTok (per §5.4). Same fan-out / `safeAccount` throw / empty freshness pattern.

**The architectural antipattern.** Both `google-worker` and `tiktok-worker` status branches called `safeCustomer` / `safeAccount` → `fetchStatus` BEFORE any `recordFreshness` write. Any throw — invalid query, missing creds, network glitch — left `data_freshness` indistinguishable from "this store has never run". Operator couldn't tell broken from never-attempted.

**Three fixes — single shared design (one commit):**

1. **`isPlatformConfiguredForStore` gate (no-op success).** Each worker checks per-store env var presence at the **top** of the branch:
   - `isGoogleConfiguredForStore(storeId)` → `${UPPER}_GOOGLEADS_CUSTOMER_ID`.
   - `isTikTokConfiguredForStore(storeId)` → `${UPPER}_TIKTOK_ADVERTISER_ID` && `${UPPER}_TIKTOK_ACCESS_TOKEN`.

   When false, the branch records `success` freshness for every scope it owns and returns. **Why `success` and not `not_configured`:** keeps the operator panel consistent (one row per (store, platform, scope) combo, always green for tenant stores). Semantically it is correct — the worker had nothing to do *and the data is being maintained elsewhere* (uzoshop's worker, for the TikTok shared-account case; nowhere, for the Google-not-configured case where there is no data at all).

   Override hook (`isGoogleConfigured?` / `isTikTokConfigured?` on the worker input type) exists for unit tests to exercise both paths explicitly without depending on env-var presence.

2. **try/catch wrap around the main work.** Both branches in both workers now wrap the fetch + diff + upsert work. On throw they write a `transient_error` row per scope (with the truncated error message) **before** re-throwing. Re-throwing keeps Inngest's exponential-backoff retry intact; the next successful tick overwrites with `success`.

   Same pattern applies to the `hot_metrics` branches — they were previously protected only by the hot-set empty short-circuit (which happened to run before `safeCustomer`); the new explicit `isPlatformConfigured` gate + try/catch make the resilience independent of code-path ordering.

3. **CRIT-F-2 — Google `change_status` bounded range.** Added the upper bound `change_status.last_change_date_time <= '${formatGaqlDateTime(new Date())}'` to the GAQL in `fetchGoogleStatusForStore` (CRIT-F's prior fix added LIMIT + ORDER BY but missed the bounded-range requirement specific to this resource). See §5.3.

**Files touched:**

- [`dashboard-web/src/lib/fetchers/googleStatus.ts`](../dashboard-web/src/lib/fetchers/googleStatus.ts) — CRIT-F-2 bound + extended comment.
- [`dashboard-web/src/lib/fetchers/googleAccountConfig.ts`](../dashboard-web/src/lib/fetchers/googleAccountConfig.ts) — export `isGoogleConfiguredForStore`.
- [`dashboard-web/src/lib/fetchers/tiktokAccountConfig.ts`](../dashboard-web/src/lib/fetchers/tiktokAccountConfig.ts) — export `isTikTokConfiguredForStore`.
- [`dashboard-web/src/inngest/functions/googleWorker.ts`](../dashboard-web/src/inngest/functions/googleWorker.ts) — configured-gate + try/catch on both branches.
- [`dashboard-web/src/inngest/functions/tiktokWorker.ts`](../dashboard-web/src/inngest/functions/tiktokWorker.ts) — same.
- 9 new vitest cases (4 googleWorker + 4 tiktokWorker + 1 googleStatus).

**Post-fix expected `data_freshness` shape (45 rows total):**

| platform | scopes (5) | rows per scope | total |
|---|---|---|---|
| meta | campaign/adset/ad status + campaign/ad metrics | 3 (1 per store) | 15 |
| google | same | 3 — uzoshop runs the real fetch, usmile360+zolplus no-op success | 15 |
| tiktok | same | 3 — uzoshop runs the real fetch + tenant rows via the Phase A.5 v2 map; usmile360+zolplus no-op success | 15 |

The operator panel becomes a true health matrix: any red row corresponds to a real failure (`transient_error`), not "this combination is not deployed yet".

**Drawer hotfix — shared-advertiser-id resolution.** The same soak surfaced a Phase A.5 v2 bug in `CampaignDrawer.tsx`. The TikTok store-mapping section computed `const advertiserId = adAccounts[storeId]?.tiktokAdvertiserId ?? ''`. But the advertiser id is a **single shared id** that lives only under `uzoshop` in the adAccounts map (§5.4). The moment a campaign was successfully attributed to usmile360 or zolplus — exactly the success case the operator is most likely to revisit — the drawer's `storeId` prop became the tenant store, `adAccounts['usmile360'].tiktokAdvertiserId` returned `''`, the `<select disabled={!advertiserId}>` rendered grey-out, and the storeMap lookup hit the empty key → `currentValue = undefined` → the "(לא ממופה · ברירת מחדל uzoshop)" badge appeared next to campaigns the operator had already mapped. The operator could not re-map without going back to uzoshop's filter.

**Fix:** new helper [`resolveSharedTikTokAdvertiserId(accounts: AdAccountMap)`](../dashboard-web/src/lib/campaignsLinks.ts) scans every adAccount entry and returns the first non-empty `tiktokAdvertiserId`. The drawer ([CampaignDrawer.tsx:383](../dashboard-web/src/components/CampaignDrawer.tsx#L383) + [CampaignDrawer.tsx:1315](../dashboard-web/src/components/CampaignDrawer.tsx#L1315)) calls it instead of the per-store lookup. The dropdown is now enabled for every store filter as long as ANY store carries the advertiser id; the storeMap key is computed consistently from the shared id; previously-mapped campaigns render with the correct value selected; the badge appears only for genuinely unmapped campaigns.

If TikTok ever onboards multiple distinct advertisers (e.g. a per-store TikTok rebuild), the helper becomes wrong and the drawer needs a per-campaign advertiser id (probably stored on the campaign row itself). Future problem — gated behind a single function so the change is localised.

**Test coverage (Phase C soak total):**
- 5 unit tests in [`campaignsLinks.test.ts`](../dashboard-web/src/lib/__tests__/campaignsLinks.test.ts) for the resolver.
- 3 DOM regression tests in [`campaignDrawerStoreMapV2.dom.test.tsx`](../dashboard-web/src/components/__tests__/campaignDrawerStoreMapV2.dom.test.tsx) under the `shared-advertiser-id resolution` describe block — exercises the exact bug scenario (storeId='usmile360', only uzoshop has the advertiser id) and asserts dropdown enabled + mapping resolved.
- 1 GAQL bound test in [`googleStatus.test.ts`](../dashboard-web/src/lib/fetchers/__tests__/googleStatus.test.ts) asserts both `>` and `<=` operators on `last_change_date_time`.
- 4 + 4 worker tests in [`googleWorker.test.ts`](../dashboard-web/src/inngest/functions/__tests__/googleWorker.test.ts) / [`tiktokWorker.test.ts`](../dashboard-web/src/inngest/functions/__tests__/tiktokWorker.test.ts) — `isConfigured` no-op paths + try/catch `transient_error` paths.

**CRIT-G — `change_status.resource_name` is the wrong field for entity-id extraction (Phase C soak follow-up).** Once the GAQL bound + OAuth token rotation cleared, the Google status worker hit a NEW error: `BAD_NUMBER` on `WHERE campaign.id IN ('1780118362096495-5-22542818628', …)`. Root cause was in the change_status response parsing — `change_status.resource_name` returns the resource_name of the **change_status entity itself** (`customers/{cid}/changeStatus/{minute_bucket-entity_type-entity_id}`), not the changed campaign / ad_group / ad. The fetcher was splitting it on `/` and treating the composite tail as the entity_id, which Google promptly rejected at the follow-up `campaign.id IN (...)` step.

**Fix:** the GAQL now selects the typed sibling fields:
- `change_status.campaign` → resource_name of the changed campaign (when `resource_type=CAMPAIGN`)
- `change_status.ad_group` → resource_name of the changed ad_group (when `resource_type=AD_GROUP`)
- `change_status.ad_group_ad` → resource_name of the changed ad_group_ad (when `resource_type=AD_GROUP_AD`); its tail is `<adGroupId>~<adId>` so an extra `split('~').pop()` yields the ad id.

Parsing loop reads the per-type field selected by `resource_type` and applies the right split sequence. 2 new regression tests cover AD_GROUP + AD_GROUP_AD; the existing CAMPAIGN test was rewritten to use the real Google JSON shape (with `changeStatus.campaign` carrying the campaign's resource_name) so the unit suite reflects production behavior and catches this class of bug going forward.

**Audit of the same pattern on Meta + TikTok:** clean. `metaStatus.ts` reads `c.id` directly from `/campaigns?fields=id,...` Graph responses (numeric strings, no resource_name involved). `tiktokStatus.ts` reads `r.campaign_id` / `r.ad_id` directly from TikTok's `/campaign/get/` responses (same shape). The CRIT-G class is unique to Google's `change_status` log resource — Meta and TikTok don't expose a change-log API of this kind, so their status discovery hits campaigns/adsets/ads directly.

**Open follow-up:** the `meta-worker` should adopt the same `isConfigured` + try/catch shape for symmetry (Meta has per-store accounts for all 3 stores today, so the antipattern is dormant — but a future store onboarding could hit it). Tracked separately.

## Phase D — Registry-Status Cutover (2026-05-30)

The dashboard now reads campaign / adset / ad **status** from the 3
registries written by the Phase B/C orchestrator (≤10 min refresh)
instead of from `effective_status` on the 3 `*_daily` tables (~30 min
refresh via `cron-live-heavy`).

### What changed
- **3 SQL migrations** added under `supabase/migrations/`:
  - `20260530250000_phase_d_backfill_registries.sql` — one-time backfill,
    idempotent, `ON CONFLICT DO NOTHING`. Sources `campaign_registry` +
    `adset_registry` from `campaigns_daily` (ad-set-granular per its PK).
    Sources `ad_registry` keys-only from `ads_daily` (no `effective_status`
    column on `ads_daily` to derive from).
  - `20260530260000_phase_d_auto_coverage_triggers.sql` — 2 `AFTER INSERT`
    triggers (one on `campaigns_daily` that seeds both campaign + adset
    registries; one on `ads_daily` for keys-only ad_registry).
  - `20260530270000_phase_d_enriched_views.sql` — `campaigns_enriched`
    / `adsets_enriched` / `ads_enriched` `LEFT JOIN` views.
- **postgresReaders.ts** — `fetchCampaignsFromPostgres` /
  `fetchAdsFromPostgres` select from the enriched views; `CampaignRow` /
  `AdRow` carry 6 `reg*` fields. `fetchCurrentCampaignStatuses` rebuilt
  to read `campaign_registry` directly (was: 60-day scan of
  `campaigns_daily`).
- **statusClassification.ts** (`lib/registries/`) — single source of
  truth for the (`regDeliveryStatus` × fallback chain) → {label, tone,
  isOff, isBackfillUnknown} mapping. Consumed by `CampaignsTableRow`
  (chip) + `CampaignDrawerStatusSection` (panel). `tiktokStatusSets.ts`
  re-exports `TIKTOK_ACTIVE_ENOUGH` from `platformConfig.ts` (single
  source for "TT statuses we treat as ON") + owns `TIKTOK_OFF_STATUSES`
  locally.
- **CampaignDrawerStatusSection** expanded from "minimal" (Phase C) to
  "full": 3 status chips side-by-side (configured / effective /
  delivery), BACKFILL_UNKNOWN explainer paragraph, 3-event timeline
  (first_seen → status_changed → last_status_success → last_live_tick).
- **ProductCentricView** + **CohortComparisonPanel** swap to `reg*`
  fields with legacy fallback. ProductCentricView's `isActive` check
  treats `UNKNOWN` as fall-through (matches `classifyCampaignStatus`).

### What didn't change
Writers (cronDaily / cronLive / metaWorker / googleWorker / tiktokWorker)
continue writing to `*_daily` and registries exactly as before. The
cutover is read-side only.

Shopify pipeline (revenue / orders / refunds / catalog) untouched —
Phase D is status-only and does not modify `data_daily`,
`orders_attribution`, `products_daily`, or the `cronLive.ts` Shopify
fetcher branch.

### Sentinel
`configured_status = 'BACKFILL_UNKNOWN'` marks rows that the backfill
seeded from daily data alone (i.e. no platform-native operator-set value
has been observed yet). The next status-scope worker tick (~10 min)
replaces it with the real platform value. The UI surfaces a small
"⏳ טוען מ-Platform" chip and an explainer block while the sentinel
is active.

### Coverage parity test
`registryCoverageParity.live.test.ts` (AUDIT_LIVE=1) asserts every
distinct `(store, platform, entity_id)` in the dailies has a matching
registry row. Adset tuples sourced from `campaigns_daily` (which is
ad-set-granular per its PK), not from a non-existent `adsets_daily`.

### Rollback
Revert the frontend / postgresReaders commits. The DB layer
(VIEWs + triggers + backfilled rows) stays in place — it harms nothing
while idle and lets us roll forward instantly. See spec §6.

### Phase D soak fix (2026-05-30) — close-out structural patches
After the initial deploy, 4 registry rows stayed at the
`BACKFILL_UNKNOWN` sentinel beyond the expected 1–2 worker-cycle
window. Root-cause analysis showed three distinct issues no amount of
additional polling would resolve. Three changes landed to close Phase D:

1. **One-shot cleanup migration**
   (`20260530290000_phase_d_soak_cleanup_stuck_unknown_rows.sql`).
   Idempotent: `DELETE` 2 TikTok cross-attribution duplicates and
   `UPDATE configured_status = effective_status` for 2 worker-
   unreachable rows. After apply, all 3 platforms drop to 0%
   `BACKFILL_UNKNOWN`.

2. **Google fetcher BACKFILL_UNKNOWN sweep**
   (`googleStatus.ts:GoogleStatusInput.extraCampaignIds`,
   `googleWorker.ts:runGoogleStatusBranch`). The Google Ads
   `change_status` resource only surfaces campaigns that changed in the
   last 24h, so a long-stable ENABLED campaign was never re-fetched and
   stayed at the sentinel forever. The worker now derives the set of
   stale ids from the prior registry (`configured_status === 'BACKFILL_UNKNOWN'`)
   and passes them to the fetcher as `extraCampaignIds`, which merges
   them into the existing follow-up `SELECT campaign.id, …` query. Every
   tick with any stale rows performs a one-shot refresh.

3. **TikTok worker stale-attribution registry DELETE**
   (`tiktokWorker.ts:runTikTokStatusBranch + Inngest binding`). The
   TikTok ad account belongs to uzoshop but individual campaigns can be
   mapped to other stores via the Phase A.5 v2 `campaign-store-map`.
   When the resolved store changes (e.g. uzoshop → usmile360), the new
   upsert writes `(tiktok, usmile360, X)` but the prior
   `(tiktok, uzoshop, X)` row stays — the upsert PK includes store_id,
   no conflict. The worker now mirrors the same DELETE-then-UPSERT
   pattern `persistCampaignsLive` already uses for `campaigns_daily`:
   after the campaign_registry upsert, DELETE any
   `(platform='tiktok', campaign_id IN fresh_set, store_id NOT IN fresh_target_set)`
   rows. Soft-fail on DELETE error — the upsert already succeeded; the
   next tick retries.

Scope deferred: adset/ad-level cleanup is out of scope for the close-
out patch; revisit when Phase E2 adds ad-level status workers.

### Phase D soak fix #2 (2026-05-30) — cron-live omits TikTok enrollment
Re-running the coverage parity harness after the first soak fix exposed
a separate upstream bug: `cron-live`'s "active ad-set enrollment"
UPSERT was writing TikTok placeholder rows to `campaigns_daily` under
the function-arg `storeId` (= the cron iteration's store, usually
`uzoshop`) without consulting `campaign-store-map`. This created a
fresh `(tiktok, uzoshop, X)` row for every cron-live tick on every
TikTok campaign mapped to a non-uzoshop store, which (a) violated
coverage parity once the matching registry row was DELETEd, and (b)
re-seeded the same kind of cross-attribution duplicates that the
Phase A.5 v2 backfill had cleaned.

Fix: `cron-live` now filters out `platform === 'tiktok'` from
`activeEnrollments` before the UPSERT, mirroring the principle from
Phase A.5 v2 ("cron-live omits tt" for the same reason it omits spend
aggregation). TikTok enrollment placeholders continue to be written by
`cron-live-heavy` (every 30 min, via `persistCampaignsLive` which
applies the per-row map) and the Phase C `tiktokWorker` hot_metrics
branch (every 10 min). The UPDATE step #3 in `cron-live` still applies
to all platforms including TikTok because it only modifies
`effective_status` on EXISTING rows — it cannot create mis-attributed
placeholder rows.

Tradeoff acknowledged: a newly-active TikTok ad-set will not appear
in `campaigns_daily` until the next cron-live-heavy tick (≤30 min)
instead of the next cron-live tick (≤1 min). This is consistent with
the existing TikTok spend latency and acceptable for the single-
operator internal-tool use case.

Companion data fix: migration `20260530300000` DELETE'd today's two
stale `(tiktok, uzoshop, …)` rows so coverage parity restored
immediately rather than waiting for ambient cleanup.

## Phase E1 — Decommission `cron-live-heavy` (2026-05-30)

The 3 per-store `cron-live-heavy` Inngest functions are no longer
registered (`cronLiveHeavyFunctions = []`). `cron-tick-orchestrator`
(every 10 min) is the single source of live truth for `campaigns_daily`
+ `ads_daily` metric refreshes via the hot_metrics worker branches in
`metaWorker` / `googleWorker` / `tiktokWorker`.

### What moved
- **Token-failure WhatsApp alerts** (auth/rate errors): cron-live-heavy
  fired these per provider per store per date with operation keys
  `cron_live_heavy_rate_limit` / `cron_live_heavy_auth`. After E1, the
  3 hot_metrics worker branches fire equivalents with NEW operation
  keys (`meta_hot_metrics_rate_limit`, `google_hot_metrics_auth`,
  `tiktok_hot_metrics_rate_limit`, etc.). Status branches stay alert-
  free (they only `recordFreshness('transient_error')` to surface in
  /operator — WhatsApp on every status hiccup would be noise).
- **Meta BUC pre-flight gate**: the metaWorker hot_metrics branch
  already had the gate but did NOT fire a WhatsApp on `budget_skip`.
  E1 adds the suppressed-WhatsApp call (`meta_hot_metrics_budget_skip`
  operation) so the operator sees BUC throttling on `/operator` and
  gets a DB notification record without the panic ping.

### What stays
- `cronLiveHeavy.ts` source — `runHeavyForStore` + `makeCronLiveHeavy`
  remain in the file for: (a) existing vitest fixtures that drive
  `runHeavyForStore` directly via dynamic import; (b) git-revert
  rollback if a coverage gap surfaces in soak.
- `persistCampaignsLive.ts` source — `cron-daily` (nightly authoritative
  run) still calls it. No change.
- `agg_tiktok_spend_per_store_for_date` RPC — still useful for
  cron-daily.

### Why now
The Phase C reconcile harness `audit:reconcile:hot-vs-heavy` proved
parity for hot_metrics writes. Phase D's coverage parity + 0%
BACKFILL_UNKNOWN snapshot proved stable status ingestion. Per user
2026-05-30, the scope-memo's "~1 week soak" prereq was waived.

### Savings
- Frees 3 Inngest function slots (cron-live-heavy was 3 staggered
  per-store crons).
- ~30% reduction in cron API load — cron-live-heavy was the heaviest
  per-tick burden (full per-platform insights fetch every 30 min).
- Freshness improves: `campaigns_daily.last_live_tick_at` updates
  every ≤10 min instead of every ≤30 min.

### Rollback
`git revert` the E1 commits + push. Vercel redeploys in 3-5 min.
cron-live-heavy returns to service on next Inngest sync. Self-healing:
the next cron-live-heavy tick writes the same campaigns_daily rows
hot_metrics was writing — no data loss.

## Phase E1.5 — cron-live → Shopify-only + per-worker enrollment + cron-yesterday-refresh (2026-05-30)

E1.5 expands the cleanup beyond cron-live-heavy:

### cron-live stripped to Shopify-only
The original 05.6 design intent (`cron-live` header lines 1-50) was
"refresh Shopify revenue on a 3-day rolling window every 10 min — Meta
+ Google Ads are NOT refreshed on the live cadence". Over time, status
fetches + enrollment placeholders accreted into the same function. With
the orchestrator + workers now owning all platform discovery, those
accretions are removed:

- Deleted ~285 lines of `step.run('refresh-effective-status', …)` —
  fetched Meta budgets + Google ad-group statuses + TikTok ad-group
  statuses, built an enrollments list, UPSERTed placeholders, and
  UPDATEd historical `effective_status`.
- Deleted the 3 `fetchMetaBudgets` / `fetchGoogleAdsAdGroupStatuses`
  / `fetchTikTokAdGroupStatuses` import sites (no longer used by
  cron-live).
- Kept: `fetch-shopify-rolling-3day` + `persist-rolling-3day`. The
  remaining shape matches the original "Shopify-only on live" design.

### Per-worker placeholder enrollment
The 3 status workers (`runMetaStatusBranch`, `runGoogleStatusBranch`,
`runTikTokStatusBranch`) now also UPSERT placeholder rows into
`campaigns_daily` for any ACTIVE ad-set after their registry upserts:

- Meta: `effective_status === 'ACTIVE'`.
- Google: `effective_status === 'ENABLED'`.
- TikTok: any of the 5 `TIKTOK_ACTIVE_STATUSES`
  (`ADGROUP_STATUS_DELIVERY_OK`, `BUDGET_EXCEED`, `AUDIT`,
  `REVIEWING`, `NOT_START`).

Payload omits metric columns so spend/impressions/clicks/conversions
are preserved on conflict (defaults 0 on insert). TikTok uses the
per-row `a.store_id` (already resolved by the fetcher via
`campaign-store-map`) so the Phase A.5 v2 multi-store attribution model
is preserved.

This closes the gap that would otherwise appear when cron-live's
enrollment loop was removed: `postgresReaders.fetchCampaigns:678-690`
drops rows with zero metrics unless their `effective_status` is
currently active, which requires SOME row in `campaigns_daily`.

### `cron-yesterday-refresh` — every 2h per store
New cron family (`cronYesterdayRefreshFunctions`) — 3 Inngest functions,
staggered :15 / :20 / :25 every even hour (Asia/Jerusalem). Each
function runs `runDailyForStore(store, yesterday)` to keep yesterday's
per-platform spend + per-order attribution + cross-day Shopify refunds
fresh during the day.

Operator-acceptable midpoint between the "perfect" 30-min refresh that
cron-live-heavy used to do (now removed) and "next day only"
cron-daily (too stale for refunds arriving mid-day). 12 fires/day per
store = ~36/day total = ~324 step.runs/day = ~10K/month — well within
the Inngest free-tier 50K cap.

### Refresh All button — 3-day window
`POST /api/operator/sync-now` `{scope:'all'}` now passes a
`dates: [today, yesterday, day-before]` field to the 3 `event/sync-now`
events. `eventSyncNow` loops `runDailyForStore` for each date
sequentially (parallelism across stores preserved by 3 separate
events). A manual click now catches cross-day refunds + late
attribution + per-platform spend for the last 3 days at once.

Watchdog (`useDashboardRefresh.MAX_WAIT_MS`) bumped from 90s → 180s to
match the longer per-tick runtime (3× per store).

### Test impact
- Deleted: `cronLivePastRowBackfill.test.ts` (5 tests, on the removed
  refresh-effective-status UPDATE bounds), `cronLiveStatusRefresh.test.ts`
  (3 tests, on the removed step's resilience).
- Updated: `cronLiveHeavyBudgetSkip.test.ts` — `cronLiveHeavyFunctions
  .length === 0` (was `=== 3`).
- Added: 10 new tests (2 BUC/auth/rate per platform × 3 platforms = 6;
  1 placeholder enrollment per platform × 3 platforms = 3; 1 disable
  regression-guard for cronLiveHeavy).
- Net: 1546 baseline + 10 new − 8 deleted = **1548 tests green**.

### Inngest function inventory after E1+E1.5
| Family | Count | Cadence | Purpose |
|---|---|---|---|
| `cron-daily-{store}` | 3 | 00:05 daily | authoritative yesterday refresh |
| `cron-live-{store}` | 3 | every 10 min | Shopify-only (revenue + orders + refunds for [today, T-1, T-2]) |
| `cron-yesterday-refresh-{store}` | 3 | every 2h staggered | yesterday refresh during the day |
| `cron-tick-orchestrator` | 1 | every 10 min | fan-out status + hot_metrics events |
| `metaWorker` / `googleWorker` / `tiktokWorker` | 3 | event-triggered | status (including placeholder enrollment) + hot_metrics + WhatsApp alerts |
| `eventSyncNow` / `eventBackfill` | 2 | operator-triggered | sync-now (Refresh All 3-day window) + backfill range picker |
| `cronOauthCanary` | 1 | 00:00 daily | token canary |
| `whatsappCronFunctions` + `eventWhatsappSendNow` | 2 | varies | operator WhatsApp queue |
| `cronLiveHeavyFunctions` | **0** | — | DISABLED in E1 (empty array) |

## Phase E1.6 — Account-level spend completes the cron-live → workers move (2026-05-30 evening)

E1.5 claimed "cron-live → Shopify-only" but missed
`fetch-meta-google-tiktok-spend-light-3day` — the account-level
spend + impressions fetcher that populated
`data_daily.fb/ga/tt_spend_cad` + `_impressions`. Operator observation
2026-05-30 ~17:50 IL via the Inngest dashboard caught this. E1.6
finishes the move.

### Correction to §Phase E1.5
The "cron-live → Shopify-only" claim from E1.5 was partial. E1.5
removed the status fetches + enrollment + historical UPDATE; it left
the account-level spend fetcher in place because no alternative path
existed for `data_daily.fb/ga/tt_spend_cad`. E1.6 (below) closes that
gap.

### Architecture
The 3 hot_metrics worker branches each get one new step running just
before `recHotPair('success')`:

  fetchAccountSpend(adAccount/customer/advertiser, [today, T-1, T-2])
    → one bulk API call:
        • Meta: `time_range={since,until}` + `time_increment=1`
        • Google: GAQL `WHERE segments.date BETWEEN d1 AND d3`
        • TikTok: `start_date`/`end_date` + `dimensions=[stat_time_day]`
        + `data_level=AUCTION_ADVERTISER`
    → CAD-convert via the shared `cadConvert` helper:
        • Meta (ILS) — FX → CAD
        • TikTok (USD) — FX → CAD
        • Google (CAD) — passthrough
        • FX failure → null → preserve prior column
    → upsertDataDailySpend(platform, spendCad, impressions) — partial-
      column UPSERT to data_daily (only fb/ga/tt_spend_cad + impressions)

cron-live now owns only fetch-shopify-rolling-3day +
fetch-shopify-orders-attribution-today + persist-rolling-3day (revenue
+ derived). `spendByDate` is aliased over `priorSpendByDate` (which
SELECTs what workers wrote) so the persist code is unchanged. ~870
lines removed (158 from the deleted step + the 2 dropped test files
worth of fixtures).

### Race mitigation (workers vs cron-live on data_daily)
Supabase JS `.upsert({...payload}, {onConflict: 'date,store_id'})`
builds the SET clause from payload keys only. Workers' payload contains
only fb/ga/tt_spend_cad + _impressions; cron-live's payload contains
only revenue + derived. Disjoint columns → merge per-column → no
overwrites. Same semantic cron-live + cron-daily relied on for years.

### API call budget delta
Before E1.6: 27 platform calls / 10 min (3 stores × 3 platforms × 3 dates).
After E1.6: 9 platform calls / 10 min (3 stores × 3 platforms × 1 bulk).
Net: −50% platform API load. Meta BUC pressure also drops by ~33%.

### FX-failure semantics
The shared `cadConvert` helper (extracted to
`dashboard-web/src/lib/inngest/cadConvert.ts`) carries the exact null-
preserve contract from cron-live's audit fix 2026-05-23 a/WARN-3.
When FX times out or returns invalid, cadConvert returns null →
upsertDataDailySpend OMITS the affected column → Supabase preserves
the prior value. "Stale > wrong" — never overwrite a valid CAD figure
with raw ILS/USD.

### Files inventory (new in E1.6)
- `dashboard-web/src/lib/inngest/cadConvert.ts` (+ test, 8 cases)
- `dashboard-web/src/lib/inngest/upsertDataDailySpend.ts` (+ test, 7 cases)
- `dashboard-web/src/lib/fetchers/metaAccountSpend.ts` (+ test, 4 cases)
- `dashboard-web/src/lib/fetchers/googleAccountSpend.ts` (+ test, 3 cases)
- `dashboard-web/src/lib/fetchers/tiktokAccountSpend.ts` (+ test, 4 cases)
- 3 worker hot_metrics steps + production adapter wiring (+ 6 tests)

### Tests
+26 new (8+7+4+3+4+6) − 8 dropped on removed steps
(cronLive.test.ts T5/T7/T8 + cronLiveShopifyDecoupled.test.ts) =
**net +18 tests; 1574 total green** (was 1548).

### Rollback
`git revert` the E1.6 commits. cron-live's fetch-light + spendByDate
fresh path are restored; workers stop the account-aggregate step.
data_daily is self-healing on the next tick from either path —
cron-live takes over again.

### Function inventory delta vs E1.5 table
| Family | Before E1.6 | After E1.6 |
|---|---|---|
| cron-live-{store} step.runs per tick | ~5 (shopify + spend-light + 3 prior + persist) | 3 (shopify + orders + persist) |
| Worker hot_metrics steps per tick | 4 (BUC + hot ids + 2 upserts + recHotPair) | 5 (+ account-aggregate) |
| Platform API calls / 10 min | 36 | 18 |

## Phase E1.6.1 — Hot-set / account-aggregate regression hotfixes (2026-05-30 evening)

The Phase E1.6 ship at ~18:30 IL stopped propagating account-level
spend + CPM to `data_daily.{fb,ga,tt}_spend_cad` + `*_impressions` in
production. Three independent bugs surfaced once the cron-live
fetch-light step was removed; this section documents all three and the
fixes that landed in commits `cfd1903` + `a4c0d0e`.

### Bug 1 — Empty hot-set early-exit pre-empted the E1.6 write

In all 3 hot_metrics worker branches (`metaWorker`, `googleWorker`,
`tiktokWorker`), the Phase E1.6 account-aggregate block was placed
**after** the pre-existing `if (hotCampaign + hotAdset + hotAd === 0)
return;` early-exit. Stores with no campaigns flagged "hot" at tick
time (per the 5-branch hot-set RPCs in
`20260530240000_phase_c_hot_set_functions.sql`) returned **before** the
new account-aggregate write, freezing `data_daily.fb/ga/tt_spend_cad`
+ impressions. cron-live's `priorSpendByDate` then re-read the stale
values every tick → the dashboard's per-account spend / Live CPM
appeared frozen even though Phase E1.6 had wired the new path
"correctly".

**Fix**: in each worker's `runXHotMetricsBranch`, resolve credentials
early and execute the account-aggregate block **before** the
empty-hot-set check. The hot-set fetch + campaigns_daily / ads_daily
upsert remain gated on a non-empty hot set as before. Regression
tests added to all 3 *.test.ts files asserting that an empty hot set
still triggers `fetchAccountSpend` + 3 calls to
`upsertDataDailySpend` (Meta/Google) or `aggregateTiktokSpendByStore`
(TikTok).

### Bug 2 — `hotSet.ts` silent soft-fail-to-empty hid RPC failures

The Phase C wrappers `getHotCampaignIds` / `getHotAdsetIds` /
`getHotAdIds` (`dashboard-web/src/lib/registries/hotSet.ts`) caught any
RPC error and returned `[]` with `console.warn`. A missing migration,
permissions issue, transient DB failure, or a genuinely empty hot set
all looked identical to the worker → no operator signal, no Sentry
event, no freshness `transient_error` row.

**Fix**: remove the soft-fail; throw on RPC errors. The worker's outer
try/catch records `data_freshness.transient_error` and Inngest's
exponential-backoff retry kicks in. Operator sees the cause in
`/operator`'s freshness panel within one tick. Updated
`hotSet.test.ts` to assert the new throw contract.

### Bug 3 — TikTok account-aggregate cross-store inflation

The Phase E1.6 block in `tiktokWorker` called the bulk-date account
spend fetcher and wrote the **full advertiser total** to
`data_daily.tt_spend_cad` for whatever store_id ran the worker. For
TikTok this is wrong: there is **one** shared advertiser (uzoshop's)
serving multiple stores via per-ad pixel routing (Phase A.5 v2). So:

- `uzoshop.tt_spend_cad` was inflated (full advertiser total = sum of
  all stores' campaign spend).
- `usmile360.tt_spend_cad` + `zolplus.tt_spend_cad` stayed at 0 because
  those stores' workers skip at `checkTikTokConfigured` (only uzoshop
  has its own TikTok env vars).

Pre-Phase-E1 this was avoided by `cron-live-heavy` running the
`agg_tiktok_spend_per_store_for_date(d)` RPC every 30 min via
`persistCampaignsLive`. Phase E1 (earlier today) disabled
`cron-live-heavy` entirely, leaving only the nightly cronDaily call.

**Fix**: remove the bulk-date account-spend write from `tiktokWorker`
entirely. Replace with a per-tick call to
`agg_tiktok_spend_per_store_for_date(today)` — once before the
empty-hot-set early-exit (re-aggregates whatever's currently in
campaigns_daily) and once after `upsertCampaignsDaily` (picks up the
fresh writes). The RPC re-aggregates campaigns_daily per (date,
store_id) — which is already correctly attributed via the campaign-
store-map at write time — into `data_daily.tt_spend_cad +
tt_impressions`, then recomputes `total_spend_cad + roas +
gross_profit + net_profit` in Pass 2. Meta + Google's E1.6
account-aggregate blocks are unchanged (each store has its own ad
account → no cross-store inflation issue).

**Removed wiring**: the TikTok Inngest binding no longer passes
`fetchAccountSpend` / `cadConvert` / `upsertDataDailySpend`. The
`fetchTikTokAccountSpendForDates` fetcher remains in the codebase
unused (kept for the operator's manual debugging if ever needed; not
imported by the worker).

### Tests
3 new regression tests (one per worker) for Bug 1.
1 updated hotSet test for Bug 2.
3 restructured TikTok tests for Bug 3 (replacing the 2 prior E1.6
account-aggregate tests + the regression test added for Bug 1).
**Net: 1577 total tests green** (was 1574).

### Rollback
`git revert cfd1903 a4c0d0e`. The empty-hot-set early-exit returns to
its pre-fix position (Bug 1 returns); hotSet.ts goes back to silent
soft-fail (Bug 2 returns); tiktokWorker re-wires the bulk-date account
fetcher (Bug 3 returns). data_daily heals on the next nightly
cronDaily run regardless.

## Phase E1.6.2 — cron-live is truly Shopify-only + derive-calc decoupling (2026-05-30 evening)

After the three E1.6.1 hotfixes (cfd1903 + a4c0d0e) deployed, the user
reported that the dashboard "still wasn't updating except Campaigns"
even though those fixes were in production. Investigation found a
fourth bug — bigger than the prior three — that Phase E1.6 had created.

### Bug 4 — cron-live re-wrote platform spend columns from a stale snapshot

Phase E1.6 (18:30 IL) moved the bulk-date account-spend FETCH from
cron-live to the 3 hot_metrics worker branches but LEFT the WRITE in
cron-live's `persistDayForStore`. The `spendOverride` parameter that
used to receive fresh API values was redirected to read from
`priorSpendByDate` — a SELECT cron-live cached at the start of its
10-min tick. Between cron-live's SELECT (T+0s) and its later UPSERT
(T+30-60s), workers wrote fresh fb/ga_spend_cad values to data_daily;
cron-live's persist step then OVERWROTE those worker-fresh values with
the stale priorSpend snapshot.

Campaigns tab (reads campaigns_daily, owned exclusively by workers)
kept updating because nothing raced. Every other tab (reads
data_daily) saw oscillating / frozen values.

### Fix scope

Two cleanups landed in Phase E1.6.2:

**1. `cron-live` is now PURELY Shopify (no FB/Google/TikTok references in TS).**

Removed entirely from `cronLive.ts`:
- `DateSpend` type
- `priorSpendByDate` SELECT loop (was 3 step.runs per tick, one per date)
- `spendByDate` aliasing over priorSpendByDate
- `spendOverride` / `opts.spendOnly` / `prior` parameters on `persistDayForStore`
- All `fb_spend_cad` / `ga_spend_cad` / `tt_spend_cad` / `fb_impressions` /
  `ga_impressions` / `tt_impressions` / `total_spend_cad` references
- The `STORES_WITH_TIKTOK` import
- The "spend-only fallback" UPSERT branch (was Phase 12.2.2 INN-07 fix;
  now obsolete because workers own platform spend)
- The `roas` / `gross_profit_cad` / `net_profit_cad` inline computations
  in the persist payload

`persistDayForStore` now writes only:
- `date`, `store_id`, `store_name`
- `revenue_cad`, `gross_revenue_cad`, `refund_deduction_cad` (Shopify)
- `cogs_cad` (computed from revenue × per-store rate; depends only on
  revenue so no race)
- `last_live_tick_at` (freshness timestamp)

The `runLiveForStore` return shape's `todaySpendCad` field is preserved
for backwards-compat with tests but always returns zeros (deprecated).

**2. `recompute_data_daily_derived(d date)` SQL function — atomic derive at DB layer.**

New migration `20260530300000_recompute_data_daily_derived.sql`. The
function reads the current `fb_spend_cad + ga_spend_cad + tt_spend_cad
+ revenue_cad + cogs_cad` from data_daily and re-derives
`total_spend_cad + roas + gross_profit_cad + net_profit_cad` for every
row on date `d`. Idempotent.

Called from:
- `persistDayForStore` (cron-live) — after the Shopify UPSERT.
- `upsertDataDailySpend` (Meta + Google workers) — after each spend write.
- (TikTok already calls `agg_tiktok_spend_per_store_for_date` which does
  the same derive logic as its Pass 2.)

This decouples cron-live and workers entirely. Neither needs to know
about the other's columns; the DB re-derives in one atomic UPDATE.

### Ownership matrix (post-Phase E1.6.2)

| Column | Owner | Cadence |
|---|---|---|
| `revenue_cad`, `gross_revenue_cad`, `refund_deduction_cad`, `cogs_cad`, `store_name`, `last_live_tick_at` | cron-live | 10 min |
| `fb_spend_cad`, `fb_impressions` | metaWorker hot_metrics | ~10 min (orchestrator-driven) |
| `ga_spend_cad`, `ga_impressions` | googleWorker hot_metrics | ~10 min |
| `tt_spend_cad`, `tt_impressions` | agg RPC (via tiktokWorker's `aggregateTiktokSpendByStore` call) | ~10 min |
| `total_spend_cad`, `roas`, `gross_profit_cad`, `net_profit_cad` | `recompute_data_daily_derived` RPC (called from cron-live + each worker) | atomic per-write |

### Tests
Updated 4 test files for the new contract:
- `upsertDataDailySpend.test.ts` — mock now includes `admin.rpc` (5 tests).
- `cronLive.test.ts` — mock includes `admin.rpc` (1 test).
- `cronLiveLiveTickAt.test.ts` — mock includes `admin.rpc`; "spend-only
  fallback" test inverted to assert NO data_daily upsert when Shopify
  fails (3 tests).
- `cronLiveRetryIdempotency.test.ts` — entire INN-10 contract replaced:
  cron-live's payload must NOT contain `fb/ga_spend_cad` /
  `fb/ga_impressions`, and no `select-prior-spend-*` step.run labels
  should appear (3 tests).

Vitest: 1577 pass / 0 fail / 9 skip.

### Migration deployment
`20260530300000_recompute_data_daily_derived.sql` must be applied to
the production Supabase before the new TS code can run successfully.
If applied via the Supabase Dashboard SQL editor: paste the migration
SQL and execute. cron-live + workers will start calling the RPC on
their next tick.

### Rollback
`git revert` the Phase E1.6.2 commits. The pre-fix race condition
returns (workers write fresh spend, cron-live overwrites with stale
snapshots). The RPC stays in the DB unused (no harm); `DROP FUNCTION
recompute_data_daily_derived(date)` if a clean DB rollback is needed.

## Phase E1.7 — `campaigns_daily` as Source of Truth + Unified Agg RPC (2026-05-30 night)

Tonight's third architectural cleanup. After Phase E1.6.1 + E1.6.2 the
dashboard still had two parallel data paths for ad spend:
- `campaigns_daily` (per-campaign, written by hot_metrics workers — fresh)
- `data_daily.{fb,ga,tt}_spend_cad` (account-aggregate via the
  `upsertDataDailySpend` helper — lagged Meta by ~$35 and silently
  failed on Day-3 due to `store_name NOT NULL`)

User reported "everything not updating except Campaigns". Vercel logs
showed: every 10-min tick threw `data_daily upsert <platform> <store>
2026-05-28: null value in column "store_name" of relation "data_daily"
violates not-null constraint`. The error was caught by the soft-fail
catch, so freshness still reported success — but Day-3 column never
updated and Meta lagged by $35.

### Bug 4 — `store_name NOT NULL` silently dropped Day-3 writes

The Phase E1.6 `upsertDataDailySpend` helper used a partial-column
UPSERT: payload had only `{date, store_id, fb_spend_cad}` (no
`store_name`). PostgreSQL's INSERT ... ON CONFLICT evaluates NOT NULL
constraints BEFORE the conflict check. For Day-3 dates where no row
existed yet, the INSERT path tripped the constraint and the
ON CONFLICT branch never fired. Every worker, every tick, for every
store on 2026-05-28 — silent failure all evening.

### Architecture cleanup

`campaigns_daily` is now the SINGLE source of truth for ad spend.
`data_daily.{fb,ga,tt}_spend_cad + impressions` is DERIVED from
`campaigns_daily` via the unified RPC.

### The unified RPC: `agg_data_daily_for_date(d date)`

Three passes per call (migration `20260530310000`):

1. **ZERO** — every `data_daily` row on date `d` gets
   `fb/ga/tt_spend_cad` and `fb/ga/tt_impressions` zeroed. Stores that
   lost all campaign activity correctly drop to 0.

2. **AGGREGATE** — SUM `campaigns_daily.spend_cad + impressions` per
   `(date, store_id, platform)` and UPDATE `data_daily`. TikTok rows
   attributed via the Phase A.5 v2 campaign-store-map land on the
   right `data_daily` row.

3. **DERIVE** — re-compute `total_spend_cad + roas + gross_profit_cad
   + net_profit_cad` from freshly-set spend + cron-live-owned revenue
   + cogs.

Called from:
- `cronLive.ts persistDayForStore` (after Shopify UPSERT)
- `metaWorker hot_metrics branch` (before empty-hot-set + after upserts)
- `googleWorker hot_metrics branch` (same pattern)
- `tiktokWorker hot_metrics branch` (same pattern)

The pre-fetch call (before empty-hot-set) is soft-fail (logs warning,
continues). The post-upsert call re-throws so the outer try/catch
records `transient_error` freshness for operator visibility.

### Ownership matrix (post-Phase E1.7)

| Column(s) | Owner | Cadence |
|---|---|---|
| `revenue_cad`, `gross_revenue_cad`, `refund_deduction_cad`, `cogs_cad`, `store_name`, `last_live_tick_at` | cron-live | 10 min |
| `campaigns_daily.spend_cad + impressions` (Meta) | metaWorker hot_metrics | ~10 min |
| `campaigns_daily.spend_cad + impressions` (Google) | googleWorker hot_metrics | ~10 min |
| `campaigns_daily.spend_cad + impressions` (TikTok) | tiktokWorker hot_metrics | ~10 min |
| `data_daily.{fb,ga,tt}_spend_cad + impressions` | `agg_data_daily_for_date` RPC (called from cron-live + 3 workers) | atomic per-write |
| `data_daily.total_spend_cad`, `roas`, `gross_profit_cad`, `net_profit_cad` | `agg_data_daily_for_date` RPC (same call) | atomic per-write |

**Key change**: `data_daily.{fb,ga,tt}_spend_cad` is no longer written
DIRECTLY by anything. It is derived by the SQL function from
`campaigns_daily`. There is exactly ONE source of truth.

### Files deleted

- `dashboard-web/src/lib/inngest/upsertDataDailySpend.ts` (+ test)
- `dashboard-web/src/lib/fetchers/metaAccountSpend.ts` (+ test)
- `dashboard-web/src/lib/fetchers/googleAccountSpend.ts` (+ test)
- `dashboard-web/src/lib/fetchers/tiktokAccountSpend.ts` (+ test)

3 fewer Meta/Google/TikTok account-aggregate API calls per tick.

### Migrations deployed

- `20260530310000_agg_data_daily_for_date.sql` — the new unified RPC.
- 4 older RPCs are dormant (superseded but not dropped — kept for
  migration history immutability): `agg_tiktok_spend_per_store_for_date`,
  `recompute_data_daily_derived`, the 2 fix-pass migrations.

After applying via `supabase db query --linked --file …` we ran
`NOTIFY pgrst, 'reload schema'` so PostgREST picks up the new function
without restart.

### Tests

Net change: 18 tests deleted (upsertDataDailySpend + 3 account-spend
fetchers) + 6 new tests written (the 2 new contracts per worker × 3
workers). Final: 1559 passed / 0 failed / 9 skipped.

### Diagnostic hotfix to TikTok hot_metrics envelope

While verifying Phase E1.7 in production we observed that
`campaigns_daily.{google,tiktok}` was frozen since 17:30 IL despite
freshness rows reporting success. Root cause: `fetchTikTokHotMetricsForStore`
did not check the TikTok response envelope's `code !== 0` (rate limit
/ auth / quota errors) — it silently returned `[]`. Fix: throw with
`code` + `message` so the worker's outer try/catch records
`transient_error` freshness and Inngest's retry kicks in. Same commit
adds temporary `console.log` diagnostics to both Google + TikTok hot
fetchers (prefixed `[gh-diag]` / `[tt-diag]`) to capture API response
shape for the next 1-2 ticks; these will be removed once root cause
is confirmed.

### TikTok hot_metrics conversion metric: `purchase` → `complete_payment` (2026-06-04)

Operator reported a live TikTok campaign showing **0 conversions** in the
Campaigns tab while TikTok Ads Manager showed 2. Root cause:
`fetchTikTokHotMetricsForStore` (the live writer for `campaigns_daily`,
every ~10 min) requested the metrics `purchase` + `total_purchase_value`.
For this Shopify **web-pixel** setup those belong to TikTok's APP-event
family and are **always 0** — the real sales are reported under
`complete_payment`. A live API probe (2026-06-04, campaign
`1866979241538642`) confirmed: `purchase=0`, `total_purchase_value=0.00`,
but `complete_payment=1`, `value_per_complete_payment=90.51`.

This is the SAME metric set the **nightly** fetcher
(`tiktok.ts:fetchTikTokAdInsights`) has used since the Phase 05.7.8 fix —
and what ARCHITECTURE §"Metrics mapping" (line ~215) already documents as
canonical. The hot_metrics fetcher had drifted from it. Symptom shape:
- Days written by the live worker (`source='live_tick'`, i.e. **today**)
  showed `conversions=0`, `conversion_value_cad=0`.
- Days that received the nightly reconcile (`source='daily_reconcile'`)
  were already correct.
- So only the **today/live** TikTok numbers were wrong; **Meta** (purchase
  priority chain `omni_purchase→purchase→fb_pixel_purchase`) and **Google**
  (`metrics.conversions`) were unaffected at both live and nightly.

Fix (`fetchTikTokHotMetricsForStore`): request
`["spend","impressions","clicks","conversion","complete_payment","value_per_complete_payment"]`
and map `conversions = complete_payment`,
`conversion_value = complete_payment × value_per_complete_payment` (FX→CAD),
mirroring the nightly fetcher exactly. No history backfill needed — past
days were already correct via nightly reconcile; today self-heals on the
next tick (~10 min) after deploy.

### TikTok DELETE-then-UPSERT for re-mapped campaigns

User raised the concern that the dimensions fix must also handle new
campaigns, status changes, and most importantly campaigns RE-MAPPED to
different stores via the Phase A.5 v2 campaign-store-map. The
campaigns_daily PK is (date, store_id, platform, campaign_id,
ad_set_id) — when a campaign moves stores, the next hot_metrics tick
writes a row under the NEW store_id but the OLD row under the previous
store_id lingers. The agg_data_daily_for_date RPC then sums BOTH rows
→ double-count on both stores.

Phase A.5 v2's `persistCampaignsLive` (cron-live-heavy era, disabled
in Phase E1) had this DELETE-then-UPSERT pattern. The pattern moves
to the hot_metrics worker now via two new helpers wired in the Inngest
binding:
- `deleteStaleCampaignsDailyRows(rows)` — for each fresh (date,
  platform, campaign_id, ad_set_id, store_id) DELETE rows with same
  first 4 keys but a different store_id.
- `deleteStaleAdsDailyRows(rows)` — same for ads_daily (PK also
  includes store_id).

Both fire BEFORE the upsertCampaignsDaily / upsertAdsDaily calls.

### TikTok AD-level dimensions don't allow campaign_id

The dimensions hotfix above worked at AUCTION_ADGROUP level but TikTok
rejects `dimensions=["campaign_id","ad_id"]` at AUCTION_AD level with
`code=40002 data_level AUCTION_AD and dimension campaign_id do not
match`. Fix: AD-level uses `dimensions=["adgroup_id","ad_id"]`, then
enriches each row's `campaign_id` from a `Map<adgroup_id, campaign_id>`
built from the ADGROUP-level fetch in the same tick. This way both
levels route correctly via the campaign-store-map.

### TikTok dimensions must include `campaign_id` for store-map routing

After the JSON.stringify(ids) fix above, TikTok started returning rows
again — but ALL of them got attributed to `uzoshop` (the function-arg
storeId) regardless of the Phase A.5 v2 campaign-store-map. Root
cause: `fetchTikTokHotMetricsForStore` requested only
`dimensions=["adgroup_id"]` (or `["ad_id"]`). TikTok's response only
carries the requested dimensions. `toCampaignRow` read
`d.campaign_id` → undefined → `cid = ''` → `resolveStore('')` fell
back to the function-arg storeId. The map was never consulted.

Fix: include `campaign_id` in the dimensions array:
`dimensions=["campaign_id","adgroup_id"]` (and similarly with `ad_id`
for AD-level). Now the response carries `dimensions.campaign_id` and
`resolveStore(cid)` correctly routes each row to the mapped store.

### TikTok `filter_value` was always-array (latent Phase C bug)

The envelope error surface (above) immediately uncovered: `code=40002
filtering.0.filter_value: Not a valid string`. The Phase C
`fetchTikTokHotMetricsForStore` passed `filter_value: ids` where `ids`
was a JavaScript array. TikTok's report API requires `filter_value`
for `filter_type: 'IN'` to be a STRING (in their case, a
JSON-stringified array — `"[\"id1\",\"id2\"]"`).

The bug has been LATENT since Phase C deployed because:
- cron-live-heavy (disabled in Phase E1 at ~17:40 IL today) was the
  PRIMARY writer of TikTok `campaigns_daily` via `persistCampaignsLive`.
  cron-live-heavy fetched insights via `fetchTikTokAdInsights`
  (a DIFFERENT function path) which did not have this filter_value bug.
- The Phase C `tiktokWorker hot_metrics` was supposed to take over but
  silently failed, returning empty adsets/ads. campaigns_daily.tiktok
  was being filled by cron-live-heavy until 17:40 IL, masking the
  Phase C bug entirely.

Fix: pass `filter_value: JSON.stringify(ids)` so TikTok parses it as a
string that contains an array. Same pattern in `tiktokAccountSpend.ts`
(the Phase E1.6 fetcher, now deleted, didn't have this bug because it
queried account-level not adgroup-level).

After this fix, TikTok hot_metrics will write `campaigns_daily.tiktok`
every 10 min and the Phase E1.7 agg RPC will surface fresh values in
`data_daily.tt_spend_cad + tt_impressions`.

### Google hot_metrics account-TZ + 2-day window fix

The `gh-diag` log from the 20:50 tick showed
`adgroup_query store=uzoshop date=2026-05-30 ids=3 rows=0`. Google
Ads's GAQL query for 3 known-active adgroup IDs filtered by
`segments.date = '2026-05-30'` returns ZERO rows. The 3 IDs match the
rows currently in `campaigns_daily.google` (stale since 17:30 IL).

**Root cause**: `segments.date` in GAQL is bucketed in the account's
TZ, NOT UTC. The worker passed `dateStr = nowIso.slice(0, 10)` which
is UTC-derived; accounts in non-UTC timezones got 0 rows because the
queried date didn't match the account's calendar day.

**Fix**: `fetchGoogleHotMetricsForStore` now queries
`SELECT customer.time_zone FROM customer LIMIT 1` once at the start
(extra ~50ms RPC), computes both `today` + `yesterday` in the
account's TZ, and filters with `segments.date BETWEEN '${yesterdayInTz}'
AND '${todayInTz}'`. The 2-day window also tolerates Google's known
cost-reporting delay (cost_micros can buffer up to ~3 hours after the
activity).

The fetcher returns rows with `date = segments.date` from Google's
response. Worker writes them as-is into `campaigns_daily`; the agg
RPC aggregates by `(date, store_id, platform)`. If account TZ differs
from IL, campaign rows will land under the Google-account TZ's date —
the dashboard's "today IL" view then shows them via the agg RPC
provided IL-today and account-TZ-today overlap (true for uzoshop
since the account is in Israel).

### Phase E1.7 night follow-up — TikTok AUCTION_AD + Google PMax fixes

Two issues surfaced after the initial Phase E1.7 deploy that the
"add account-TZ" Google fix didn't address:

**TikTok dimension rules (validated empirically against the
production API)** — TikTok's BASIC `report_type` enforces a strict
single-dimension-per-data-level rule. The 21:50 production tick after
the first deploy proved it rejects both:

- AUCTION_AD with `["adgroup_id","ad_id"]` or `["campaign_id","ad_id"]`
  → `code=40002 data_level AUCTION_AD and dimension <X> do not match`
- AUCTION_ADGROUP with `["campaign_id","adgroup_id"]`
  → `code=40002 data_level AUCTION_ADGROUP and dimension campaign_id
  do not match`

Fix: dimensions = exactly `["adgroup_id"]` at AUCTION_ADGROUP and
exactly `["ad_id"]` at AUCTION_AD. Parent IDs come from worker-built
maps sourced from the registries:

- `adsetIdToCampaignId` (from `adset_registry WHERE platform='tiktok'
  AND adset_id IN (hotAdgroupIds)`) — used to enrich ADGROUP rows.
- `adIdToParent` (from `ad_registry WHERE platform='tiktok' AND
  ad_id IN (hotAdIds)`) — used to enrich AD rows.

The fetcher uses `resolveStore(campaign_id)` via the campaign-store-map
for store routing — preserving the Phase A.5 v2 attribution model.
Rows whose parent IDs aren't in the maps are SKIPPED (safer than
mis-attribution under the worker's default storeId fallback).

**Google PMax campaigns** — Performance Max campaigns expose NO
`ad_group` resource (delivery is asset-group based). Querying
`FROM ad_group WHERE ad_group.id IN (...)` for a PMax campaign id
returns 0 rows. uzoshop's hot set includes 2 PMax campaigns
(`22542818628`, `23590447604`) whose ids land in `ad_set_id` by the
existing nightly-cron + Phase D backfill convention.

Fix: `fetchGoogleHotMetricsForStore` now queries
`FROM campaign WHERE campaign.id IN (hotCampaignIds)` instead of
`FROM ad_group WHERE ad_group.id IN (hotAdgroupIds)`. This works
uniformly for **all** Google campaign types (PMax, Standard Shopping,
Search, Display) because every campaign aggregates `metrics.cost_micros`
at the campaign resource. Rows are written with
`ad_set_id = campaign_id` (synthetic, matches existing PMax
convention and Phase D backfill). The agg RPC sums by
`(date, store_id, platform)` so this synthesis is loss-less for
`data_daily.ga_spend_cad`. `hotAdgroupIds` is now ignored in the
input shape. The ad-level branch (`FROM ad_group_ad`) is unchanged —
returns 0 rows for PMax naturally, returns real rows for other types.

### Phase E1.7 night follow-up #2 — workers use IL TZ for `campaigns_daily.date`

All 3 hot_metrics workers computed `today = nowIso.slice(0, 10)` —
UTC date. Israel is UTC+3 (IDT) or UTC+2 (IST), so between 00:00 IL
and 03:00 IL each night the UTC date is one day behind the IL date.

Symptom (observed 2026-05-31 00:20 IL): the 00:00 + 00:10 + 00:20 IL
ticks wrote campaigns_daily rows under `date = '2026-05-30'` (UTC),
UPSERT-overwriting yesterday's final spend with today's partial
spend. The corresponding `agg_data_daily_for_date('2026-05-30')`
call then propagated the (wrong) sums to `data_daily.{fb,ga,tt}_*`.
Meanwhile `data_daily['2026-05-31']` (written by cron-live in IL TZ)
sat at zero spend.

Fix: new helper `getTodayInIsraelTz(nowIso?)` in `lib/dateRange.ts`.
Workers now compute `today` via that helper. The optional `nowIso`
parameter lets vitest pin deterministic dates without mocking `Date`.

Recovery: the next `cron-yesterday-refresh` cycle (every 2h) re-pulls
yesterday's full-day spend from each platform and restores the
correct 2026-05-30 values; the next post-deploy tick writes today
under `date = '2026-05-31'`, and the agg RPC populates
`data_daily['2026-05-31']`.

## 26. UI/UX Design-System Overhaul (2026-05-30)

Single-PR overhaul addressing 11 concerns raised in the 2026-05-30 fresh
independent audit (see `docs/superpowers/specs/2026-05-30-ui-ux-design-system-overhaul-audit.md`).

### Token system
Two-layer (semantic OKLCH vars in `globals.css` referenced by Tailwind
utilities + CVA primitives). New tokens added in this overhaul:
`--status-warning(-bg, -fg)`, `--chart-axis`, `--chart-cpm-prev`,
`--gradient-hero-{from,via,to}`, `--store-{uzoshop,zolplus,usmile}(-bg, -fg)`,
8 `--annotation-*` tokens. All tokens carry both `:root` and
`[data-theme="dark"]` definitions; the `tokenParity.test.ts` CI gate
enforces this contract.

Tailwind class-name convention: status sub-tokens use camelCase keys in
tailwind.config.ts (`status.warningBg`) which Tailwind preserves literally
in the class form (`bg-status-warningBg`, NOT `bg-status-warning-bg`).
Reverse migration of any kebab usages happened in commit `28da6b4`.

### Color palette unification
Store palette is canonical at the chart palette (cyan / hot-pink / lime —
sourced from `storeColors.ts`). `format.ts STORE_HUES` now routes through
the `--store-*` tokens, with `storeBadgeHex()` exposed as a backwards-
compat shim for server-side callers (WhatsApp summaries).

Platform tokens promoted from `chartColors.ts` into a canonical
`PLATFORM_TOKENS` map exposing per-platform `color` + `strokeDasharray`
+ `strokeWidth`. Shopify keeps its dashed-stroke convention to signal
"actual revenue" vs "reported ads platforms".

### Component primitives (3 new + 1 compound extension)
- `Stat` — replaces 2 inline drawer stat-block functions.
- `TableBase` (Head + HeaderCell + Row + Cell) — replaces 4 ad-hoc tables.
- `InsightCard` (+ `InsightCard.Group` + `InsightCard.Row` compound API) —
  replaces 4 custom warning/info card surfaces AND absorbs
  `InsightsBoard.tsx`'s severity-grouped row pattern (compound extension
  shipped in commit `138fd78`).

`Badge.tsx` now exports `BADGE_TONE_BG` as the single source of truth;
the 2 duplicate maps in CampaignsTable + AdsDrawer are deleted.

### Drawers → Sheet primitive
`CampaignDrawer` + `AdsDrawer` migrated to the `Sheet` primitive
(`side="end"` for RTL safety). Header padding, backdrop blur, close-
button size now consistent.

### IA restructure
- **Home tab** → 3 visual bands (`HomeLiveBand` / `HomeSummaryBand` /
  `HomePerStoreBand`) — scroll height drops ~40%.
- **Analysis tab** → 2 sub-tabs (`Trends` honors global filter;
  `Archive` has its own year selector + month accordion).
- **/operator** → 4 sub-tabs (`Sync` / `Health` / `Activity` / `Danger`).
- `GoalTracker` moves Home → P&L (matches its global scope).

### Bidi sweep
Six high-traffic surfaces wrap dynamic LTR content in `<bdi dir="ltr">`:
CampaignDrawer title + Ads Manager link, CampaignsTableRow campaign-name
cell + 3 mixed-text tooltips, PerStoreCards store-name span. Mixed
Hebrew + English no longer reorders.

### Virtualization
DEFERRED for `CampaignsTable`. The component already uses
`TOP_N_DEFAULT = 10` pagination (clicking "הצג עוד" expands progressively),
so virtualization solves a non-problem at current data scale. The
required CSS-grid rewrite would risk regressing sticky-header alignment,
RTL horizontal scroll, inline Recharts Sparklines, and screen-reader
table semantics. If row counts ever exceed ~500, server-side pagination
(`?page=` URL param) is the safer path. See commit `09ad684` for the
deferral rationale.

### ESLint guards
9 enforcement rules (all `'error'` severity) prevent design-system regression:
1. `local/no-raw-button-in-components` — forbid `<button>` outside `components/ui/`.
2. `local/no-dark-variant-in-components` — forbid `dark:` Tailwind variants in components.
3. `local/no-hex-color-in-components` — forbid hex literals in components (5 SVG-color exemptions inline in HeroOverview).
4. `local/no-legacy-tailwind-class` — forbid pre-Wave-1 legacy palette classes (Wave-1 Task 1.2).
5. `local/no-cross-palette-import` — forbid cross-palette imports between scope boundaries (Wave-1 Task 1.2).
6. `local/no-raw-table-in-components` — forbid raw `<table>` outside `TableBase` (Wave-2 Task 2.2).
7. `local/no-native-title-tooltip` — forbid native `title="…"` tooltips (Wave-2 Task 2.6).
8. `local/no-raw-input-in-components` — forbid raw `<input>/<select>/<textarea>` (Wave-2 Task 2.7).
9. `no-restricted-imports` — forbid `@radix-ui/react-*` imports outside `components/ui/` (Wave-2 Task 2.10); primitives wrap Radix and are the only allowed consumers.

Wave-4 Task 4.5 will add `local/no-physical-direction-in-components`;
Wave-5 Task 5.10 will add `local/no-emoji-in-jsx`.

### Tests
Final count: 1602 node passed | 9 skipped + ~120 DOM tests. New tests:
sidebarHover, buttonDestructive, stat, tableBase, insightCard
(simple + compound), yearSelector, bidi, token-parity,
globals-new-tokens, dark-mode-tuning, badge.

---

## 27. Premium 2026 Design-System Contract (2026-05-31)

Layered polish on top of §26 — same data, same algorithms, same
operator workflow. §26 stabilized the design tokens + ESLint guards;
§27 documents the **visual language contract** that Wave-3+ work added
(glass+neon canvas, V4 band attributes, freshness staging, semantic
emphasis classes, motion vocabulary, synthesis module). This is the
reference contract any Phase-3+ component or page MUST honor.

### 27.1 Glass+neon token system

**Canvas tokens** (deep blue-violet base — replaces the flat `--bg`
neutral previously used in §26):
- `--canvas-1` — body base color (darkest violet-tinted shade).
- `--canvas-2` — secondary canvas / scrolled-content base.

Both canvas tokens carry an animated **conic-gradient body
background** (`globals.css` body rule) — a slow-rotating
`conic-gradient(...)` blend driven by a CSS custom property
`--canvas-rotate` animated via `@keyframes` (`prefers-reduced-motion`
short-circuits the animation per §27.6).

**Glass layers** — translucent surfaces stacked over the canvas:
- `--glass-1` — primary card surface (most opaque).
- `--glass-2` — nested card / drawer sub-section.
- `--glass-3` — popover / tooltip / detached overlay.
- `--glass-edge` — 1px stroke at rest.
- `--glass-edge-hot` — 1px stroke on hover / focus / `data-band` active
  states.

The `.glass` utility class composes
`background: var(--glass-1); border: 1px solid var(--glass-edge);
backdrop-filter: blur(...)`. All cards, drawers, popovers go through
`.glass` — no raw `bg-white` / `bg-slate-*` in components.

### 27.2 V4 band data-attribute contract

ROAS health is communicated via **data attributes**, not class names.
Any `.glass` element MAY declare `data-band="red|orange|green|blue|gray"`
to opt-in to band styling. The CSS contract:

- **3px top edge bar** in the band color (sits flush against the
  glass element's top border).
- **Background tint** — band color blended at ~6% alpha into the
  glass surface.
- **`.v.banded` numeric color** — numeric children with the `.v.banded`
  utility class adopt the band color for typography, so the band
  echoes from the edge to the headline metric.

`useRoasBandGradient(roas: number)` (in
`src/lib/format/useRoasBandGradient.ts`) is the canonical mapper from
a numeric ROAS to a band:
- `roas < 2.0` → `red`
- `2.0 ≤ roas < 2.7` → `orange`
- `2.7 ≤ roas < 3.0` → `green`
- `roas ≥ 3.0` → `green` (no extra tier — green tops out at break-even)
- `roas == null` / not-finite → `gray`

The `blue` band is reserved for **informational / accent** non-ROAS
emphasis (e.g. cross-store summary bars) — never auto-derived from
the helper.

### 27.3 Freshness data-attribute contract

Card-level freshness uses a parallel data-attribute contract — any
`.glass` element MAY declare `data-freshness="fresh|aging|stale"`. The
CSS effect:

- `fresh` — no filter, full opacity.
- `aging` — `filter: saturate(0.7)`.
- `stale` — `filter: saturate(0.4); opacity: 0.85`.

The contract is **purely cosmetic** — content remains keyboard-
accessible and readable; the desaturation is the visual cue, not an
interaction block.

`useStaleness(updatedAt: string | null)` (in
`src/lib/freshness/useStaleness.ts`) computes the stage for a single
timestamp. For cards aggregating multiple sources (e.g. PerStoreRow
showing all platforms), the **worst-stage wins** rule applies — the
hook returns `stale` if ANY platform is stale, else `aging` if any
is aging, else `fresh`. Thresholds: 15 min → aging; 30 min → stale.

### 27.4 Semantic emphasis classes

Per-cell color emphasis lives in `src/lib/format/aovEmphasis.ts` +
companion utility classes:
- `.cell.spend` — red emphasis when value is rising.
- `.cell.revenue` — green emphasis when value is rising.
- `.cell.aov-good` — green (AOV trending healthy).
- `.cell.aov-bad` — red (AOV below conditional floor).
- `.cell.aov-mid` — neutral white (in-band).

The contract is **direction-of-good**, not magnitude — these classes
indicate which direction is positive for the user, so red on Spend
means "spend went up (bad)" while red on Revenue means "revenue went
down (bad)". CPM intentionally has no emphasis class (cost indicator,
not an actionable home-tab KPI).

### 27.5 Motion vocabulary

5-tier motion scale in `globals.css` `:root`:
- `--motion-snap` — 120ms (instant feedback: button press, toggle).
- `--motion-fast` — 180ms (hover transitions, color swaps).
- `--motion-base` — 240ms (default tween for layout shifts).
- `--motion-slow` — 320ms (drawer slides, modal entrances).
- `--motion-large` — 480ms (page-level view transitions, hero swaps).

All animations honor `prefers-reduced-motion: reduce` via a global
`@media` rule that flattens transitions to `0.01ms` (see commit
`29f2dbc`).

### 27.6 ESLint enforcement — 9 rules at `error`

The full guardrail set (extends §26.3 — moved here as the canonical
list):

1. `local/no-raw-button-in-components` — forbid `<button>` outside
   `components/ui/`.
2. `local/no-raw-table-in-components` — forbid raw `<table>` outside
   `TableBase`.
3. `local/no-raw-input-in-components` — forbid raw `<input>` /
   `<select>` / `<textarea>` outside primitives.
4. `local/no-native-title-tooltip` — forbid native `title="…"`
   tooltips (use `Tooltip` primitive).
5. `local/no-legacy-tailwind-class` — forbid pre-overhaul palette
   classes (`bg-slate-*`, `text-slate-*`, etc.).
6. `local/no-cross-palette-import` — forbid cross-palette helper
   imports between scope boundaries.
7. `local/no-physical-direction-in-components` — forbid `left:` /
   `right:` / `ml-*` / `mr-*` etc.; use logical properties (`start`,
   `end`, `ms-*`, `me-*`) for RTL safety.
8. `local/no-emoji-in-jsx` — warn-level guard against emoji literals
   in JSX text (use `lucide-react` icons or `Badge` primitives).
9. `no-restricted-imports` — forbid `@radix-ui/react-*` imports
   outside `components/ui/`; primitives wrap Radix and are the only
   allowed consumers.

`no-hex-color-in-components` + `no-dark-variant-in-components` from
§26 remain in force but are now considered baseline.

### 27.7 `lib/synthesis/` module — authoritative TL;DR

Located at `dashboard-web/src/lib/synthesis/`. 5 page-scoped
synthesizers that turn raw aggregated data into a single Hebrew TL;DR
sentence/paragraph block rendered by the `PageSynthesis` primitive:

- `roasChart.ts` — Home / RoasTargetChart synthesis (peak day,
  trough day, vs-target delta).
- `trends.ts` — Analysis → Trends sub-tab.
- `archive.ts` — Analysis → Archive sub-tab.
- `detail.ts` — Detail tab (per-day P&L narration).
- `pnl.ts` — P&L tab (month-to-date summary).

Each synthesizer is a **pure function** of its data input — no I/O,
no DOM, no React. Co-located unit tests in
`src/lib/synthesis/__tests__/` ensure stable output across data
shapes. New pages adding TL;DR must add a synthesizer here — no
inline string concatenation in components.

### 27.8 Key helpers (canonical locations)

- `useStaleness` — `src/lib/freshness/useStaleness.ts`
- `FreshnessBadge` — `src/components/ui/FreshnessBadge.tsx`
- `useRoasBandGradient` — `src/lib/format/useRoasBandGradient.ts`
- `aovEmphasis` — `src/lib/format/aovEmphasis.ts`
- `StatusPill` — `src/components/ui/StatusPill.tsx` (used on
  `/operator` for cron/worker status surfacing).

### 27.9 Playwright visual-regression CI gate

`dashboard-web/tests/visual/` holds Playwright specs that snapshot:
- `pages.spec.ts` — every top-level page (Home / P&L / Analysis /
  Campaigns / Products / Detail / Operator) at desktop + mobile
  breakpoints, in light + dark themes.
- `states.spec.ts` — key component states (drawer open / sub-tab
  switches / annotation pin hover / freshness stages).

The gate runs on **every PR** via GitHub Actions. Snapshot diffs
beyond the configured threshold fail the check; the failing run
uploads the Playwright HTML report as an artifact (`playwright-
report/`) for visual inspection. See commit `643fa6a` for the
workflow definition.

Updating baselines is intentional and requires running
`npx playwright test --update-snapshots` locally then committing the
updated PNGs.

### 27.10 Sidebar pin state contract

The slim 72px sidebar (Wave-5 / Q10, commit `ad2c4ff`) stores its
pinned state in `localStorage` under the key **`sidebar:pinned`**
(boolean as `"1"` / `"0"`). Behavior:
- Unpinned (default) — sidebar is 72px, icons only; hover expands
  it temporarily; mouse-leave collapses it.
- Pinned — sidebar stays expanded for the entire session even after
  mouse-leave.

Keyboard shortcut **`⌘\` (Mac) / `Ctrl+\` (Win/Linux)** toggles
pinned ↔ unpinned globally (registered at app root). Mobile is
unaffected — drawer behavior (§2.1.6) still applies via the
`<768px` media query.

### 27.11 Dual-mode theming (Light + Dark) — 2026-05-31 mesh re-skin

The re-skin reactivated the previously-disabled light mode, making both
themes first-class. The theming system is token-driven end-to-end; no
component holds hardcoded colors.

#### Token contract (`globals.css`)

```
:root {
  /* DARK token set — authoritative baseline */
  --canvas-1: oklch(…);
  --band-red: oklch(…);
  …all tokens…
}

[data-theme="light"] {
  /* LIGHT token set — re-declares every token */
  --canvas-1: oklch(…);
  --band-red: oklch(…);
  …all tokens…
}
```

The `:root` block holds the **dark** values; `[data-theme="light"]`
overrides **every** token with its light counterpart. A vitest
**`themeParity`** guard (`src/lib/__tests__/themeParity.test.ts`)
asserts at CI time that every token present in `:root` has a matching
declaration under `[data-theme="light"]` — preventing silent
single-mode regressions.

#### Theme resolution pipeline (`ThemeProvider`)

```
user choice ("system" | "light" | "dark")
    ×
OS prefers-color-scheme
    ↓
ThemeProvider resolves → effective theme ("light" | "dark")
    ↓
writes data-theme="light|dark" on <html>
    ↓
CSS selector [data-theme="light"] takes effect
```

`ThemeProvider` (`src/components/providers/ThemeProvider.tsx`) reads
the stored choice from `localStorage` (`theme-preference`), subscribes
to `window.matchMedia('(prefers-color-scheme: dark)')` for `system`
mode, and writes `document.documentElement.dataset.theme`.

**No FOUC:** `layout.tsx` injects an inline bootstrap script (≤200
bytes, before any `<link>` or body content) that reads `localStorage`
and sets `data-theme` synchronously — the browser paints the correct
theme on first render. `viewport.themeColor` in `layout.tsx` is
declared per-scheme via the Next.js `metadata.themeColor` array so
the browser chrome color updates correctly on mobile.

#### Theme-aware derivations

Tokens that vary continuously from the base color set use **OKLCH
relative-color** syntax so they flip automatically with the theme:

```css
/* Example: band-card gradient built from --band-red */
background: oklch(from var(--band-red) calc(l - 0.08) c h / 0.35);
```

Key derivation families:

| Surface | Technique |
|---|---|
| Band-card gradients (per-store, hero ROAS) | `oklch(from var(--band-*)…)` relative-color + mesh layering |
| Band chips + FreshnessBadge chips | Same relative-color via `--band-*/0.15` bg tint |
| Hero sparklines inside colored cards | `oklch(from var(--band-*) l c h / 0.6)` — semi-transparent brand color |
| Freshness desaturation (AGING/STALE) | CSS `filter: saturate(X)` on the `.glass` container |
| Platform dot re-saturation | Nested `filter: saturate(Y)` on `.platform-dot` overrides parent desaturation so brand colors (Meta/Google/TikTok) stay distinct even on STALE cards |
| Failure-day cell | `background: var(--cell-fail)` — tokens `oklch(10% 0 0)` dark / `oklch(15% 0 0)` light (near-black in both modes) |
| Tooltip surfaces | `var(--canvas-tooltip)` + `var(--text-canvas)` — no hardcoded `bg-ink text-white` |

#### Sidebar theme control

Three buttons at the bottom of the Sidebar (`☀️` / `🌙` / `🖥️`)
dispatch `setTheme('light' | 'dark' | 'system')`. The active choice
is visually highlighted. Command Palette (`⌘K`) exposes the same
actions as `theme-light`, `theme-dark`, `theme-system` commands.

---

## 28. Mesh exact re-skin + Campaign modal (2026-06-01)

A "match-the-mockup-exactly" pass on top of §27 — same data, same
algorithms, same operator workflow. Two parts:
(a) **mesh token additions + a green-ratchet design-color guard** that
enforces token-only colors across every component, and
(b) a **drawer → modal architecture change**: the Campaign view is now a
centered modal (a new `Sheet variant="modal"`) with the Ads drawer
rendered as an edge drawer *over* it.

The session also deleted **18 dead prior-design components** (HomeLiveBand /
HeroOverview / TodayLive / KpiCards / PerStoreCards / … + the unused
`ui/Dialog` and `ui/Select` primitives) — all unreferenced, nothing
user-visible changed. Commit range on `main`: `3fb43d7..ab2bf74`.

### 28.1 Mesh token additions

`globals.css` gained five tokens, each declared in BOTH the `:root`
(dark) and `[data-theme="light"]` blocks (the `themeParity` guard from
§27.11 enforces the dual-mode contract):

| Token | Role | Dark | Light |
|---|---|---|---|
| `--accent-soft` | icon-chip bg, operator accent-panel, mapped-product pill (alpha-safe tint) | `rgba(124,108,255,0.16)` | `#def5f7` |
| `--accent-bg` | alpha-safe replacement for the old `bg-accent/NN` tint sites | `rgba(124,108,255,0.12)` | `rgba(14,165,183,0.10)` |
| `--surface-sunken` | recessed surface (inset wells / track backgrounds) | `#191d31` | `#f1f3f9` |
| `--scrim` | dialog/modal backdrop dim | `rgba(0,0,0,0.6)` | `rgba(22,26,48,0.45)` |
| `--shadow-soft` | subtle 1px lift for flat surfaces | `0 1px 2px rgba(0,0,0,0.3)` | `0 1px 2px rgba(22,26,48,0.05)` |

Token-drift fixes in the same pass: card radius re-pinned to **18px**,
chip/control radius to **11/10px**, the accent pinned to the exact mockup
hex (`#0ea5b7` teal light / `#7c6cff` violet dark), band-orange / band-blue
light values corrected, and the chart annotation pin to `#f4a200`. A real
light-mode bug was fixed in the process: the date-picker glyph was
inverting white-on-white. Stale "glass+neon / mockup-04" narration was
purged from the token comments.

### 28.2 Design-color green-ratchet guard (token-only-colors enforcement)

`src/lib/__tests__/designColorGuard.test.ts` is a **green-ratchet** CI
gate that scans every component under `src/components/**` (excluding
test/story files) and FAILS on any forbidden color escape hatch:

1. `white` / `black` literals on `bg|text|border|fill|divide|ring`.
2. slash-alpha on those keywords (`white/NN`, `black/NN`).
3. raw Tailwind named palette (`gray|slate|…|fuchsia`)-NN.
4. inline color literals — `#hex` / `rgb()` / `hsl()` / `oklch()` inside a
   className or style string.
5. **slash-alpha on FLAT tokens** — e.g. `bg-accent/40`. The flat tokens
   bind to a bare `var(--…)` with no `<alpha-value>` channel
   (verified against `tailwind.config.ts`), so `/NN` silently DROPS its
   alpha — a visually-invisible footgun. The guard catches the bracketed
   and gradient-stop forms too (commit `e830563`).

**Explicitly allowed:** `var(--…)`, `color-mix(… var(--…) …)`,
`oklch(from var(--…) …)`, arbitrary `[color:var(--…)]`, the alpha-safe
tint tokens (`bg-accent-bg` / `bg-accent-soft` / `text-accent-fg` and the
status `*Bg` / `*Fg` tints used WITHOUT `/NN`), and token utilities like
`bg-status-green` (no digit after the color word → never matches the
named-palette regex).

**Ratchet mechanics:** a `MIGRATION_ALLOWLIST` holds the component paths
NOT yet migrated. The test fails when (a) a file NOT on the list has ≥1
violation (regression guard), OR (b) a file ON the list has 0 violations
(stale entry — it was fixed and must be removed). The list can only ever
shrink. This session migrated ~50 components and emptied the practical
allowlist down to seeded-migration exceptions only.

This guard complements the §26/§27 ESLint rules
(`no-hex-color-in-components`, `no-dark-variant-in-components`): ESLint is
a lint-time AST gate; `designColorGuard` is a vitest gate that also
catches the slash-alpha-drops-alpha class of bug ESLint can't see.

### 28.3 `Sheet` `variant` axis: `drawer` vs `modal`

`components/ui/Sheet.tsx` (the Radix-Dialog-backed sheet primitive) gained
a `variant` axis on its CVA alongside the existing `side` axis:

| `variant` | Presentation | Surface | Entrance | `side` |
|---|---|---|---|---|
| `drawer` (default) | edge-docked panel | gradient `from-glass-3 to-glass-2` + `--blur-sheet` backdrop + `--glass-edge-hot` opening-edge highlight | slide-in from the chosen edge | honored (`end`/`start`/`top`/`bottom`) |
| `modal` | centered floating card | **flat** `bg-glass-1` (no gradient), hairline `border-glass-edge`, `rounded-[var(--radius-hero)]` | `zoom-in-95 fade-in-0` | **IGNORED** |

Implementation notes:

- The shared CVA base keeps only truly common classes (`fixed z-50
  text-ink shadow-sheet animate-in duration-base ease-out`). Surface +
  entrance direction live **per-variant** so a modal never inherits the
  drawer's gradient/blur/slide.
- `side` is declared so the prop is accepted but emits **no** classes on
  its own; the edge positioning/slide/highlight is driven by
  `compoundVariants` gated on `variant === 'drawer'`. So a
  `<SheetContent variant="modal" side="end">` (or the default `side="end"`)
  never picks up edge classes.
- The modal layout: `left-1/2 top-1/2 -translate-*` centering,
  `w-[min(92vw,920px)] max-h-[88vh]`, flex-column, `overflow-hidden`. On
  **`max-sm`** it collapses to a full-screen edge-to-edge sheet
  (`inset-0`, `w-full`, `h-full`, `rounded-none`).
- **Overlay treatment follows the variant:** modal sits on the tokenised
  `bg-scrim` dim (§28.1); drawer keeps its frosted `bg-glass-3` wash. Both
  fade in. A new `overlayClassName` prop lets a nested drawer lift its
  scrim above a parent Sheet's overlay (see §28.4).

### 28.4 Drawer-over-modal stacking: CampaignDrawer (modal) + AdsDrawer (drawer)

`components/campaign-drawer/index.tsx` now renders its `SheetContent` with
`variant="modal"` (`p-0 sm:w-[min(880px,92vw)]` — the operator's preferred
880px width overrides the cva's 920px default; the mobile full-screen
sheet from `max-sm:w-full` still wins on phones). The **⤢ expand /
maximize control was removed** — the modal is a fixed-size centered card,
so only the X close remains (`pe-10` on the title row reserves space for
the primitive's auto-injected close X at `end-3 top-3`, z-20).

`components/AdsDrawer.tsx` stays an **edge drawer** (default
`variant="drawer"`, `side="end"`) but is rendered *over* the campaign
modal. Because the modal's overlay + content sit at `z-50`, the AdsDrawer
bumps BOTH its overlay and its content to **`z-[60]`**
(`overlayClassName="z-[60]"` + `z-[60]` on the content) so the modal's
scrim can never cover the ad-level drilldown. `twMerge` (via `cn`) lets the
`z-[60]` win over the primitive's default `z-50`.

**Esc handling — `lib/drawerStack.ts`.** A module-level stack coordinates
Esc across nested overlays so a single keystroke only closes the *topmost*
open layer (fixes #WR-01, where two `window` keydown listeners fired in the
same tick and collapsed the whole stack). Each layer calls
`useDrawerEsc(open, onClose)`; the hook pushes a **getter** (not the
callback itself) so it always reads the latest `onClose` ref without
re-pushing on every parent render (CC-02), and keys its effect on `[open]`
only. A single shared `window` keydown listener is installed lazily on
first push and removed on last pop, invoking only the top entry's current
callback. Result: **Esc pops the AdsDrawer first** (back to the Campaign
modal), **a second Esc closes the modal**. The Campaign modal additionally
sets `onEscapeKeyDown={(e) => e.preventDefault()}` so Radix's own
Esc-to-close doesn't race the stack — the stack is the single source of
truth for Esc.

DOM coverage: `components/__tests__/adsOverModalStack.dom.test.tsx`
(AdsDrawer-over-modal z-order + Esc ordering) and
`lib/__tests__/drawerStack.test.ts` (stack push/pop + top-only dispatch).

### 28.5 Post-deploy fidelity fixes (2026-06-01)

A small after-deploy polish pass on top of §27/§28. No data/algorithm/workflow
change — visual fidelity only.

- **V4 band top-bar (`::before`) removed.** Per operator, the 4px band-colored
  top-edge bar on banded cards (per-store + hero) read as "an annoying frame
  like a roof". It is now hidden at the BASE `.glass[data-band]::before` rule
  with `display: none;`; the per-band `::before` rules below set only
  background/box-shadow/height (never `display`), so they inherit the hide. The
  band SIGNAL is now the vivid card GRADIENT + the white `.v.banded` number +
  the `.band-chip` chip — the top bar is no longer part of the V4 contract
  (§27.2). The data-attribute contract itself is unchanged.

- **ROAS cells unified to SOLID status badges.** The Analysis/History monthly
  tables (`MonthlyTables.tsx`, `DetailTable.tsx`) and the Campaigns table
  (`CampaignsTableRow.tsx`, `AdSetTable.tsx`) previously washed the whole `<td>`
  in a PALE band tint (`bg-status-*Bg`). They now render the ROAS value as a
  SOLID rounded badge (white number on solid green/blue/orange/red) matching the
  campaign SCORE chips (`HealthScoreBadge.tsx`) and the mockup. The logic is
  consolidated into a single source of truth, `lib/format/roasCell.ts`
  (`roasCell()` returns `bg-status-{c} text-accent-fg`; `ROAS_BG` solid map;
  failure-cell still driven by the `roas-cell-fail` utility + `--cell-fail` /
  `--cell-fail-fg` tokens), plus the new `lib/format/RoasBadge.tsx` primitive
  (`RoasBadge` renders the inner chip; `roasCellTdClass()` keeps the full-cell
  wash only for the failure case). Thresholds + band→tone mapping unchanged.
  Covered by `lib/__tests__/roasCell.test.ts`.

- **Vivid per-store cards → all-white text + white-alpha CPM tiles.** On a vivid
  band per-store card the band gradient is the signal, so all text reads white
  (including platform names + CPM values) and the per-platform CPM tiles are
  white-alpha (not brand-tinted); the platform DOT keeps its brand color
  (`bg-current` on `.platform-dot`). Scoped to
  `.per-store-card.glass[data-band]:not([data-band="gray"])`. GRAY (no-data /
  ROAS-0) cards are excluded and additionally PINNED to dark ink (`var(--text)`)
  by an explicit `[data-band="gray"]` guard block, because the gray surface is
  near-white in light mode (light-on-light guard).

- **Campaign-drawer Daily charts** given an explicit min-height
  (`campaign-drawer/CampaignDrawerDaily.tsx`) so they don't squish inside the
  centered modal.

## 29. Readability & Legibility Hardening (2026-06-01)

A "readability & legibility hardening" initiative on top of §27/§28 — it
**builds on** the mesh re-skin (§28) and the Premium 2026 contract (§27). Same
data, same algorithms, same operator workflow, same pipeline: this is a
readability + accessibility (a11y) pass plus one coupled display bugfix and one
UX unification. No pipeline change. Two new contrast/overflow concerns are made
*hermetically enforceable* so the gains can't silently regress.

Five engineering pillars:

### 29.1 On-color token matrix (`--on-band-*` + `-muted`) — band text never derives from the band

The mesh band surfaces are gradients whose hue is the operator signal, so the
text that sits ON them must come from a **paired, independently-tuned on-color
token**, never from the variable band color. `globals.css` gained the matrix in
BOTH the `:root` (dark) and `[data-theme="light"]` blocks (the `themeParity`
guard from §27.11 enforces the dual declaration):

| Token family | Role |
|---|---|
| `--on-band-{red\|orange\|green\|blue\|gray}` | strong-contrast ink for the primary band-surface text (per-store ROAS number `.v.banded`, etc.) — AA-verified against the band's representative gradient stop |
| `--on-band-{band}-muted` | second-tier on-color for labels / the ROAS caption that sit on the BARE band tint (`.sl`, `roas-cap`) — still ≥ AA, but allowed to be softer |
| `--band-scrim` / `--band-scrim-ink` | a NEUTRAL sub-surface (white-alpha in light, near-black-alpha in dark) + its ink. Chips, CPM tiles and the freshness pill sit on this scrim so their contrast is independent of the underlying band hue |
| `--plot-bg` | neutral chart scrim / sparkline casing fill (§29.3) |
| `--metric-font` | shared `clamp()` font size for the overflow-safe number primitive (§29.2); theme-independent, re-declared identically in both blocks for parity |

**Rule:** any text rendered on a `.glass[data-band]` surface references one of
these paired tokens (or the neutral `--band-scrim-ink`). It must **never** be
hardcoded `white` (the bug this fixes: a light-theme white-on-white failure on
vivid cards) nor derived from the band color. The per-band CSS lives under
`.glass[data-band="…"] .v.banded` / `.sl` / `roas-cap` rules in `globals.css`.

**Freshness signal preserved on the scrim:** moving the LIVE/AGING/STALE pill
onto `--band-scrim` would have erased its status color, so STALE/AGING restore
the status hue as a small colored **dot** inside the white-alpha pill
(`.fresh-dot`), keeping the freshness signal legible without re-coupling to the
band.

**Hermetic gate — `src/lib/__tests__/contrastGuard.test.ts`** (static, vitest).
It parses the band hexes + every `--on-band-*` / `-muted` / `--band-scrim*`
token straight out of `globals.css` for BOTH `:root` and `[data-theme="light"]`
and fails CI if any pairing drops below WCAG-AA 4.5:1. Static (not axe) **by
design**: the band is a GRADIENT and axe only reads solid backgrounds — so this
guard owns the gradient surfaces in both themes (see the axe division of labor
in §29.4).

### 29.2 `<Money>` overflow-safe number primitive

`src/components/ui/Money.tsx` + its core `src/lib/metricFormat.ts`
(`formatMetricValue`). A 7-digit value can no longer overflow its cell or get
ellipsized.

- **`formatMetricValue(value, opts)`** is the single source of truth. Opts:
  `prefix` (`'$'` | `'CAD'` | `'none'`), `locale` (`'en-US'` | `'he-IL'`),
  `decimals` (`0` | `2`), `compactAbove` (default `100_000`). It returns
  `{ display, full, compacted }`: `display` is what's painted (compacted to a
  bounded `$X.XM` token iff `abs >= compactAbove`), `full` is always the exact
  locale-grouped value, `compacted` flags whether they differ. These opts let
  ONE primitive reproduce every prior money render site byte-for-byte (bare
  `he-IL` 0/2dp table cells, `$`-prefixed `en-US` compact hero, etc.). Negatives
  use U+2212; a tiny negative that rounds to 0 normalizes to `0` (mirrors
  `formatCurrency`). The compact path is intentionally locale-INDEPENDENT
  (`1.2M`) — compaction is an overflow floor, and `full`/title/sr-only carry the
  exact grouped value.
- **`<Money>`** renders a `<bdi dir="ltr" className="metric-num">` with the
  `display` string, and — ONLY when compacted — sets the native `title` to
  `full` plus an `sr-only` span carrying `full`. So the EXACT value is always
  recoverable on hover and to screen readers. RTL-isolated via `<bdi>`.
- **CSS contract (`globals.css`):** `.metric-num` is `tabular-nums` + `nowrap`
  and deliberately **size-agnostic** (Wave C3) so call-site size classes win and
  it does NOT force a width. Width reservation is opt-in via `.metric-reserve`
  (`min-inline-size: 8ch`) for the big hero/goal numbers; `.metric-cell`
  (`container-type: inline-size`) enables the `cqi`-based `--metric-font`. The
  overflow contract = `nowrap` + compact floor + exact value in title/sr-only.
- **Adoption:** per-store cards, campaigns/products tables, hero, goal tracker,
  top-list.
- **Hermetic gate — `src/lib/__tests__/moneyPrimitiveGuard.test.ts`**: a
  green-ratchet (identical mechanics to `designColorGuard` §28.2) that scans
  `src/components/**` for NEW raw money construction (`.toLocaleString(` and
  hand-built `$${…}` / `CAD ${…}` templates) and blocks regressions. Approved
  helper calls (`<Money>`, `formatMetricValue`, `formatCurrency`, `fmtMoney*`)
  are not flagged; a curated `MIGRATION_ALLOWLIST` records the legitimate
  exceptions (the detector over-matches by design — also catching date/count
  `.toLocaleString` and chart-axis tick formatters — and lets the allowlist
  carry one-line reasons). The list can only shrink.

### 29.3 Sparkline legibility on band surfaces

- **`Sparkline onBand` prop** (`src/components/ui/Sparkline.tsx`): when set, the
  SVG paints a neutral `--plot-bg` scrim rect behind the line AND a thick
  `--plot-bg` under-stroke (casing) beneath the colored stroke, so the trend
  line never collides with a same-hue band tint.
- **Hero `NetSparkline` — casing-only** (`components/home/CommandCenterHero.tsx`,
  refined in `caca263`): the featured Net-Profit card deliberately DROPS the
  plot-scrim rect and keeps only the casing under-stroke (neutral `--plot-bg`,
  thicker) under the band-colored line. This preserves the band color as the
  card's surface signal (no neutral panel over the gradient) while the casing
  alone keeps the line readable. `--plot-bg` is theme-aware, so the casing holds
  on every band in both themes.

### 29.4 Hermetic CI gates + axe-vs-static division of labor

Playwright now declares **two projects** — `chromium-light` (`colorScheme:
'light'`) and `chromium-dark` — both at 1440×900, and a **prod-overridable
`baseURL`** via `PLAYWRIGHT_BASE_URL` (when set, the local dev `webServer` is
skipped). Per the no-localhost-in-verify rule, the a11y gates run **post-deploy
against prod**. New specs:

- **`tests/visual/contrast.axe.spec.ts`** — `@axe-core/playwright`
  color-contrast on every tab, both themes. axe reads SOLID backgrounds.
- **`tests/visual/overflow.spec.ts`** — at 200% zoom, asserts no `.metric-num`
  element overflows its container (the `<Money>` overflow contract, validated in
  a real browser).

**Division of labor (documented so the coverage gap is intentional, not
accidental):** `@axe-core/playwright` color-contrast covers the **solid**
surfaces; the **gradient** band surfaces — which axe cannot read — are owned by
the static `contrastGuard` (§29.1), which measures the on-color token against
the parsed band stop hex in both themes. Together they cover every text-on-color
pairing in the app.

### 29.5 Coupled fixes — date-picker unification + attribution panel

- **Single global date picker (Campaigns + Products).** The redundant in-tab
  date pickers were removed from BOTH `CampaignsTable.tsx` and
  `ProductsTable.tsx`; each tab now follows the single page-global `range` prop.
  Implementation: `const localRange = range;` — `localRange` is kept as an
  **alias** of the `range` prop so the ~40 downstream references (SWR keys,
  attribution coherence, bucket math, aggregation) didn't have to churn. Old
  `c_from`/`c_to`/`p_from`/`p_to` (and `*_preset`) URL bookmarks degrade
  gracefully — they're parsed-but-ignored, then swept out of the URL by
  `syncTabLocalUrl`. This kills the dual-picker confusion AND the
  divergence-bug class that caused the attribution-panel disappearance below.
- **Attribution-panel Shopify-side-follows-range fix** (`CampaignsTable.tsx`,
  commit `cc87f54`). The "התאמת שיוך · Meta & Google & TikTok ↔ Shopify" panel
  reconciles the platform claim (`/api/campaigns`, keyed on `localRange`) against
  Shopify revenue. It previously used the page-global `dailyRows` prop for the
  Shopify side, so whenever the (now-removed) in-table picker selected a window
  outside the global range, the coherence gate saw two mismatched windows and
  hid the panel — which manifested as the panel vanishing for non-global ranges
  / non-uzoshop stores. Fix: the Shopify side now fetches `/api/data` keyed on
  the SAME `localRange` (`panelDailyRows = localDailyResp?.rows ?? dailyRows`,
  the global prop only as a first-paint fallback), so both halves always describe
  the same window. Verified on prod: the data was always present — this was a
  display bug, not sparsity.

Cross-references: builds on §27 (Premium 2026 design-system contract — V4 band /
freshness / semantic emphasis), §28 (mesh exact re-skin + token-only-color
ratchet). The contrast/money ratchets sit alongside the §28.2 `designColorGuard`
as the third and fourth green-ratchet vitest gates. No data/algorithm/workflow
change — readability + a11y + one display bugfix + one picker unification only.


## 30. Real-Time Shopify Activity Feed — Ingest (Phase 0-1, 2026-06-01)

**Goal:** replace the Home "פעילות אחרונה" card with a webhook-fed real-time feed
(sale + refund + add-to-cart) across the 3 stores. This section covers the
**ingest backbone** (Phases 0-1); the cart pixel/beacon (Phase 2) and the feed UI
+ LIVE badge (Phase 3) land in later commits. Spec:
`docs/superpowers/specs/2026-06-01-realtime-activity-feed-design.md`; plan:
`docs/superpowers/plans/2026-06-01-realtime-activity-feed.md`.

### New tables (migration `20260601120000_realtime_activity_feed.sql`)
- **`store_webhooks`** — per-store webhook routing + secrets, so connect /
  disconnect / change / **add a store is a row edit, never a redeploy**. Columns:
  `store_id → stores.id`, `shop_domain` (unique; matched against
  `X-Shopify-Shop-Domain`), `signing_secret` (server-webhook HMAC), `cart_public_token`
  + `allowed_origins[]` (Phase-2 client cart), `enabled`. **Service-role-only** —
  it holds secrets, so NO `anon` grant is issued (RLS is disabled project-wide;
  the absence of an anon grant is the access boundary).
- **`store_events`** — normalized feed rows: `type` (`sale|refund|add_to_cart`),
  `amount_cad` + `currency` + `amount_original`, `product_title`, `quantity`,
  `customer_label` (MASKED — initials or null, never raw PII), `occurred_at`,
  `received_at` (drives LIVE freshness), `dedupe_key` (UNIQUE → idempotent),
  `raw` (trimmed to a non-PII allowlist). Read in Phase 3 via a service-role
  server route behind the password gate (no anon grant).

### Ingest endpoint `POST /api/webhooks/shopify` (`runtime='nodejs'`)
Allowlisted in `isDashboardAuthAllowlisted` (Shopify can't present the dashboard
cookie); authenticates per-request instead:
- Reads the **raw body first** (`req.text()`) — HMAC is over exact bytes, never a
  JSON round-trip. Routes by `X-Shopify-Shop-Domain` → `store_webhooks` lookup.
- **HMAC-SHA256** over the raw body vs `X-Shopify-Hmac-Sha256`, **constant-time**
  (`timingSafeEqual`, equal-length-guarded). Unknown/disabled shop → `200` ack+drop
  (so Shopify stops retrying); bad signature → `401`; non-surfaced topic /
  unparseable JSON → `200`; valid → idempotent upsert on `dedupe_key`.
- **Retry-storm guards** (security review): the post-verify normalize+insert is
  wrapped so a transient DB/FX error returns `200` (not `500` → 48h of Shopify
  retries); the CAD conversion is **bounded by a 1.5s race** so a hung FX service
  can't blow the <5s ack window (→ `amount_cad` null, preserve `amount_original`).
  `occurred_at` is coerced to a valid ISO before the NOT-NULL timestamptz insert.
- CAD via the existing `makeCadConvert`/`getFxRate` (FX outage → null, "stale >
  wrong" money rule). PII masked at the normalize boundary.

### Operator wiring (STOP 1)
Per store, Shopify admin → Settings → Notifications → Webhooks → `orders/create`
+ `refunds/create` (JSON) → the endpoint URL; the store's single signing secret +
myshopify domain are stored as a `store_webhooks` row (applied out-of-band, secrets
never committed). The migration was applied to prod in isolation (the 2 unrelated
pending prior-phase migrations were set aside so only `20260601120000` pushed).

Tests: `shopifyHmac` (4), `normalizeShopifyEvent` (16, incl. PII-no-leak + occurred_at
sanity), `store` (7), route (8, incl. throw→200), middleware allowlist. No UI / no
data-pipeline change.

### Phase 3 — read API + feed UI + LIVE badge (2026-06-01)
- **`GET /api/store-events`** (`runtime='nodejs'`, `force-dynamic` + `no-store`): reads via
  `getSupabaseAdmin()` (service-role; `store_events` has NO anon grant) and stays **password-gated**
  (NOT in `isDashboardAuthAllowlisted` — unlike the two ingest paths). Returns
  `{ events: [latest 50, received_at DESC], serverNow, lastReceivedAt }`, optional `?store=` (filters
  `store_id`, applied before the cap). `nodejs`+`no-store` over ISR is deliberate: the service-role
  client isn't Edge-safe, and the feed must be real-time (the client owns the 12s cadence). Helper
  `readRecentStoreEvents({limit, storeId?})` in `src/lib/webhooks/store.ts`. Guard test
  `storeEventsRouteGuard.test.ts` pins service-role + nodejs + still-gated.
- **`<ActivityFeed>` rebuilt** (`src/components/home/ActivityFeed.tsx`): SWR-polls `/api/store-events`
  every 12s and renders the real-time Shopify feed (sale=green / refund=red / add_to_cart=blue, all
  token-driven; `<Money>` CAD; `<bdi>` numbers; store chips; relative time; RTL; AA both themes; DB
  strings rendered as escaped text). The **LIVE badge** derives state from `lastReceivedAt` vs the
  **server clock** `serverNow` (skew-immune) + SWR error: 🟢 listening (pulse + last-event time) / ⚪
  idle ("מאזין") / 🔴 disconnected ("נותק"). Pulse + new-row animation gated by `useReducedMotion`.
  The Home filter passes a display NAME; `resolveStoreId` maps it to the internal `store_id`
  (`"Zol Plus"`→`zolplus`, `"360usmile"`→`usmile360`) so per-store filtering isn't empty.
- **Refund currency**: `normalizeShopifyEvent` now scans all `transactions[]` for the first present
  currency, and when none is present treats the amount as CAD (display-only; the 3 stores are CAD) so
  refunds still show a figure.
- **No info lost**: the campaign-status feed still renders in `/operator` (`StatusEventsFeed` +
  `/api/operator/status-events`, untouched). Contrast guard extended +12 (3 glyph tones × both themes).
- Phase 2 (add-to-cart Custom Pixel + Lovable beacon → `/api/events/cart`) is the remaining ingest path.

### Phase 2 — add-to-cart ingest (client, 2026-06-01)
- **`POST` + `OPTIONS /api/events/cart`** (`runtime='nodejs'`, `force-dynamic`): browser-called (Shopify
  Custom Pixel on the 2 standard stores + a Lovable beacon on headless usmile), so **CORS** is on every
  response (`corsHeaders(origin)` echoes the Origin or `*`; preflight via `OPTIONS`). Auth is the per-store
  **`cart_public_token`** (`lookupStoreByCartToken`, enabled) — a PUBLIC token (lives in client JS), low-trust
  by design. Origin is **best-effort**: a sandboxed Web Pixel sends the literal `Origin: null` (opaque) — that
  AND an absent header are allowed (token-primary); rejection only when `allowed_origins` is non-empty and the
  normalized request origin (scheme+host+port) isn't listed. Dedup `dedupe_key='cart:'+event_id`; insert
  wrapped → always `204` (never 5xx → never blocks a storefront add-to-cart). NO PII (no money/customer;
  `product_title` capped ~200). Middleware-allowlisted (Phase 1). **Display-only — never feeds aggregates/billing.**
- Per-store `cart_public_token` seeded in `store_webhooks` (PUBLIC tokens; `allowed_origins` left empty = token-only
  to start, tightened later). STOP 2 = operator pastes the Custom Pixel (Settings → Customer events) in uzoshop +
  Zol Plus and adds the beacon to the Lovable usmile frontend.

### Phase 3.1 — "פעילות" tab + paged events API + mobile polish (2026-06-01)
- **`GET /api/store-events` paged branch (additive, back-compat):** with NO `page` param it returns the
  legacy `{ events, serverNow, lastReceivedAt }` (the Home feed is unchanged); with `page` it returns
  `{ events, total, page, pageSize, serverNow }` and honors `from`/`to` (ISO; default last 30 days,
  IL-anchored, `to` end-of-day inclusive), `store` (id; 'All'→none), `type` (sale|refund|add_to_cart;
  'all'→none). Helper `readStoreEventsPaged({from,to,storeId?,type?,page,pageSize})` in store.ts (service-role;
  `received_at DESC`; `count:'exact'` + `.range()`; pageSize clamped ≤100, page ≥1). Still nodejs +
  service-role + password-gated (NOT allowlisted; storeEventsRouteGuard green).
- **New `activity` tab** wired exactly like the archive/trends split: `urlState.ts` (TabKey + TAB_VALUES),
  `Sidebar.tsx` (Zap nav item, slot 2 — right after בית), `CommandPalette.tsx`, `Dashboard.tsx`
  (`activeTab==='activity'` → `<ActivityEventsTab>`). `src/components/activity/ActivityEventsTab.tsx` = the
  browser: compact store/day/type filters → the paged API (store NAME→id resolve), day-grouped rows
  (lucide glyph tones sale/refund/cart, `<Money>` CAD, store chips), pagination, empty/loading. The Home
  `<ActivityFeed>` gains an `onSeeAll` "ראה הכל ‹" footer link (Dashboard threads
  `handleTabChange('activity')`) and is **capped to the latest 20 rows** (snapshot, not an archive).
- **Mobile-only Home polish (desktop frozen at md+):** A3 sliding range-pills inside `Filters.tsx` (new
  `--pill-*` tokens both themes; the on-thumb accent was deepened so white clears AA — the mockup hue would
  have failed); B3 `MobileStickyRoas.tsx` (IntersectionObserver collapse, reduced-motion gated, z below the
  z-30 app header). Year/month selectors in `AnalysisArchiveTab.tsx` narrowed to w-28/w-40 on one row.
- No data-pipeline change; `store_events` is the single source for both the live feed and the tab.


## 31. Tooltip system (2026-06-03)

**Goal:** unify every help affordance behind ONE primitive — `HelpTooltip`
(`src/components/ui/Tooltip.tsx`) — that auto-selects a render mode from
**pointer-type × content-shape**, is touch-friendly, and is hermetically guarded.
No new data/algorithm/workflow; presentation only. Builds on the §27/§28/§29 design
contract (glass surfaces, token-only color, AA, `<Money>` for numbers).

- **Single entry point + load-bearing passthrough.** `HelpTooltip`'s public
  signature is unchanged, and the `null`/`''` content passthrough (returns the child
  untouched) is preserved — so the ~32 existing call-sites upgraded for free.
  `useIsMobile(767)` is called UNCONDITIONALLY at the top (before the null
  early-return) to honor the hooks rule.
- **Four auto-selected modes** (content shape: a plain `string`/`number` is *simple*;
  a non-string `ReactNode`, an explicit `variant="rich"`, or a `title` is *rich*):
  - **A · desktop simple** → Radix **Tooltip** (`role="tooltip"`), glass-2 bubble,
    `Arrow` + `collisionPadding={8}`, opens on hover/focus, Esc/blur to close.
  - **B · desktop rich** → Radix **Popover** (`role="dialog"`, `tooltip/RichPopover.tsx`),
    **hover-intent** (open ~180ms after pointer-enter or on click; stays open while the
    popover is hovered so its content is readable/selectable), glass-1 card,
    `whitespace-pre-line` body, optional `title`.
  - **C · touch simple / short-rich** → **ⓘ toggletip** (`tooltip/Toggletip.tsx`): a
    paired `<button aria-label>` with a ≥44px hit area that tap-opens a Popover carrying
    the body; a `role="status"` live region announces it; tap-outside/Esc close.
  - **D · touch long-rich** → bottom **Sheet** (`tooltip/RichSheet.tsx`, Radix Dialog
    `side="bottom"`) with a header `title` + visible `✕`. Length heuristic: rich AND
    (has a `title` OR block/array content) → Sheet; short-rich stays the C tap-Popover.
- **Props (additive):** `variant?: 'auto'|'text'|'rich'` (`'text'` pins JSX content to
  a *simple* tooltip — no surprise Popover), `title?`, `withinDrawer?` (lifts content to
  `z-[60]` so it clears a parent Sheet/drawer scrim). Delays tuned at the app-root
  provider (`src/app/layout.tsx`): `delayDuration={200}` / `skipDelayDuration={300}`.
- **Radix building blocks:** `@radix-ui/react-tooltip` (mode A) + `@radix-ui/react-popover`
  (modes B/C) + the existing `Sheet` (Radix Dialog, mode D).
- **Migration completed (Phases 2–4):** native `title=` leftovers wrapped in `HelpTooltip`
  (or dropped to `aria-label` where redundant on optimize-toggles); the `RoasTargetChart`
  dot SVG `<title>` removed (crosshair covers it); the 4 bespoke hover-popovers
  (`RefundIndicator`, `ProductCentricView` `ColHelp`×9 + `HoverTooltip`, `CampaignsTable`
  `ColumnHeaderTh`×4) folded into the rich primitive — fixing the prior `overflow-auto`
  clipping in scroll tables. Chart-anchored tooltips (`RoasTargetChart`, `CustomerValueCurve`)
  keep their SVG/pointer anchoring but wear the shared rich-card chrome + ARIA + `<Money>`.
  Recharts' `ChartTooltip` is left untouched as the skin reference.
- **Hermetic CI guards:**
  - **`local/no-native-title-tooltip`** (ESLint, re-armed to **error**) — forbids native
    `title="…"` tooltips, including the previously-bypassed prop-forwarding primitives
    (`Button`/`IconButton`/`Chip`/`Badge` spread `{...props}` to a host element, so the
    `title` would leak to the DOM); the SVG `<title>` content element stays exempt.
  - **`tooltipFocusableGuard`** (`src/components/ui/__tests__/tooltipFocusableGuard.dom.test.tsx`)
    — asserts no focusable element (`a/button/input/select/textarea/[tabindex]`) ever renders
    inside a `role="tooltip"` (rich/focusable content MUST be a Popover/Sheet dialog, not a
    tooltip). Mode-selection + a11y + null-passthrough covered by
    `src/components/ui/__tests__/Tooltip.dom.test.tsx`; keyboard + touch-emulation + both-theme
    by `tests/visual/tooltips.spec.ts` (Playwright).

## 32. WS3 — In-app intelligence: campaign-died + creative-fatigue + action list (2026-06-04)

WS3 extends the pure insights engine (`lib/insights.ts`) with two new
detectors and a ranking layer, and surfaces the result as an always-visible
"do this now" action list above the (collapsed-by-default) `InsightsBoard`.
Everything is **client-side over existing endpoints** — no new cron, no new
API route, no migration. READ-ONLY: no pixel/CAPI events; the existing
WhatsApp alerts are untouched (the WhatsApp *push* of these insights was
descoped).

### 32.1 New detectors (pure, TDD)
- **`lib/insights/campaignDied.ts` → `detectCampaignDied(campaigns, currentEffectiveStatus?, today?)`**
  Flags an *established* campaign that went dark. Groups daily `CampaignRow`s
  (`/api/campaigns` → `campaigns_enriched`) by `${storeName}::${platform}::${campaignId}`
  over the last 14 days. Establishment gate: ≥7 active days **and** mean ≥CAD 50/day
  over the prior window `[today-13 .. today-1]`. Dark gate: spend on the
  most-recent **completed** day (`today-1`) ≤ CAD 1 — the **current** Israel day is
  excluded (mirrors the dead-day current-day suppression) and a **missing** `today-1`
  row counts as 0 (the enriched view drops zero-activity rows). Severity `critical`,
  weight **96**. The cause hint reads the live `CampaignsResponse.currentEffectiveStatus`
  map (keyed `${storeId}::${Platform}::${campaignId}::${adSetId}` — resolved via exact /
  bare-id / `::<id>` substring fallback, freshest `updatedAt` wins) and softens to
  "marked paused" only when the platform reports PAUSED/REMOVED/ARCHIVED; it never
  asserts the cause as fact.
- **`lib/insights/adFatigue.ts` → `detectAdFatigue(ads)`**
  Base CTR+CPM creative-fatigue. Groups per-day `AdRow`s (`/api/ads` →
  `ads_enriched`) by `${storeId}::${platform}::${adId}`, splits the date window at
  its midpoint (≥6 unique days per half required), and flags **iff** `recentCtr ≤
  0.7·priorCtr` **and** `recentCpm ≥ 1.2·priorCpm` above a 5,000-combined-impression
  noise floor. Severity `opportunity`, weight **68**, carrying the **parent
  campaignId** so the drawer + Ads-Manager link resolve. The **frequency-climb leg**
  (the strongest fatigue signal) is **deferred** — it needs an `ads_daily.frequency`
  column + a Meta fetcher field that don't exist yet; do NOT fabricate frequency from
  impressions.

### 32.2 Ranking + wiring
- **`lib/insights/prioritize.ts` → `prioritizeInsights(insights, n)`** — pure dedup +
  rank. Dedup key: `c:${campaignId}` → `s:${scope}:${kind}` → `id:${id}` (keep max
  weight, tie-break by severity then id). Sort weight-desc → severity-rank → id-asc.
  Returns `filter((ins, idx) => idx < n || ins.severity === 'critical')` — top-N with
  criticals **always** kept. Does **no** visibility filtering (the caller passes only
  `isInsightVisible` rows).
- **`lib/insights/adsManagerLink.ts`** — the campaign deep-link helper, **extracted**
  so `insights.ts`, `campaignDied.ts`, and `adFatigue.ts` share one copy (was an
  internal in `insights.ts`). Imports nothing from `insights.ts` → no cycle.
- **`buildAllInsights(rows, campaigns, products, ads = [], opts?)`** gained a 4th `ads`
  arg + an `opts.currentEffectiveStatus` (backward-compatible: existing 3-arg callers +
  tests unchanged). It now splices `detectCampaignDied` + `detectAdFatigue` into the
  weight-sorted merge.
- **`InsightsBoard.tsx`** adds a third SWR fetch (`/api/ads`, 120s, same cadence as
  products/campaigns), passes `ads.rows` + `campaigns.currentEffectiveStatus` into
  `buildAllInsights`, computes `prioritizeInsights(visible, 5)`, and renders the new
  **`components/insights/ActionListPanel.tsx`** above the board. The board's old
  collapsed-state `InsightHero` + all-clear surfaces were removed — the action list now
  owns the collapsed headline + the calm "all good" state; the board below remains the
  full grouped archive.
- **Range-scoped fetch fix (2026-06-04, UM 2.37.1).** The board now analyzes a FIXED
  trailing 30-day window (`INSIGHTS_WINDOW_DAYS`), independent of the dashboard's selected
  range. All four data routes (`/api/data`, `/api/campaigns`, `/api/ads`, `/api/products`)
  **require** `?from=&to=` (`parseRangeParams` throws otherwise → degraded empty body), so
  the board builds range-scoped SWR keys via `buildDateRangeKey(path, insightsRange)` —
  exactly like `CampaignsTable`. Before this the board fetched them param-less → empty →
  recommendations + both WS3 detectors never fired (anomalies still worked because they
  read the range-scoped `data` prop). Anomalies now read the trailing-window `/api/data`
  fetch; the `data` prop is only a no-flash fallback while it loads. Guarded by
  `insightsBoardDataWiring.dom.test.tsx`.

### 32.3 Tests
`campaignDied` (8) + `prioritize` (11) + `adFatigue` (8) node tests; `ActionListPanel`
(7) DOM test. All pure-logic detectors are deterministic (a `today` seam on
`detectCampaignDied` for fixtures; the others read no clock).

## 33. Last-known budget_type (CBO/ABO chip stability, 2026-06-05)

The CBO/ABO chip in the campaigns table read `CampaignAgg.budgetType`, which the aggregator fills only from in-range `campaigns_daily` rows whose `budget_type` is non-empty (the update loop is gated `if (r.budgetType)`). `budget_type` is DERIVED at write time (CBO when campaign budget>0, ABO when adset budget>0, else `''`), and Meta returns 0/0 budgets for paused/lifetime/budget-off campaigns — so a single-day / "today" window (now the default range) often had all-empty rows → the chip vanished.

Fix mirrors the `currentEffectiveStatus` last-known-status pattern exactly (no schema change — `campaign_registry` has no budget_type column):
- `fetchLastKnownBudgetTypes()` (`postgresReaders.ts`, parallel to `fetchCurrentCampaignStatuses`) — reads `campaigns_daily` where platform=meta AND budget_type IN ('CBO','ABO'), keeps the most-recent date per `${storeId}::${Platform}::${campaignId}::${adSetId}` key, soft-fails to `{}`.
- `/api/campaigns` adds it as a 4th `Promise.all` reader + a `lastKnownBudgetTypes` field on `CampaignsResponse` (`{}` on the degraded path).
- `aggregateCampaigns` (`campaignsAggregator.ts`) takes it as an optional param and runs an override pass AFTER the currentEffectiveStatus block: for any aggregate with `!budgetType`, fill from the last-known map (adset-mode = direct key; campaign-mode = freshest entry under the campaign prefix). The gated update loop is untouched, so any in-range value still wins. `CampaignsTable` threads it through; `CampaignsTableRow` is unchanged. Guarded by 4 new `campaignsAggregator.test.ts` cases.

## 34. Data-Trust on screen (Wave 3, 2026-06-05)

Surfaces trust signals where decisions happen. All READ-ONLY/CAPI-safe; every UI piece self-hides when its data is absent. Five pure helpers (TDD) + thin soft-fail-200 routes (all mirror `/api/operator/freshness`: runtime=nodejs, dynamic=force-dynamic, captureRouteError+userFacingError, 200 + empty-shape+error on throw) + presentational components.

- **DQ-1 reconciliation** — pure `reconcileRows(input)` (`lib/audit/reconcileRows.ts`, extracts the INV-7/9/10 checks from `reconcile.ts` via read-only imports; the TikTok account-vs-Σcampaigns gap stays tolerated) → async `reconcileLive(now?)` (`lib/audit/reconcileLive.ts`, fetches the 4 sources for the last ~7 completed IL days via the existing postgres readers) → `GET /api/reconcile` `{violations,error?}`. UI: `<ReconcileBanner/>` (Home, null unless violations) + `<ReconcilePanel/>` (operator HealthTab).
- **DQ-3 manual-override flag** — `fetchManualOverridesForRange(range)` + pure `overridesActive(rows,range)` → `GET /api/active-overrides` `{anyActive,byStorePlatform,error?}`. UI: `<OverrideFlag/>` on Hero spend + P&L ad-spend (Dashboard fetches + scopes to the store filter). Migration `20260604130000_manual_overrides_audit_cols.sql` adds nullable `updated_at`+`applies_to` (no `created_by` — single-operator); the operator manual-overrides POST/PATCH now stamps `updated_at`.
- **DQ-4 provenance** — `fetchDailyDataFromPostgres` now projects `is_finalized/source/last_live_tick_at/reconciled_at` onto `DailyRow` (cols pre-existed since 20260530100002; just unprojected). Pure `provenanceForRange(rows)` → `'finalized'|'live_estimate'|'unknown'`. UI: `<ProvenanceFlag/>` on Hero + P&L (null on 'unknown').
- **DQ-5 source health** — pure `sourceStatusRollup(FreshnessRow[])` (success+budget_skip = healthy; worst non-healthy per store×platform) → `GET /api/freshness-summary`. UI: `<SourceHealthChip/>` near TabFreshnessHeader (null when healthy).
- **DQ-6 cohort as-of** — `cronCohortRefresh` now `recordFreshness({scope:'cohort_monthly',...})` per store (success/error); `fetchCohortAsOf()` reads max last_success_at; `/api/cohorts` returns `asOf`. UI: `<CohortAsOfBadge/>` in the Customers tab header (fresh ≤7d info / stale >7d warning). No migration (reuses data_freshness).
- **DQ-7 TikTok coverage** — `fetchTikTokCoverageInputs(range)` (account total = Σ data_daily tt_spend; campaigns from campaigns_daily; advertiserId from env) → `GET /api/tiktok-coverage`; pure `tiktokCoverage()` computes unmapped/unattributed client-side against the campaign-store map. UI: `<TikTokCoveragePanel/>` (operator HealthTab, below the static disclaimer).

Drill bridge (2026-06-05): a Dashboard-level `roas-open-campaign-drawer` listener routes the InsightActions "פתח קמפיין" through `drillToCampaigns` when the campaigns tab isn't mounted (the board/action-list live on Home where CampaignsTable — the only other subscriber — is absent). See §32 for WS3.

## 35. Deep-QA precision fixes (2026-06-05)

Post-launch deep audit (DB ground-truth + adversarial code audit; 11 core systems verified sound) — 8 fixes:
- **`_fbc` 7-day click gating** (`lib/fetchers/shopify.ts` `classifyOrderAttribution` + new exported `fbcIsFreshClick`): Meta's `_fbc` cookie persists ~90 days, so presence-alone over-attributed Meta. Per Meta's official spec (`fb.<subdomainIndex>.<creationTimeMs>.<fbclid>`) we parse the click time and treat the cookie as a paid signal ONLY within Meta's default **7-day click** window vs `order.created_at`. The real per-click `fbclid` URL param remains a fresh signal on its own. Affects new-order classification only.
- **GoalTracker month-end forecast salaries** (`lib/insights.ts` `forecastMonthEnd` + GoalTracker): the forecast net now subtracts `salariesForRange` (MTD) + extrapolated month salaries, matching the dashboard P&L net definition (was ~7%-of-revenue too high). Optional param → legacy callers unchanged.
- **Hero coverage chip** now filters by `filters.store` (was business-wide regardless of selected store).
- **First-click coverage chip** display clamped to ≤100% (raw ratio kept in tooltip).
- **ChannelTruthPanel** "אין גיוס" vs "אין נתונים" (spend-but-no-acquisition vs truly empty).
- **Cohort grid** marks the current partial month "(חלקי)"; **cohort profit curve** no longer exceeds the net curve when a cohort-month net is negative (`net>=0 ? net*keepRate : net`).
- **CampaignDrawer** uses `effectiveStoreId` consistently for cohort/reconciliation/attribution (was raw `storeId` → cohort vanished + reconciliation zeroed for remapped-store TikTok campaigns).
- **Overcount basis (documented, no change):** `overcountByChannelFromCampaigns` verified-revenue is GROSS (`total_price`) — intentional + correct because the platform claim is also gross; overcount is a like-for-like gross comparison (NC-ROAS is net by design; overcount is gross by design).
