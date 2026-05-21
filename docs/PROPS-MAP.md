# PROPS-MAP — v2.0 migration property classification

> Operator checklist gating Phase 05.7 cut-over. Each row is one Apps Script
> PropertiesService key from `.env`. Tick `[x]` in "Seeded?" only after
> verifying the destination (`vercel env ls production` OR
> `SELECT * FROM notification_config`).
>
> **Type values (per D-C3):** `SECRET` = Vercel env var, sensitive (tokens, keys);
> `CONFIG` = Vercel env var, low-sensitivity (domains, IDs); `DATA` = Supabase row
> (operator-editable via UI in Phase 05.6); `n/a` = legacy duplicate, do not seed.
>
> **Sorting:** by `.env` section (matches mental model "work one service at a
> time"), NOT by type. See §`Sorting rationale` in RESEARCH.md §Pattern 8.
>
> Total: **43 rows** (40 from `.env` + 3 new Supabase keys per D-C5).

| #   | Property key                 | Type   | Destination                                                 | Source value                            | Seeded? |
| --- | ---------------------------- | ------ | ----------------------------------------------------------- | --------------------------------------- | ------- |
| **§1 — Google Sheets data plane (3 props)** | | | | | |
| 1   | spreadsheet.id               | CONFIG | VERCEL_ENV: SPREADSHEET_ID                                  | 1f5tbc-8...                             | [ ]     |
| 2   | spreadsheet.canonical-id     | n/a    | — (legacy duplicate of #1; do not seed)                     | —                                       | n/a     |
| 3   | archive.spreadsheet.id       | CONFIG | VERCEL_ENV: ARCHIVE_SPREADSHEET_ID                          | 1p3DNHO9...                             | [ ]     |
| **§2.1 — Notification dispatch (6 props)** | | | | | |
| 4   | notify.provider              | DATA   | supabase: notification_config.provider                      | metacloud                               | [x]     |
| 5   | notify.dashboardUrl          | DATA   | supabase: notification_config.dashboard_url                 | https://roas-dashboard-smoky.vercel.app | [x]     |
| 6   | notification.email           | DATA   | supabase: notification_config.notification_email            | dor77777@gmail.com                      | [x]     |
| 7   | notify.phone1                | DATA   | supabase: notification_config.phone1                        | +972524809540                           | [x]     |
| 8   | notify.phone2                | DATA   | supabase: notification_config.phone2                        | +972546100067                           | [x]     |
| 9   | test-notify.phone1           | DATA   | supabase: notification_config.test_phone1 (or omit if test-only) | whatsapp:+972524809540              | [ ]     |
| **§2.2 — Meta Cloud (active provider, 4 props)** | | | | | |
| 10  | metacloud.accessToken        | SECRET | VERCEL_ENV: METACLOUD_ACCESS_TOKEN                          | EAAVHQVc...                             | [ ]     |
| 11  | metacloud.phoneNumberId      | CONFIG | VERCEL_ENV: METACLOUD_PHONE_NUMBER_ID                       | 1091010644104167                        | [ ]     |
| 12  | metacloud.templateName       | DATA   | supabase: notification_config.template_name                 | roas_daily_summary                      | [x]     |
| 13  | metacloud.templateLang       | DATA   | supabase: notification_config.template_lang                 | he                                      | [x]     |
| **§2.3 — Twilio (legacy fallback, 3 props)** | | | | | |
| 14  | twilio.accountSid            | SECRET | VERCEL_ENV: TWILIO_ACCOUNT_SID                              | ACc90784...                             | [ ]     |
| 15  | twilio.authToken             | SECRET | VERCEL_ENV: TWILIO_AUTH_TOKEN                               | 1d8ed5c8...                             | [ ]     |
| 16  | twilio.whatsappFrom          | CONFIG | VERCEL_ENV: TWILIO_WHATSAPP_FROM                            | whatsapp:+14155238886                   | [ ]     |
| **§3 — Google Ads (5 props)** | | | | | |
| 17  | googleads.clientId           | CONFIG | VERCEL_ENV: GOOGLEADS_CLIENT_ID                             | 99469225...                             | [ ]     |
| 18  | googleads.clientSecret       | SECRET | VERCEL_ENV: GOOGLEADS_CLIENT_SECRET                         | GOCSPX-_...                             | [ ]     |
| 19  | googleads.developerToken     | SECRET | VERCEL_ENV: GOOGLEADS_DEVELOPER_TOKEN                       | IrOq9uap...                             | [ ]     |
| 20  | googleads.loginCustomerId    | CONFIG | VERCEL_ENV: GOOGLEADS_LOGIN_CUSTOMER_ID                     | 1774599931                              | [ ]     |
| 21  | googleads.refreshToken       | SECRET | VERCEL_ENV: GOOGLEADS_REFRESH_TOKEN                         | 1//04jv7F...                            | [ ]     |
| **§4.1 — uzoshop (7 props)** | | | | | |
| 22  | uzoshop.shopify.domain       | CONFIG | VERCEL_ENV: UZOSHOP_SHOPIFY_DOMAIN                          | uzo-d-s-2.myshopify.com                 | [ ]     |
| 23  | uzoshop.shopify.clientId     | CONFIG | VERCEL_ENV: UZOSHOP_SHOPIFY_CLIENT_ID                       | f44d1af6...                             | [ ]     |
| 24  | uzoshop.shopify.clientSecret | SECRET | VERCEL_ENV: UZOSHOP_SHOPIFY_CLIENT_SECRET                   | shpss_da...                             | [ ]     |
| 25  | uzoshop.shopify.token        | SECRET | VERCEL_ENV: UZOSHOP_SHOPIFY_TOKEN                           | shpat_01...                             | [ ]     |
| 26  | uzoshop.meta.accessToken     | SECRET | VERCEL_ENV: UZOSHOP_META_ACCESS_TOKEN                       | EABAHWeV...                             | [ ]     |
| 27  | uzoshop.meta.adAccountId     | CONFIG | VERCEL_ENV: UZOSHOP_META_AD_ACCOUNT_ID                      | 26442930835313109                       | [ ]     |
| 28  | uzoshop.googleads.customerId | CONFIG | VERCEL_ENV: UZOSHOP_GOOGLEADS_CUSTOMER_ID                   | 4014537400                              | [ ]     |
| **§4.2 — zolplus (6 props)** | | | | | |
| 29  | zolplus.shopify.domain       | CONFIG | VERCEL_ENV: ZOLPLUS_SHOPIFY_DOMAIN                          | 2x1gqx-y0.myshopify.com                 | [ ]     |
| 30  | zolplus.shopify.clientId     | CONFIG | VERCEL_ENV: ZOLPLUS_SHOPIFY_CLIENT_ID                       | da3d0f8d...                             | [ ]     |
| 31  | zolplus.shopify.clientSecret | SECRET | VERCEL_ENV: ZOLPLUS_SHOPIFY_CLIENT_SECRET                   | shpss_77...                             | [ ]     |
| 32  | zolplus.shopify.token        | SECRET | VERCEL_ENV: ZOLPLUS_SHOPIFY_TOKEN                           | shpat_96...                             | [ ]     |
| 33  | zolplus.meta.accessToken     | SECRET | VERCEL_ENV: ZOLPLUS_META_ACCESS_TOKEN                       | EABAHWeV...                             | [ ]     |
| 34  | zolplus.meta.adAccountId     | CONFIG | VERCEL_ENV: ZOLPLUS_META_AD_ACCOUNT_ID                      | 800776975668368                         | [ ]     |
| **§4.3 — usmile360 (6 props)** | | | | | |
| 35  | usmile360.shopify.domain     | CONFIG | VERCEL_ENV: USMILE360_SHOPIFY_DOMAIN                        | 360usmile.myshopify.com                 | [ ]     |
| 36  | usmile360.shopify.clientId   | CONFIG | VERCEL_ENV: USMILE360_SHOPIFY_CLIENT_ID                     | e7a2e1ff...                             | [ ]     |
| 37  | usmile360.shopify.clientSecret | SECRET | VERCEL_ENV: USMILE360_SHOPIFY_CLIENT_SECRET               | shpss_b5...                             | [ ]     |
| 38  | usmile360.shopify.token      | SECRET | VERCEL_ENV: USMILE360_SHOPIFY_TOKEN                         | shpat_aa...                             | [ ]     |
| 39  | usmile360.meta.accessToken   | SECRET | VERCEL_ENV: USMILE360_META_ACCESS_TOKEN                     | EAAeL5Kw...                             | [ ]     |
| 40  | usmile360.meta.adAccountId   | CONFIG | VERCEL_ENV: USMILE360_META_AD_ACCOUNT_ID                    | 981695850074160                         | [ ]     |
| **§5 — Supabase (NEW, 3 props per D-C5)** | | | | | |
| 41  | supabase.url                 | CONFIG | VERCEL_ENV: SUPABASE_URL                                    | https://npegxufdupooqovrewyb.supabase.co | [x]     |
| 42  | supabase.anon.key            | SECRET | VERCEL_ENV: SUPABASE_ANON_KEY                               | eyJhbGc...                              | [x]     |
| 43  | supabase.service.role.key    | SECRET | VERCEL_ENV: SUPABASE_SERVICE_ROLE_KEY                       | eyJhbGc...                              | [x]     |

## Notes

- Row 2 (`spreadsheet.canonical-id`) is `n/a` — legacy duplicate of #1 per `.env` Section 1
  comment and CONTEXT.md `<code_context>`. Migrate only #1 to Vercel; ignore the duplicate.
- The 6 DATA rows in §2.1 + §2.2 (rows 4-8, 12, 13) are already pre-ticked `[x]` because
  they are seeded by the `notification_config` INSERT in `supabase/migrations/{ts}_seed_stores.sql`
  (plan 01 Task 3). Operator verifies in Supabase Studio Table Editor.
- Row 9 (`test-notify.phone1`) is a test-environment value — operator decides at 05.6 whether
  to add a `test_phone1` column to `notification_config` or omit entirely.
- Source values for rows 23, 24, 26, 31, 32, 33, 37, 38, 39 (Shopify + Meta tokens for all 3
  stores) are abbreviated to the first 8 chars + `...` — this file is git-tracked and must
  not leak full tokens. Operator reads the full values from `.env` (gitignored) when seeding.
- Rotation playbook deferred to a future phase per D-C4 (no `docs/SECRET-ROTATION.md` in 05.5).
