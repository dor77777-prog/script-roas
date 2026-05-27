# ROAS Dashboard — Architecture & System Reference

> **קהל יעד**: מפתחים, מי שמתחזק את הקוד, AI agents שעובדים על הריפו.
> זה לא user manual — לזה יש את [docs/ROAS-Dashboard-User-Manual.md](ROAS-Dashboard-User-Manual.md).
>
> **גרסה**: 1.0 · **תאריך**: 2026-05-22 · **בסיס קוד**: Phase 05.7.x

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
| `orders_attribution` | פר order: `source` (meta-paid / google-paid / tiktok-paid / direct / etc), `utm_id`, `utm_campaign`, `fbclid`, `gclid` | Inngest cron-daily + cron-live | `/api/orders-attribution` |
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
| `cron-oauth-canary` | `0 0 * * *` IL | פעם ביום פינג ל-fetchGoogleAdsSpendForDay('uzoshop', yesterday) כcanary לרענון refresh-token; failure → Sentry + Inngest dead-letter (Phase 13.4) |

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
- **Auth**: OAuth refresh-token + developer-token. ENV: `GOOGLE_ADS_DEVELOPER_TOKEN`, `<STORE>_GOOGLE_ADS_CUSTOMER_ID`, `<STORE>_GOOGLE_ADS_REFRESH_TOKEN`.
- **GAQL**: `SELECT campaign.id, campaign.name, campaign.status, metrics.cost_micros, ... FROM campaign ...` ו-`SELECT ad_group.id, ad_group.status, ... FROM ad_group ...`.
- **status fields**: `campaign.status` (`ENABLED` / `PAUSED` / `REMOVED`), `ad_group.status` (same).
- **Conversions**: לוקחים `conversions` + `conversions_value` ישירות מ-`metrics`.

### 5.4 TikTok Marketing
- **API**: `v1.3`.
- **קובץ**: `dashboard-web/src/lib/fetchers/tiktok.ts`.
- **Auth**: long-lived access token + advertiser_id. ENV: `UZOSHOP_TIKTOK_ACCESS_TOKEN`, `UZOSHOP_TIKTOK_ADVERTISER_ID` (TikTok פעיל רק על uzoshop נכון להיום).
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
`+15` אם מסומן optimized; `−30` אם `effective_status` = כבוי.

### 7.5 ציון סופי + grade
`score = Σ(component × weight) + operatorAdj` clamped ל-[0,100].
- A ≥ 75
- B ≥ 60
- C ≥ 45
- D ≥ 30
- F < 30

### 7.6 Tests
39 vitest tests ב-`dashboard-web/src/lib/__tests__/campaignHealthScore.test.ts`. מכסים: shape, insufficient gate, source-of-truth priority, trust modulation, volume tiers, trajectory mapping, attribution clarity, operator adjustments, realistic scenarios.

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
| WhatsApp test | POST `/api/operator/whatsapp/send-now` | Inngest `event-whatsapp-send-now` |
| Reset Data | POST `/api/operator/reset` `{scope,confirm}` | ישיר ל-Supabase admin client |

### 11.2 Auth
**אין auth.** מודל URL-obscurity — אל תשלח את ה-URL.

### 11.3 Secrets handling
`INNGEST_SIGNING_KEY` + `INNGEST_EVENT_KEY` + `SUPABASE_SERVICE_ROLE_KEY` — server-side בלבד. 0 התאמות ב-`.next/static/` לאחר build (bundle scan).

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

### 16.3 Read pattern
ב-mount, הקומפוננטה קוראת מ-localStorage. ברקע, `useCloudSync` מבקש את ה-server value וממזג. השרת תמיד win על קונפליקט (אחרון-כותב, סינגל-משתמש מבטיח שאין race).

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
