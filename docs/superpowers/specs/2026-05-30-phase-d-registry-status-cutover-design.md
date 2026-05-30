# Phase D — Registry-Status Cutover (Design)

> **תאריך**: 2026-05-30
> **מקור**: brainstorming session 2026-05-30 (יום הסיום של Phase C soak)
> **קהל יעד**: מימוש Phase D על ידי AI worker או צוות פיתוח אנושי
> **תלות**: Phase B + Phase C (registries + workers + freshness) פרוסים ויציבים — הכל קיים ב-`main` נכון ל-`2e51cba`.

---

## 1. Goal

החלפת **כל קריאות `effective_status` מ-`campaigns_daily` / `adsets_daily` / `ads_daily`** בקריאות מבוססות-`campaign_registry` / `adset_registry` / `ad_registry` ברחבי כל הדשבורד. ההחלפה מבטלת את ה-lag של עד ~30 דקות שמובנה במודל הלגאסי (`campaigns_daily.effective_status` מתעדכן רק בריצת `cron-live-heavy`), ומחזירה את ה-Operator Panel למודל "**registry הוא ה-source of truth ל-status**" שתוכנן ב-Phase B.

**המוטיבציה תפעולית (operator pain שזוהתה):** טריות + אמינות. המפעיל לא רוצה להסיק על סטטוס חי מנתון יומי שמתעכב סיבוב cron שלם.

---

## 2. Scope — System-wide cutover

הוחלט מפורשות (brainstorming Q2): **comprehensive**, לא minimal ולא standard.

המקומות שמשתנים (לא רשימה ממצה — חיפוש נדרש במהלך התכנון):
- `CampaignsTable.tsx` — ה-status chip בכל row + הסינון "active only" וכו'
- `CampaignDrawer.tsx` — סקציות Health / Recommendations / כל מקום שמציג סטטוס
- `CampaignDrawerStatusSection.tsx` — הסקציה המינימלית של Phase C עוברת לקריאה ישירה ממראה (view), לא משתי טבלאות
- `Today` / `TodayLive` — badge של campaign status
- `ProductChannelBreakdown` — כל סטטיסטיקה של "active campaigns count"
- כל API route שמחזיר campaign data ויש לו עמודת status
- כל recommendation engine שבוחר על בסיס status

---

## 3. Architecture — 4 Layers (Pure-SQL approach)

הוחלט מפורשות (brainstorming Q4): **Database VIEW** מבצע את ה-LEFT JOIN בשרת. ה-API routes רק מצביעים על שם view חדש; הפרונט מקבל שדות `reg_*` בנוסף לשדות הקיימים.

### 3.1 Layer 1 — Backfill (one-time SQL migration)

**הבעיה שנפתרה:** ב-prod היום יש פער כיסוי (brainstorming Q3): `campaign_registry` = 78 שורות, `campaigns_daily` של היום בלבד = ~150-200 קמפיינים ייחודיים. בלי backfill, כל מצב "campaigns_daily יש לי registry ריק" יישבר.

**ה-SQL** (migration אידמפוטנטית):

```sql
-- supabase/migrations/{YYYYMMDDHHMMSS}_phase_d_backfill_registries.sql
INSERT INTO campaign_registry (
  store_id, platform, campaign_id, name,
  configured_status, effective_status, delivery_status,
  is_enabled, is_serving,
  first_seen_at, last_seen_at,
  platform_updated_at, status_changed_at,
  last_metrics_success_at, last_status_success_at,
  raw_status_payload, missed_seen_count, is_removed
)
SELECT
  cd.store_id, cd.platform, cd.campaign_id,
  MAX(cd.campaign_name) AS name,
  'BACKFILL_UNKNOWN' AS configured_status,            -- לא ידוע, נחכה לסיבוב הבא של הסטטוס-worker
  -- effective_status מ-row האחרון לפי תאריך
  (SELECT cd2.effective_status FROM campaigns_daily cd2
    WHERE cd2.store_id = cd.store_id AND cd2.platform = cd.platform AND cd2.campaign_id = cd.campaign_id
   ORDER BY cd2.date DESC LIMIT 1) AS effective_status,
  -- delivery_status + bool flags — מבוססים על אותה תשובה של ה-LATERAL subquery למטה
  latest.delivery_status,
  latest.is_enabled,
  latest.is_serving,
  MIN(cd.date)::timestamptz AS first_seen_at,
  MAX(cd.date)::timestamptz AS last_seen_at,
  NULL, NULL, NULL, NULL, '{}'::jsonb, 0, FALSE
FROM campaigns_daily cd
CROSS JOIN LATERAL (
  SELECT
    cd2.effective_status,
    CASE WHEN cd2.effective_status IN ('SERVING','ACTIVE','ADGROUP_STATUS_DELIVERY_OK') THEN 'DELIVERING'
         WHEN cd2.effective_status IN ('PAUSED','DISABLED','REMOVED','ARCHIVED','DELETE') THEN 'NOT_DELIVERING'
         WHEN cd2.effective_status IN ('PENDING','PENDING_REVIEW') THEN 'PENDING_REVIEW'
         ELSE 'UNKNOWN' END AS delivery_status,
    CASE WHEN cd2.effective_status IN ('ENABLED','ACTIVE') THEN TRUE ELSE FALSE END AS is_enabled,
    CASE WHEN cd2.effective_status IN ('SERVING','ACTIVE','ADGROUP_STATUS_DELIVERY_OK') THEN TRUE ELSE FALSE END AS is_serving
   FROM campaigns_daily cd2
  WHERE cd2.store_id = cd.store_id AND cd2.platform = cd.platform AND cd2.campaign_id = cd.campaign_id
  ORDER BY cd2.date DESC LIMIT 1
) AS latest
WHERE NOT EXISTS (
  SELECT 1 FROM campaign_registry cr
   WHERE cr.store_id = cd.store_id AND cr.platform = cd.platform AND cr.campaign_id = cd.campaign_id
)
GROUP BY cd.store_id, cd.platform, cd.campaign_id,
         latest.effective_status, latest.delivery_status, latest.is_enabled, latest.is_serving
ON CONFLICT (store_id, platform, campaign_id) DO NOTHING;
```

**אותה גישה ל-`adset_registry`** (מקבל גם `campaign_id`) ולך-`ad_registry` (גם `campaign_id` + `adset_id`).

**Acceptance:** אחרי הרצת ה-migration: `COUNT(campaigns_daily DISTINCT (store, platform, campaign_id))` = `COUNT(campaign_registry)`. אותו דבר ל-2 ה-registries האחרים.

### 3.2 Layer 2 — Auto-coverage Triggers (going-forward)

**הבעיה:** קמפיין חדש מופיע ב-`campaigns_daily` ברגע ה-spend הראשון. ה-`cron-tick-orchestrator` רץ כל 10 דק'. אז יש חלון של עד 10 דקות שבהן UI יראה את הקמפיין החדש בלי registry row (= ב-strict cutover נראה ריק).

**הפתרון:** PostgreSQL trigger `AFTER INSERT ON campaigns_daily` שמכניס שורה חסרה ל-`campaign_registry` סינכרונית. אותו דבר ל-2 הטבלאות האחרות.

```sql
-- supabase/migrations/{YYYYMMDDHHMMSS}_phase_d_auto_coverage_triggers.sql
CREATE OR REPLACE FUNCTION ensure_campaign_registry_row()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO campaign_registry (
    store_id, platform, campaign_id, name,
    configured_status, effective_status, delivery_status,
    is_enabled, is_serving,
    first_seen_at, last_seen_at,
    missed_seen_count, is_removed
  ) VALUES (
    NEW.store_id, NEW.platform, NEW.campaign_id, NEW.campaign_name,
    'BACKFILL_UNKNOWN', NEW.effective_status,
    CASE WHEN NEW.effective_status IN ('SERVING','ACTIVE','ADGROUP_STATUS_DELIVERY_OK') THEN 'DELIVERING'
         WHEN NEW.effective_status IN ('PAUSED','DISABLED','REMOVED') THEN 'NOT_DELIVERING'
         ELSE 'UNKNOWN' END,
    CASE WHEN NEW.effective_status IN ('ENABLED','ACTIVE') THEN TRUE ELSE FALSE END,
    CASE WHEN NEW.effective_status IN ('SERVING','ACTIVE','ADGROUP_STATUS_DELIVERY_OK') THEN TRUE ELSE FALSE END,
    NEW.date::timestamptz, NEW.date::timestamptz,
    0, FALSE
  )
  ON CONFLICT (store_id, platform, campaign_id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER campaigns_daily_ensure_registry
  AFTER INSERT ON campaigns_daily
  FOR EACH ROW EXECUTE FUNCTION ensure_campaign_registry_row();
```

טריגרים מקבילים ל-`adsets_daily` → `adset_registry`, `ads_daily` → `ad_registry`.

**הערה על דריסה:** ה-trigger רק INSERTs חסרים. הוא **לא** מעדכן registry rows קיימות (זה תפקיד workers Phase C). UPDATE על campaigns_daily לא מפעיל את ה-trigger. אסור לדרוס data עשיר ש-workers הכניסו.

### 3.3 Layer 3 — Database VIEWs

```sql
-- supabase/migrations/{YYYYMMDDHHMMSS}_phase_d_create_enriched_views.sql
CREATE OR REPLACE VIEW campaigns_enriched AS
SELECT
  cd.*,
  cr.configured_status     AS reg_configured_status,
  cr.effective_status      AS reg_effective_status,
  cr.delivery_status       AS reg_delivery_status,
  cr.is_enabled            AS reg_is_enabled,
  cr.is_serving            AS reg_is_serving,
  cr.first_seen_at         AS reg_first_seen_at,
  cr.last_seen_at          AS reg_last_seen_at,
  cr.status_changed_at     AS reg_status_changed_at,
  cr.last_status_success_at AS reg_last_status_success_at,
  cr.last_metrics_success_at AS reg_last_metrics_success_at,
  cr.missed_seen_count     AS reg_missed_seen_count,
  cr.is_removed            AS reg_is_removed
FROM campaigns_daily cd
LEFT JOIN campaign_registry cr
  ON cr.store_id = cd.store_id
 AND cr.platform = cd.platform
 AND cr.campaign_id = cd.campaign_id;

-- adsets_enriched, ads_enriched בנוסחה דומה.
```

**הערות:**
- `LEFT JOIN` ולא `INNER JOIN` מפני שאחרי הbackfill + trigger, הצד הימני לעולם לא יהיה NULL בpractice — אבל הסמנטיקה השמרנית מוגנת.
- ה-view לא מוסיף performance overhead משמעותי — PG planner יעבד את ה-JOIN ב-hash על מפתח מאוסיף (`store_id, platform, campaign_id` משותף לשתי הטבלאות).
- אין צורך ב-RLS על ה-view; משתמש `service_role` מקבל הכל; משתמש `anon` לא ניגש לטבלאות פנימיות כאלה.

### 3.4 Layer 4 — UI Cutover

**Backend:**
6-8 route handlers שקוראים מ-`campaigns_daily` / `adsets_daily` / `ads_daily` עוברים לשם החדש:
- `/api/campaigns` → `from('campaigns_enriched')`
- `/api/ads` → `from('ads_enriched')`
- `/api/data` (משמש לdata_daily, לא משתנה — לא קורא effective_status)
- כל route איתור: `grep -rn "from('campaigns_daily')\|from('adsets_daily')\|from('ads_daily')"` ב-src/app/api/

**Frontend:**
1. כל `row.effective_status` → `row.reg_effective_status`.
2. רכיבים שיציגו את ה-`reg_configured_status === 'BACKFILL_UNKNOWN'` כ-badge מיוחד ("טרם נמשך מה-platform — בעוד עד 10 דק׳ יתעדכן").
3. בכל `CampaignsTable` chip: מבסס על `reg_delivery_status` (DELIVERING / NOT_DELIVERING / PENDING_REVIEW / UNKNOWN) במקום על `effective_status` הגנרי.
4. `CampaignDrawerStatusSection`: יוצא מ-"minimal" ל-"full" — מציג configured + effective + delivery side-by-side + timeline של ה-status_changed_at.

---

## 4. Testing Strategy

### 4.1 Unit tests (always-on)
- `backfillRegistries.test.ts` — לוגיקת ה-SQL נבדקת דרך fixture inputs ל-`__tests__/fixtures/` ו-execution local (אם Supabase CLI מותקן) או mocks. Goal: idempotency, no duplicates, correct derived columns.
- `enrichedFieldMapping.test.ts` — חוזה תרגום `reg_effective_status` → display logic (ירוק/אדום/...) במקום אחד מרוכז.

### 4.2 Migration tests
- Re-running the migration on a populated DB doesn't create duplicates (ON CONFLICT DO NOTHING).
- After backfill: `SELECT COUNT(*) FROM campaigns_daily GROUP BY store_id, platform, campaign_id` = `SELECT COUNT(*) FROM campaign_registry`.

### 4.3 Integration tests
- `campaigns_enriched` VIEW returns expected JOIN shape — fixture של 2 שורות (one with registry, one without) → assert reg_* columns populated where expected and NULL where not.
- Trigger test: INSERT row to `campaigns_daily` with (new store, platform, campaign) → ensure new row in `campaign_registry`.

### 4.4 Live integrity tests (AUDIT_LIVE=1)
הרחבת ה-harness של `reconcileHotMetricsVsHeavy.live.test.ts`:
```typescript
it('coverage parity: every campaigns_daily campaign has a registry row', async () => {
  // SELECT COUNT(DISTINCT (store, platform, campaign_id)) FROM campaigns_daily - COUNT(*) FROM campaign_registry = 0
});
```

### 4.5 DOM/E2E tests
- `CampaignsTable.dom.test.tsx`: render fixture rows; assert chip text + color בכל אחד מ-`reg_delivery_status` הבא: DELIVERING / NOT_DELIVERING / PENDING_REVIEW / UNKNOWN / BACKFILL_UNKNOWN.

---

## 5. Migration Sequence (Atomic per-commit)

1. **Migration 1:** create the 3 VIEWs (`campaigns_enriched`, `adsets_enriched`, `ads_enriched`).
2. **Migration 2:** backfill SQL — INSERT INTO {entity}_registry rows מ-{entity}_daily.
3. **Migration 3:** create 3 AFTER INSERT triggers על {entity}_daily.
4. **Code patch 1:** route handlers — `from('X_daily')` → `from('X_enriched')`.
5. **Code patch 2:** frontend — `effective_status` → `reg_effective_status` + new chip logic.
6. **Code patch 3:** Architecture doc + User Manual entries (2.2.0 — Phase D landed).
7. **Deploy** to main; Vercel build (לא מתבטל כי שינויים אמיתיים ב-dashboard-web/ ו-supabase/migrations/).
8. **Verify:** `AUDIT_LIVE=1 npm run audit:reconcile:hot-vs-heavy` + manual UI smoke.

---

## 6. Rollback Plan

אם ה-UI מתחיל להראות נתון שגוי או לא צפוי:
1. Revert ל-`from('X_enriched')` → `from('X_daily')` בקוד route. הDeploy חוזר לקרוא את ה-legacy effective_status.
2. ה-views, triggers, ו-backfilled rows יכולים להישאר ב-DB — לא משפיעים על קוד שלא קורא מהם. אפשר לנקות אחר כך.
3. אין הרס דאטה — ה-backfill לא דורס שורות קיימות; ה-trigger לא דורס; ה-view הוא קריאה בלבד.

---

## 7. Open Questions / Future Work

- **`BACKFILL_UNKNOWN` cleanup:** אחרי 1-2 סיבובי orchestrator הצפויים, רוב הdo`BACKFILL_UNKNOWN` configured_status רושמים יוחלפו ב-`ENABLED`/`PAUSED` אמיתיים מ-platform. שווה לעקוב — אם נשאר רוב גדול, סימן שgoogle's `change_status` discovery לא תופס את הקמפיינים האלה. השדה `last_status_success_at` ב-registry יעזור לאתר.
- **historical view semantics:** ה-design מציג CURRENT registry status בכל מקום, גם בתצוגות היסטוריות (אתמול, השבוע). זה ההחלטה הפשוטה ביותר; המפעיל יראה "this campaign currently PAUSED, last spent X yesterday". אם זה מבלבל אותו, נחזור לכאן ונשקול תוספת `historical_effective_status` (snapshot per-day) ל-VIEW.
- **`adset_registry` / `ad_registry` coverage:** הbackfill למטרה זו דורש שמירה על FK לקמפיין/אדסט הורי. אם ב-prod יש adsets_daily rows עם campaign_id ש-לא במ-campaign_registry (אחרי הbackfill הראשון), הtrigger צריך לטפל בזה דרך seq-dependency:
   1. backfill campaign_registry ראשון
   2. backfill adset_registry שני (תלוי בקיום campaign_registry rows ל-FK)
   3. backfill ad_registry שלישי

---

## 8. Acceptance Criteria

Phase D נחשב הושלם כאשר:
1. ✅ 3 backfill migrations רצים בpr ןד ה-`COUNT` מאוזן (parity test).
2. ✅ 3 triggers פעילים: INSERT חדש ל-campaigns_daily יוצר registry row בו-זמנית.
3. ✅ 3 VIEWs פעילים ועובדים ל-PG planner ב-< 50ms על מ-1000 rows.
4. ✅ כל route handler שמשתמש ב-effective_status עבר ל-enriched view (grep מאומת).
5. ✅ כל רכיב frontend שקרא `row.effective_status` קורא עכשיו `row.reg_effective_status` או `row.reg_delivery_status` (grep + tests מאומתים).
6. ✅ ה-suite מלאה ירוקה: tsc + 1500+ unit tests + 92+ DOM tests + live harness 4/4.
7. ✅ Operator panel `/operator` עדיין ירוק על כל ה-45 freshness rows.
8. ✅ Architecture doc §Phase D נכתב; User Manual 2.2.0 entry פורסם.
9. ✅ Backfill verification query: `SELECT COUNT(*) FROM campaign_registry WHERE configured_status = 'BACKFILL_UNKNOWN'` יורד ב-90%+ אחרי 24h של orchestrator runs (המבחן שהחיווט פעיל).

---

## 9. Reference

- [Phase B design](2026-05-30-phase-b-registries-meta-status-design.md) — מקור 5 הטבלאות החדשות
- [Phase C plan](../plans/2026-05-30-phase-c-hot-metrics.md) — workers + freshness loop
- [ARCHITECTURE.md §Phase C soak fixes](../../ARCHITECTURE.md) — תיעוד ל-CRIT-G + הarch של registries
