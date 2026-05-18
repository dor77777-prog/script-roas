---
phase: 03-ci-cd-apps-script
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - package.json
  - package-lock.json
  - .gitignore
  - .clasp.json
  - .github/workflows/deploy-gs.yml
  - SETUP.md
  - SYSTEM_OVERVIEW.md
autonomous: false
requirements:
  - PHASE-3-CICD
must_haves:
  truths:
    - "`npm install` ב-root עובד ומתקין את `@google/clasp` כ-devDependency"
    - "`npm run deploy:gs` מ-local דוחף את כל קבצי ה-`.gs` + `appsscript.json` לפרויקט Apps Script"
    - "GitHub Action מורצת אוטומטית ב-push ל-`main` כששינוי גע בקובץ `*.gs` או `appsscript.json`"
    - "ה-Action מסתיים בהצלחה (`clasp push --force` עובר) ונראה ב-Actions tab"
    - "`.clasprc.json` ב-gitignore (לא ב-repo)"
    - "`.clasp.json` כן ב-repo (script ID committed)"
    - "SETUP.md מתעד את המסלול החדש (clasp login מקומי + GitHub Secret + Action)"
    - "SYSTEM_OVERVIEW.md מזכיר ש-deploy של `.gs` הוא אוטומטי"
  artifacts:
    - path: "package.json"
      provides: "root package.json עם @google/clasp + deploy:gs script"
      contains: '"deploy:gs"'
    - path: "package-lock.json"
      provides: "lockfile של ה-root (לרבות clasp deps)"
    - path: ".clasp.json"
      provides: "script ID של פרויקט Apps Script (committed)"
      contains: '"scriptId"'
    - path: ".gitignore"
      provides: "מחריג את .clasprc.json (credentials)"
      contains: ".clasprc.json"
    - path: ".github/workflows/deploy-gs.yml"
      provides: "GitHub Action שמריץ clasp push ב-push ל-main"
      contains: "clasp push"
    - path: "SETUP.md"
      provides: "תיעוד למסלול ה-deploy החדש"
    - path: "SYSTEM_OVERVIEW.md"
      provides: "תיאור high-level של ה-CI/CD לscript"
  key_links:
    - from: "git push origin main"
      to: ".github/workflows/deploy-gs.yml"
      via: "GitHub Actions trigger (push + paths filter)"
      pattern: "on:\\s*push"
    - from: ".github/workflows/deploy-gs.yml"
      to: "~/.clasprc.json"
      via: "כתיבת secret CLASPRC_JSON ל-home directory לפני clasp push"
      pattern: "CLASPRC_JSON"
    - from: "clasp push"
      to: "script.google.com"
      via: ".clasp.json (scriptId) + .clasprc.json (auth)"
      pattern: "clasp push --force"
    - from: "package.json :: scripts.deploy:gs"
      to: "@google/clasp binary"
      via: "npm run deploy:gs"
      pattern: "clasp push --force"

user_setup:
  - service: clasp (Google Apps Script CLI)
    why: "אימות מקומי מול חשבון Google של בעלי ה-Apps Script project — חד-פעמי"
    env_vars: []
    dashboard_config:
      - task: "להריץ `npx clasp login` מקומית פעם אחת — יפתח דפדפן, להתחבר עם חשבון Google שיש לו edit access ל-Apps Script project"
        location: "טרמינל מקומי (root של ה-repo)"
      - task: "להעתיק את התוכן של `~/.clasprc.json` ולהדביק אותו כ-GitHub Secret בשם `CLASPRC_JSON`"
        location: "GitHub repo → Settings → Secrets and variables → Actions → New repository secret"
      - task: "להריץ `npx clasp clone <scriptId>` (אם ה-project כבר קיים) או `npx clasp create --type standalone --title 'ROAS Tracker'` (אם זה Apps Script חדש) — תוצאה: נוצר `.clasp.json` עם ה-scriptId"
        location: "טרמינל מקומי (root של ה-repo)"
---

<objective>
לבטל את שלב ה-upload הידני של קבצי `*.gs` ל-script.google.com. כל `git push` ל-`main`
שמשנה `*.gs` או `appsscript.json` יפעיל GitHub Action שמריץ `clasp push --force` ⇒
ה-Apps Script project מתעדכן אוטומטית.

Purpose:
זוהי נקודת חיכוך גדולה ב-workflow היומי (`CONCERNS.md` :: "Apps Script Upload ידני").
כל edit ב-`DailyUpdate.gs` / `Shopify.gs` / `Config.gs` דורש כיום פתיחת עורך Apps
Script וpaste ידני קובץ-אחר-קובץ. הסיכון: half-deploy (חצי קובץ ב-production, חצי
מקומי) וfeel של "האם ה-`.gs` ב-production תואם ל-commit hash שב-git?". הפתרון
האדריכלי המומלץ ב-`CONCERNS.md` Recommendation #3: `clasp` + GitHub Action,
effort ~2h, risk reduction סופית.

Output:
- root `package.json` (חדש) + root `package-lock.json` עם `@google/clasp` כ-devDependency.
- `.clasp.json` (committed) — script ID מקושר ל-project הקיים בlasp.
- `.gitignore` מעודכן — `.clasprc.json` מוחרג.
- `.github/workflows/deploy-gs.yml` — Action שמריץ `clasp push --force` ב-push ל-main
  עם paths-filter על `*.gs` + `appsscript.json`.
- SETUP.md + SYSTEM_OVERVIEW.md מעודכנים.
- בדיקת end-to-end: no-op commit ל-`.gs` ⇒ Action ירוקה ב-Actions tab.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/ROADMAP.md
@.planning/codebase/CONCERNS.md
@.planning/codebase/STACK.md
@SETUP.md
@appsscript.json
@.gitignore

<interfaces>
<!-- key facts the executor needs without spelunking -->

**ה-Apps Script side (לפי STACK.md + CONCERNS.md):**
- 9 קבצי `*.gs` ב-root: `Config.gs`, `FX.gs`, `Shopify.gs`, `MetaAds.gs`, `GoogleAds.gs`,
  `ManualOverrides.gs`, `SheetBuilder.gs`, `DailyUpdate.gs`, `Main.gs`.
- `appsscript.json` ב-root — manifest (V8, Asia/Jerusalem, OAuth scopes).
- אין `package.json` ב-root לפני ה-phase הזה. ה-`package.json` היחיד הוא ב-`dashboard-web/`
  (Next.js side) ולא נוגעים בו.

**clasp specifics (מתוך @google/clasp v2.x docs — what the executor must know):**
- `clasp login` יוצר `~/.clasprc.json` עם OAuth tokens (NOT `~/.config/clasp/`,
  למרות שיש variants חדשות יותר — להישאר עם default).
- `clasp clone <scriptId>` יוצר `.clasp.json` עם `{"scriptId": "...", "rootDir": "."}`.
  אם רוצים ש-clasp ידחוף רק קבצי `*.gs` + `appsscript.json` בroot, `rootDir: "."` הוא ברירת המחדל.
- `.claspignore` (אופציונלי) קובע אילו קבצים לא לדחוף. ברירת המחדל של clasp:
  כל `.js`/`.ts`/`.gs` + `appsscript.json`. ב-repo שלנו אין `.js`/`.ts` ב-root,
  אז ברירת המחדל מספקת. **חשוב:** ב-CI אנחנו לא רוצים שhe-`.github/`, `.planning/`,
  `dashboard-web/`, `node_modules/` ייכנסו ל-push, אז אם בכל זאת יוצרים `.claspignore`,
  להחריג אותם במפורש.
- `clasp push --force` דוחף בלי לבקש אישור אינטראקטיבי (`--force` קריטי ב-CI).
- ב-CI: kי-`clasp login` הוא interactive (browser), חייבים לכתוב את `CLASPRC_JSON`
  ל-`~/.clasprc.json` לפני קריאה ל-`clasp push`. הפורמט: JSON עם `token`/`oauth2ClientSettings`.

**GitHub Actions:**
- workflow trigger: `on: push: branches: [main], paths: ['**.gs', 'appsscript.json']`.
- runner: `ubuntu-latest` (gratis).
- steps: checkout → setup-node@v4 → `npm ci` (קורא את ה-`package-lock.json` ב-root) →
  echo secret ל-`~/.clasprc.json` → `npx clasp push --force`.
- secret access: `${{ secrets.CLASPRC_JSON }}`.

**.gitignore המצב הנוכחי (חשוב):**
```
.clasp.json    ← קיים — צריך **להסיר** מ-.gitignore (אנחנו רוצים אותו ב-git)
.DS_Store
node_modules/
.vercel
```
אחרי השינוי:
```
.clasprc.json  ← חדש (credentials, never commit)
.DS_Store
node_modules/
.vercel
```

**SETUP.md מבנה:**
- מדריך step-by-step בעברית. השלב הרלוונטי לעדכון: שלב 0 ("יצירת פרויקט Apps Script")
  — שם מתואר כרגע "מחק את ברירת המחדל Code.gs. צור קובץ עבור כל אחד מהבאים והדבק את התוכן מהריפו".
  זה ה-flow ה-manual שאנחנו מבטלים. נוסיף **שלב 0.5** ("Deploy אוטומטי דרך clasp")
  שמסביר את ה-CI/CD path **למפעיל החדש** (ל-onboarding) + הערה ש"השלב 0 הידני
  נדרש רק לפעם הראשונה כדי לקבל scriptId, אחר כך הכול אוטומטי".

**SYSTEM_OVERVIEW.md:**
- מסמך high-level של איך המערכת עובדת. נוסיף סעיף קצר ("CI/CD") שמתאר ש-`*.gs`
  deploy ל-script.google.com קורה אוטומטית מ-GitHub Actions בכל push ל-main.
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: יצירת root package.json + התקנת clasp + script deploy:gs</name>
  <files>package.json, package-lock.json</files>
  <action>
ליצור `package.json` חדש ב-**root** של ה-repo (לא ב-`dashboard-web/`!) עם המבנה הבא:

```json
{
  "name": "script-roas",
  "private": true,
  "version": "0.0.0",
  "description": "ROAS Tracker — Apps Script collector + clasp CI/CD glue. Dashboard lives in dashboard-web/.",
  "scripts": {
    "deploy:gs": "clasp push --force"
  },
  "devDependencies": {
    "@google/clasp": "^2.4.2"
  }
}
```

הערות:
- `"private": true` — מונע פרסום בטעות ל-npm registry.
- `^2.4.2` — הגרסה היציבה האחרונה של clasp נכון ל-2026-05. אם npm מציע גרסה חדשה
  יותר, להשתמש בה — `^` מתיר minor upgrades.
- `"description"` מבהיר שזה לא package אמיתי אלא glue ל-clasp בלבד.
- **אין** להוסיף `dependencies` (רק dev) ו**אין** scripts אחרים מעבר ל-`deploy:gs`
  בשלב הזה (אם בעתיד נרצה lint ל-`.gs` נוסיף בפיצ'ר נפרד — לא בתוך ה-phase הזה).

אחר כך להריץ:
```bash
npm install
```

זה ייצור:
- `node_modules/` ב-root (כבר ב-gitignore — אל לגעת)
- `package-lock.json` ב-root ⇒ **commit לזה**

**אל תריץ** `clasp login` בtask הזה — זה יבוצע ב-T-04 (operator-manual).
**אל תיצור** `.clasp.json` בtask הזה — גם זה ב-T-04.
  </action>
  <verify>
    <automated>test -f package.json && test -f package-lock.json && node -e "const p=require('./package.json'); if(!p.scripts || p.scripts['deploy:gs'] !== 'clasp push --force') process.exit(1); if(!p.devDependencies || !p.devDependencies['@google/clasp']) process.exit(2);" && test -x node_modules/.bin/clasp</automated>
  </verify>
  <done>
- `package.json` קיים ב-root עם `"deploy:gs": "clasp push --force"` ו-`@google/clasp` ב-devDependencies.
- `package-lock.json` קיים ב-root.
- `node_modules/.bin/clasp` קיים (לאחר `npm install`).
- אין שינוי ב-`dashboard-web/package.json` או `dashboard-web/package-lock.json`.
  </done>
</task>

<task type="auto">
  <name>Task 2: עדכון .gitignore + יצירת .clasp.json placeholder</name>
  <files>.gitignore, .clasp.json</files>
  <action>
שני שינויים נפרדים אבל קשורים:

**א. עדכון `.gitignore`:**

המצב הנוכחי:
```
.clasp.json
.DS_Store
node_modules/
.vercel
```

לשנות ל:
```
.clasprc.json
.DS_Store
node_modules/
.vercel
```

כלומר:
- **להסיר** את השורה `.clasp.json` (אנחנו רוצים שזה כן יהיה ב-git — מכיל את ה-scriptId שהוא public-ish).
- **להוסיף** את השורה `.clasprc.json` (זה ה-credentials file — never commit).

**ב. יצירת `.clasp.json`:**

יצירת קובץ `.clasp.json` ב-root עם תוכן placeholder:
```json
{
  "scriptId": "REPLACE_WITH_REAL_SCRIPT_ID_FROM_CLASP_CLONE",
  "rootDir": "."
}
```

הסבר:
- `scriptId` יוחלף ע"י ה-operator ב-T-04 (אחרי `clasp clone <id>` או `clasp create`).
  הסיבה שאנחנו committing placeholder: כדי ש-CI workflow יוכל למצוא את הקובץ
  מתחילתו, וכדי שה-pattern ב-`must_haves.artifacts.contains: "scriptId"` יעבוד.
- `rootDir: "."` — clasp ידחוף קבצי `*.gs` + `appsscript.json` שיושבים ב-root.

**אזהרה:**
אל תיצור `.claspignore` כעת. clasp's default ignore patterns (`node_modules/`, `.git/`,
`*.tsx`/`*.jsx`/`*.ts` במצב היפך) **לא** מכסים את `.planning/`, `dashboard-web/`,
`.github/` שלנו. **אבל**: clasp ב-default דוחף רק `*.gs` ו-`appsscript.json` (לא
`*.md` או `*.json` אחר), אז `.planning/` ו-`dashboard-web/` לא ייכנסו ל-push. **אם
ב-T-05 (validation) נגלה ש-clasp דוחף קבצים לא רצויים**, אז ניצור `.claspignore`
בtask follow-up. בינתיים — לא.

ה-operator יצטרך לערוך את `scriptId` ב-T-04. נסביר את זה גם ב-SETUP.md ב-T-06.
  </action>
  <verify>
    <automated>grep -q '^\.clasprc\.json$' .gitignore && ! grep -q '^\.clasp\.json$' .gitignore && test -f .clasp.json && node -e "const c=require('./.clasp.json'); if(!('scriptId' in c) || c.rootDir !== '.') process.exit(1);"</automated>
  </verify>
  <done>
- `.gitignore` מכיל `.clasprc.json` ו**לא** מכיל `.clasp.json`.
- `.clasp.json` קיים עם `scriptId` (placeholder) ו-`rootDir: "."`.
- `git status` מראה את `.clasp.json` כקובץ untracked מוכן ל-stage (לא ignored).
  </done>
</task>

<task type="auto">
  <name>Task 3: יצירת .github/workflows/deploy-gs.yml</name>
  <files>.github/workflows/deploy-gs.yml</files>
  <action>
ליצור את התיקייה `.github/workflows/` (אם לא קיימת) ולכתוב את הקובץ `deploy-gs.yml`:

```yaml
name: Deploy Apps Script (clasp push)

on:
  push:
    branches: [main]
    paths:
      - '**.gs'
      - 'appsscript.json'

jobs:
  deploy:
    runs-on: ubuntu-latest
    timeout-minutes: 5

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Write clasp credentials from secret
        env:
          CLASPRC_JSON: ${{ secrets.CLASPRC_JSON }}
        run: |
          if [ -z "$CLASPRC_JSON" ]; then
            echo "::error::CLASPRC_JSON secret is empty. Set it under Settings → Secrets → Actions."
            exit 1
          fi
          printf '%s' "$CLASPRC_JSON" > "$HOME/.clasprc.json"
          chmod 600 "$HOME/.clasprc.json"

      - name: Verify clasp can see the project
        run: npx clasp status || (echo "::error::clasp status failed — check scriptId in .clasp.json and CLASPRC_JSON secret"; exit 1)

      - name: Push to Apps Script
        run: npm run deploy:gs
```

הסברים על החלטות:
- `paths: ['**.gs', 'appsscript.json']` — ה-Action רץ רק כשנגעו ב-`.gs` או ב-manifest.
  שינוי ב-`dashboard-web/`, `.planning/`, `SETUP.md` וכו' לא ירוץ ⇒ חוסך runner minutes.
- `node-version: '20'` — LTS, תואם ל-clasp v2.x.
- `cache: 'npm'` — מאיץ את ה-Action ע"י cache של `~/.npm`.
- `npm ci` ולא `npm install` — קורא ישירות מ-`package-lock.json` (deterministic).
- `printf '%s'` ולא `echo` — מונע בעיות עם trailing newline ב-tokens.
- `chmod 600` — best practice לקובץ credentials.
- step ה-`clasp status` הוא ה-pre-flight check: אם ה-scriptId לא תקף או ה-token פג,
  נכשל **לפני** push ⇒ הודעת שגיאה ברורה.
- `timeout-minutes: 5` — Apps Script push לא אמור לקחת יותר מ-30 שניות; 5 דקות מספיק
  בהבדל ובנפילות network.

**אזהרה:**
- אל תפעיל `clasp login` ב-Action — זה interactive ויכשל. רק `clasp push` רץ ב-CI.
- אל תוסיף `permissions:` block — defaults של GitHub Actions מספקים ל-public repo;
  עבור private repo, defaults עדיין מאפשרים secrets read.
  </action>
  <verify>
    <automated>test -f .github/workflows/deploy-gs.yml && grep -q 'clasp push --force' .github/workflows/deploy-gs.yml && grep -q "secrets.CLASPRC_JSON" .github/workflows/deploy-gs.yml && grep -q "paths:" .github/workflows/deploy-gs.yml && grep -v '^#' .github/workflows/deploy-gs.yml | grep -c "'\*\*\.gs'" | grep -q '^1$'</automated>
  </verify>
  <done>
- `.github/workflows/deploy-gs.yml` קיים.
- מכיל את ה-trigger `on: push: branches: [main], paths: ['**.gs', 'appsscript.json']`.
- מכיל את ה-secret reference `${{ secrets.CLASPRC_JSON }}`.
- מריץ `npm run deploy:gs` (שהוא `clasp push --force`).
- מכיל step של `clasp status` כ-pre-flight check.
  </done>
</task>

<task type="checkpoint:human-action" gate="blocking">
  <name>Task 4: Operator-manual — clasp login + clone + GitHub Secret</name>
  <what-built>
T-01..T-03 הניחו את כל ה-glue: `package.json` + `.clasp.json` (placeholder) + workflow.
מה שעדיין דרוש זה אימות מקומי + רישום ה-script ID האמיתי + העלאת ה-credentials
כ-GitHub Secret. אלה פעולות שדורשות browser interaction (OAuth) ו-GitHub UI ⇒
operator-manual.
  </what-built>
  <how-to-verify>
**שלב א — clasp login מקומי (פעם אחת בלבד):**

1. ב-טרמינל מקומי, מ-root של ה-repo, להריץ:
   ```bash
   npx clasp login
   ```
2. דפדפן ייפתח עם Google OAuth. להתחבר עם **חשבון Google שיש לו edit access
   ל-Apps Script project של ROAS Tracker** (אותו חשבון שמשתמש ב-script.google.com היום).
3. לאשר את ההרשאות (`script.projects`, `script.deployments`, וכו').
4. אחרי החזרה לטרמינל יופיע `Saved credentials to ~/.clasprc.json`.

**שלב ב — קישור ל-Apps Script project הקיים:**

יש שתי אופציות:

**אופציה B1 (מומלץ — ה-project כבר קיים ב-script.google.com):**
1. להיכנס ל-https://script.google.com → לפתוח את ה-project של ROAS Tracker.
2. **Project Settings ⚙️** (סרגל שמאלי) → להעתיק את **Script ID** (מחרוזת ארוכה).
3. לערוך ידנית את `.clasp.json` ב-root: להחליף את `REPLACE_WITH_REAL_SCRIPT_ID_FROM_CLASP_CLONE`
   ב-Script ID האמיתי.
4. אופציה אלטרנטיבית: למחוק את `.clasp.json` ולהריץ `npx clasp clone <scriptId>` —
   זה ייצור `.clasp.json` חדש עם ה-ID. **אזהרה**: clone יוריד את הקבצים ה-Apps Script
   הנוכחיים אל ה-root — אם יש drift בין ה-`.gs` בגיט לבין מה שב-Apps Script,
   הקבצים המקומיים ידרסו. לבדוק `git diff` אחרי clone לפני commit.

**אופציה B2 (אם רוצים project חדש לגמרי — לא מומלץ במצב הקיים):**
1. `npx clasp create --type standalone --title 'ROAS Tracker'` — יוצר project חדש
   ב-script.google.com (אחר). יש להתאים את ה-`spreadsheet.id` Script Property
   ב-project החדש לפי SETUP.md שלב 4.
2. רק אם אתה בטוח שאתה רוצה לעבור project — אל תבחר B2 בלי לוודא שה-triggers
   ו-Script Properties יועברו.

לתעד את האופציה שנבחרה.

**שלב ג — GitHub Secret:**

1. להריץ מקומית:
   ```bash
   cat ~/.clasprc.json
   ```
   להעתיק את כל ה-output (JSON ארוך).
2. ב-GitHub: לפתוח את ה-repo → **Settings** → **Secrets and variables** → **Actions**.
3. **New repository secret**:
   - Name: `CLASPRC_JSON`
   - Secret: להדביק את ה-JSON שהועתק.
4. **Add secret**.

**שלב ד — בדיקה מקומית:**

לוודא ש-clasp מקומית עובד:
```bash
npx clasp status
```
תוצאה צפויה: `Not ignored files:` followed by list of `.gs` files + `appsscript.json`,
ואז `Ignored files:` followed by `node_modules/...` וכו'.

לא להריץ `clasp push` כעת — נעשה את זה ב-T-05 דרך commit אמיתי.
  </how-to-verify>
  <resume-signal>
לכתוב "approved" אחרי שכל 4 השלבים בוצעו, **ולכלול**:
- ה-Script ID שנכנס ל-`.clasp.json` (כדי שאפשר יהיה להמשיך).
- אישור ש-`CLASPRC_JSON` GitHub Secret נוצר (לציין רק שזה קיים — לא להדביק את ה-token).
- output של `npx clasp status` (לוודא שהוא רואה את הקבצים).

אם משהו נכשל (`clasp login` נתקע, OAuth error, GitHub Secret לא נשמר), לתאר את
השגיאה ב-resume signal — אם אפשר נטפל ב-revision של ה-plan.
  </resume-signal>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <name>Task 5: End-to-end test — no-op commit ל-`.gs` ⇒ GitHub Action ירוקה</name>
  <what-built>
אחרי T-04, יש לנו: `.clasp.json` עם scriptId אמיתי + `CLASPRC_JSON` כ-GitHub Secret +
workflow file. עכשיו לבדוק שהשרשרת כולה עובדת end-to-end דרך commit אמיתי.
  </what-built>
  <how-to-verify>
**שלב א — לוודא ש-deploy:gs עובד מקומית:**

1. מ-root, להריץ:
   ```bash
   npm run deploy:gs
   ```
2. תוצאה צפויה: `Pushing files...` ואחריו list של הקבצים (`Config.gs`, `FX.gs`, ...,
   `appsscript.json`) ולבסוף `Pushed N files.` ללא error.
3. להיכנס ל-https://script.google.com → לפתוח את ה-project → לוודא שה-content של
   קובץ אחד (לדוגמה `Config.gs`) תואם לגרסה ב-git (לדוגמה לחפש מחרוזת ייחודית
   כמו `'spreadsheet.canonical-id'` ב-Config.gs).

אם נכשל מקומית — לתעד את השגיאה ולהפסיק. הסתכל ב-`scriptId` ב-`.clasp.json`,
ב-`~/.clasprc.json`, וב-`npx clasp status` output. ה-resume signal ילך לrevision.

**שלב ב — no-op commit ל-`.gs`:**

1. לבחור קובץ `.gs` קטן ובטוח — מומלץ `ManualOverrides.gs` (לא רץ ב-daily trigger).
2. להוסיף שורת comment בסוף:
   ```javascript
   // CI/CD validation — Phase 3 deploy-gs workflow smoke test
   ```
3. `git add ManualOverrides.gs` + `git commit -m "test(03): trigger deploy-gs workflow"`.
4. `git push origin main`.

**שלב ג — בדיקת ה-Action ב-GitHub Actions tab:**

1. ב-GitHub → ה-repo → **Actions** tab.
2. אמורה להופיע run חדש בשם **"Deploy Apps Script (clasp push)"** עם status running/queued.
3. לחכות עד שהsignaling יעבור ל-✅ (ירוק). זמן צפוי: 30-90 שניות.
4. ללחוץ על ה-run כדי לראות את ה-logs של כל step:
   - **Checkout** — ירוק.
   - **Setup Node** — ירוק.
   - **Install dependencies** — ירוק (`npm ci`).
   - **Write clasp credentials from secret** — ירוק (לא amounts of output — זה
     secrets, לא ידפיס את ה-content).
   - **Verify clasp can see the project** — ירוק עם output של `clasp status`.
   - **Push to Apps Script** — ירוק עם `Pushed N files.`.

**שלב ד — לוודא ב-Apps Script שה-comment נכנס:**

1. https://script.google.com → ה-project → `ManualOverrides.gs`.
2. לגלול לסוף הקובץ — אמור להופיע ה-comment שהוספנו.
3. אם הוא שם ⇒ ה-CI/CD עובד end-to-end. ✅

**שלב ה (אופציונלי) — לוודא ש-paths filter עובד:**

אם רוצים, אפשר לבדוק שhe-Action **לא** רץ בקבצים שלא `.gs`:
1. לעדכן `SETUP.md` (no-op edit ב-T-06 ממילא).
2. push.
3. לבדוק שלא נוסף run חדש ב-Actions tab.

**מה לדווח ב-resume:**

- מספר ה-run של ה-Action (לדוגמה `#1`).
- ה-URL של ה-run.
- אישור שה-comment הופיע ב-Apps Script editor.
- אם נכשל — להעתיק את ה-error message מה-log של ה-step שכשל.
  </how-to-verify>
  <resume-signal>
לכתוב "approved" + לכלול:
- URL של ה-Actions run (לדוגמה https://github.com/USER/script-roas/actions/runs/12345).
- אישור שה-comment הופיע ב-`ManualOverrides.gs` ב-script.google.com.
- (אופציונלי) "paths filter verified" אם בוצע שלב ה.

אם הכישלון ב-CI אבל הצלחה מקומית — בעיה ב-`CLASPRC_JSON` secret (token פג /
פורמט לא נכון). לתאר את ה-error מה-log.

אם הצלחה ב-CI אבל הקובץ לא מתעדכן ב-Apps Script — בעיה ב-`scriptId` ב-`.clasp.json`
(scriptId לא תואם ל-project הצפוי). לתאר.
  </resume-signal>
</task>

<task type="auto">
  <name>Task 6: עדכון SETUP.md + SYSTEM_OVERVIEW.md</name>
  <files>SETUP.md, SYSTEM_OVERVIEW.md</files>
  <action>
**א. עדכון SETUP.md:**

לעדכן את **שלב 0** ("יצירת פרויקט Apps Script"). המצב כיום:

```markdown
## שלב 0 — יצירת פרויקט Apps Script

1. היכנס ל-https://script.google.com והקלק **New project**.
2. שנה את שם הפרויקט ל-`ROAS Tracker`.
3. בעורך, מחק את ברירת המחדל `Code.gs`.
4. צור קובץ עבור כל אחד מהבאים והדבק את התוכן מהריפו:
   - `Config.gs`
   ...
```

לשנות ל:

```markdown
## שלב 0 — יצירת פרויקט Apps Script

> 💡 **חדש מ-Phase 3 (CI/CD)**: deploy של קבצי `*.gs` הוא **אוטומטי** עכשיו דרך
> GitHub Actions. אחרי ה-setup הראשוני (השלבים למטה), שום upload ידני לא נדרש —
> כל `git push` ל-`main` שמשנה `*.gs` או `appsscript.json` מפעיל workflow שעושה
> `clasp push --force` לפרויקט Apps Script אוטומטית.
>
> ראה **שלב 0.5** למטה למסלול ה-CI/CD המלא.

1. היכנס ל-https://script.google.com והקלק **New project**.
2. שנה את שם הפרויקט ל-`ROAS Tracker`.
3. בעורך, מחק את ברירת המחדל `Code.gs`.
4. צור קובץ עבור כל אחד מהבאים והדבק את התוכן מהריפו (**פעם אחת בלבד** — לאחר
   מכן clasp ידאג לסנכרון):
   - `Config.gs`
   - `FX.gs`
   - `Shopify.gs`
   - `MetaAds.gs`
   - `GoogleAds.gs`
   - `ManualOverrides.gs`
   - `SheetBuilder.gs`
   - `DailyUpdate.gs`
   - `Main.gs`
5. בתפריט השמאלי, לחץ על **Project Settings** ⚙️ → סמן **"Show appsscript.json manifest file in editor"**.
6. חזור לעורך → פתח את `appsscript.json` והדבק את התוכן מהריפו.
7. עבור לסעיף 0.5 לחיבור ה-CI/CD.

---

## שלב 0.5 — חיבור clasp ל-Apps Script project (CI/CD)

> 💡 שלב חד-פעמי. אחרי הגדרה ראשונית, deploy של `.gs` יקרה אוטומטית בכל push ל-`main`.

### 0.5א — התקנת clasp + login מקומי

מ-root של ה-repo (לא מ-`dashboard-web/`):

```bash
npm install              # מתקין את @google/clasp כ-devDependency
npx clasp login          # פותח דפדפן ל-Google OAuth
```

ב-OAuth: להתחבר עם **חשבון Google שיש לו edit access ל-Apps Script project**
(אותו חשבון שבו פתחת את ה-project ב-script.google.com בשלב 0).

תוצאה: נוצר `~/.clasprc.json` עם credentials.

### 0.5ב — קישור ל-Apps Script project

1. https://script.google.com → ה-project של ROAS Tracker → **Project Settings ⚙️** →
   להעתיק את **Script ID**.
2. לערוך את `.clasp.json` ב-root של ה-repo:
   ```json
   {
     "scriptId": "<הדבק כאן את ה-Script ID האמיתי>",
     "rootDir": "."
   }
   ```
3. לבדוק שהקישור עובד:
   ```bash
   npx clasp status
   ```
   צריך להחזיר list של `*.gs` files + `appsscript.json`.
4. לדחוף ידנית פעם ראשונה (אופציונלי — לוודא שה-content בגיט תואם ל-Apps Script):
   ```bash
   npm run deploy:gs
   ```

### 0.5ג — הגדרת GitHub Secret

כדי שה-GitHub Action יוכל לדחוף, צריך את ה-credentials כ-Secret:

1. מקומית:
   ```bash
   cat ~/.clasprc.json
   ```
   להעתיק את כל ה-JSON.
2. GitHub: ה-repo → **Settings → Secrets and variables → Actions → New repository secret**:
   - **Name**: `CLASPRC_JSON`
   - **Value**: הדבק את ה-JSON.
   - **Add secret**.

### 0.5ד — בדיקת end-to-end

1. לשנות קובץ `.gs` קטן (לדוגמה הוסף comment ב-`ManualOverrides.gs`).
2. `git commit && git push origin main`.
3. GitHub → **Actions** tab → לוודא שה-workflow **"Deploy Apps Script (clasp push)"**
   רץ ועובר ירוק.
4. https://script.google.com → ה-project → לוודא שה-change נכנס.

> ⚠️ אם ה-Action נכשל ב-step "Verify clasp can see the project" — ה-`CLASPRC_JSON`
> secret לא תקין או פג. לחזור ל-0.5א ולהריץ `clasp login` שוב, ואז לעדכן את ה-Secret.

---
```

הסבר על השינוי המבני: ה-`---` הקיים לפני "שלב 1 — Shopify Admin API tokens" נשמר;
אנחנו רק מוסיפים שלב 0.5 בין שלב 0 לשלב 1.

**ב. עדכון SYSTEM_OVERVIEW.md:**

לבדוק אם SYSTEM_OVERVIEW.md קיים. אם כן — להוסיף section חדש. אם לא — ליצור עם
section מינימלי.

לחפש את ה-section שמתאר את "איך deploy של Apps Script עובד" (אם קיים) או את
ה-section האחרון. להוסיף או לעדכן:

```markdown
## CI/CD

### Apps Script Deployment (Phase 3+)

קבצי `*.gs` ב-root של ה-repo מקושרים ל-Apps Script project ב-script.google.com דרך
[`@google/clasp`](https://github.com/google/clasp). כל push ל-`main` שמשנה `*.gs`
או `appsscript.json` מפעיל את ה-GitHub Action `.github/workflows/deploy-gs.yml`,
שמריץ `clasp push --force` ⇒ הקבצים מתעדכנים אוטומטית ב-Apps Script. אין יותר
copy-paste ידני.

**Credentials:** `~/.clasprc.json` מקומי (גוגל OAuth tokens) — gitignored. ב-CI:
GitHub Secret בשם `CLASPRC_JSON` נכתב ל-`~/.clasprc.json` בתחילת ה-job.

**Script ID:** מאוחסן ב-`.clasp.json` (committed) — מקשר את ה-repo ל-project
ספציפי ב-script.google.com.

**Trigger paths:** `**.gs` + `appsscript.json`. שינויים ב-`dashboard-web/`,
`.planning/`, `SETUP.md` וכו' לא מפעילים את ה-Action.

**Local deploy:** `npm run deploy:gs` מ-root — פותרת את אותו flow כמו ה-Action,
שימושי לבדיקה לפני push.

### Dashboard Deployment

הדשבורד (`dashboard-web/`) deploys אוטומטית ל-Vercel ב-push ל-`main` — לא קשור
ל-workflow של clasp.
```

אם SYSTEM_OVERVIEW.md לא קיים, ליצור עם תוכן מינימלי:

```markdown
# System Overview — ROAS Tracker

מסמך high-level של איך כל החלקים מתחברים. לפרטים על setup ראה `SETUP.md`. לפרטי
stack ראה `.planning/codebase/STACK.md`. לחוב טכני ראה `.planning/codebase/CONCERNS.md`.

## Components

1. **Apps Script collector** — קבצי `*.gs` ב-root. רצים על Google Apps Script V8.
   מאספים נתונים מ-Shopify / Meta / Google Ads / Frankfurter FX, ממירים ל-CAD,
   וכותבים ל-Google Sheet.
2. **Next.js dashboard** — `dashboard-web/`. קורא מאותו Sheet דרך service account.
   Deployed ב-Vercel.
3. **Google Sheet** — source of truth. מקבל writes מה-Apps Script, reads מהדשבורד.

## CI/CD

[... התוכן מלמעלה ...]
```

**אזהרה:**
לא לערוך את `dashboard-web/README.md` בtask הזה (ה-dashboard side לא משתנה ב-phase
הזה — Vercel auto-deploy already documented שם).
  </action>
  <verify>
    <automated>grep -q 'שלב 0.5' SETUP.md && grep -q 'clasp login' SETUP.md && grep -q 'CLASPRC_JSON' SETUP.md && grep -q 'deploy-gs.yml\|clasp push' SYSTEM_OVERVIEW.md && grep -q 'CI/CD' SYSTEM_OVERVIEW.md</automated>
  </verify>
  <done>
- SETUP.md כולל שלב 0.5 חדש עם 4 תתי-שלבים (0.5א/ב/ג/ד) המתאר clasp login + Secret + תהליך בדיקה.
- שלב 0 הקיים מעודכן להפנות לשלב 0.5 ומציין שה-upload הוא חד-פעמי.
- SYSTEM_OVERVIEW.md מכיל section "CI/CD" שמתאר את ה-workflow של deploy-gs.
- אין שינוי ב-`dashboard-web/README.md`.
  </done>
</task>

</tasks>

<verification>

## Phase-Level Verification

לאחר T-01..T-06 בוצעו, להריץ את הבדיקות הבאות:

### A. Local sanity

```bash
# מ-root
test -f package.json && test -f package-lock.json && test -f .clasp.json && test -f .github/workflows/deploy-gs.yml
# כל הקבצים קיימים
```

```bash
# התקנה עובדת ו-clasp זמין
npm ci && test -x node_modules/.bin/clasp
```

```bash
# .gitignore תקין
grep -q '^\.clasprc\.json$' .gitignore && ! grep -q '^\.clasp\.json$' .gitignore
```

```bash
# .clasp.json עם scriptId שאינו placeholder
node -e "const c=require('./.clasp.json'); if(c.scriptId === 'REPLACE_WITH_REAL_SCRIPT_ID_FROM_CLASP_CLONE') { console.error('scriptId still placeholder — operator did not run T-04'); process.exit(1); }"
```

```bash
# clasp status רץ
npx clasp status
```

### B. CI sanity

לבדוק ש-`.github/workflows/deploy-gs.yml` תקין מבחינת YAML:

```bash
# אם actionlint זמין:
which actionlint && actionlint .github/workflows/deploy-gs.yml
# אם לא — Python YAML parse:
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/deploy-gs.yml'))"
```

### C. End-to-end (תלוי ב-T-05)

- `git push` של no-op `.gs` ⇒ Actions tab מראה run ירוק.
- ה-comment שהוספנו מופיע ב-script.google.com.

### D. Documentation grep

```bash
grep -c 'clasp' SETUP.md   # אמור להיות >= 5
grep -c 'CI/CD\|clasp push' SYSTEM_OVERVIEW.md  # אמור להיות >= 2
```

</verification>

<success_criteria>

1. ✅ `npm run deploy:gs` מ-local דוחף את כל ה-`.gs` files + `appsscript.json` ל-Apps Script project
   (T-04 ביצע את ה-link, T-05 או T-06 verified).
2. ✅ GitHub Action רץ בהצלחה ב-commit אמיתי של `.gs` ל-main (T-05 verified ב-Actions tab).
3. ✅ Manual upload ל-script.google.com לא נדרש יותר ל-deployments שוטפים.
4. ✅ `SETUP.md` מתעד את המסלול החדש בשלב 0.5 (clasp login + GitHub Secret + פעולת end-to-end).
5. ✅ `.clasprc.json` ב-gitignore; `.clasp.json` ב-git.
6. ✅ `SYSTEM_OVERVIEW.md` כולל section CI/CD שמתאר את ה-deploy-gs workflow.

</success_criteria>

<output>

לאחר השלמת T-01..T-06 (כולל אישור ה-checkpoints ב-T-04 וב-T-05), ליצור:

`.planning/phases/03-ci-cd-apps-script/03-01-SUMMARY.md` (או `03-SUMMARY.md` אם
מוסכמת ה-naming של ה-phase היא ללא plan number):

תוכן מינימלי (לפי `templates/summary.md`):
- מה נבנה (3 ארטיפקטים עיקריים: root `package.json`, `.clasp.json`, `deploy-gs.yml`).
- מה הופך לאוטומטי (deploy של `.gs`).
- מה שהוסר (manual upload step מ-SETUP.md).
- decisions שנעשו (`scriptId` קיים vs new, `.claspignore` not created — defaults sufficient).
- patterns שהוקבעו (CI workflow per-domain עם paths filter — model ל-phases עתידיים
  שיוסיפו workflows נוספים).
- next phase: Phase 4 (Component Decomposition).

</output>
