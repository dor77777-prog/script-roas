# Phase 3: CI/CD for Apps Script — Context

**Gathered:** 2026-05-18
**Status:** Ready for planning
**Source:** User conversation + existing 03-PLAN.md (pre-context) + ROADMAP.md + CONCERNS.md §"Apps Script Upload ידני" + STACK.md

<domain>
## Phase Boundary

ביטול שלב ה-upload הידני של `*.gs` ל-script.google.com. כל `git push origin main` שמשנה `*.gs` או `appsscript.json` יפעיל GitHub Action שמריץ `clasp push --force` → ה-Apps Script project מתעדכן אוטומטית.

**In scope:**
- יצירת **root** `package.json` (חדש — היום קיים רק `dashboard-web/package.json`) עם `@google/clasp` כ-devDependency
- `deploy:gs` script ב-root package.json שעוטף `clasp push --force`
- `.clasp.json` (committed) — script ID של ה-Apps Script project הקיים
- `.clasprc.json` נוסף ל-`.gitignore` (מכיל OAuth refresh token של Google)
- `.github/workflows/deploy-gs.yml` — Action שמופעלת על push ל-`main` עם **paths filter** `*.gs` + `appsscript.json` בלבד
- `CLASPRC_JSON` GitHub Secret (תוכן של `~/.clasprc.json` ה-local)
- SETUP.md מעודכן עם המסלול החדש (one-time `clasp login` + Secret upload + Action behavior + 6-month refresh-token expiry note)
- SYSTEM_OVERVIEW.md מזכיר ש-deploy של `.gs` הוא אוטומטי
- End-to-end smoke: no-op commit על `.gs` → Action ירוקה ב-Actions tab

**Out of scope:**
- Pre-commit hook ל-`.gs` syntax validation → **נדחה ל-Phase 7 (observability)**
- Slack / Sentry / cron-monitor notifications ל-Action failures → **נדחה ל-Phase 7**
- Multiple environments (staging Apps Script project) — יש project אחד; הוספה עתידית מחוץ ל-scope
- Pre-merge preview deploys (Apps Script אין preview environment)
- Test runner ל-Apps Script V8 (אין כזה; tests חיים בdashboard-side פר Phase 2)
- שינויי Apps Script logic / `.gs` files עצמם — phase הזה רק על ה-deploy mechanism
- שינויים ב-`dashboard-web/` (פר ROADMAP — Phase 3 הוא root-only)

</domain>

<decisions>
## Implementation Decisions

### Trigger Strategy

- **D-01:** GitHub Action מופעל **על push ל-`main`** עם paths filter על `*.gs` + `appsscript.json`. push ל-`main` שלא נוגע ב-Apps Script files לא מריץ את ה-Action (חיסכון ב-Actions minutes + שקט ב-Actions tab).
- **D-02:** אין `workflow_dispatch` (manual override) ב-phase הזה. אם Action נכשל וצריך retry, פותרים את ה-root cause + dummy commit / `git commit --amend` ודוחפים שוב. הוספת `workflow_dispatch` היא <5 שורות YAML ויכולה להתווסף מאוחר יותר ב-Phase 7 אם תהיה צריכה (לא חוסם עכשיו).
- **D-03:** Trigger רק על `main` — אין deploy מ-PR branches (Apps Script אין preview environment ממילא).

### `.clasp.json` Migration (currently in .gitignore — must change)

- **D-04:** `.clasp.json` קיים היום ב-`.gitignore` (שורה 1 של `.gitignore`). **חייב להסיר** במסגרת phase זה. script ID הוא לא secret per clasp docs ו-ROADMAP מציין במפורש "`.clasp.json` (script ID committed)".
- **D-05:** הסרת `.clasp.json` מ-`.gitignore` היא חלק מ-task ראשון (תשתית) — לא משאירים לסוף.
- **D-06:** אם `.clasp.json` כבר קיים local אצל המשתמש (מ-`clasp clone/create` קודם): המשתמש מבצע `git add -f .clasp.json` בעת ה-commit הראשון של ה-task — לא מצפים שה-executor יחפש את הקובץ מ-disk. אם `.clasp.json` עוד לא קיים, ה-operator checkpoint ב-task הראשון מורה לרץ `clasp clone <scriptId>` או `clasp create`.

### Credential Handling

- **D-07:** `CLASPRC_JSON` נשמר כ-GitHub Secret. תוכן: 100% של הקובץ `~/.clasprc.json` שנוצר אחרי `clasp login` ב-local.
- **D-08:** ה-Action כותב את ה-secret ל-`~/.clasprc.json` ב-runner לפני הרצת `clasp push`. דפוס מקובל:
  ```yaml
  - run: echo "$CLASPRC_JSON" > ~/.clasprc.json
    env:
      CLASPRC_JSON: ${{ secrets.CLASPRC_JSON }}
  ```
  אסור לעשות echo של הסוד ל-stdout (GitHub מצנזר, אבל עדיף לא לסמוך). אסור לכתוב אותו ל-repo path — רק ל-`$HOME`.
- **D-09:** **Refresh token rotation:** setup-once-and-forget. SETUP.md יכלול פסקה: "Google OAuth refresh tokens של clasp expirim אחרי **6 חודשים של inactivity**. אם ה-Action נכשל פתאום עם `Error 401: invalid_grant`, רוצים: (1) `clasp login` local מחדש, (2) להעלות את `~/.clasprc.json` החדש כ-GitHub Secret value בשם `CLASPRC_JSON`."
- **D-10:** **לא** מוסיפים cron job / scheduled action כדי "להפעיל את ה-token" באופן יזום — ה-Action עצמו רץ בכל פעם שמשנים `.gs`, מה ש-rotation-friendly.

### Failure Notifications

- **D-11:** Notifications של failure: **GitHub's default email** + **Actions tab**. אין Slack webhook, אין Sentry monitor, אין cron-checker.
- **D-12:** SETUP.md מסעיף "מה לעשות כש-deploy נכשל": (1) פתח את Actions tab → run האחרון → צפה ב-logs → fix → re-push. (2) אם ה-error הוא `invalid_grant` — חזור ל-D-09.
- **D-13:** Sentry monitoring + Slack/email alerts מתוקצבים ל-**Phase 7 (Observability)**. שם יוסיפו גם monitoring ל-Apps Script runs עצמם (לא רק ל-deploy).

### `deploy:gs` Script Shape

- **D-14:** Root `package.json` יכלול:
  ```json
  {
    "name": "roas-tracker-root",
    "private": true,
    "scripts": {
      "deploy:gs": "clasp push --force"
    },
    "devDependencies": {
      "@google/clasp": "^2.4.2"
    }
  }
  ```
- **D-15:** `--force` נדרש: clasp ב-default מסרב לדרוס שינויים שעל ה-server מעט מאוחרים מאלה ה-local. ב-CI אנחנו תמיד רוצים שה-source-of-truth יהיה git. **כן יש סיכון** שזה ידרוס שינויים שמישהו ערך ידנית בעורך Apps Script — זו התנהגות מכוונת ומובנת בתיעוד SETUP.md.
- **D-16:** `clasp push --force` רץ מ-root של ה-repo (לא מ-`dashboard-web/`). ה-`.clasp.json` ב-root מצביע על ה-script ID, ו-clasp מזהה את ה-`.gs` + `appsscript.json` ב-cwd ב-flat structure (ללא תיקיות).

### Pre-commit Hook

- **D-17:** **נדחה ל-Phase 7.** Phase 7 כבר מתוכנן ל-observability — pre-commit hook ל-`.gs` syntax validation נכנס שם יחד עם Apps Script runtime logging. Phase 3 מתמקד **רק** ב-deploy mechanism.

### Idempotency

- **D-18:** Action מטופל אידמפוטנטית: `clasp push --force` רץ פעמיים ברצף → second run הוא no-op (clasp מזהה שאין diff). אם push נכשל באמצע (network error), retry פשוט מספיק.

### Claude's Discretion

- **node_modules ב-root:** מותר ל-`.gitignore` להמשיך לכלול `node_modules/` — זה כבר שם. אם לא: הוסף.
- **Workflow name + job name** ב-YAML — שמות descriptive כלשהם (e.g., `name: Deploy Apps Script` / `jobs: deploy: ...`).
- **GitHub Actions runner version** — `ubuntu-latest` (default). שום סיבה לקבע ל-`ubuntu-22.04` ב-phase זה.
- **Node version ב-Action** — `actions/setup-node@v4` עם `node-version: '22'` (תואם ל-LTS שב-`dashboard-web/package.json` של Phase 2).
- **`clasp` version pin** — `^2.4.2` ב-package.json (semver caret). אם clasp v3 ייצא וישבור backward compat, ה-Action עדיין יישאר על 2.x עד עדכון מודע.
- **Workflow concurrency** — `concurrency: group: deploy-gs` (cancels in-progress runs כשpush חדש מגיע) — אופציונלי אבל מומלץ; ה-executor יחליט.
- **`fetch-depth: 1`** ב-checkout (shallow clone — clasp לא צריך history).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### ROADMAP + concerns

- `.planning/ROADMAP.md` §"Phase 3: CI/CD for Apps Script" — Goal, Requirements, Success Criteria
- `.planning/codebase/CONCERNS.md` §"Apps Script Upload ידני" — מקור המוטיבציה לphase זה
- `.planning/codebase/CONCERNS.md` §"Recommendations #3" — clasp push + GitHub Action (HIGH IMPACT, LOW EFFORT, ~2h)

### Stack / system layout

- `.planning/codebase/STACK.md` §"Apps Script V8" — 9 קבצי `.gs` ב-root + `appsscript.json`
- `SYSTEM_OVERVIEW.md` — תיעוד high-level של ה-architecture (יש לעדכן ב-task האחרון)
- `SETUP.md` — מדריך ההקמה הקיים (מעודכן ב-phase זה — שלבים חדשים מתווספים)

### Existing config files at root

- `.gitignore` — שורה 1 כיום `.clasp.json` (חייב להסיר ב-task הראשון); `node_modules/` כבר שם; `.clasprc.json` חייב להתווסף
- `appsscript.json` — manifest קיים (V8, Asia/Jerusalem, OAuth scopes — drive, sheets, urlfetch, gmail.send, script.scriptapp)
- 9 קבצי `.gs` ב-root: `Config.gs`, `FX.gs`, `Shopify.gs`, `MetaAds.gs`, `GoogleAds.gs`, `ManualOverrides.gs`, `SheetBuilder.gs`, `DailyUpdate.gs`, `Main.gs` — לא נערכים בphase זה (deploy mechanism only)

### Existing 03-PLAN.md frontmatter

- `.planning/phases/03-ci-cd-apps-script/03-PLAN.md` — 6 tasks קיימים עם 2 operator checkpoints (clasp login + GitHub Secret upload). ה-planner ב-replan ירפרר לזה כ-pattern_ref אבל ה-decisions ב-CONTEXT.md הם source of truth.

### External docs (read on demand)

- `https://github.com/google/clasp` — clasp CLI README (גרסה 2.x — pin ל-`^2.4.2`)
- `https://docs.github.com/en/actions/security-guides/encrypted-secrets` — GitHub Secrets reference (לתיעוד ב-SETUP)
- `https://developers.google.com/apps-script/guides/clasp` — Google's clasp guide (auth flow, refresh-token expiry behavior)

### Phase 2 carry-forward (Phase 3 לא מסתמך על אלה ישירות, אבל לא לשבור)

- `dashboard-web/package.json` — קיים, יש לו `vitest`/`@sentry/nextjs` (Phase 2); root package.json החדש **לא** מבטל / מתחרה בו. שני lockfiles נפרדים.
- `dashboard-web/.gitignore` (cascade): שינויים ב-root `.gitignore` לא משפיעים על dashboard-web.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- **`.gitignore` שורה 1** (`.clasp.json`) — מקור היחיד היום שגורם ל-`.clasp.json` לא להישמר. הסרה atomic = task ראשון.
- **`appsscript.json` ב-root** — manifest קיים שcleasp ימצא אוטומטית. clasp דורש שיש בדיוק קובץ אחד `appsscript.json` ב-cwd → root טוב, dashboard-web/ לא יפריע (clasp מתעלם ממה שלא ב-cwd ולא מתחת).
- **Node 22 LTS** — כבר מותקן + מאומת ב-dashboard-web (Vercel runtime). אותו setup-node@v4 ישמש ב-deploy-gs.yml.

### Established Patterns

- **GitHub Actions לא נמצא היום** ב-repo. אין `.github/` בכלל. Action זה יהיה הראשון. אין pattern קיים לעקוב אחריו → executor יבנה מאפס.
- **Operator checkpoints** ב-PLAN (`autonomous: false`) — Phase 3 דורש 2: (1) `clasp login` local, (2) העלאת `CLASPRC_JSON` ל-GitHub Secrets. שניהם בלתי-אוטומטיים מטעמי auth.
- **Phase 2 pattern** של `cd dashboard-web && npm install` לא חל פה — Phase 3 הוא root-only. הinstall החדש הוא root-level `npm install`.

### Integration Points

- **`git push origin main` → GitHub** → workflow runner → `clasp push --force` → `script.google.com`
- ה-`CLASPRC_JSON` secret חייב להיות configured **לפני** הpush הראשון של ה-workflow file — אחרת ה-Action הראשון יכשל. ה-operator checkpoint #2 מבטיח את הסדר.

### Known landmines

- אם `.clasprc.json` נשאר על ה-local (לא ב-`.gitignore`) ויש שניים-שלושה מפתחים שמסנכרנים — ייווצר collision. `.gitignore` חייב לכלול את `.clasprc.json` **לפני** הפעם הראשונה ש-`clasp login` רץ.
- `clasp push --force` דורס שינויים שנעשו ידנית בעורך Apps Script. אם operator ערך משהו ידני ב-script.google.com ושכח לcommit ל-git, deploy הבא יוחק זאת. SETUP.md חייב להסביר את הסיכון בקבלה (אין rollback מובנה — רק re-push מ-git history).
- Google OAuth refresh tokens של clasp expir-ם אחרי **6 חודשים של inactivity**. ב-rep הזה ה-Action תרוץ לעיתים תכופות יחסית (every .gs change), אז ה-refresh token יישאר חי. אבל אם יש gap של 6 חודשים בלי שינויי `.gs` (לא צפוי, אבל אפשרי) — ה-Action ייכשל עם `invalid_grant`. SETUP.md מתעד recovery (re-login + re-upload secret).

</code_context>

<specifics>
## Specific Ideas

- **משך ביצוע משוער:** ~2 שעות (פר CONCERNS.md §"Recommendation #3"). תואם ל-effort budget של phase קטן.
- **6 tasks ב-PLAN הקיים** הם נקודת התחלה טובה לreplan, אבל ה-task המוקדם ביותר חייב להתחיל ב`.gitignore` fix (הסרת `.clasp.json` + הוספת `.clasprc.json`) לפני שמייצרים `.clasp.json` חדש — אחרת ה-`.gitignore` הקיים ימנע commit שלו.
- **שני operator checkpoints** ב-task אחד או בstask נפרדים? המלצה ל-planner: לפצל לpsk1 שמייצר את ה-config (לפני login) ו-task2 שעושה clasp login → secret upload. כל אחד יכול לחכות 5-30 דקות בתאוקה לoperator action.

</specifics>

<deferred>
## Deferred Ideas

- **Pre-commit hook ל-`.gs` syntax validation** → Phase 7 (observability). שם יתווסף יחד עם Apps Script runtime monitoring + log retention.
- **Slack webhook ל-Action failures** → Phase 7 (observability). חלק מ-alerting strategy רחב יותר (לא רק deploy failures אלא גם daily-update timeouts).
- **Sentry cron monitor** ל-deploy + ל-Apps Script triggers → Phase 7.
- **Pre-merge preview deploys** (preview Apps Script project) → לא רלוונטי בinclude נוכחי; אם בעתיד יהיה צורך, יידרש project Apps Script נוסף + branch logic ב-workflow.
- **Manual `workflow_dispatch` button** → לא נחוץ עכשיו; אם דורש retry pattern יותר מ-3 פעמים בחודש — להוסיף ב-Phase 7.
- **`.gs` linting** (eslint-config-googleappsscript או דומה) → Phase 7.
- **Apps Script side test runner** — V8 לא תומך; observability ב-Phase 7 תוסיף diagnostic logs במקום.
- **Multi-environment (staging Apps Script project)** — אם בעתיד יידרש (חוזרת אסטרטגיה), Phase 9+ עם project ID נוסף ו-branch-based deploy.

</deferred>

---

*Phase: 03-ci-cd-apps-script*
*Context gathered: 2026-05-18*
