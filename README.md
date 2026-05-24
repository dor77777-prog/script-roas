# ROAS Tracker — דשבורד מעקב מודעות + הזמנות ל-3 חנויות Shopify

מערכת end-to-end שעוקבת אחרי ROAS, רווחיות, ו-attribution דטרמיניסטי של 3 חנויות Shopify (`uzoshop`, `Zol Plus`, `360usmile`). פרודקשיין: https://roas-dashboard-smoky.vercel.app

## ארכיטקטורה (Phase 11+, מאי 2026)

הכל זורם דרך tier אחד של Next.js + Inngest + Supabase Postgres:

```
[Shopify / Meta / Google Ads / TikTok APIs]
            ↓ (Inngest cron jobs)
        [Supabase Postgres]
            ↑ (Next.js API routes)
   [Dashboard UI — 6 tabs, drill-down, cloud-sync]
```

**Inngest crons** (ב-[dashboard-web/src/inngest/functions/](dashboard-web/src/inngest/functions/)):
- `cron-daily-{store}` × 3 — רץ ב-00:05 IL, אוסף את היום הקודם מ-Shopify / Meta / Google / TikTok ושומר ל-Postgres
- `cron-live-{store}` × 3 — כל 10 דקות, מרענן את ההיום (rolling 3-day window + effective_status)
- `whatsapp-daily-summary` × 3 — 12:00 + 18:00 + 00:30 IL — שולח סיכום WhatsApp לאופרטור
- `event/sync-now` — נקרא מ-`/api/operator/sync-now` (כפתור "רענן הכל" ב-UI)
- `event/backfill` — נקרא מ-`/api/operator/backfill` (לדריסת טווח היסטורי)

**Dashboard** ([dashboard-web/](dashboard-web/)) — Next.js 15 + React 19 + Tailwind CSS + Hebrew RTL UI. 6 טאבים:
- בית · P&L · ניתוח · קמפיינים · מוצרים · פירוט
- drill-down ב-3 רמות (Store → Campaign → Ads), trust chip של attribution
- cloud-sync של state בין מכשירים (annotations, billing, יעד חודשי, מיפויי מוצרים)
- multi-mapping intelligence (cohort comparison + cannibalization detection + cohort-aware Health Score)

לכל הפרטים על ה-data flow + algorithmic surface — ראה [SYSTEM_OVERVIEW.md](SYSTEM_OVERVIEW.md).

## מבנה הקבצים

```
dashboard-web/                Next.js app — הכל פה
  src/
    app/                      Next.js App Router (pages + API routes)
      api/
        data/route.ts         GET /api/data — אגרגציה ראשית
        campaigns/route.ts    GET /api/campaigns — נתוני קמפיינים
        operator/             Operator console (sync-now, backfill, jobs, manual-overrides)
        inngest/route.ts      Inngest webhook endpoint
    components/               UI components (Dashboard, TodayLive, KpiCards, ...)
    lib/                      Pure logic
      analytics.ts            aggregate / aggregateByStore / dailySeries
      insights.ts             forecastMonthEnd, computePacing
      attributionAnalysis.ts  Bayesian CI + trust score + window stability
      campaignHealthScore.ts  4-component health score with cohort adjustments
      cpmRoasAnalysis.ts      half-over-half + previous-period
      multiMappingCohort.ts   cohort comparison + Bayesian shrinkage
      cannibalizationDetection.ts  rebalanced-cohort + composition_changed
      productCentricView.ts   product-level revenue allocation
      fetchers/               meta / googleAds / tiktok / fx / shopify
      postgresReaders.ts      Supabase read layer (camelCase shape parity)
    inngest/
      client.ts               Inngest client singleton
      functions/              cron + event handlers
docs/                         External-facing notes
.planning/                    Phase planning artifacts (PRDs, AUDITs, PLANs)
supabase/                     SQL migrations + RLS policies
```

## חוקי צבע ROAS

| ROAS              | צבע   |
|-------------------|-------|
| `< 2`             | אדום  |
| `2` עד `2.69`     | כתום  |
| `2.7` עד `3`      | ירוק  |
| `> 3`             | כחול  |

## Setup

מערכת deployed-only — single-operator URL-obscurity model, אין הוראות "הרץ מקומית" לקהל הרחב.

לפרודקשיין:
1. Vercel project מחובר ל-repo הזה; כל push ל-`main` בונה ומדפלוי
2. Env vars נדרשים ב-Vercel:
   - `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
   - `META_ACCESS_TOKEN`, `META_AD_ACCOUNT_ID_{STORE}` × 3
   - `GOOGLE_ADS_*` (uzoshop בלבד כרגע)
   - `TIKTOK_ACCESS_TOKEN`, `TIKTOK_ADVERTISER_ID_{STORE}`
   - `SHOPIFY_ACCESS_TOKEN_{STORE}` × 3
   - `${STORE_UPPERCASE}_COGS_RATE` × 3 (אופציונלי — fallback 0.25; ראה [COGS_SETUP.md](COGS_SETUP.md))
   - `WHATSAPP_*` (Meta WhatsApp Cloud API)
   - `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY` (אוטומטי דרך Vercel-Inngest integration)
3. Supabase migrations רצים דרך `supabase db push` (ראה [supabase/migrations/](supabase/migrations/))
4. Inngest cloud מקבל webhook ב-`/api/inngest`; ה-functions מתרשמים אוטומטית בכל deploy

לפיצ'ר ה-attribution — ודא שב-Meta Ads Manager מוגדרים URL Parameters לכל הקמפיינים:
```
utm_source=meta&utm_medium=paid_social&utm_campaign={{campaign.name}}
&utm_id={{campaign.id}}&utm_term={{adset.id}}&utm_content={{ad.id}}
```
זה מאפשר match דטרמיניסטי ברמת קמפיין / ad-set / ad לפי click-id.

## תיעוד נוסף

- [SYSTEM_OVERVIEW.md](SYSTEM_OVERVIEW.md) — אפיון מלא של זרימת נתונים + רכיבי המערכת
- [COGS_SETUP.md](COGS_SETUP.md) — איך מגדירים את ה-COGS rate פר-חנות
- [WELCOME.md](WELCOME.md) — מסמך operator-facing קצר
- [.planning/AUDIT.md](.planning/AUDIT.md) — האודיט האלגוריתמי האחרון (Phase 9)

## Historical note

עד Phase 11 (2026-05-24) המערכת רצה ב-2 שכבות — Apps Script (Google Sheets writer) + Next.js (Sheets reader). ההגירה ל-Supabase Postgres הושלמה ב-Phase 05.7.0 (`READ_FROM=postgres` permanent), ו-Phase 11 הסירה את שכבת ה-Apps Script לחלוטין. SYSTEM_OVERVIEW.md מכיל note היסטורי בראש שמסביר את הארכיטקטורה הישנה.

<!-- Phase 13.3 auto-deploy verification 2026-05-24 -->
