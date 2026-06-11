# דוח מוכנות מולטי-טננט — דשבורד ROAS

**תאריך:** 2026-06-11 · **שיטה:** 6 סוכני-עדשה מקבילים (כל טענה עם ראיית file:line) + מבקר-שלמות · ‏7 סוכנים, ‏191 קריאות-כלים · ‏run `wf_513fe16c-c66`

**הגדרת היעד:** מספר עסקים (tenants) מבודדים לחלוטין — לכל אחד החנויות, המשתמשים, ההגדרות וההתראות שלו; משתמש של טננט A לעולם לא רואה נתוני טננט B; הקמת טננט חדש = אפס שינויי-קוד ואפס גישת-shell.

---

## תקציר מנהלים

**פסק-דין: המרחק למולטי-טננט מלא הוא בינוני — ואין צורך בשכתוב.** פרויקט ה-self-serve שכבר שוחרר בנה נכון את **קומת-החנויות**: ‏~20 מתוך 24 הטבלאות כבר נושאות `store_id` במפתח הראשי, רשימת-החנויות דינמית מה-DB, סודות מוצפנים ב-`store_secrets`, ‏webhooks פר-חנות, ומחזור-חיים מלא לחנות. בזכות זה, הוספת **קומת-עסקים** מעליה היא תוספת אינקרמנטלית: `tenants` + ‏`stores.tenant_id`, והבידוד נגזר דרך קבוצת-החנויות של הטננט — בלי לגעת בסכמות של טבלאות-העובדות.

**מה שחסר באמת מתרכז ב-7 חסמים אדריכליים:**

1. **אין ישות-טננט** — אף טבלת businesses/tenants לא קיימת ב-51 המיגרציות.
2. **אין זהות-משתמש** — עוגיית ה-auth היא `expiry+HMAC` בלבד: בלי subject, בלי tenant claim; סיסמה אחת משותפת לכל הדשבורד.
3. **אין שכבת-אכיפה לבידוד** — כל הקריאות דרך service_role (עוקף RLS); ‏RLS מופעל על כל הטבלאות אבל עם **אפס policies**; ה-readers מושכים את כל החנויות ומסננים בצד-לקוח.
4. **`dashboard_state` הוא KV גלובלי יחיד** — ‏COGS%, משכורות, billing, יעד חודשי, מיפוי קמפיין↔חנות — טננט B היה דורס את טננט A.
5. **‏CDN cache פר-URL ולא פר-טננט** — ‏16 מסלולי-API עם cache ציבורי ידלפו נתונים בין טננטים ברגע שהזהות תהיה session-based (החסם שהכי קל לפספס — אומת ע"י המבקר).
6. **ענף ה-first-time-migration של cloudSync** ידחוף state של טננט A לחשבון של טננט B במכשיר משותף (המבקר העלה מ-major לחסם).
7. **זהויות-מפרסם גלובליות** — ‏Google MCC/developer-token יחיד, ‏META_GLOBAL_TOKEN, ‏TikTok מקובע ל-uzoshop.

**🔴 באג חי שמצאה הסקירה (לא קשור לטננטים — לתקן מיד):** ה-CHECK constraint של `token_failures` מקבע את 3 מזהי-החנויות — **כל חנות רביעית שתתווסף דרך ה-wizard תשבור את throttling-ההתראות שלה**. תיקון: מיגרציה שמסירה/מרחיבה את ה-constraint (חצי יום).

**מאמץ משוער (אחרי איחוד-כפילויות בין העדשות, לפי תיקוני המבקר):**

| יעד | מאמץ | משמעות |
|---|---|---|
| **v1 — מוצר מבודד-טננטים** (שלבים MT-1…MT-5) | **~30–37 ימי-עבודה** | מספר עסקים אמיתיים, מבודדים, עם onboarding כמעט-עצמאי (הדבקת-טוקנים מונחית) |
| **SaaS מלא** (+MT-6: ‏OAuth מלא, מדידה/חיוב, ‏GDPR, ‏staging, ‏watchdog) | **+25–35 ימים נוספים** | מוצר מסחרי לכל דבר |

בקצב של הפאזות שכבר שוחררו — ‏v1 הוא בסדר-גודל של **חודשיים-שלושה**.

---

## מה כבר מוכן-למולטי-טננט (ההשקעה שכבר נעשתה)

- **[שכבת הנתונים (סכמה / RLS)]** Store-scoped fact tables with store_id baked into every PK/unique constraint — tenant scoping can be derived transitively via a future stores.tenant_id without touching these schemas: data_daily PK(date,store_id), products_daily PK(date,store_id,product_id), campaigns_daily PK(date,store_id,platform,campaign_id,ad_set_id), ads_daily PK(date,store_id,ad_id), orders_attribution PK(store_id,order_id), product_catalog PK(store_id,product_id) (all 20260521063112_initial_schema.sql); manual_overrides UNIQUE(date,store_id,platform) (initial_schema.sql:36); campaign/adset/ad registries PK(store_id,platform,<entity_id>) and campaign_status_events dedupe_key embeds store_id (20260530230000_phase_b_registries.sql:27,60,93,136-141); token_failures PK(provider,store_id,operation); data_freshness PK(store_id,platform,scope,table_name); meta_buc_usage PK(store_id,ad_account_id); customer_first_order PK(store_id,customer_id); customer_cohort_monthly PK(store_id,first_order_month,month_since); store_ad_state PK(store_id,platform); store_events/store_webhooks FK stores(id) (20260601120000)
- **[שכבת הנתונים (סכמה / RLS)]** Dynamic DB-driven store registry: getStores()/loadActiveStoreIds() (dashboard-web/src/lib/getStores.ts) is the single source for the store list, and all cron families fan out per-store from it (dashboard-web/src/lib/inngest/planStoreJobs.ts) — adding a tenant's stores automatically enrolls them in the whole pipeline
- **[שכבת הנתונים (סכמה / RLS)]** Encrypted per-store credentials in DB: store_secrets AES-256-GCM, PK(store_id,secret_key), deliberately no anon grant (20260606170100_store_secrets.sql), with a registry contract (lib/secretsRegistry.ts) and env fallback — store onboarding already requires zero code and zero shell access via POST /api/operator/stores (add-store wizard with slug validation, reserved-id rejection, rollback)
- **[שכבת הנתונים (סכמה / RLS)]** Deny-by-default DB posture: RLS enabled on all 24 public tables + schema-wide anon REVOKE (20260607140000_phase5_rls_revoke_anon.sql) — a clean base to ADD tenant policies onto, rather than having to claw back open grants
- **[זהות והרשאות]** Per-store external-ingest auth is ALREADY tenant-shaped: Shopify webhooks verify per-store HMAC from store_webhooks.signing_secret keyed by shop domain (webhooks/shopify/route.ts:39-45), and the cart beacon uses per-store cart_public_token (events/cart/route.ts:16-32). Adding a store→tenant join is the only change needed; no shared-secret redesign required.
- **[זהות והרשאות]** Inngest serve endpoint is self-authenticating platform-level (X-Inngest-Signature, INNGEST_SIGNING_KEY, prod boot assert at api/inngest/route.ts:148) — correct as-is for multi-tenant since the queue belongs to the platform, not a tenant.
- **[זהות והרשאות]** Centralized, unit-tested allowlist (isDashboardAuthAllowlisted, middlewareHelpers.ts:90-123) — single place to reason about unauthenticated surface; the 2026-06-03 Inngest-pinning incident is documented inline, so the pattern is hardened.
- **[זהות והרשאות]** Encrypted per-store secrets vault already shipped: store_secrets AES-256-GCM, service-role-only, no anon grant (migration 20260606170100), with secretsRegistry contract (src/lib/secretsRegistry.ts), maskSecret + CLIENT_SAFE_SECRET_KEYS + repo-wide secret-echo CI audit (ARCHITECTURE.md Phase 5c notes). Per-tenant credential storage needs zero new crypto work.
- **[הנחות עסק-יחיד מקודדות]** Store list is DB-driven with byte-exact fallback: /Users/dorperetz/script-roas/dashboard-web/src/lib/getStores.ts:20-58 (getStores + loadActiveStoreIds; DB authoritative when non-empty, hardcoded 3 only on read failure). Client twin useStores.ts:11-13 same pattern.
- **[הנחות עסק-יחיד מקודדות]** Crons fan out over the DB store list, not the hardcoded consts: cronTickOrchestrator.ts:13,34,84; Phase-4b scheduler→worker folds registered in serve() (api/inngest/route.ts:108-119,164-170) — cronLiveScheduler (cronLive.ts:869-891), cronDailyScheduler, cronYesterdayRefreshScheduler (cronYesterdayRefresh.ts:129-150) all call loadActiveStoreIds() at runtime; the per-store STORES.map factories are kept on disk only as an inert revert lever (route.ts:103-104). A new store enters every cron cycle with no deploy.
- **[הנחות עסק-יחיד מקודדות]** Per-store credentials are dual-read DB-first: /Users/dorperetz/script-roas/dashboard-web/src/lib/storeSecretsReader.ts:24-54 (encrypted store_secrets → ${STORE}_${KEY} env fallback; __global__ for shared keys). Verified: googleAds.ts, shopify.ts, tiktok.ts, meta.ts have NO remaining direct process.env per-store cred reads (only the two sync gates listed in gaps). secretsRegistry.ts:20-39 is the single key contract.
- **[הנחות עסק-יחיד מקודדות]** Add-store wizard + edit/rotate creds + live cred verification shipped: POST/GET /api/operator/stores (route.ts:4-112+), verify-creds route, credVerifiers.ts (pure, injected creds), storeSnippets.ts, rollback-on-partial-failure; archive/restore/delete lifecycle per Phase 6b plan. Onboarding a new STORE requires zero code changes.
- **[צנרת Inngest / פלטפורמות]** Event ids are tenant-safe given globally-unique store ids: planStoreJobs id = `cron-{family}-{storeId}-{date|tick}` with the 2026-06-10 P0-2 fix combining date+tickId (dashboard-web/src/lib/inngest/planStoreJobs.ts:98-106); orchestrator fan-out id = `${platform}:${storeId}:${scope}:${tickId}` (dashboard-web/src/lib/registries/priorityBuilder.ts:127). stores.id is a global PK and the add-store route 409s duplicates, so uniqueness is already enforced.
- **[צנרת Inngest / פלטפורמות]** DB dedupe keys are store-scoped: campaign_status_events.dedupe_key = store_id:platform:entity_type:entity_id:from:to:minute_bucket (migration 20260530230000_phase_b_registries.sql:136-141, minute_bucket_epoch is tenant-neutral); Shopify webhook store_events dedupe = `webhook:${webhookId}` (globally-unique Shopify id, normalizeShopifyEvent.ts:189).
- **[צנרת Inngest / פלטפורמות]** Per-store rate-limit isolation at the Inngest layer is real: every worker has concurrency [{key:'event.data.store_id', limit:1}] plus a per-store throttle (metaWorker.ts:685-689 900/h, googleWorker.ts:576-580 600/h, tiktokWorker.ts:784-788 1500/h), and the orchestrator's BUC hard-gate + tiered cooldown reads meta_buc_usage per store (cronTickOrchestrator.ts:118-146, priorityBuilder.ts:99-123). A token/budget failure of store A does not throttle store B's workers.
- **[צנרת Inngest / פלטפורמות]** Alert THROTTLING is per-store: throttle key is (provider, store_id, operation) with a 6h window (tokenFailures.ts:87-90, 207-220) — tenant A's dead token would not suppress tenant B's alerts (recipient routing is the gap, not throttling).
- **[state בצד הלקוח וניתוב]** Dynamic store list behind a single chokepoint: getStores.ts ('THE single source for the store list', reads stores table) → /api/stores → useStores.ts client hook. The frontend treats the store list as data, so 'tenant's stores' becomes a WHERE-clause change at one function, not a sweep.
- **[state בצד הלקוח וניתוב]** Store branding is already per-row DB data, not code: stores.brand_color (migration 20260606170000_stores_self_serve_columns.sql) resolved by storeColors.ts:71-104 with token-based brandColor-first resolution and a deterministic fallback palette for unknown stores — a new tenant's stores get colors with zero code change.
- **[state בצד הלקוח וניתוב]** State sync is chokepointed: ONE API route (src/app/api/dashboard-state/route.ts), ONE reader (postgresReaders.ts:620 fetchDashboardStateFromPostgres), ONE writer (postgresReaders.ts:1704 upsertDashboardStateKeyPostgres), ONE key list per side. Adding tenant_id touches ~4 files plus a migration.
- **[state בצד הלקוח וניתוב]** The client/server key parity guard (src/lib/__tests__/stateKeysParity.test.ts) survives tenancy unchanged — key NAMES stay identical; only row scoping changes server-side, so the 2026-06-02 COGS-class drift bug stays prevented.
- **[תפעול, עלות ו-onboarding]** Zero-deploy store onboarding UI: AddStoreWizard (dashboard-web/src/components/operator/, ARCHITECTURE.md §48) with server-side live cred re-verification (lib/credVerifiers.ts reusing the exact pipeline helpers), atomic 4-table write + rollbackStore on failure — the pattern generalizes directly to tenant onboarding
- **[תפעול, עלות ו-onboarding]** Secrets-as-data: store_secrets AES-256-GCM (lib/secretsEncryption.ts, ENCRYPTION_MASTER_KEY, migration 20260606170100) + secretsRegistry.ts contract + maskSecret + ciSecretsAudit.test.ts secret-echo guard — no Vercel env edit needed for new stores
- **[תפעול, עלות ו-onboarding]** Dynamic cron enrollment: lib/getStores.ts is the single store-list source (DB-driven, archived auto-drop) so a new store joins every cron/worker with zero code (ARCHITECTURE.md §46, §51)
- **[תפעול, עלות ו-onboarding]** Per-store data deletion already exists and is hermetically guarded: DELETE /api/operator/stores/[id] wipes STORE_SCOPED_WIPE_TABLES with a CI test that re-derives the store_id-table set from migrations (ARCHITECTURE.md §51) — the building block for tenant deletion/GDPR

---

## מפת-הדרכים המאוחדת (אחרי דה-דופליקציה)

המבקר זיהה שאותם פערים נספרו ב-2–5 עדשות במקביל (auth ×3, התראות ×5, ‏onboarding ×2, ‏timezone ×2). הטבלה הבאה היא הגרסה המאוחדת — כל פריט פעם אחת:

### MT-0 · מיידי (גם בלי טננטים) — ‏~1 יום
- 🔴 תיקון ה-CHECK של `token_failures` (באג חי לחנות רביעית).
- ‏dedupe_key של ה-cart-beacon לא כולל store — התנגשות בין חנויות מפילה אירועי-פיד בשקט (חצי יום).

### MT-1 · יסודות הטננט — ‏~4–5 ימים
- טבלת `tenants` (id, name, status, settings, timezone) + ‏`stores.tenant_id NOT NULL` + ‏backfill העסק-המייסד.
- ‏`dashboard_state` → ‏PK ‏(tenant_id, key) + השחלת tenantId ב-cloudSync ובמסלול ה-API + מיגרציית השורות הקיימות.
- ‏`getStores({tenantId})` — הזרעה של כל ה-fan-out מהרשימה המסוננת.
- החלטת namespace ל-slug של חנות (גלובלי-ייחודי או פר-טננט).

### MT-2 · זהות ואימות — ‏~9–12 ימים (הפריט הגדול)
- ‏Supabase Auth (או NextAuth): משתמשים אמיתיים, ‏tenant_memberships, ‏roles ‏(owner/viewer).
- ‏session נושא tenant_id; נקודת-אכיפה אחת שכל מסלול-API עובר דרכה.
- ‏invite/signup (דורש תשתית אימייל — ממד שהמבקר מצא חסר מכל העדשות).
- פיצול קונסולת-operator: ‏platform-super-admin (חוצה-טננטים, נשאר עם secret) מול tenant-admin (חנויות/overrides של עצמו בלבד).
- ‏lifecycle ל-session: ‏revocation, רוטציית סוד-חתימה, ‏rate-limit על ‎/api/login.

### MT-3 · אכיפת הבידוד — ‏~8–10 ימים
- כל ‏~25 ה-readers + ‏~15 מסלולי-API מקבלים `tenantStoreIds` חובה (`.in('store_id', …)`) + ‏guard-פריטי בסגנון stateKeysParity שאוכף שאף reader לא נשאר לא-מסונן.
- ‏RLS policies עם tenant-claim ב-JWT כקו-הגנה הרמטי; קריאות-הדשבורד יורדות מ-service_role לקליינט מאומת פר-בקשה (service_role נשאר לכותבי-cron בלבד).
- 🔴 תיקון ה-CDN: כל מסלול עם נתוני-טננט עובר ל-`private`/`no-store` או מפתח-cache פר-טננט (16 מסלולים, אומת).
- 🔴 תיקון ענף ה-first-time-migration של cloudSync (דחיפה אוטומטית חוצת-טננטים).
- ‏blast-radius של reset/operator-actions נקשר לטננט.
- ‏RPCs גלובליים-לתאריך (agg_data_daily_for_date וכו') מקבלים גבול-טננט או נשארים cron-only.

### MT-4 · התראות ותצורה פר-טננט — ‏~3–4 ימים
- ‏notification_config + נמענים פר-טננט; מפתחות-throttle כוללים tenant.
- אסטרטגיית ערוץ: ‏WhatsApp sender משותף עם תבניות פר-טננט, או אימייל/Telegram פר-טננט (זול יותר).

### MT-5 · זהויות-מפרסם ופלטפורמות — ‏v1 ‏~4–6 ימים
- סודות `__global__` → פר-טננט (Google MCC/dev-token, ‏Meta token, ‏TikTok advertiser).
- פירוק ההנחה "uzoshop הוא בעל חשבון-TikTok" (~8 אתרים בקוד).
- ‏v1 של onboarding: הדבקת-טוקנים מונחית ב-wizard (קיים לחנויות-Shopify) מורחבת לפלטפורמות-פרסום; רישום-webhooks אוטומטי.
- ‏OAuth מלא כמוצר (Shopify public app, ‏Meta/Google/TikTok app review) — נדחה ל-SaaS המלא (‏~12–15 ימים, רובו המתנה ל-reviews של הפלטפורמות).

### MT-6 · ‏SaaS מלא — ‏~25–35 ימים (ניתן לשלבים)
- ‏backfills כ-jobs מה-operator-console (בלי shell/.env), ייצוא/גיבוי פר-טננט, ‏GDPR, ‏suspend/offboard עם cascade, ‏staging נפרד (כיום Preview חולק את ה-DB של פרוד!), ‏watchdog, מדידת-שימוש וחיוב.
- **תקרת-סקייל נוכחית:** ‏~105–110K הרצות-Inngest/חודש לחנות → תקרת ה-Pro ‏(1M) נפגעת סביב **~9 חנויות**; המעבר המתוכנן ל-QStash (סוף-החודש, לפי תוכנית קיצוץ-העלויות) פותר גם את זה.

---

## ממדים שהמבקר מצא חסרים (נוספו למפה)

- **Cutover and rollback plan for migrating the EXISTING business into the tenant model** — Every lens says 'backfill the 3 stores to a founding tenant' but none owns the live-prod cutover: this repo deploys via push-to-main with NO staging (ops-cost gap 7, ARCHITECTURE.md:981-983 — Preview shares the prod Supabase project), and the tenancy work requires PK rewrites on live tables (dashboard_state key→(tenant_id,key)), NOT NULL tenant_id columns, and an auth-system swap that logs out the operator's devices. A single mis-ordered migration corrupts the only paying business. The repo's own culture has 'inert revert lever' patterns (Phase 4b kept old scheduler factories on disk) — no lens scoped the equivalent for tenancy. Auth lens raises live-session cutover only as an open question; client-state raises the localStorage shim only as an open question. ‏→ A phased cutover plan as a first-class deliverable: (1) additive-only migrations first (tenants table, nullable tenant_id, backfill, then NOT NULL in a later migration); (2) dual-accept auth window (dash_auth cookie OR new session) with a feature flag; (3) explicit revert lever per phase (keep the old read path callable); (4) ordering constraint that app-layer scoping ships BEFORE second-tenant onboarding opens, RLS backstop after. ~1.5 effortDays of planning/sequencing plus discipline baked into each phase; the staging environment (ops-cost gap 7, 3d) should be re-classified as a prerequisite of this cutover, not independent polish.
- **Tenant-isolation test/CI strategy (two-tenant seed harness + IDOR sweep + tenancy ratchet)** — No lens has a gap for proving isolation. Fragments exist inside workNeeded lines (data-tenancy: 'parity test that every exported reader takes tenant scope'; client-state: 'guard test on s-maxage') but there is no owned dimension for: seeding TWO tenants and asserting every one of the 46 API route.ts files (verified count — lenses underestimated at ~15-30) returns empty/403 for cross-tenant ?store= params; cross-tenant write attempts on dashboard-state, manual-overrides, store lifecycle; RPC membership assertions; a CI ratchet that fails when a new table/route/reader ships without declared tenant scope. This codebase's entire safety model is hermetic guards (stateKeysParity, ciSecretsAudit, STORE_SCOPED_WIPE_TABLES re-derivation, design-color ratchet) — tenancy without an equivalent guard will regress silently, exactly like the 2026-06-02 ALLOWED_STATE_KEYS drift bug. ‏→ Build a vitest two-tenant fixture (tenant A/B, one store each) + a route-walker test that hits every route.ts with B's session and A's store ids asserting zero rows; extend to RPCs; add a migration-derived ratchet 'every table with store_id is reachable only through tenant-scoped seams'; one Playwright smoke as second tenant. ~3 effortDays at shipped-phase pace. Blocker-grade: the target ('user of tenant A can NEVER read/write tenant B') is unverifiable without it.
- **Secrets encryption key management: one global ENCRYPTION_MASTER_KEY for all tenants, no rotation story** — Ops-cost lists store_secrets AES-256-GCM as 'alreadyReady' but nobody examined the key model: secretsEncryption.ts:10-13 (verified) derives everything from a single 32-byte env ENCRYPTION_MASTER_KEY. In multi-tenant, compromise of that one key = every tenant's Shopify/Meta/Google/TikTok tokens. There is no key-version column, no rotation/re-encryption job, no per-tenant key derivation. Auth lens covered cookie-secret rotation but not the secrets-vault key. ‏→ Add key_version to store_secrets ciphertext envelope + a rotation job (decrypt-with-old/encrypt-with-new, idempotent, Inngest one-shot) + runbook; optionally per-tenant derived keys (HKDF(master, tenant_id)) so blast radius is bounded. ~1.5 effortDays. Severity: major (required for real multi-tenant operation; not architecturally required for isolation).
- **Legal/PII processor obligations beyond the Shopify GDPR webhooks** — Ops-cost covers the 3 mandatory Shopify compliance webhooks and export-before-delete, but the dimension stops there. Onboarding external businesses makes the platform a data PROCESSOR of tenants' shopper PII — orders_attribution (PK store_id,order_id), customer_first_order(store_id,customer_id), store_events cart/sale events with ~46.8k orders back to 2023 — with no ToS, no DPA, no privacy policy, no per-tenant retention policy, no documented subprocessor list (Supabase, Vercel, Sentry, Meta WhatsApp), and the dashboard URL-obscurity trust model dies the moment a second business gets a login. Also unexamined: dashboard-web/scripts/exportCustomersForFacebook.ts is UNTRACKED in git (visible in git status) and exports customer PII via shell — a processor-compliance liability in itself. ‏→ Mostly non-code legal track (ToS/DPA/privacy templates) + ~1.5 code effortDays: per-tenant retention/redaction job over the PII-bearing tables, subprocessor inventory doc, delete-or-promote the untracked export script. Should appear in the verdict as a major gap gating REAL external tenants even if engineering-complete.
- **Email delivery infrastructure — assumed by invite/signup estimates, absent from the stack** — Verified: zero email capability anywhere (grep for resend/sendgrid/nodemailer/smtp across src hits only Sentry scrub files; all alerting is WhatsApp via one WABA). Auth lens prices 'signup + email invite flow' at 3d and data-tenancy 'invite/email plumbing' at 3d, both silently assuming a sender exists. Supabase Auth's built-in SMTP is dev-grade (single-digit emails/hour) and unusable for production invites/password-resets. Every per-tenant-onboarding estimate quietly depends on this. ‏→ Add a transactional email provider (Resend/Postmark) + domain auth (SPF/DKIM on a real domain — the app currently lives on a vercel.app URL, so a custom domain is itself a sub-prerequisite) + invite/reset templates. ~1 effortDay code, plus domain/DNS lead time. Cheap but must be named, or the invite-flow estimates are wrong.
- **Per-tenant quotas / noisy-neighbor / abuse enforcement — raised twice as open questions, owned by no lens** — Pipeline and auth both park 'per-tenant concurrency/rate budget' in openQuestions; ops-cost quantifies the 1M-exec ceiling (~9-12 stores) but its gap is metering/billing, not ENFORCEMENT. Nothing anywhere covers: a tenant adding 10 stores and consuming the whole Inngest budget, per-tenant API rate limits on the 46 routes once untrusted users hold sessions, signup throttling, webhook-flood handling, or pausing a delinquent tenant (suspend semantics). The Google developer-token shared quota (pipeline gap 3) makes this concrete: one tenant's volume can starve all others with no enforcement lever. ‏→ tenants.status (active/suspended) honored by planStoreJobs/cron-tick enrollment + per-tenant store-count cap + per-tenant cadence tier (pipeline already scoped the cadence half at 2d) + basic per-session rate limit on API routes. ~2 effortDays incremental on top of pipeline's cadence work. Severity: major for real multi-tenant operation.
- **Tenant-level lifecycle (suspend / offboard / cascade delete) — only STORE lifecycle exists** — Phase 6b shipped archive/restore/delete for STORES, and ops-cost reuses STORE_SCOPED_WIPE_TABLES for export — but no lens defines what happens to a TENANT: offboarding must cascade stores + users/memberships + dashboard_state rows + notification_config + tenant-scoped secrets ('__tenant__:<id>' rows proposed by data-tenancy) + sessions, and suspension must block login AND cron enrollment atomically. The target definition explicitly says each tenant owns 'stores, users, settings, alerts and data'; the lenses tenant-scope each piece but nobody composes the lifecycle. ‏→ Tenant delete = iterate existing store-delete per store + wipe tenant-keyed tables + revoke sessions, behind the same guarded confirm flow; tenant suspend = status flag checked in requireTenant + planStoreJobs. Mostly composition of shipped pieces: ~1.5 effortDays + extend the existing hermetic wipe-table guard to tenant-keyed tables.

## תיקוני-חומרה ואיחודים של המבקר

- Alerts/notifications BLOCKER (pipeline, ops-cost) → MAJOR. By the audit's own definition, blocker = architecturally required for tenant ISOLATION. Alert routing is a feature: v1 could ship with tenant alerts disabled and isolation would be intact. The genuinely blocker-shaped sliver is narrow: once per-tenant recipients exist, the daily summary MUST aggregate only the tenant's stores or it becomes a cross-tenant data leak — that one condition belongs in the isolation test suite, the rest is major. (data-tenancy/auth/hardcoded already have it right.)
- ops-cost 'credential acquisition is operator-manual paste' BLOCKER/18d → MAJOR, with the 18d split: ~2-4d incremental engineering (pipeline's path: auto-register Shopify webhooks via the already-verified token + publish Google consent screen + per-tenant refresh tokens) qualifies for the v1 verdict; the remaining ~14d (Shopify public app + app review + Meta Login for Business + TikTok auto-exchange) is post-v1 productization gated on external review calendars, not isolation. Paste-based onboarding through the existing wizard already meets the stated target's letter ('zero code changes, zero operator shell access').
- client-state 'localStorage first-time-migration push injects tenant A's state into tenant B' MAJOR → BLOCKER. cloudSync.ts:423-439's auto-push is an UNATTENDED cross-tenant WRITE: a device that touched tenant A will silently upload A's billing/COGS/goal financials into tenant B's bucket on first login, authenticated as B — the server cannot distinguish it from a legitimate write, so no amount of server-side scoping or RLS catches it. It directly violates 'a user of tenant A can never write tenant B data' and corrupts B's P&L numbers. Gating the migration-push branch (persist a tenant marker; push only if same-tenant) is mandatory BEFORE the second tenant exists, not polish.
- pipeline 'token_failures CHECK constraint hardcodes 3 store ids' — severity MAJOR is fine within the tenancy frame, but the verdict must reclassify it as a LIVE P0 TODAY, independent of multi-tenant: verified at supabase/migrations/20260523080000_add_token_failures.sql:42, it breaks alert throttling (up to 144 WhatsApp sends/day on a dead token) for ANY store added through the ALREADY-SHIPPED self-serve wizard. Same for hardcoded's operatorManualOverrides.ts:18 VALID_STORES (verified) which blocks manual overrides for a 4th store. Both are 0.5d fixes that should be pulled out of the tenancy roadmap and shipped now.
- Effort sanity on the 5 biggest items: (1) ops-cost OAuth 18d — inflated for the v1 verdict, see correction above; real v1 slice ~3-4d. (2) data-tenancy auth 9d — reasonable standalone but overlaps auth-lens 12.5d and client-state 4d; deduped ~10-12d total is the honest number. (3) data-tenancy unscoped-reads 7d — plausible against verified counts (23 exported readers in postgresReaders.ts, 46 API routes — MORE routes than any lens assumed, so 7d is a floor, not padding), but overlaps auth's 5d+3d; deduped ~7-8d. (4) ops-cost metering/billing 6d — conflates ~3d of metering with 'decide and execute the scheduler migration', which is the separately-scoped ~5d Inngest→QStash project (docs/cost/2026-06-06-inngest-cost-cut.md) already deferred to late June AND partially re-counted in pipeline's 2d cadence gap; metering alone = 3d. (5) ops-cost backfills 5d vs hardcoded 1.5d — reconcile to ~3d (see contradictions). Net effect: a naive sum of all six lenses' effortDays (~95d) overstates the true deduped program, which lands nearer 45-55d.
- data-tenancy 'no tenant onboarding flow' MAJOR/3d and auth 'no signup/invite flow' MAJOR/3d are the same gap counted twice, and BOTH estimates assume email infrastructure that does not exist in the stack (verified: no email provider anywhere; see missingDimensions). Keep one instance at 3d + 1d email infra.
- client-state 'CDN-cached state responses' BLOCKER is CORRECT and under-credited by the other lenses: no other lens noticed that 16 API routes (verified cacheControl call-site count) emit s-maxage on tenant-undifferentiated URLs — data-tenancy's and auth's read-scoping gaps would still leak via shared CDN cache even after perfect DB scoping if tenancy is session-carried. The verdict should bind this 1d fix as a hard precondition of the session-based-tenancy decision both lenses lean toward.

- *סתירה שאוחדה:* OAuth onboarding: pipeline rates 'tenant onboarding requires manual platform-app setup' MAJOR / 4 effortDays (incremental: auto-register Shopify webhooks + hosted Google OAuth) while ops-cost rates the same dimension BLOCKER / 18 effortDays (full Shopify public app + Meta Login + TikTok generalization + app reviews). These cannot both stand in the verdict. The target definition only requires 'zero code changes and zero operator shell access' — a tenant-admin pasting their own custom-app creds into the existing wizard satisfies that literally, so pipeline's framing is correct for the stated target and ops-cost's 18d is the optional productization track (dominated by external review calendar time, not engineering). The synthesis must pick one stance: paste-based = v1-sufficient (major UX gap), OAuth = post-v1.
- *סתירה שאוחדה:* Deep-history backfill porting: hardcoded prices 'port the shell scripts into the operator backfill route' at 1.5 effortDays; ops-cost prices the identical work ('promote the runners to one-shot Inngest jobs… progress rows… surface status in StoresTab') at 5 effortDays. Same scripts (10 files in dashboard-web/scripts/, verified), same destination pattern (eventBackfill exists). Realistic deduped estimate ~3d; the verdict must carry ONE number, not 6.5d summed.
- *סתירה שאוחדה:* Notifications/alerts gap appears in FIVE lenses with conflicting severity and effort: data-tenancy major/2.5d, auth major/1.5d, hardcoded major/2d, pipeline BLOCKER/2d, ops-cost BLOCKER/4d. Naive summation yields ~12 effortDays for one ~2-3d job, and the severity split (blocker vs major) is unresolved. Per the audit's own severity definition, major is correct (see severityCorrections).
- *סתירה שאוחדה:* Auth/identity work is double-counted across three lenses with no reconciliation: data-tenancy carries it as ONE 9d blocker; auth decomposes the same scope into 3d (Supabase Auth) + 2d (tenant tables) + 5d (requireTenant threading) + 2.5d (operator split) = 12.5d; client-state adds 4d for 'the frontend/session share of the auth work'. Naive total ~25.5d for what is realistically ~10-12d of deduped work. Note also the threading denominator disagreement: auth says ~30 routes, data-tenancy ~15, client-state ~25 fetches — actual count is 46 route.ts files (verified), which supports the higher per-route estimates but means the smaller lens scopings undercount.
- *סתירה שאוחדה:* Read-path scoping + RLS overlaps and disagrees: data-tenancy bundles app-layer .in('store_id',…) scoping AND the RLS/JWT backstop into one BLOCKER at 7d; auth splits them into its 5d blocker (requireTenant) plus a separate 3d MAJOR ('RLS has no tenant policies… can land after app-layer scoping'). Same work, different severity for the RLS half and double-counted days. Recommended reconciliation: app-layer scoping = blocker, RLS backstop = major-but-required-before-second-real-tenant (auth's framing), one combined ~7-8d.
- *סתירה שאוחדה:* Per-tenant base currency: data-tenancy explicitly DEFERS it ('keep CAD as the internal canonical unit… defer the column-rename rewrite'; open question calls it 'the one item that approaches rewrite territory') while hardcoded schedules it NOW as a 4d MAJOR gap (reinterpret *_cad as tenant base currency + thread ~6 cadConvert call sites). Direct scope disagreement about v1. The verdict needs a decision; hardcoded's reinterpretation path is the cheaper middle ground but contradicts data-tenancy's 'CAD-first onboarding' stance.
- *סתירה שאוחדה:* Timezone work is counted twice: hardcoded carries 'Asia/Jerusalem day-boundary' as its own 3d major gap, AND data-tenancy includes 'add tenants.timezone and thread through getTodayInIsraelTz/dateRange' inside its separate 3d hardcoded-assumptions gap. Both also have open questions saying it may be fully deferrable if first tenants are Israeli — a gap and its own deferral coexisting unresolved.
- *סתירה שאוחדה:* Tenants-table effort spread reflects bundling, not disagreement, but will mislead summation: data-tenancy 2d and auth 2d price the bare tenants+tenant_id+backfill migration, while hardcoded prices 'the same' gap at 5d because it silently bundles tenant-scoping notification_config, dashboard_state, token_failures, __global__ secrets AND per-tenant RLS policies — each of which other lenses carry as separate priced gaps. Any roll-up that sums per-lens gap lists will double-count by roughly 2x in this cluster.

---

## שאלות פתוחות למפעיל (הכרעות-מוצר, לא קוד)

- **[שכבת הנתונים (סכמה / RLS)]** Should store_id stay a globally-unique slug (cheap, zero FK churn — recommended) or become per-tenant unique with surrogate keys (touches every PK/FK in the schema)? This decision gates whether ANY fact-table migration is needed at all.
- **[שכבת הנתונים (סכמה / RLS)]** Is per-tenant display currency in scope for v1 multi-tenant, or can the CAD-canonical *_cad column model stand (tenants onboard with CAD reporting first)? A true per-tenant base currency is the one item that approaches rewrite territory.
- **[שכבת הנתונים (סכמה / RLS)]** Does /operator remain a cross-tenant super-admin surface (single x-operator-secret), with a NEW tenant-admin tier built alongside — or must operator functions themselves become tenant-scoped?
- **[שכבת הנתונים (סכמה / RLS)]** Per-tenant timezone: is Asia/Jerusalem-only acceptable for the first external tenants, or is tenants.timezone required at launch? It threads through day-boundary logic in dateRange.ts, getTodayInIsrael.ts and every cron's 'yesterday' computation.
- **[שכבת הנתונים (סכמה / RLS)]** RLS enforcement depth: is app-layer tenant filtering with a hermetic parity test sufficient (service-role model preserved), or is JWT-claim RLS with per-request authenticated clients required (stronger isolation, bigger change to the read path)?
- **[שכבת הנתונים (סכמה / RLS)]** The TikTok shared-advertiser model (one ad account serving multiple stores via campaign-store-map, ARCHITECTURE.md:211) is inherently per-business — confirm it generalizes as a per-tenant map keyed by the tenant's advertiser, not a platform-level singleton.
- **[שכבת הנתונים (סכמה / RLS)]** Noisy-neighbor policy on the shared Inngest app: per-store fan-out scales linearly with tenants — is a per-tenant concurrency/rate budget needed before opening onboarding, given Meta BUC limits are per-token (per-tenant) anyway?
- **[זהות והרשאות]** Supabase Auth vs NextAuth: audit assumes Supabase Auth (DB is already Supabase, RLS policies can read the JWT tenant claim, and it kills the session-revocation gap for free) — confirm before the auth migration since it determines whether middleware verifies a Supabase cookie or a NextAuth JWT.
- **[זהות והרשאות]** Where should the authoritative tenant check live: recommendation is per-route requireTenant() helper with middleware kept as the coarse logged-in gate (Edge middleware cannot do membership DB lookups per request, and routes need allowedStoreIds anyway) — confirm this vs pushing tenancy into RLS-only enforcement.
- **[זהות והרשאות]** Does the current operator keep a cross-tenant platform-admin console after the split, and does x-operator-secret survive as its auth (localStorage bearer) or migrate to a platform_admin role on a real account?
- **[זהות והרשאות]** Cut-over plan for live sessions: replacing dash_auth logs out the operator's trusted devices; is a dual-accept window (old cookie OR new session) needed, or is a one-time re-login acceptable for a 1-user system?
- **[זהות והרשאות]** Are saved-views/annotations per-USER or per-TENANT in the target model? dashboard_state re-keying needs the answer up front (PK (tenant_id,key) vs (tenant_id,user_id,key) for a subset of keys).
- **[זהות והרשאות]** Inngest workers run platform-level with service-role (correct), but per-tenant fan-out cost/quota: should cron-tick enrollment become tenant-aware (pause a delinquent tenant) — relevant given the planned Inngest→QStash cost migration (~late June)?
- **[זהות והרשאות]** Shopify webhook lookup is by shop domain (lookupStoreByShopDomain) — is shop-domain uniqueness enforced across tenants (two tenants claiming the same myshopify domain), and should add-store verify-creds reject cross-tenant duplicate domains?
- **[הנחות עסק-יחיד מקודדות]** Is 'one deployment per tenant' (separate Vercel project + Supabase per business) an acceptable interim model? It sidesteps most singletons but fails the stated target ('zero operator shell access' onboarding) — worth an explicit decision before investing in tenant_id plumbing.
- **[הנחות עסק-יחיד מקודדות]** Base-currency strategy: keep the *_cad column names and reinterpret them as 'tenant base currency' (cheap, slightly dishonest schema), or rename/alias columns (honest, touches every reader + the agg RPCs)? The audit assumes reinterpretation.
- **[הנחות עסק-יחיד מקודדות]** WhatsApp: per-tenant sender (each tenant's own Meta WABA + template approval — weeks of non-code lead time) or one shared sender with per-tenant recipients/templates? This dominates the notifications gap.
- **[הנחות עסק-יחיד מקודדות]** Is the TikTok shared-advertiser model (one ad account serving multiple stores via campaign-store-map) a permanent product feature future tenants get (agency-style), or an artifact of THIS business that new tenants bypass by bringing first-party TikTok creds? Determines whether to generalize or merely de-hardcode it.
- **[הנחות עסק-יחיד מקודדות]** Do future tenants need per-tenant timezones at launch, or can v1 multi-tenant ship Asia/Jerusalem-only (all near-term tenants Israeli)? The cron-day-boundary work (gap 8) is the most invasive of the major items and is fully deferrable if yes.
- **[הנחות עסק-יחיד מקודדות]** The lens-3 sweep found the campaignStoreMap lives in dashboard_state while campaign_registry/campaigns_daily live in real tables — when tenant-scoping, should the map graduate to a proper table (store_id-validated, FK'd) instead of a JSON blob under a tenant-scoped key?
- **[צנרת Inngest / פלטפורמות]** Store-id namespace decision: every event id and dedupe key is tenant-safe ONLY under globally-unique store ids (current stores.id global PK + 409-on-dup). Will tenant stores keep one global slug namespace, or move to tenant-prefixed ids? Decide before any tenant table lands — retrofitting ids into in-flight Inngest events and STORED generated dedupe columns is much costlier later.
- **[צנרת Inngest / פלטפורמות]** Sequencing vs. the deferred Inngest->QStash/pg_cron migration (~late June per docs/cost/2026-06-06-inngest-cost-cut.md): per-tenant cadence/exec work targets whichever scheduler survives — building tenancy into Inngest functions that are about to be replaced would be wasted effort.
- **[צנרת Inngest / פלטפורמות]** Google OAuth consent screen ('roas-tracker-ga') is still Testing-mode with 7-day refresh-token TTL (googleAccountConfig.ts operator note) — publication to Production is a hard prerequisite for ANY tenant Google self-serve and is an operator action pending since 2026-05-30. Also: is Google Ads API Standard Access (higher shared developer-token quota) planned, or will tenants need their own developer tokens?
- **[צנרת Inngest / פלטפורמות]** TikTok model: is the shared-advertiser-with-per-campaign-store-remap (uzoshop-owned) intended to exist for tenants at all, or is multi-tenant TikTok strictly per-tenant-advertiser? The secretsRegistry hardcode and the campaignStoreMap override logic both assume the former.
- **[צנרת Inngest / פלטפורמות]** Meta token strategy for tenants: paste-in system-user tokens from each tenant's own Meta Business work with today's code (per-store META_ACCESS_TOKEN wins over the global fallback), but a real product needs a Meta OAuth flow -> App Review with ads_read — weeks of external lead time. Which is the target?
- **[צנרת Inngest / פלטפורמות]** WhatsApp sender identity: do tenants share the operator's WhatsApp Cloud sender number (recipients-only isolation, cheap) or need their own WABA/sender (per-tenant WHATSAPP_PHONE_NUMBER_ID + template approvals, much heavier)?
- **[state בצד הלקוח וניתוב]** Tenancy carrier decision (blocks the caching + routing gaps): session-cookie with bare paths (least churn, requires private/no-store on ~all cached API routes) vs /t/[slug] path tenancy (CDN-safe, shareable deep links) vs subdomains (max isolation, Vercel wildcard-domain setup)? The audit leans session-based as the incremental path.
- **[state בצד הלקוח וניתוב]** Can one user belong to multiple tenants (agency model)? If yes, the localStorage namespacing + a tenant-switcher UI become mandatory (not just login-time clearing), and 'last-write-wins' sync needs per-tenant lastPushAt bookkeeping.
- **[state בצד הלקוח וניתוב]** Which STATE_KEYS become per-USER vs per-TENANT? Proposed: billing/cogs/salary/goal/annotations/campaign-maps = tenant; saved-views/column-visibility/insight-states = user. Needs product decision before the scope column lands.
- **[state בצד הלקוח וניתוב]** Hebrew-only UI copy (cloudSync error strings cloudSync.ts:349,384, the whole dashboard) — is multi-tenant scoped to Hebrew-speaking businesses, or does tenancy imply an i18n workstream (out of this lens's effort numbers)?
- **[state בצד הלקוח וניתוב]** The 'monthly goal is global' invariant (goalSettings.ts:12-16, GoalTracker ignores filters) — under tenancy it naturally becomes per-tenant-global; confirm no per-store goal requirement is being smuggled in with multi-tenant.
- **[state בצד הלקוח וניתוב]** Migration of the existing single bucket: backfilling current dashboard_state rows to the founding tenant is trivial, but do per-DEVICE localStorage caches on the operator's existing devices need a one-time migration shim (old bare keys → tenant-namespaced keys) to avoid the first-time-migration push re-uploading stale data?
- **[תפעול, עלות ו-onboarding]** Do tenants bring their own ad-platform developer apps, or share the operator's? Google Ads developer-token access level (Basic vs Standard) caps how many external customer accounts one token may serve — this decides whether gap 1's Google flow is 'publish consent screen' or 'apply for Standard access' (weeks of Google review).
- **[תפעול, עלות ו-onboarding]** What is the tenant alert channel: shared WABA (free 1000 conversations/mo pool exhausts at ~10 tenants of 3 daily summaries; utility conversations billed after), per-tenant WABA (each tenant does Meta business verification — heavy), or fall back to email for tenants and keep WhatsApp operator-only?
- **[תפעול, עלות ו-onboarding]** Does the deferred Inngest→QStash/Vercel-cron migration (docs/cost/2026-06-06-inngest-cost-cut.md, deferred to late June) land BEFORE tenant growth? Fan-out cost is ~100K execs/store/mo, so the answer changes both the per-tenant cost model and the dead-man's-switch design (the watchdog is mandatory under Vercel cron, optional under Inngest).
- **[תפעול, עלות ו-onboarding]** Single shared Supabase project with RLS for all tenants, or project-per-tenant? Today's backup/restore granularity is the whole project — if a tenant demands restore or data residency, project-per-tenant changes gaps 5-7 substantially.
- **[תפעול, עלות ו-onboarding]** When Shopify onboarding becomes a public OAuth app (gap 1), is the operator prepared for Shopify app review + the mandatory GDPR webhooks (gap 6) as a hard precondition — i.e., should those two gaps be executed as one combined phase?
- **[תפעול, עלות ו-onboarding]** Is per-tenant billing actually in scope for the first multi-tenant milestone, or is metering-only (cost attribution without charging) sufficient — affects whether gap 5 is 3 days (metering) or 6+ (Stripe + plans + dunning)?

---

# נספח — ממצאים מלאים פר-עדשה (ראיות מילוליות מהסוכנים)

## שכבת הנתונים (סכמה / RLS) (data-tenancy)

**מצב נוכחי:** Single-tenant, multi-store. There is NO tenant/business entity anywhere: grep for tenant/business across all 51 files in supabase/migrations/ returns zero table hits; `stores` (20260521063112_initial_schema.sql:12-23 + 20260606170000_stores_self_serve_columns.sql) has lifecycle/config columns but no tenant_id. Access model is server-trust: 20260607140000_phase5_rls_revoke_anon.sql enabled RLS on all 24 tables with ZERO policies and revoked all anon grants, so service_role (which bypasses RLS) is the ONLY access path — getSupabase() in dashboard-web/src/lib/supabase.ts returns the SERVICE-ROLE client even for reads (Phase 5a comment, lines 4-16). AuthZ above the DB is one shared dash_auth cookie whose token is just `${expiry}.${hmac(expiry)}` — no identity, no tenant claim (dashboard-web/src/lib/auth/dashboardAuth.ts:18-29) — plus one global x-operator-secret for /api/operator/* (src/middleware.ts:101-102). Readers fetch ALL stores' rows with only date filters (e.g. fetchDailyDataFromPostgres, postgresReaders.ts:368-392) and any authenticated browser sees everything. The good news: ~20 of 24 tables already carry store_id in their PK/unique constraints, the store list/secrets/crons are fully DB-driven, and the add-store wizard works with zero code changes — so an incremental tenants-table-above-stores path exists; no rewrite is needed for the fact tables.

**כבר מוכן:**
- Store-scoped fact tables with store_id baked into every PK/unique constraint — tenant scoping can be derived transitively via a future stores.tenant_id without touching these schemas: data_daily PK(date,store_id), products_daily PK(date,store_id,product_id), campaigns_daily PK(date,store_id,platform,campaign_id,ad_set_id), ads_daily PK(date,store_id,ad_id), orders_attribution PK(store_id,order_id), product_catalog PK(store_id,product_id) (all 20260521063112_initial_schema.sql); manual_overrides UNIQUE(date,store_id,platform) (initial_schema.sql:36); campaign/adset/ad registries PK(store_id,platform,<entity_id>) and campaign_status_events dedupe_key embeds store_id (20260530230000_phase_b_registries.sql:27,60,93,136-141); token_failures PK(provider,store_id,operation); data_freshness PK(store_id,platform,scope,table_name); meta_buc_usage PK(store_id,ad_account_id); customer_first_order PK(store_id,customer_id); customer_cohort_monthly PK(store_id,first_order_month,month_since); store_ad_state PK(store_id,platform); store_events/store_webhooks FK stores(id) (20260601120000)
- Dynamic DB-driven store registry: getStores()/loadActiveStoreIds() (dashboard-web/src/lib/getStores.ts) is the single source for the store list, and all cron families fan out per-store from it (dashboard-web/src/lib/inngest/planStoreJobs.ts) — adding a tenant's stores automatically enrolls them in the whole pipeline
- Encrypted per-store credentials in DB: store_secrets AES-256-GCM, PK(store_id,secret_key), deliberately no anon grant (20260606170100_store_secrets.sql), with a registry contract (lib/secretsRegistry.ts) and env fallback — store onboarding already requires zero code and zero shell access via POST /api/operator/stores (add-store wizard with slug validation, reserved-id rejection, rollback)
- Deny-by-default DB posture: RLS enabled on all 24 public tables + schema-wide anon REVOKE (20260607140000_phase5_rls_revoke_anon.sql) — a clean base to ADD tenant policies onto, rather than having to claw back open grants
- Store-parameterized RPCs already exist where it matters most: get_hot_campaign_ids/get_hot_adset_ids/get_hot_ad_ids(p_store_id,p_platform) (20260530240000) and recompute_first_order_flags(p_store_id) (latest 20260610140000) — the per-store call convention is established
- Webhook ingest is already multi-store with no code per store: store_webhooks routes by UNIQUE shop_domain to store_id, per-store HMAC signing_secret + cart_public_token (20260601120000_realtime_activity_feed.sql:13-24), idempotent store_events dedupe_key
- Per-store ads-off and lifecycle: store_ad_state PK(store_id,platform) (20260606160000) + archive/restore/delete routes (/api/operator/stores/[id]/...) — the store lifecycle surface a tenant admin would need is already built

**פערים:**

### 🔴 חוסם · No tenant/business entity above stores · ~2 ימים

**ראיות:** No businesses/tenants table in any of the 51 migrations (grep -i 'tenant|business' over supabase/migrations/*.sql matches only comments); stores table (20260521063112_initial_schema.sql:12-23, extended by 20260606170000) has status/brand_color/display_order but no tenant_id; getStores() (lib/getStores.ts) returns the one flat list to every caller.

**העבודה:** Add tenants table (id, name, status, settings JSONB) + stores.tenant_id TEXT NOT NULL FK with backfill of the 3 stores to a founding tenant; thread tenantId through getStores({tenantId}) and the add-store wizard. Because store_id stays globally unique (stores.id TEXT PK), NO per-table tenant_id columns or PK/dedupe-key changes are needed on the ~20 store-scoped tables — tenancy is derived by resolving the tenant's store-id set at the boundary.

### 🔴 חוסם · No user identity or tenant-scoped authentication · ~9 ימים

**ראיות:** dash_auth token is `${expiry}.${hmacHex(expiry)}` — literally no identity or tenant claim (lib/auth/dashboardAuth.ts:18-29, makeAuthToken:62-66); one shared password for the whole app; one global OPERATOR_SECRET header for all /api/operator/* (src/middleware.ts:52-53,101-102). Target requires per-tenant users who can never see another tenant.

**העבודה:** Replace the shared-password gate with real auth (Supabase Auth or NextAuth) + a users/tenant_memberships table; session carries tenant_id; middleware resolves tenant per request; split the operator surface into platform-super-admin (cross-tenant, keeps x-operator-secret) vs tenant-admin routes (store add/archive, manual overrides, ad-state for OWN stores only). Largest single work item.

### 🔴 חוסם · All reads/writes are unscoped service_role — tenant isolation has no enforcement layer · ~7 ימים

**ראיות:** getSupabase() returns the service-role client which bypasses RLS (lib/supabase.ts:4-16); RLS has tables enabled but ZERO policies (20260607140000 — deny-all to anon only); readers fetch every store's rows with only date filters, e.g. fetchDailyDataFromPostgres (postgresReaders.ts:368-392), fetchPaymentMethods/fetchCohorts/fetchCampaigns all pull all stores and filter client-side; agg_payment_methods_monthly() GROUP BYs the entire orders_attribution table (20260610130000:36-49).

**העבודה:** Incremental two-layer path (no rewrite): (1) app layer — add a mandatory tenant-scoped query seam in postgresReaders/API routes (`.in('store_id', tenantStoreIds)` on every reader; ~25 reader functions + ~15 API routes), with a parity test that every exported reader takes/enforces tenant scope (same pattern as the stateKeysParity guard); (2) hermetic backstop — add RLS policies keyed on a JWT tenant claim and move dashboard READS off service_role to a per-request authenticated client, keeping service_role for cron writers only.

### 🔴 חוסם · dashboard_state is a global single-namespace KV holding business-level settings · ~2.5 ימים

**ראיות:** dashboard_state PK is bare `key` (initial_schema.sql:158-163); ALLOWED_STATE_KEYS holds per-BUSINESS settings — billing-recurring/onetime, annotations, monthly-revenue-goal, cogs-settings, salary-settings, goal-settings, saved-views, campaign-product-map, campaign-store-map (lib/dashboardStateKeys.ts:29-51); fetchDashboardStateFromPostgres reads ALL keys with no scoping (postgresReaders.ts:621-649). Tenant B saving COGS% would overwrite tenant A's.

**העבודה:** Add tenant_id to dashboard_state, PK → (tenant_id, key), backfill existing rows to the founding tenant; thread tenantId through fetch/upsert + /api/dashboard-state route + cloudSync; campaign-store-map (TikTok shared-advertiser mapping) becomes per-tenant naturally. One migration + ~6 call sites + the parity tests.

### 🟠 מהותי · Notification config and alert recipients are global — alerts would leak tenant data cross-tenant · ~2.5 ימים

**ראיות:** notification_config has no store/tenant column (initial_schema.sql:166-178); sendDailySummary loads the single active metacloud row and sends ALL stores' numbers to phone1/phone2 (lib/notifications/sendDailySummary.ts:81-94); token-failure alerts hardcode ALERT_PHONE = '+972524809540' (lib/notifications/tokenFailures.ts:85).

**העבודה:** Add tenant_id to notification_config (one row-set per tenant), make the daily summary aggregate only the tenant's stores, and route token-failure/FX alerts per tenant (operator keeps a global ops channel). WhatsApp sender creds can stay platform-global; recipients/templates become per-tenant.

### 🟠 מהותי · Shared __global__ secrets bucket couples platform credentials to the founding tenant · ~1.5 ימים

**ראיות:** GLOBAL_SECRET_KEYS stores GOOGLEADS_DEVELOPER_TOKEN/CLIENT_ID/CLIENT_SECRET/LOGIN_CUSTOMER_ID/REFRESH_TOKEN + META_GLOBAL_TOKEN under store_id '__global__' (lib/secretsRegistry.ts:32-40; ARCHITECTURE.md §self-serve 3A). GOOGLEADS_LOGIN_CUSTOMER_ID/REFRESH_TOKEN are the operator's MCC — tenant 2's Google fetch would resolve tenant 1's credentials via the global fallback. TikTok keys are hard-gated to uzoshop (secretsRegistry.ts:28-29) reflecting the one-advertiser-shared-across-the-business model (ARCHITECTURE.md:211).

**העבודה:** Split secret scope into platform-global (Google developer token, app client id/secret — genuinely shareable) vs tenant-global (MCC login id, refresh token, Meta business token, TikTok advertiser) stored under a per-tenant scope (e.g. store_id = '__tenant__:<id>'); update getGlobalSecret resolution order and the backfill route. The per-store secret rows already work unchanged.

### 🟠 מהותי · Date-global RPCs write across all stores/tenants per call and trust the caller · ~2 ימים

**ראיות:** agg_data_daily_for_date(d date) Pass 1 zeroes EVERY data_daily row for the date across all stores before re-aggregating (20260530310000:36-44, re-affirmed in 20260609180000 + 20260610120000) — every hot-metrics worker call touches all tenants' rows; agg_tiktok_spend_per_store_for_date(d date) same shape (20260610120000:162); agg_payment_methods_monthly() scans the whole table (20260610130000); store-parameterized RPCs (get_hot_*_ids, recompute_first_order_flags) take p_store_id but perform no membership check — pure caller trust.

**העבודה:** Re-scope the agg RPCs to take a store-id set (or store_id) so a worker only recomputes its own store's rows — also removes cross-tenant lock contention; add tenant filtering to agg_payment_methods_monthly (p_store_ids text[]); once RLS-backstop lands, make RPCs SECURITY INVOKER or add tenant-membership assertions. Mechanical SQL changes + the 4 worker call sites + reconcile harness.

### 🟠 מהותי · Hardcoded single-business assumptions: store-name map, hardcoded fallback stores, Israel timezone, CAD canonical currency · ~3 ימים

**ראיות:** STORE_NAME_BY_ID hardcodes the 3 stores (postgresReaders.ts:733-737, used at :847,:1235,:1357,:1489 — new tenants' stores display raw ids); getStores() HARDCODED fallback resurrects the founding tenant's 3 stores for ANY caller on DB blip (lib/getStores.ts:20-24,52); day boundaries hardcoded Asia/Jerusalem (lib/getTodayInIsrael.ts:14, lib/dateRange.ts:106); every money column is *_cad with cadConvert as the single conversion path (initial_schema.sql data_daily cols; lib/inngest/cadConvert.ts).

**העבודה:** Replace STORE_NAME_BY_ID with the stores table (already loaded elsewhere); make the hardcoded fallback tenant-aware or fail-empty for non-founding tenants; add tenants.timezone and thread it through getTodayInIsraelTz/dateRange (the helper already takes nowIso). Currency: keep CAD as the internal canonical unit initially (rename-free), add per-tenant display currency later — defer the column-rename rewrite.

### 🟠 מהותי · No tenant onboarding flow (signup, tenant creation, password/users per tenant) · ~3 ימים

**ראיות:** Store onboarding is zero-code (POST /api/operator/stores wizard), but tenant onboarding has no surface: the only credentials are env vars (DASHBOARD password gate, OPERATOR_SECRET, src/middleware.ts:52-53) — adding a tenant today literally means deploying a second Vercel project. Target: zero code + zero shell for a new tenant.

**העבודה:** After the auth gap (G2) lands: tenant-creation flow (super-admin creates tenant + invites first tenant-admin user; or self-serve signup), per-tenant store wizard reuse, per-tenant Inngest enrollment is automatic via loadActiveStoreIds once stores carry tenant_id. Mostly UI + invite/email plumbing on top of G1/G2.

### 🟡 משני · Store-id slug namespace is global — two tenants cannot both have store id 'myshop' · ~0.5 ימים

**ראיות:** stores.id is a bare TEXT PK (initial_schema.sql:13) and every table FKs/keys on that text; the wizard rejects duplicates (api/operator/stores/route.ts:138-142,168-170 slug regex + existence check). Per-tenant slugs would require surrogate keys and a FK-chain rewrite across ~20 tables.

**העבודה:** Keep store_id globally unique (the cheap, correct call): auto-prefix or suffix wizard-generated ids on collision and keep a per-tenant display name. Document the invariant. No schema change.

### 🟡 משני · Operator observability tables/panels are platform-global with no tenant view · ~1 ימים

**ראיות:** cron_tick_snapshots has no store/tenant scope (20260530230000:149-157); /api/operator/freshness, token-failures, status-events, cron-tick-snapshots return all stores; data_freshness/token_failures ARE store-scoped so tenant filtering is possible, but no tenant-facing surface exists.

**העבודה:** Keep cron_tick_snapshots global (platform-ops concern). Add tenant-filtered variants of freshness/token-failure panels for tenant admins once G2 lands. Pure read-path filtering.

### 🟡 משני · Full-table read patterns won't scale past a handful of tenants · ~2 ימים

**ראיות:** paginate() hard-caps at 50×1000 rows (documented in 20260610130000 header — orders_attribution already at ~46.8k); readers like fetchProductsFromPostgres/fetchCampaigns pull all stores then filter in JS; agg_payment_methods_monthly was the first fix of this class.

**העבודה:** The tenant scoping from G3 (`.in('store_id', …)` pushdown) fixes most of this for free — each tenant reads only its slice. Audit remaining unbounded readers (orders_attribution, product_catalog) and push tenant filters server-side; more SQL-side GROUP BY RPCs as row counts grow.


## זהות והרשאות (auth)

**מצב נוכחי:** AUTH MODEL TODAY (verified in code): Two stacked gates, both enforced exclusively in Edge middleware (dashboard-web/src/middleware.ts:62-113) — no API route contains its own session check (verified: api/data, api/campaigns, api/stores, api/dashboard-state have zero auth code; the webhook/cart/inngest routes are the only self-authenticating ones). Gate 1: one shared DASHBOARD_PASSWORD; POST /api/login (src/app/api/login/route.ts:35-76) constant-time-compares it and mints a 60-day `dash_auth` cookie whose token is ONLY `${expiryEpochMs}.${hmacSha256(expiry)}` keyed by AUTH_SIGNING_SECRET (src/lib/auth/dashboardAuth.ts:62-66) — the token carries NO user id, NO tenant id, NO session id; it is a bearer "this device knew the password" stamp. Verification is verifyAuthToken in middleware (middleware.ts:74-78); anyone with a valid cookie can read/write EVERYTHING (all stores, all settings). Stateless → no per-device revocation; ARCHITECTURE.md (§ Phase 5c note, line ~3518) explicitly warns "Do NOT rotate AUTH_SIGNING_SECRET (would invalidate every live cookie)" — i.e. the only revocation lever is a global logout. No login rate-limit/lockout exists (login/route.ts has none). Gate 2: /api/operator/* additionally requires a single global `x-operator-secret` header matching OPERATOR_SECRET (checkOperatorSecret, src/lib/middlewareHelpers.ts:164-190; 404 on mismatch), client-side stored in localStorage key 'operatorSecret' (src/lib/operatorClient.ts:17-50). This one secret is god-mode: store CRUD/archive/delete (api/operator/stores/*), secrets backfill (api/operator/backfill-secrets), reset, manual-overrides, sync-now. Both gates fail-closed in prod via boot guard (middleware.ts:48-55) and VERCEL_ENV force-enforcement (middlewareHelpers.ts:49-54, 140-151). EXTERNAL ALLOWLISTED ROUTES (isDashboardAuthAllowlisted, middlewareHelpers.ts:90-123): /api/webhooks/shopify authenticates PER-STORE via X-Shopify-Hmac-Sha256 against store_webhooks.signing_secret looked up by shop domain (webhooks/shopify/route.ts:39-45; table in migration 20260601120000 lines 13-18) — already per-store, not shared; /api/events/cart authenticates via per-store cart_public_token in the body (events/cart/route.ts trust-model header, lines 16-32); /api/inngest authenticates via platform-level X-Inngest-Signature / INNGEST_SIGNING_KEY validated by serve() with a prod boot assert (api/inngest/route.ts:148); /api/oauth/tiktok/callback is allowlisted and unauthenticated by design (renders only the single-use auth_code). DATA LAYER: all server access uses the Supabase service-role key which BYPASSES RLS; migration 20260607140000_phase5_rls_revoke_anon.sql enabled RLS deny-all (no policies) on every table and revoked anon — so isolation is 100% app-layer today. SINGLE-USER ASSUMPTIONS WITH EVIDENCE: dashboard_state table PK is `key` alone (migration 20260521063112 line 158-162) and GET /api/dashboard-state returns the ENTIRE KV while POST upserts by key with no owner (dashboard-state/route.ts:29-43, 75-105) — so cogs-settings, salary-settings, goal-settings, billing-recurring/onetime, annotations, saved-views, insight-states, campaign-store-map, campaign-product-map (ALLOWED_STATE_KEYS, src/lib/dashboardStateKeys.ts:29-51) are all deployment-wide singletons; notification_config is a global singleton table (initial_schema line 166-177, phone1/phone2) with WhatsApp creds from global env and default recipient +972524809540 (src/lib/notifications/whatsapp.ts:45-90); GET /api/stores returns ALL stores to any cookie-holder (api/stores/route.ts:12-15); every data route accepts any ?store= param unchecked. NO tenant/user/membership table exists anywhere in supabase/migrations (full CREATE TABLE inventory verified). The word "tenant" in code (secretsRegistry.ts:18, campaignsLinks.ts:127, tiktokWorker.ts:395) refers to TikTok shared-ad-account store mapping, not business tenancy.

**כבר מוכן:**
- Per-store external-ingest auth is ALREADY tenant-shaped: Shopify webhooks verify per-store HMAC from store_webhooks.signing_secret keyed by shop domain (webhooks/shopify/route.ts:39-45), and the cart beacon uses per-store cart_public_token (events/cart/route.ts:16-32). Adding a store→tenant join is the only change needed; no shared-secret redesign required.
- Inngest serve endpoint is self-authenticating platform-level (X-Inngest-Signature, INNGEST_SIGNING_KEY, prod boot assert at api/inngest/route.ts:148) — correct as-is for multi-tenant since the queue belongs to the platform, not a tenant.
- Centralized, unit-tested allowlist (isDashboardAuthAllowlisted, middlewareHelpers.ts:90-123) — single place to reason about unauthenticated surface; the 2026-06-03 Inngest-pinning incident is documented inline, so the pattern is hardened.
- Encrypted per-store secrets vault already shipped: store_secrets AES-256-GCM, service-role-only, no anon grant (migration 20260606170100), with secretsRegistry contract (src/lib/secretsRegistry.ts), maskSecret + CLIENT_SAFE_SECRET_KEYS + repo-wide secret-echo CI audit (ARCHITECTURE.md Phase 5c notes). Per-tenant credential storage needs zero new crypto work.
- RLS is already ENABLED deny-all on every public table with anon revoked (migration 20260607140000_phase5_rls_revoke_anon.sql lines 18-40) — adding tenant policies is additive, not a retrofit of an RLS-off schema.
- Fail-closed production posture: middleware boot guard throws on missing DASHBOARD_PASSWORD/AUTH_SIGNING_SECRET/OPERATOR_SECRET (middleware.ts:48-55) and gates force-enforce when VERCEL_ENV=production (middlewareHelpers.ts:49-54, 140-151) — the deploy-safety discipline multi-tenant auth needs is already cultural.
- Security primitives are solid and shared: Edge-safe constant-time compare (middlewareHelpers.ts:66-73), HMAC cookie infra on Web Crypto usable in both runtimes (dashboardAuth.ts:43-56), open-redirect-safe sanitizeNext (dashboardAuth.ts:101-109), HttpOnly/Secure/SameSite=Lax cookie (login/route.ts:66-74).
- Store-level onboarding without code changes already exists (add-store wizard + verify-creds + webhookSecret field + archive/restore/delete lifecycle, api/operator/stores/* routes, Phase 6a/6b plans) — tenant onboarding can compose this flow rather than rebuild it.

**פערים:**

### 🔴 חוסם · No user identity: dash_auth token has no subject — sessions cannot be bound to a tenant · ~3 ימים

**ראיות:** Token shape is `${expiry}.${hmacHex(expiry)}` only (src/lib/auth/dashboardAuth.ts:62-66); verifyAuthToken checks expiry+signature, nothing else (lines 77-91). /api/login compares ONE shared DASHBOARD_PASSWORD (src/app/api/login/route.ts:59). No users table exists in any migration; no Supabase Auth / NextAuth import anywhere in src (grep verified).

**העבודה:** Adopt Supabase Auth (natural fit — DB is already Supabase; @supabase/ssr server client + auth.users). Replace /login + /api/login with email/password or magic-link sign-in; middleware verifies the Supabase session cookie instead of dash_auth. Keep the existing fail-closed boot-guard pattern. This also fixes session revocation for free (gap below).

### 🔴 חוסם · No tenant data model: no tenants/memberships tables, stores have no owner · ~2 ימים

**ראיות:** Full CREATE TABLE inventory of supabase/migrations has zero user/tenant/membership/role tables (verified grep). stores self-serve columns (migration 20260606170000) add status/brand_color/is_headless/has_tiktok/display_order — no tenant_id. store_secrets PK is (store_id, secret_key) with no tenant scope (migration 20260606170100).

**העבודה:** Migrations: `tenants` (id, name, status), `tenant_members` (tenant_id, user_id, role owner|viewer), `stores.tenant_id NOT NULL` backfilled to a 'default' tenant for the 3 existing stores (same byte-identical-backfill pattern as 20260606170000). All per-store tables inherit tenancy through store_id→stores.tenant_id; only truly global tables (dashboard_state, notification_config — see separate gaps) need direct tenant_id.

### 🔴 חוסם · Enforcement point is middleware-only and binary — no per-route session→tenant binding, every route serves all stores to any cookie-holder · ~5 ימים

**ראיות:** Data routes contain zero auth code (api/data/route.ts, api/campaigns/route.ts, api/stores/route.ts:12-15 — getStores() returns ALL stores; api/dashboard-state/route.ts:29-43 GET returns entire KV). Middleware only answers 'has any valid cookie?' (middleware.ts:72-94). Store filtering is a trusted client-supplied ?store= param (e.g. activity-stats per ARCHITECTURE §AS-T1).

**העבודה:** Add ONE per-route helper `requireTenant(req)` → { userId, tenantId, role, allowedStoreIds } (resolves Supabase session → tenant_members → stores). Middleware stays the coarse logged-in gate (Edge can't do DB membership lookups per-request cheaply, and CVE-2025-29927-class bypasses argue against middleware-as-sole-authority); the helper is the authoritative enforcement point called at the top of each of the ~30 routes, and every reader in postgresReaders/aggregators gets storeIds threaded in (most already take store params — the mapping-aware aggregate discipline exists).

### 🔴 חוסם · dashboard_state is a deployment-global KV — COGS/salary/billing/goal/saved-views/annotations would leak across tenants · ~1.5 ימים

**ראיות:** dashboard_state PK = key alone (migration 20260521063112 lines 158-162); POST upserts by key with no owner and GET returns all keys (api/dashboard-state/route.ts:75-105, 29-43); ALLOWED_STATE_KEYS lists 12 business-settings keys incl. cogs-settings, salary-settings, billing-recurring, goal-settings, saved-views, campaign-store-map (src/lib/dashboardStateKeys.ts:29-51).

**העבודה:** Re-key to PK (tenant_id, key) + backfill existing rows to the default tenant; dashboard-state route reads tenant from requireTenant and scopes both verbs; cloudSync client unchanged (server injects tenant). Decide saved-views per-tenant vs per-user (open question). Keep the STATE_KEYS↔ALLOWED_STATE_KEYS parity guard.

### 🔴 חוסם · Single global OPERATOR_SECRET god-mode console — no roles, no per-tenant admin · ~2.5 ימים

**ראיות:** checkOperatorSecret gates ALL /api/operator/* on one env secret (middlewareHelpers.ts:164-190); secret lives in browser localStorage 'operatorSecret' (operatorClient.ts:17-50); under it sit store CRUD/delete (api/operator/stores/[id]/route.ts), secrets backfill (api/operator/backfill-secrets), reset, manual-overrides, sync-now — tenant-A's 'owner' would hold a secret that can delete tenant-B's stores.

**העבודה:** Split into (a) tenant-owner role (from tenant_members.role) authorizing tenant-scoped store lifecycle/secrets/sync via requireTenant(role='owner') — the operator UI becomes per-tenant settings; and (b) a platform-admin surface (cross-tenant reset/backfill/diag) which can keep x-operator-secret short-term, ideally migrating to a platform_admin role. Incremental: routes already exist, only the gate + store-scope checks change.

### 🟠 מהותי · No session lifecycle: 60-day stateless bearer cookie, no revocation, signing-secret rotation = global logout · ~1 ימים

**ראיות:** SIXTY_DAYS_MS cookie Max-Age (dashboardAuth.ts:36, login/route.ts:73); token is self-contained — nothing server-side to revoke; ARCHITECTURE.md Phase 5c note: 'Do NOT rotate AUTH_SIGNING_SECRET (would invalidate every live cookie)'.

**העבודה:** Solved as a side-effect of Supabase Auth adoption (refresh-token rotation, per-user sign-out, password reset). If auth migration is staged, interim: add a server-side session/jti table checked in requireTenant. Also add per-tenant secret rotation UX for store_webhooks.signing_secret / cart_public_token (rotate-able PATCH already exists per ARCHITECTURE MF-2 note — surface it per-tenant).

### 🟠 מהותי · No signup/invite flow — tenant onboarding requires Vercel env edits and shared-password distribution · ~3 ימים

**ראיות:** The only credential issuance paths are: operator sets DASHBOARD_PASSWORD env (login/route.ts:36) and hands the operator secret to localStorage manually (operatorClient.ts). Adding a tenant today = sharing the ONE password that opens everything. Zero-code onboarding target fails by definition.

**העבודה:** Tenant-creation + invite flow on top of Supabase Auth: signup creates tenant + owner membership; owner invites members (email invite, role picker owner/viewer). Compose with the existing add-store wizard (Phase 6a) so a new tenant connects stores entirely from UI. Per-tenant WhatsApp/alert recipient capture belongs in this flow too.

### 🟠 מהותי · RLS has no tenant policies — isolation rests 100% on app code because service-role bypasses RLS everywhere · ~3 ימים

**ראיות:** Migration 20260607140000: RLS enabled deny-all, comment states 'service_role BYPASSES RLS. All writes + RPCs already use service-role'. Every reader/writer uses getSupabaseAdmin() service-role (ARCHITECTURE §store-events notes). One missed WHERE clause in any of ~30 routes = cross-tenant leak with no second wall.

**העבודה:** Defense-in-depth, incremental: add tenant-scoped policies (USING store_id IN (SELECT id FROM stores WHERE tenant_id = auth.jwt tenant claim)) and move ROUTE READS to a tenant-scoped client (authenticated role / request-scoped JWT), keeping service-role for Inngest workers only (workers are platform-level and write all tenants). Tables enumerated in 20260607140000 lines 20-40 (~20 tables). Can land after app-layer scoping; required before trusting real second tenant.

### 🟠 מהותי · Alerts/notifications are global singletons — WhatsApp recipients and templates are per-deployment, not per-tenant · ~1.5 ימים

**ראיות:** notification_config table has no tenant/store scope (initial_schema lines 166-177: provider, phone1, phone2 singleton rows); default recipient +972524809540 with env NOTIFICATION_RECIPIENT_ALLOWLIST (src/lib/notifications/whatsapp.ts:83-90); WHATSAPP_PHONE_NUMBER_ID/token are global env (whatsapp.ts:45-55). Token-failure + daily-summary alerts would broadcast tenant-A spend to the platform operator's phone.

**העבודה:** Add tenant_id to notification_config (or per-tenant rows keyed by tenant), thread tenant→recipients through sendDailySummary/tokenFailures (workers already iterate stores, so the store→tenant join gives the routing), and expose recipient management in the per-tenant settings UI. Platform-level failures (Inngest, deploy) stay on the operator channel.

### 🟡 משני · Login hardening absent: no rate limit, lockout, or audit on /api/login · ~0.5 ימים

**ראיות:** api/login/route.ts has constant-time compare only — no attempt counter, no IP throttle, no Sentry/audit event on failures (verified grep for rate/attempt/lockout: none).

**העבודה:** Moot if Supabase Auth replaces the route (provider-side rate limiting + captcha). If shared-password survives any interim, add a minimal per-IP throttle (Upstash/QStash-friendly) + failure logging.

### 🟡 משני · Global platform credentials (__global__ secrets, TikTok OAuth callback) assume one advertiser identity · ~1.5 ימים

**ראיות:** GLOBAL_SECRET_KEYS stores GOOGLEADS_DEVELOPER_TOKEN/CLIENT_ID/CLIENT_SECRET/LOGIN_CUSTOMER_ID/REFRESH_TOKEN + META_GLOBAL_TOKEN under store_id '__global__' (src/lib/secretsRegistry.ts:32-40); /api/oauth/tiktok/callback is a single global allowlisted landing (middlewareHelpers.ts:121-122). A tenant bringing its own Google MCC / Meta BM / TikTok app needs per-tenant rows.

**העבודה:** Re-scope '__global__' to '__tenant:<id>__' (or add tenant_id to store_secrets PK) with fallback to platform-global for the developer-token class that legitimately stays platform-wide (Google developer token). TikTok callback already passes the code through UI-side; per-tenant exchange instructions suffice initially. BYO-OAuth-app flows are later polish.


## הנחות עסק-יחיד מקודדות (hardcoded)

**מצב נוכחי:** LENS 3 verdict: the self-serve-stores project has genuinely dynamized the STORE axis (store list, per-store creds, colors, crons, add/edit/lifecycle UI all read the DB with hardcoded/env fallback), but the BUSINESS axis is still a hard singleton. There is zero tenant dimension anywhere — `grep tenant supabase/migrations/*.sql` returns nothing; `stores.id` is a bare TEXT PK (initial_schema.sql:12-24). Every business-wide object is a per-deployment singleton: `dashboard_state` is keyed by bare `key` (initial_schema.sql:158-162) and carries the load-bearing campaign↔store map plus COGS/goal/salary/billing; `notification_config` is UNIQUE(provider) (20260521075741:13-19) with a literally hardcoded alert phone (+972524809540, tokenFailures.ts:85); the base/display currency is CAD frozen into column NAMES (`fb_spend_cad`, `revenue_cad`, initial_schema.sql:41-58) and format defaults (format.ts:76); the day boundary is Asia/Jerusalem in every cron string and in `getTodayInIsrael.ts:14` (used in 23 non-test files); TikTok's shared-account model hardcodes uzoshop as owner in ~8 places; and a Phase-7 cleanup of residual 3-store literals (type unions, validators, scripts) has not happened — at least one of those (`VALID_STORES` in operatorManualOverrides.ts:18) actively BREAKS a 4th store today (manual overrides rejected). Incremental path is clear: a `tenants` table + `tenant_id` on `stores` + tenant-scoping the ~6 singleton surfaces, riding the already-shipped dual-read pattern. No rewrite needed — the dual-read seams (getStores, getStoreSecret, scheduler→worker fold) were built exactly for this.

**כבר מוכן:**
- Store list is DB-driven with byte-exact fallback: /Users/dorperetz/script-roas/dashboard-web/src/lib/getStores.ts:20-58 (getStores + loadActiveStoreIds; DB authoritative when non-empty, hardcoded 3 only on read failure). Client twin useStores.ts:11-13 same pattern.
- Crons fan out over the DB store list, not the hardcoded consts: cronTickOrchestrator.ts:13,34,84; Phase-4b scheduler→worker folds registered in serve() (api/inngest/route.ts:108-119,164-170) — cronLiveScheduler (cronLive.ts:869-891), cronDailyScheduler, cronYesterdayRefreshScheduler (cronYesterdayRefresh.ts:129-150) all call loadActiveStoreIds() at runtime; the per-store STORES.map factories are kept on disk only as an inert revert lever (route.ts:103-104). A new store enters every cron cycle with no deploy.
- Per-store credentials are dual-read DB-first: /Users/dorperetz/script-roas/dashboard-web/src/lib/storeSecretsReader.ts:24-54 (encrypted store_secrets → ${STORE}_${KEY} env fallback; __global__ for shared keys). Verified: googleAds.ts, shopify.ts, tiktok.ts, meta.ts have NO remaining direct process.env per-store cred reads (only the two sync gates listed in gaps). secretsRegistry.ts:20-39 is the single key contract.
- Add-store wizard + edit/rotate creds + live cred verification shipped: POST/GET /api/operator/stores (route.ts:4-112+), verify-creds route, credVerifiers.ts (pure, injected creds), storeSnippets.ts, rollback-on-partial-failure; archive/restore/delete lifecycle per Phase 6b plan. Onboarding a new STORE requires zero code changes.
- Store colors no longer require code: storeColors.ts resolution order brandColor (stores.brand_color, operator-chosen) → STORE_COLORS map → deterministic FALLBACK_PALETTE (storeColors.ts:29-60); migration 20260606170000 backfilled the 3.
- Platform-configured gates are DB-aware (async variants): isGoogleConfiguredForStoreAsync replaced the hardcoded STORES_WITH_GOOGLE_ADS={uzoshop} short-circuit (googleAds.ts:32-37); isTikTokConfiguredForStoreAsync (tiktokAccountConfig.ts:96-130) lets a DB-only store become configured.
- Account currency is fetched, not assumed: Meta account_currency from the API with ILS only as soft fallback (meta.ts:414,458,722-751), TikTok advertiser currency resolved live + normalized (tiktokAccountConfig.ts:132-161), Google customer.currency_code; FX via getFxRate to the base currency with fail-to-null (preserve prior) semantics.
- Campaign↔store attribution mapping is data-driven, not code: dashboard_state key 'campaign-store-map' read server-side by lib/inngest/campaignStoreMap.ts:9-24 and consumed by tiktokWorker.ts:424,607; resolveStoreForCampaign takes defaultStoreId as a parameter (campaignStoreMap.ts:49-57).
- Security substrate ready for tenant policies: RLS enabled on every table + anon fully revoked (migration 20260607140000); all reads/writes via service-role. Adding per-tenant RLS policies later is additive (the migration's own notes flag this as the Phase-6+ carry-over, ARCHITECTURE.md:3520).
- Webhooks/cart beacons are per-store table-driven: store_webhooks (shop_domain, signing_secret, cart_public_token, allowed_origins) with lookupStoreByCartToken/lookupStoreByShopDomain readers — no per-store env or code.

**פערים:**

### 🔴 חוסם · No tenant dimension in the schema — every business-scoped object is a deployment singleton · ~5 ימים

**ראיות:** grep -rn tenant supabase/migrations/*.sql → 0 hits. stores PK is bare TEXT id (20260521063112_initial_schema.sql:12-24); data tables keyed (date, store_id) only (initial_schema.sql:41-58 et al.); dashboard_state PK = key (initial_schema.sql:158-162); notification_config UNIQUE(provider) (20260521075741_add_constraints_and_grants.sql:13-19). ARCHITECTURE.md:3469 explicitly calls multi-tenant 'a future project that is itself out of scope'.

**העבודה:** Add `tenants` table + `tenant_id` (FK, default 'default') on stores, notification_config, dashboard_state, token_failures, and store_secrets' __global__ rows; backfill the single existing tenant; derive tenant for all per-store data via the store→tenant join (do NOT add tenant_id to the big fact tables — store_id is already the isolation key once stores carry tenant_id). Then per-tenant RLS policies on top of the already-enabled RLS. This is the same additive dual-read playbook as self-serve Phase 1.

### 🔴 חוסם · dashboard_state singleton holds load-bearing cross-tenant state (campaign↔store map, COGS%, monthly goal, salaries, billing, saved views) · ~2.5 ימים

**ראיות:** STATE_KEYS list cloudSync.ts:56-81 + server allowlist dashboardStateKeys.ts:29; campaign-store-map read server-side from the global row (lib/inngest/campaignStoreMap.ts:13-15 .eq('key','campaign-store-map')) and used by tiktokWorker.ts:424 to attribute spend rows; goalSettings.ts/cogsSettings.ts:5 (DEFAULT_COGS_PCT=25)/salarySettings.ts:11 (7%) all localStorage+pushCloudKey to the same single-keyspace table. Tenant B saving COGS% or remapping a campaign would overwrite tenant A's.

**העבודה:** Key dashboard_state by (tenant_id, key) (composite PK), thread tenant into /api/dashboard-state GET/POST and the server readers (campaignStoreMap loader, aiReport COGS reads). Client side needs no key change once the API is tenant-scoped by session. Preserve the 'monthly goal is global' rule but global-within-tenant.

### 🟠 מהותי · CAD is frozen in as THE base/display currency — in column names, format defaults, and frozen FX constants · ~4 ימים

**ראיות:** data_daily columns fb_spend_cad/ga_spend_cad/total_spend_cad/revenue_cad/cogs_cad/net_profit_cad (initial_schema.sql:45-52), same *_cad convention in campaigns_daily/ads_daily and the agg RPCs (20260530120000 tt_spend agg); format.ts:76,105 default code 'CAD'; metricFormat.ts:46 MoneyPrefix='$'|'CAD'; billing.ts:532 FROZEN_USD_TO_CAD; campaignsColumnPrefs.ts:55 label 'CAD'; unknownBucket.ts:18 AOV bands denominated in CAD ($50/$70).

**העבודה:** Incremental path: reinterpret *_cad as 'tenant base currency' (no column rename) + add tenants.base_currency; make every cadConvert/getFxRate target read the tenant's base currency (today hardcoded 'CAD' at ~6 call sites e.g. tiktokAccountConfig.ts:186-206, manualOverrides.ts:103-125); thread a currency code through format.ts/metricFormat defaults and the handful of 'CAD' UI labels. Document the column-name lie or rename in a later cleanup.

### 🟠 מהותי · TikTok shared-account model hardcodes uzoshop as the owning advertiser across ~8 sites · ~2.5 ימים

**ראיות:** adState.ts:16 TIKTOK_SHARED_STORES=['uzoshop','usmile360']; secretsRegistry.ts:27-28 TikTok keys appliesTo:['uzoshop']; postgresReaders.ts:1881 getStoreSecret('uzoshop','TIKTOK_ADVERTISER_ID'); home/tiktokCoverage.ts:36 'Production passes uzoshop' as defaultStoreId; campaignsLinks.ts:127-140 scans for THE single shared advertiser; platformsByStore.ts:49-61 STORES_WITH_TIKTOK literal sets; cronDaily.ts:266; ARCHITECTURE.md:211 documents the model as uzoshop-owned. The Phase-6a wizard deliberately collects NO TikTok creds for new stores (plan decision 4).

**העבודה:** Make the owner/shared-set data-driven: stores.tiktok_owner_store_id (or a tiktok_accounts table: advertiser_id → owning store + member stores), replace the literal sets and the 'uzoshop' default-store params with lookups; let the wizard accept first-party TikTok creds for a tenant that owns its own advertiser (verifier exists for the other platforms as a template). The campaign-store-map mechanism itself already generalizes.

### 🟠 מהותי · Residual hardcoded 3-store lists/unions/validators — the unshipped 'Phase 7 cleanup'; one is an ACTIVE bug for a 4th store · ~2.5 ימים

**ראיות:** operatorManualOverrides.ts:18 VALID_STORES=Set(['uzoshop','zolplus','usmile360']) enforced at manual-overrides route.ts:159 → a self-serve 4th store CANNOT receive manual spend overrides; token-failures route.ts:179-183 validStores literal; tokenFailures.ts:53 TokenFailureStore union; sentry/capture.ts:58 storeId union; platformsByStore.ts:18,30,37-41 STORE_NAMES/StoreId/STORE_ID_TO_NAME; postgresReaders.ts:734-736 id→name map; fetchMeta.ts:77 lookupStoreByAdAccount loops the literal 3; cronDaily.ts:263/cronLive.ts:140/cronYesterdayRefresh.ts:44-54 STORES consts + 'as uzoshop|zolplus|usmile360' casts (cronDaily.ts:575,616,708,762, cronLive.ts:554, metaWorker.ts:773, tiktokWorker.ts:893); CampaignsTable.tsx:867-869 fallback id→name; RoasChart.tsx:41 PRIMARY_COLOR=STORE_COLORS.uzoshop; cronOauthCanary.ts:124-142 uzoshop as the Google+TikTok canary store; aiReport.ts:2552 Hebrew prompt prose 'שלוש חנויות: uzoshop, Zol Plus, 360usmile'.

**העבודה:** Sweep: replace VALID_STORES + token-failures validStores with a getStores()-backed check; widen StoreId/TokenFailureStore unions to string (the DB is the validator now); derive id→name maps from getStores; pick the canary store dynamically (first store with the platform configured); generate the aiReport store-list prose from the actual store list. Add a CI ratchet greping for the 3 literals outside tests/fallbacks so they can't creep back.

### 🟠 מהותי · Alerting/notifications are single-business: hardcoded operator phone, one global WhatsApp sender, one config row per provider · ~2 ימים

**ראיות:** tokenFailures.ts:85 ALERT_PHONE='+972524809540' (comment: 'ALWAYS sends to the single recipient'); whatsapp.ts:45-46 global WHATSAPP_PHONE_NUMBER_ID/WHATSAPP_ACCESS_TOKEN env; notification_config has phone1/phone2 with UNIQUE(provider) — one row per provider per DEPLOYMENT (initial_schema.sql:166-178); daily summary aggregates all stores into one business message (templateParams.ts:27, sendDailySummary.ts:89).

**העבודה:** Scope notification_config by tenant (drop UNIQUE(provider) → UNIQUE(tenant_id, provider)); move ALERT_PHONE into that config; route token-failure + daily-summary sends per tenant (recipients + dashboard_url per tenant). Decide shared-sender vs per-tenant WhatsApp sender (per-tenant Meta template approval is the long pole, not code).

### 🟠 מהותי · Global platform identities (__global__ secrets) are per-deployment: one Google MCC/developer-token/refresh-token, one META_GLOBAL_TOKEN · ~1.5 ימים

**ראיות:** secretsRegistry.ts:32-39 GLOBAL_SECRET_KEYS (GOOGLEADS_DEVELOPER_TOKEN/CLIENT_ID/CLIENT_SECRET/LOGIN_CUSTOMER_ID/GOOGLEADS_REFRESH_TOKEN, META_GLOBAL_TOKEN) stored under the single reserved store_id '__global__' (storeSecretsReader.ts:11-12,44-47 falls back to UNPREFIXED env). A tenant with its own Google MCC or Meta system token cannot coexist.

**העבודה:** Tenant-scope the global tier: store_secrets rows under (tenant_id-scoped synthetic id, e.g. '__global__' + tenant FK column) with getGlobalSecret(tenantId, key); developer token can stay shared (it is per-API-developer, not per-business) but LOGIN_CUSTOMER_ID + refresh tokens must be per-tenant; extend the wizard's Google step to capture them.

### 🟠 מהותי · Asia/Jerusalem day-boundary and cron schedules are a single-business timezone assumption · ~3 ימים

**ראיות:** getTodayInIsrael.ts:14 TZ='Asia/Jerusalem' (used by 23 non-test files incl. all workers via getTodayInIsraelTz, dateRange.ts:106,143); every Inngest cron string is TZ=Asia/Jerusalem (cronLive.ts:873 '*/10', cronYesterdayRefresh.ts:123-124, cronDaily scheduler '5 0 * * *' per route.ts:72-73). 'Yesterday', finalization, and the UTC→IL cross-midnight fix (lib/dateRange.ts) all assume one business TZ.

**העבודה:** Add tenants.timezone; replace getTodayInIsraelTz call sites with getTodayInTz(tenantTz) (helper already centralizes the logic — mechanical); schedulers keep ONE cron each but compute per-tenant 'today/yesterday' inside the fan-out (the scheduler→worker fold makes this easy: planStoreJobs already computes the date per run, cronYesterdayRefresh.ts:136-147). Nightly-at-00:05-local for arbitrary TZs needs either hourly scheduler + per-tenant local-midnight gate, or per-tenant Inngest cron creation.

### 🟡 משני · Deep-history backfills + maintenance are shell scripts with hardcoded STORES and root-.env dotted keys · ~1.5 ימים

**ראיות:** scripts/backfillCohortMonthly.ts:86, backfillAdsReach.ts:33-38 (TT_STORES=['uzoshop']), backfillFirstOrderLedger.ts:82, backfillPaymentGateway.ts:50, backfillRecentAttribution.ts:40, exportCustomersForFacebook.ts:30 — all `const STORES = ['uzoshop','zolplus','usmile360']` and env setup via root .env dotted keys (verified present: uzoshop.shopify.domain= etc. in /Users/dorperetz/script-roas/.env). Target requires zero operator shell access for onboarding; new-store recent backfill IS covered in-app (eventBackfill Inngest + /api/operator/backfill), but cohort/first-order/attribution deep history is shell-only.

**העבודה:** Port the still-relevant deep backfills (cohort monthly, first-order ledger, attribution reclassify) into the existing operator backfill route/Inngest runner reading getStores()+getStoreSecret; delete or quarantine the one-off scripts. The dotted-.env convention dies with them (Vercel runtime already uses UPPER_SNAKE + DB).

### 🟡 משני · Sync env-only platform gates can silently skip a DB-only store on hot paths · ~0.5 ימים

**ראיות:** tiktokAccountConfig.ts:84-93 isTikTokConfiguredForStore reads process.env only (comment: 'Converting it to a DB read here is a Phase-4/6 follow-up'); googleAccountConfig.ts:86 same pattern. Async DB-aware variants exist (tiktokAccountConfig.ts:121-130) but the sync gates remain referenced; a store whose creds live ONLY in store_secrets (every future self-serve store) returns false on any path still using the sync gate.

**העבודה:** Finish the documented cutover: audit remaining call sites of the sync gates, switch to the *Async variants (workers are already async), delete the sync versions. Small, already-designed.

### 🟡 משני · Business-tuned constants are code, not tenant settings (ROAS bands, AOV bands, COGS/salary defaults, frozen FX) · ~1 ימים

**ראיות:** ROAS health bands <2x/2-2.7x/3x baked into format/useRoasBandGradient.ts + synthesis/roasChart.ts (operator-locked for THIS business, memory feedback_roas_band_thresholds — VAT=0 cross-border assumption included); AOV emphasis bands $50/$70 CAD (home/unknownBucket.ts:18, home/adapters.ts:407); DEFAULT_COGS_PCT=25 (cogsSettings.ts:5); DEFAULT_SALARY 7% (salarySettings.ts:11); FROZEN_USD_TO_CAD (billing.ts:2,532). Another business has different break-even economics.

**העבודה:** Hoist into per-tenant settings with the current values as defaults (the editable-COGS pattern is the template: client-side recompute + tenant-scoped dashboard_state). ROAS band thresholds feed color tokens, so keep the band→token mapping and only parameterize the cut points.

### 🟡 משני · Hebrew-only, single-business product voice (UI copy, AI report, WhatsApp templates) · ~0.5 ימים

**ראיות:** Entire UI is Hebrew RTL; aiReport.ts:2498-2560 hard-writes business-specific Hebrew guidance incl. the store roster; WhatsApp templates are pre-approved Hebrew templates keyed by name in notification_config (whatsapp.ts:37-42). Not isolation-relevant, but 'fully multi-tenant' product reality for non-Hebrew tenants.

**העבודה:** Out of scope for isolation; flag as a product decision. Minimum: generate roster/COGS prose in aiReport from data (hours, part of the literal sweep); full i18n only if non-Hebrew tenants are actually targeted.


## צנרת Inngest / פלטפורמות (pipeline)

**מצב נוכחי:** Pipeline is single-tenant multi-store but store-keyed end-to-end. One Inngest app ('roas-dashboard', src/inngest/client.ts:19) runs ~17 functions: 3 scheduler+worker cron pairs (daily 00:05, live */10, yesterday every-2h) that load the active store list from the DB at runtime and fan out one event per store (planStoreJobs.ts), plus a 10-min cron-tick-orchestrator fanning out per store x platform x scope to meta/google/tiktok workers gated by data_freshness + BUC budget (priorityBuilder.ts). All event ids and dedupe keys are store_id-prefixed; all worker concurrency (limit 1) and throttle keys (meta 900/h, google 600/h, tiktok 1500/h) are keyed on event.data.store_id. Platform tokens resolve per-store from encrypted store_secrets with env fallback (storeSecretsReader.ts), but Google OAuth client + developer token and a META_GLOBAL_TOKEN fallback are global '__global__' secrets, and TikTok creds are hardcoded to uzoshop (secretsRegistry.ts:27-39). Shopify webhooks and the cart beacon route dynamically per store (shop_domain / cart_public_token lookup in store_webhooks) but registration on the Shopify side is manual (operator pastes signing secret + installs pixel per the 6a wizard checklist). All alerts go to ONE hardcoded operator phone via one global notification_config row. Exec volume: ~340K Inngest executions/month at 3 stores (~105-110K marginal per store), against Pro's 1M included — ceiling at roughly 9 stores before overage; the dominant driver is the 18-way tick fan-out (docs/cost/2026-06-06-inngest-cost-cut.md:15-27).

**כבר מוכן:**
- Event ids are tenant-safe given globally-unique store ids: planStoreJobs id = `cron-{family}-{storeId}-{date|tick}` with the 2026-06-10 P0-2 fix combining date+tickId (dashboard-web/src/lib/inngest/planStoreJobs.ts:98-106); orchestrator fan-out id = `${platform}:${storeId}:${scope}:${tickId}` (dashboard-web/src/lib/registries/priorityBuilder.ts:127). stores.id is a global PK and the add-store route 409s duplicates, so uniqueness is already enforced.
- DB dedupe keys are store-scoped: campaign_status_events.dedupe_key = store_id:platform:entity_type:entity_id:from:to:minute_bucket (migration 20260530230000_phase_b_registries.sql:136-141, minute_bucket_epoch is tenant-neutral); Shopify webhook store_events dedupe = `webhook:${webhookId}` (globally-unique Shopify id, normalizeShopifyEvent.ts:189).
- Per-store rate-limit isolation at the Inngest layer is real: every worker has concurrency [{key:'event.data.store_id', limit:1}] plus a per-store throttle (metaWorker.ts:685-689 900/h, googleWorker.ts:576-580 600/h, tiktokWorker.ts:784-788 1500/h), and the orchestrator's BUC hard-gate + tiered cooldown reads meta_buc_usage per store (cronTickOrchestrator.ts:118-146, priorityBuilder.ts:99-123). A token/budget failure of store A does not throttle store B's workers.
- Alert THROTTLING is per-store: throttle key is (provider, store_id, operation) with a 6h window (tokenFailures.ts:87-90, 207-220) — tenant A's dead token would not suppress tenant B's alerts (recipient routing is the gap, not throttling).
- Platform API tokens are per-store already: store_secrets (AES-256-GCM, service-role only, migration 20260606170100) + getStoreSecret DB-first/env-fallback resolution (storeSecretsReader.ts:24-48); googleAds.ts:263-266 even prefers a per-store GOOGLEADS_REFRESH_TOKEN before the global fallback — the per-tenant-Google seam exists.
- Store enumeration is fully dynamic: every scheduler and the orchestrator call loadActiveStoreIds() at runtime (cronLive.ts:880, cronTickOrchestrator.ts:84, getStores.ts:56-58) — a store added via the wizard joins every cron with no deploy.
- Inbound webhook ROUTING is tenant-ready: /api/webhooks/shopify resolves store by X-Shopify-Shop-Domain with per-store HMAC signing_secret (route.ts:39-45, webhooks/store.ts:32-43); the cart beacon resolves by per-store cart_public_token with per-store allowed_origins (events/cart route + lookupStoreByCartToken). No code change per new store.
- Vercel serverless shape holds at higher store counts: maxDuration=60 on /api/inngest (route.ts:136) bounds per-STEP time, and adding stores adds parallel invocations, not longer steps; long one-shots (eventBackfill, cohort Bulk) are already step-decomposed.
- FX conversion is shared but harmless: Frankfurter is keyless/no-quota and failure maps to null-preserve, never cross-contamination (fetchers/fx.ts, lib/inngest/cadConvert.ts).

**פערים:**

### 🔴 חוסם · All alerts route to one hardcoded operator phone — no per-tenant recipients or alert config · ~2 ימים

**ראיות:** ALERT_PHONE = '+972524809540' hardcoded (dashboard-web/src/lib/notifications/tokenFailures.ts:85) for every token-failure alert regardless of store; daily WhatsApp summary reads the SINGLE active metacloud notification_config row with phone1/phone2 (whatsapp.ts:204-211, sendDailySummary.ts:89); WhatsApp sender creds are one global env pair WHATSAPP_PHONE_NUMBER_ID/token (whatsapp.ts:45-55). Tenant B's token failures and daily summaries would WhatsApp tenant A's operator.

**העבודה:** Key notification_config (or a new tenant_notification_config) by tenant; resolve recipient in notifyTokenFailure/sendDailySummary from store_id -> tenant -> recipients; fan out the 3 whatsapp crons per tenant (same scheduler+worker fold pattern as cron-daily). Sender number can stay shared initially (Meta Cloud API allows one sender, many recipients).

### 🟠 מהותי · token_failures CHECK constraint hardcodes the 3 store ids — breaks alert throttling for ANY new store (already a live bug for self-serve, not just tenants) · ~0.5 ימים

**ראיות:** migration 20260523080000_add_token_failures.sql:42 `CHECK (store_id IN ('uzoshop','zolplus','usmile360','global'))` + hardcoded union type TokenFailureStore (tokenFailures.ts:53). For a 4th store, the upsert violates the CHECK and soft-fails (tokenFailures.ts:315-331 warns, never throws), so `existing` is always null on the next call -> shouldAlert=true EVERY invocation -> the 6h throttle is defeated and a dead token on a wizard-added store spams WhatsApp up to 144x/day.

**העבודה:** Migration dropping the store_id CHECK (or FK to stores + 'global'); widen TokenFailureStore to string; add a regression test that a non-seed store id persists and throttles.

### 🔴 חוסם · Shared platform developer credentials: Google developer-token quota, META_GLOBAL_TOKEN fallback, TikTok hardcoded to uzoshop · ~5 ימים

**ראיות:** GLOBAL_SECRET_KEYS = GOOGLEADS_DEVELOPER_TOKEN / CLIENT_ID / CLIENT_SECRET / REFRESH_TOKEN + META_GLOBAL_TOKEN under '__global__' (secretsRegistry.ts:32-39); meta fetchers fall back to the shared token when a store lacks its own (meta.ts:250-256, metaAccountConfig.ts:75) — a rate-limit/revocation on the shared token degrades every fallback store at once; Google Ads developer token (one per installation, googleAds.ts:314) carries a SHARED daily operations quota across all customer ids, so tenant A's volume can exhaust tenant B's Google fetches with no per-tenant partitioning; TikTok creds appliesTo:['uzoshop'] only (secretsRegistry.ts:27-28) — the shared-advertiser model has no tenant story.

**העבודה:** Policy + enforcement: tenant stores MUST have per-store tokens (forbid global fallback outside the owner tenant — small code change in meta.ts/metaAccountConfig.ts); per-tenant Google refresh tokens already work via the per-store key, but the shared developer-token quota needs either Standard Access (higher quota) or per-tenant priority/budgeting in the orchestrator; TikTok needs per-store advertiser creds with the uzoshop hardcode removed. The external track (Google Standard Access application, consent-screen publication, Meta App Review if OAuth is wanted) is calendar-time, not code-time.

### 🟠 מהותי · Tenant onboarding requires manual platform-app setup — webhooks, pixel, and tokens cannot be self-served by an end tenant · ~4 ימים

**ראיות:** The 6a wizard verifies PASTED creds and emits a manual checklist: 'custom app; scopes read_orders/products/customers; register order/refund webhook with the generated signing_secret; paste pixel/beacon' (docs/superpowers/plans/2026-06-07-self-serve-stores-phase6a-add-store.md:83); webhookSecret is operator-entered, webhooks 'registered via Settings→Notifications' (api/operator/stores/route.ts:60-67); Meta system-user token and Google refresh token are minted out-of-band (OAuth Playground, googleAccountConfig.ts:75-83 comment). A non-technical tenant cannot do Shopify custom-app creation, webhook registration, or token minting from the UI.

**העבודה:** Incremental path, no rewrite: (1) auto-register Shopify order/refund webhooks via the Admin API using the already-verified custom-app token during POST /api/operator/stores (~2d, removes the most error-prone manual step); (2) hosted Google OAuth consent flow storing the per-store refresh token (consent screen must be published first); (3) longer-term Shopify public OAuth app + Meta OAuth for true zero-touch. Estimate covers (1)+(2); (3) is its own project with external review timelines.

### 🟠 מהותי · Inngest exec count scales ~105-110K/month per store — Pro 1M cap reached around 9 stores; single shared orchestrator is a global SPOF · ~2 ימים

**ראיות:** docs/cost/2026-06-06-inngest-cost-cut.md:15-27: 340K execs/mo at 3 stores, dominated by the 144-ticks/day x 18-worker fan-out (~233K) + cron-live (~73K). Marginal per store: ~78K (tick workers: 144 x 6 events x ~3 execs) + ~24K (live) + ~3K (daily/yesterday). Fixed scheduler overhead ~33K. (1M - 33K) / ~107K = ~9 stores before overage; cost then grows linearly (no architectural break — fan-out + per-store keys hold). One cron-tick-orchestrator and one scheduler per family serve ALL tenants (cronTickOrchestrator.ts:68-71): a scheduler failure stalls every tenant simultaneously.

**העבודה:** Per-tenant/per-store cadence tiering in the orchestrator (e.g., low-spend tenants tick less often — priorityBuilder already has the cooldown machinery, add a per-store base-cadence column) buys 2-3x headroom for ~1 day. Beyond ~20-30 stores, execute the already-scoped Inngest->QStash/pg_cron migration (cost doc options C/D, ~5d) — multi-tenant work should be sequenced against that decision.

### 🟡 משני · Cart beacon dedupe_key is not store-scoped — cross-store/cross-tenant event_id collision silently drops feed events · ~0.5 ימים

**ראיות:** store_events dedupe for add-to-cart is `cart:${eventId}` with NO store prefix (api/events/cart/route.ts:361) against a global UNIQUE constraint; event_id is client-generated (Shopify pixel event.id or the headless Lovable beacon). Two tenants emitting the same id = second event dropped; a malicious tenant could theoretically pre-poison ids. Display-only data, so impact is cosmetic.

**העבודה:** Change dedupe to `cart:${store_id}:${eventId}` (new inserts only; old rows unaffected) + test.

### 🟡 משני · FX rate fetch is uncached per conversion call · ~0.5 ימים

**ראיות:** fetchers/fx.ts:12-17 explicitly dropped caching as 'premature optimization for ~3 stores'; every worker/cron conversion hits Frankfurter live. At tens of stores x multiple platforms x 10-min cadence this is hundreds of identical (date, ILS->CAD) requests/day. Frankfurter is keyless with no documented quota, so this is load-politeness and latency, not correctness.

**העבודה:** Module-level Map memo keyed (from,to,date) — same pattern as googleAds.ts tokenCache — or a tiny fx_rates table.


## state בצד הלקוח וניתוב (client-state)

**מצב נוכחי:** Frontend state is a SINGLE GLOBAL bucket per deployment, by construction. The client keeps 12 synced settings in localStorage under a fixed 'roas-dashboard:' prefix (dashboard-web/src/lib/cloudSync.ts:53-78 STATE_KEYS: billing-recurring/onetime, annotations, monthly-revenue-goal, insight-states, campaign-optimized, campaign-product-map, campaigns-column-visibility, campaign-store-map, cogs-settings, salary-settings, goal-settings, saved-views) and syncs them through ONE route (src/app/api/dashboard-state/route.ts) into ONE Postgres table with `key TEXT PRIMARY KEY` and no tenant/user/store column (supabase/migrations/20260521063112_initial_schema.sql:158-162). GET returns the ENTIRE kv to any holder of the dash_auth cookie (fetchDashboardStateFromPostgres, src/lib/postgresReaders.ts:620-650, unconditional select) with CDN caching s-maxage=30/swr=60 (route.ts:40, cacheConfig.ts:47). Identity does not exist: the login route compares one shared DASHBOARD_PASSWORD and mints a cookie that is an HMAC of an expiry timestamp ONLY — it carries zero user/tenant identity (src/lib/auth/dashboardAuth.ts:18-29, src/app/api/login/route.ts), and src/middleware.ts gates everything on that single cookie. Routing is bare paths + query params (tab/preset/store in src/lib/urlState.ts) — no tenant carrier anywhere; grep for tenant/org/business_id finds nothing. The good news: the store list is already dynamic and chokepointed (getStores.ts → /api/stores → useStores.ts), store branding is DB-driven (stores.brand_color, storeColors.ts:71-104), client settings models already carry perStore/byMonth dimensions (cogsSettings.ts:21, billing.ts:26), the client/server key-allowlist parity is test-enforced (lib/__tests__/stateKeysParity.test.ts), and RLS is enabled on dashboard_state and every table (migration 20260607140000) — so adding a tenant dimension is an incremental change at narrow seams, not a rewrite. The blockers are: no tenant column in dashboard_state, no user identity to derive a tenant from, and CDN-cached state responses that would be shared across tenants.

**כבר מוכן:**
- Dynamic store list behind a single chokepoint: getStores.ts ('THE single source for the store list', reads stores table) → /api/stores → useStores.ts client hook. The frontend treats the store list as data, so 'tenant's stores' becomes a WHERE-clause change at one function, not a sweep.
- Store branding is already per-row DB data, not code: stores.brand_color (migration 20260606170000_stores_self_serve_columns.sql) resolved by storeColors.ts:71-104 with token-based brandColor-first resolution and a deterministic fallback palette for unknown stores — a new tenant's stores get colors with zero code change.
- State sync is chokepointed: ONE API route (src/app/api/dashboard-state/route.ts), ONE reader (postgresReaders.ts:620 fetchDashboardStateFromPostgres), ONE writer (postgresReaders.ts:1704 upsertDashboardStateKeyPostgres), ONE key list per side. Adding tenant_id touches ~4 files plus a migration.
- The client/server key parity guard (src/lib/__tests__/stateKeysParity.test.ts) survives tenancy unchanged — key NAMES stay identical; only row scoping changes server-side, so the 2026-06-02 COGS-class drift bug stays prevented.
- Client settings models already carry the dimensions tenancy needs: cogsSettings.ts:21 perStore map, billing.ts:26 per-store entries, goalSettings.ts byMonth map. Once the BUCKET is tenant-scoped these shapes work as-is — no client data-model redesign.
- RLS is already enabled on dashboard_state and all 24 public tables with anon fully revoked (migration 20260607140000_phase5_rls_revoke_anon.sql:21-52) — the scaffolding for per-tenant policies exists; today service_role bypasses it by design.
- Auth is chokepointed: one middleware (src/middleware.ts), one cookie helper (src/lib/auth/dashboardAuth.ts), one login route — swapping password-gate for per-user sessions is localized, not scattered.
- URL state is tenant-agnostic query params only (urlState.ts: tab/preset/from/to/store/compare) — compatible with session-, path-, or subdomain-tenancy without breaking bookmarks; no tenant data is baked into deep links.
- API-boundary input hardening on state writes (route.ts:73-99: key allowlist + 64KB value cap + prototype-pollution defense via Object.create(null) in the reader) carries over to multi-tenant unchanged.

**פערים:**

### 🔴 חוסם · dashboard_state is a global singleton KV — no tenant dimension · ~2 ימים

**ראיות:** supabase/migrations/20260521063112_initial_schema.sql:158-162: `CREATE TABLE dashboard_state (key TEXT PRIMARY KEY, value JSONB, updated_at ...)` — no tenant/user/store column. fetchDashboardStateFromPostgres (postgresReaders.ts:620-650) selects ALL rows unconditionally; GET /api/dashboard-state returns the entire kv to any dash_auth holder; upsert is onConflict:'key' (postgresReaders.ts:1704-1726). Every tenant's billing, COGS%, salary%, monthly goal, insight feedback, campaign↔store/product maps, column prefs and saved views would live in ONE shared bucket — tenant B reads and last-write-wins-stomps tenant A.

**העבודה:** Migration: add tenant_id, composite PK (tenant_id, key), backfill existing rows to the founding tenant. Thread tenantId (from session, see auth gap) into the route's GET/POST and into the reader/writer signatures. Client code is UNCHANGED (keys stay bare; tenant comes from session server-side). Extend stateKeysParity-style guard to assert the route never queries dashboard_state without a tenant filter.

### 🔴 חוסם · No user identity — cookie is an HMAC'd expiry, password is deployment-wide; tenant cannot be derived from a request · ~4 ימים

**ראיות:** src/app/api/login/route.ts compares body.password to process.env.DASHBOARD_PASSWORD (one password for the whole deployment); dashboardAuth.ts:18-29 token shape is `${expiryEpochMs}.${hmacHexOf(expiry)}` — zero identity payload; src/middleware.ts:72-94 only checks 'knows the password'. There is no way to answer 'which tenant is this request?' — the prerequisite for every other tenancy fix in this lens.

**העבודה:** Frontend/session share of the auth work (account system itself is a cross-lens gap): replace the password Login page with per-user login (Supabase Auth is the incremental path — already the DB), change the cookie to a session carrying user_id+tenant_id, middleware resolves tenant and forwards it (header or request context) to API routes, add logout/account UI, keep the operator-secret gate as a separate PLATFORM-admin tier. All ~25 client fetches stay unchanged (same-origin cookie).

### 🔴 חוסם · CDN-cached state and data responses are keyed per-URL, not per-tenant — cross-tenant cache leakage once tenancy is session-based · ~1 ימים

**ראיות:** src/app/api/dashboard-state/route.ts:16+40: `revalidate = 30` + `Cache-Control: cacheControl('dashboardState')` = s-maxage 30/swr 60 (cacheConfig.ts:47). With tenant identity in a cookie and bare URLs (/api/dashboard-state identical for all tenants), a shared CDN/ISR cache can serve tenant A's settings payload to tenant B. Same pattern exists across the other cached data routes via cacheConfig.

**העבודה:** Decide the tenancy carrier first (see routing gap). If session-based: flip every tenant-scoped route to `private, no-store` (or Vary-safe equivalent) — audit all cacheConfig consumers; if path-based (/t/[slug]/...): CDN keys naturally and current headers survive. Add a guard test asserting tenant-scoped routes never emit s-maxage without a tenant-distinguishing URL.

### 🟠 מהותי · localStorage cache is device-global; cloudSync's first-time-migration branch will inject tenant A's state into tenant B · ~1.5 ימים

**ראיות:** cloudSync.ts:53-78: fixed 'roas-dashboard:' prefix, no tenant in the key. cloudSync.ts:423-439: when cloud has NO row for a key but localStorage has data, hydrate PUSHES the local value up as 'first-time migration'. A device that was logged into tenant A and then logs into tenant B (agency user, demo, tenant switch) has A's billing/COGS/goal in localStorage → B's bucket is empty → the client auto-uploads A's data into B's tenant. Also stale cross-tenant reads from cache before hydrate completes.

**העבודה:** Namespace localStorage keys by tenant (e.g. `roas-dashboard:${tenantId}:cogs-settings`) at the readLocal/writeLocal/stripPrefix seam — keep the wire key bare; or simpler v1: clear all STATE_KEYS (+ :lastPushAt suffixes) on login/tenant-switch and gate the migration-push branch behind 'same tenant as last session' (persist a tenant marker). Update CHANGE_EVENTS lookup and the hydrate grace bookkeeping for the chosen scheme; add a test for the tenant-switch scenario.

### 🟠 מהותי · Hardcoded 3-store fallbacks would show the founding business's store names to other tenants · ~1 ימים

**ראיות:** getStores.ts:20-24 HARDCODED (uzoshop/Zol Plus/360usmile) returned on DB error/empty; useStores.ts:10-14 duplicates it as SWR fallbackData — first paint for EVERY tenant renders uzoshop/Zol Plus/360usmile until /api/stores responds, and any fetch failure pins another business's store list into Filters, seedBillingIfEmpty (billing.ts:143 seeds per-store rows from whatever list arrives), and the storeColor name-keyed map (storeColors.ts:30-34).

**העבודה:** Make fallbacks tenant-safe: empty-list (with skeleton UI) or a per-tenant cached last-known list; restrict the HARDCODED set to the founding tenant id only during transition. Sweep the remaining hardcoded store-name references in components (CommandPalette.tsx, RoasChart.tsx, MonthlyTables.tsx etc. — grep hits exist) onto useStores-derived data. Filters/Dashboard.tsx itself is already store-list-driven (Filters.tsx:50 takes stores: string[]; Dashboard.tsx derives the universe from data.stores) so the model survives; only the constants must go.

### 🟠 מהותי · No tenancy carrier in the routing model — one deployment, bare paths, single global middleware matcher · ~2.5 ימים

**ראיות:** Routes are /, /login, /operator with query-param state only (urlState.ts; middleware.ts:115-123 matcher covers the whole app uniformly). Nothing in the URL, cookie, or headers distinguishes tenants; CommandPalette/deep-links/saved-views (savedViews.ts stores Filters incl. store display name) all assume one world.

**העבודה:** Lock the decision: session-derived tenant with bare paths (least churn — no URL restructure, saved views/bookmarks survive; requires the no-store caching fix) vs /t/[slug] path tenancy (CDN-friendly, shareable links, but App-Router re-rooting of all pages + fetches). Recommend session-based as the incremental path given everything is cookie-authed already. Implement getTenant() server helper + middleware threading; per-tenant login routing (tenant resolved from user, not from URL).

### 🟡 משני · State keys need a user-vs-tenant scope classification (one bucket conflates business settings with personal prefs) · ~1 ימים

**ראיות:** All 12 STATE_KEYS share one scope today: business-financial keys (billing-recurring, cogs-settings, salary-settings, goal-settings) sit next to personal-preference keys (campaigns-column-visibility, saved-views, insight-states feedback). cloudSync's last-write-wins (cloudSync.ts:30-35 comment assumes 'partners' on one team) means two users of the SAME tenant would also stomp each other's column prefs and saved views.

**העבודה:** Add a scope attribute per key (tenant | user) in dashboardStateKeys.ts, store user-scoped keys under (tenant_id, user_id, key), extend the parity test to assert every key declares a scope. Can ship after the tenant_id migration as a follow-up; default-everything-to-tenant is acceptable for v1.

### 🟠 מהותי · Operator surfaces and reset blast-radius are deployment-global, not tenant-scoped · ~1 ימים

**ראיות:** operatorReset.ts:20-47 DATA_TABLES — the operator Reset Data endpooint wipes data_daily/products_daily/campaigns_daily/ads_daily/orders_attribution/product_catalog/manual_overrides with NO tenant filter; /operator pages (HealthTab.tsx, ManualOverridesCrud.tsx, SyncNowButtons.tsx) enumerate all stores/platforms deployment-wide behind the single x-operator-secret. Under tenancy these become platform-admin tools that can destroy every tenant's data, while tenants need their own scoped settings/admin surface.

**העבודה:** Split the surface: keep /operator as PLATFORM admin (existing secret gate, add per-tenant filters to reset/CRUD), and move tenant-facing controls (store lifecycle wizard from Phase 6a/6b, COGS/billing/goal settings — already in the dashboard) under the tenant session. Make reset tenant-parameterized (DELETE ... WHERE store_id IN tenant's stores).


## תפעול, עלות ו-onboarding (ops-cost)

**מצב נוכחי:** Operations are "single-operator, product-ized at STORE level, not tenant level". The self-serve-stores project genuinely productized store onboarding: AddStoreWizard in /operator adds a store with zero deploy (live cred verification via dashboard-web/src/lib/credVerifiers.ts, POST /api/operator/stores with rollback — ARCHITECTURE.md §48), secrets live AES-256-GCM-encrypted in store_secrets (dashboard-web/src/lib/secretsEncryption.ts, migration 20260606170100_store_secrets.sql, service-role-only), crons enroll new stores automatically via getStores()/loadActiveStoreIds() (dashboard-web/src/lib/getStores.ts), and archive/restore/delete is a guarded UI flow with an exhaustive FK-safe wipe (ARCHITECTURE.md §51). But everything AROUND that wizard is bound to one operator: credentials are pasted custom-app/long-lived tokens, not OAuth flows (Phase 6a plan line 83 ships an "irreducible Shopify checklist" of manual steps; TikTok OAuth callback renders a manual curl and TikTok secrets are pinned to uzoshop in secretsRegistry.ts); alerts go to one hardcoded phone (+972524809540, tokenFailures.ts:85) through one global WABA and a single UNIQUE(provider) notification_config row; deep-history backfills are shell scripts needing repo root + root .env with service-role (dashboard-web/scripts/backfillFirstOrderLedger.ts:39-41); Sentry tags storeId but has no tenant dimension and there is no external dead-man's-switch (only proposed in docs/cost/2026-06-06-inngest-cost-cut.md §4.6); Production and Preview share ONE Supabase project (ARCHITECTURE.md:981-983) with no staging; there is zero per-tenant metering, billing, backup, export, or GDPR webhook surface. Cost shape is well understood (~$120/mo fixed: Inngest $75 + Supabase Pro $25 + Vercel Pro $20) with near-zero marginal cost per store until the Inngest fan-out (~78-100K execs/store/mo derived from the 233K/3-store line in the cost doc) hits the 1M Pro cap around ~9-12 stores.

**כבר מוכן:**
- Zero-deploy store onboarding UI: AddStoreWizard (dashboard-web/src/components/operator/, ARCHITECTURE.md §48) with server-side live cred re-verification (lib/credVerifiers.ts reusing the exact pipeline helpers), atomic 4-table write + rollbackStore on failure — the pattern generalizes directly to tenant onboarding
- Secrets-as-data: store_secrets AES-256-GCM (lib/secretsEncryption.ts, ENCRYPTION_MASTER_KEY, migration 20260606170100) + secretsRegistry.ts contract + maskSecret + ciSecretsAudit.test.ts secret-echo guard — no Vercel env edit needed for new stores
- Dynamic cron enrollment: lib/getStores.ts is the single store-list source (DB-driven, archived auto-drop) so a new store joins every cron/worker with zero code (ARCHITECTURE.md §46, §51)
- Per-store data deletion already exists and is hermetically guarded: DELETE /api/operator/stores/[id] wipes STORE_SCOPED_WIPE_TABLES with a CI test that re-derives the store_id-table set from migrations (ARCHITECTURE.md §51) — the building block for tenant deletion/GDPR
- Per-store webhook isolation: store_webhooks carries per-store signing_secret + cart_public_token (migration 20260601120000) — webhook ingest is already multi-store keyed, not env-global
- Sentry wired on all three runtimes with PII scrub (sentry.server/client/edge.config.ts, lib/sentry/scrub.ts) and storeId-tagged capture helpers (lib/sentry/capture.ts:35-50) — adding a tenant tag is incremental
- Operator console as internal-admin bones: 7 tabs (Health/Sync/Stores/AdState/Activity/AttributionDiag/Danger, dashboard-web/src/app/operator/) behind a fail-closed-in-prod OPERATOR_SECRET gate with constant-time compare (lib/middlewareHelpers.ts:36-56)
- Cost model is documented and quantified per-function (docs/cost/2026-06-06-inngest-cost-cut.md: 340K execs/mo breakdown, per-fire step counts, migration plan to ~$20/mo) — per-store marginal cost is derivable today
- WhatsApp misdirection guard: NOTIFICATION_RECIPIENT_ALLOWLIST rejects unknown destinations (lib/notifications/whatsapp.ts:93-130) — a safety pattern to keep when recipients become per-tenant
- Per-store platform rate-limit telemetry exists (meta_buc_usage, migration 20260530100000) — a seed for per-tenant usage metering

**פערים:**

### 🔴 חוסם · Credential acquisition is operator-manual paste, not tenant OAuth product flows · ~18 ימים

**ראיות:** secretsRegistry.ts stores pasted SHOPIFY_CLIENT_ID/SECRET (per-store custom app), META_ACCESS_TOKEN, GOOGLEADS_REFRESH_TOKEN; GLOBAL_SECRET_KEYS holds ONE shared Google refresh token + LOGIN_CUSTOMER_ID (MCC) for all stores. Phase 6a plan (docs/superpowers/plans/2026-06-07-self-serve-stores-phase6a-add-store.md:83) ships an 'irreducible Shopify checklist': tenant must create a custom app, set scopes, register order/refund webhooks by hand, paste pixel. TikTok flow is a rendered curl the operator runs locally (src/app/api/oauth/tiktok/callback/route.ts:1-26) and TikTok secrets are pinned appliesTo:['uzoshop'] (secretsRegistry.ts). Google OAuth consent screen still unpublished (memory: roas-tracker-ga in Testing).

**העבודה:** Per platform, replace paste with OAuth: (1) Shopify public/unlisted OAuth app (auto token + auto webhook registration + app-review) replacing per-store custom apps; (2) Meta Login-for-Business flow issuing per-tenant system-user/long-lived tokens; (3) per-tenant Google Ads OAuth grant (publish consent screen, store per-tenant refresh tokens, confirm developer-token access level supports external accounts); (4) generalize the TikTok callback into an auto-exchange flow and un-pin from uzoshop. Keep credVerifiers as the post-OAuth validation step. Token-refresh/rotation jobs per tenant.

### 🔴 חוסם · Alerting is hardwired to one human: one phone, one WABA, one global notification_config row · ~4 ימים

**ראיות:** ALERT_PHONE = '+972524809540' hardcoded (lib/notifications/tokenFailures.ts:84-85, comment at :24 'ALWAYS sends to the single recipient'); notification_config is UNIQUE(provider) → exactly one metacloud row with phone1/phone2 (migrations 20260521063112:165-178 + 20260521075741:13-18); WABA creds are global env WHATSAPP_PHONE_NUMBER_ID/ACCESS_TOKEN (whatsapp.ts:41-56); NOTIFICATION_RECIPIENT_ALLOWLIST is one global env list; templates pre-approved on the operator's WABA (docs/whatsapp-template-v2-submission.md). A tenant's token failure today would WhatsApp the operator's personal phone or be allowlist-rejected.

**העבודה:** Tenant-scope notification config (tenant_id column, recipients per tenant, per-tenant enable/disable per alert type), route token-failure/daily-summary by store→tenant, move the allowlist from env to per-tenant DB rows. Decide channel economics: shared WABA (free tier is 1000 conversations/mo TOTAL — 3 daily summaries/tenant ≈ 90 conv/mo/tenant, so ~10 tenants exhaust it; utility conversations billed after) vs per-tenant email (cheaper, no template approval).

### 🟠 מהותי · Deep-history backfills require operator shell access + root .env with service-role key · ~5 ימים

**ראיות:** 10 runner scripts in dashboard-web/scripts/ (backfillFirstOrderLedger.ts, backfillCohortMonthly.ts, backfillPaymentGateway.ts, reclassifyHistoricalAttribution.ts, exportCustomersForFacebook.ts — the last still untracked in git). backfillFirstOrderLedger.ts:39-41: 'RUN COMMAND (from the repo root, NOT dashboard-web)… The root .env stores credentials under DOTTED keys'. The NC-ROAS backfill runner is explicitly 'run once scope lands' via shell (memory). Onboarding a tenant store WITH history (orders→2023, cohorts, first-order ledger) is impossible without the operator's laptop.

**העבודה:** Promote the runners to one-shot Inngest jobs triggered from the add-store wizard / operator console (the pattern exists: /api/operator/backfill + eventBackfill already run as durable functions). Each script's core logic is already pure TS reading creds via the dual-read helpers — wrap, add progress rows to data_freshness, surface status in StoresTab.

### 🟠 מהותי · Observability is tenant-blind and has no machine watchdog · ~4 ימים

**ראיות:** Sentry capture helpers tag layer/route/fnId/storeId only (lib/sentry/capture.ts:35-50) — no tenant dimension, no per-tenant issue routing; /operator HealthTab + data_freshness are global views; no external dead-man's-switch exists in the repo (grep for healthchecks/uptime returns nothing) — it is only PROPOSED in docs/cost/2026-06-06-inngest-cost-cut.md item 6 ('Vercel logs nothing for a non-delivered tick'); Inngest dashboard is the only run-timeline and is operator-account-bound.

**העבודה:** Add tenant_id to Sentry tags + data_freshness rollups; per-tenant pipeline-staleness alert (reuse the freshness thresholds already computed for the UI); an external heartbeat monitor on the tick orchestrator; per-tenant ingestion SLA panel in the (tenant-scoped) operator console.

### 🟠 מהותי · No per-tenant usage metering or billing; Inngest fan-out caps growth at ~9-12 stores · ~6 ימים

**ראיות:** Cost doc (docs/cost/2026-06-06-inngest-cost-cut.md:18) shows fan-out = 18 workers/tick for 3 stores ≈ 233K execs/mo → ~78K/store/mo, plus cron-live ~73K/3 ≈ 24K/store/mo → ~100K execs/store/mo; Inngest Pro cap is 1M (doc:27), so ~9-12 stores total before overage; migration off Inngest is DEFERRED to late June (memory: project_inngest_cost_cut_deferred). Zero billing/metering tables exist (migrations grep: only meta_buc_usage = platform rate-limit telemetry; lib/billing.ts is the operator's own P&L cost entries in localStorage/cloud-sync, not tenant billing).

**העבודה:** Per-tenant usage metering (exec counts per store from data_freshness/cron logs, Supabase row counts per store_id, WhatsApp sends per tenant) + a tenants×usage rollup table; decide and execute the scheduler migration (Option B/C in the cost doc) BEFORE tenant growth multiplies fan-out; only then layer billing (Stripe) on the metering.

### 🟠 מהותי · No per-tenant backup/export, no GDPR webhook surface; delete is irreversible with no export-first · ~4 ימים

**ראיות:** DELETE /api/operator/stores/[id] is documented as 'no undo, no backup, no rollback' (ARCHITECTURE.md §51 / :3596); the only export paths are client-side CSV of views (lib/csvExport.ts) and the untracked exportCustomersForFacebook.ts shell script; api/webhooks/shopify/ contains a single orders/refunds route — none of Shopify's three mandatory compliance webhooks (customers/data_request, customers/redact, shop/redact), which become REQUIRED the moment Shopify onboarding becomes a public OAuth app (gap 1); backup granularity is the whole Supabase project (single project, ARCHITECTURE.md:981), so restoring one tenant means restoring everyone.

**העבודה:** Per-store/tenant export bundle (JSON/CSV of all STORE_SCOPED_WIPE_TABLES — the table list and its hermetic guard already exist, reuse it); wire export-before-delete into the lifecycle flow; implement the 3 Shopify GDPR webhooks + customer-redact job over orders_attribution/store_events/customer_first_order; document tenant-restore procedure.

### 🟠 מהותי · No staging environment: Preview shares the production Supabase project and service-role key · ~3 ימים

**ראיות:** ARCHITECTURE.md:981-983 env table: SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY all scoped 'Production + Preview' pointing at https://npegxufdupooqovrewyb.supabase.co; deploy trigger is git push to main (memory: feedback_deploy_git_push_only); migrations are applied to prod via a manual CLI procedure with known foot-guns (memory: reference_supabase_migration_procedure — hide root .env, move duplicate-timestamp files). Acceptable for one operator; untenable when a bad migration or preview write can corrupt paying tenants' data.

**העבודה:** Second Supabase project for staging/preview (Vercel Preview env vars repointed), migration rehearsal step in the pre-push gate, seed-data script for staging. Optionally branch-database tooling (Supabase branching) instead of a permanent second project.

### 🟡 משני · Operator console is a single-key global admin with no identity or audit trail · ~3 ימים

**ראיות:** All /api/operator/* gated by one shared x-operator-secret header (lib/middlewareHelpers.ts, src/middleware.ts) — fail-closed in prod (good) but anyone holding the secret is root over ALL stores; DangerTab reset and store DELETE record no actor; no admin-action audit log table exists in migrations; support model for tenants (impersonation/read-only tenant view) absent.

**העבודה:** When tenant auth lands (other lenses), convert /operator to role-based internal-admin (admin user accounts instead of the shared header), add an admin_audit_log table written by the dangerous routes (reset/archive/delete/secrets-edit), and a read-only per-tenant support view.

### 🟡 משני · Onboarding documentation is operator-facing Hebrew runbooks, not tenant-facing product content · ~2 ימים

**ראיות:** docs/ROAS-Dashboard-User-Manual.md + ROAS-Dashboard-Quick-Start.md + docs/operator/first-click-capture-install.md + docs/storefront-snippets/first-touch-attribution.md are written for the single operator; the wizard already embeds generated snippets (lib/storeSnippets.ts, ARCHITECTURE.md §52.1 'New stores… surfaces BOTH the Custom Pixel and the theme snippet') which covers most of the in-product need, but Meta/Google/TikTok setup, WhatsApp, and COGS conventions still live only in repo docs.

**העבודה:** Surface the remaining setup steps in-product (wizard step copy + a per-store setup checklist with done/pending state), and split docs into tenant-facing help vs internal runbook. Mostly falls out of the OAuth work in gap 1, which deletes most manual steps.

