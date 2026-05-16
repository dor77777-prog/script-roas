# ROAS Dashboard Web

דשבורד Next.js שמוצג בדפדפן, מתעדכן בזמן אמת מ-Google Sheets, ערוך לפריסה ב-Vercel.

## תכונות

- KPI cards (ROAS, הכנסות, הוצאות, רווח גולמי) עם השוואה לתקופה הקודמת
- כרטיסיות פר-חנות (ROAS, סטטוס מילולי, סיכומים)
- גרף ROAS לאורך זמן לפי חנות
- תובנות אוטומטיות (חנות מובילה, חנות בסיכון, יום חזק)
- **טבלאות חודשיות פר-חנות** (כמו ב-Sheet, עם צביעת ROAS)
- **טבלת סיכום חודשי משולבת** (כל החנויות יחד)
- טבלת פירוט יומי (100 רשומות אחרונות)
- בורר תקופה (השבוע / החודש / חודש קודם / 30 ימים / מותאם)
- בורר חנות
- רענון אוטומטי כל דקה
- ממשק עברית RTL מלא

---

## הקמה - שלב אחר שלב

### 1. צור Service Account ב-Google Cloud

הדשבורד צריך גישה לקריאה לגיליון. הדרך הסטנדרטית: Service Account.

1. גש ל-**https://console.cloud.google.com**.
2. צור פרויקט חדש (או השתמש בקיים) - לדוגמה `roas-dashboard-sa`.
3. **APIs & Services → Library** → אפשר את **Google Sheets API**.
4. **APIs & Services → Credentials → + Create Credentials → Service account**.
5. שם: `roas-dashboard-reader`. **Create and continue**. **Done** (לא חובה לתת תפקידים).
6. בעמוד ה-Service Accounts לחץ על החשבון החדש → **Keys → Add Key → Create new key → JSON**.
7. הורד את הקובץ JSON. בתוכו תמצא `client_email` ו-`private_key`.

### 2. שתף את הגיליון עם ה-Service Account

1. פתח את הגיליון של הדשבורד (`ROAS Tracker - מעקב חנויות`).
2. כפתור **Share** בפינה ימין למעלה.
3. הוסף את ה-`client_email` של ה-Service Account (לדוגמה `roas-dashboard-reader@your-project.iam.gserviceaccount.com`).
4. הרשאה: **Viewer**. **Send**.

### 3. הקמת הפרויקט מקומית

```bash
cd dashboard-web
npm install
cp .env.local.example .env.local
```

ערוך את `.env.local`:

```bash
GOOGLE_CLIENT_EMAIL=roas-dashboard-reader@your-project.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n<מהקובץ JSON>\n-----END PRIVATE KEY-----\n"
SPREADSHEET_ID=1f5tbc-8eMG60Go1ubTldWALc_kwnpaXD_33IsPDWrAk
```

> 💡 **טיפ**: בגרסת ה-JSON של ה-private key, השורות מופרדות ב-`\n` (literal backslash-n). השאר ככה - הקוד מטפל בהמרה.

הרץ את שרת הפיתוח:
```bash
npm run dev
```

פתח **http://localhost:3000**. הדשבורד יטען עם הנתונים מהגיליון.

---

## פריסה ל-Vercel

### 1. צור חשבון ב-Vercel

https://vercel.com/signup - חינמי, התחבר עם GitHub.

### 2. חבר את הריפו ל-Vercel

1. Vercel Dashboard → **Add New → Project**.
2. בחר את הריפו `script-roas` מ-GitHub.
3. **Root Directory**: לחץ **Edit** → בחר `dashboard-web`. (חשוב - כי Next.js יושב בתת-תיקייה)
4. **Framework Preset**: Next.js (יזוהה אוטומטית).
5. **Build & Output Settings**: השאר ברירת מחדל.

### 3. הוסף את משתני הסביבה ב-Vercel

לפני שלוחצים Deploy, הוסף את ה-Environment Variables:

| Key | Value |
|-----|-------|
| `GOOGLE_CLIENT_EMAIL` | מה-JSON של Service Account |
| `GOOGLE_PRIVATE_KEY` | מה-JSON של Service Account (כולל המעטפת `-----BEGIN PRIVATE KEY-----`) |
| `SPREADSHEET_ID` | `1f5tbc-8eMG60Go1ubTldWALc_kwnpaXD_33IsPDWrAk` |

> ⚠️ ל-`GOOGLE_PRIVATE_KEY`: Vercel תופס מעברי שורות אוטומטית כשמדביקים. הקוד מטפל גם ב-`\n` ב-string וגם במעברי שורה אמיתיים.

### 4. Deploy

לחץ **Deploy**. ייקח ~30 שניות.

תקבל URL כמו `https://script-roas.vercel.app`. אם תרצה דומיין משלך (`dashboard.yourdomain.com`), הגדר ב-Vercel → Settings → Domains.

### 5. עדכונים אוטומטיים

כל push ל-branch `main` ב-GitHub יפרוס אוטומטית גרסה חדשה. בלי כפתורים, בלי הגדרות. בערך 30 שניות מ-push ועד שזה Live.

---

## מבנה הפרויקט

```
dashboard-web/
├── package.json
├── tsconfig.json
├── next.config.ts
├── tailwind.config.ts
├── .env.local.example       (תבנית למשתני סביבה)
├── README.md                (קובץ זה)
└── src/
    ├── app/
    │   ├── layout.tsx       (root layout, RTL, Heebo font)
    │   ├── page.tsx         (דף הבית - טוען את הדשבורד)
    │   ├── globals.css
    │   └── api/data/
    │       └── route.ts     (API route שמושך מ-Sheets)
    ├── components/
    │   ├── Dashboard.tsx    (קומפוננטה ראשית, SWR, פילטרים)
    │   ├── Filters.tsx      (בורר תקופה + חנות)
    │   ├── KpiCards.tsx     (4 כרטיסי KPI עם השוואה)
    │   ├── PerStoreCards.tsx (3 כרטיסיות פר-חנות)
    │   ├── RoasChart.tsx    (גרף ROAS לאורך זמן)
    │   ├── InsightsPanel.tsx (תובנות אוטומטיות)
    │   ├── MonthlyTables.tsx (טבלאות חודשיות פר-חנות + סיכום)
    │   └── DetailTable.tsx  (טבלת פירוט יומי)
    └── lib/
        ├── types.ts         (TypeScript types)
        ├── sheets.ts        (Google Sheets client)
        ├── presets.ts       (לוגיקה של בוררי תקופה)
        ├── analytics.ts     (KPI aggregations + ROAS labels)
        └── utils.ts         (פורמטים + cn helper)
```

---

## תחזוקה שוטפת

**הוספת חנות חדשה?** Apps Script ימלא אותה אוטומטית לטאב `data-daily`, והדשבורד יציג אותה אוטומטית בלי שינוי קוד.

**שינוי סף ROAS?** ערוך `src/lib/analytics.ts` → פונקציה `roasLabel`.

**שינוי פלטת צבעים?** `tailwind.config.ts` או הקבועים `STORE_COLORS` בקומפוננטות.

**הרענון איטי מדי?** ב-`src/components/Dashboard.tsx`, שנה `refreshInterval: 60_000` לערך אחר (במילישניות).

---

## פתרון תקלות

| תופעה | סיבה |
|--------|------|
| "שגיאה בטעינת הנתונים" + "Missing GOOGLE_..." | משתני סביבה לא מוגדרים. ב-Vercel: Settings → Environment Variables. מקומית: `.env.local`. |
| "403 The caller does not have permission" | לא שיתפת את הגיליון עם ה-Service Account email. ראה שלב 2. |
| "Range not found" | טאב `data-daily` לא קיים בגיליון. הרץ `setupAll` ב-Apps Script כדי לייצר אותו. |
| הנתונים לא מתעדכנים | בדוק שה-trigger היומי של Apps Script רץ (אמור לרוץ ב-00:05). הרץ ידנית `runDailyUpdate`. |

---

## מערכת היחסים עם Apps Script

- **Apps Script** = הצד הכותב. הוא מושך נתונים מ-Shopify / Meta / Google Ads ורושם לגיליון.
- **Next.js Dashboard** = הצד הקורא. הוא קורא מ-`data-daily` בלבד, מעבד, מציג.
- שני הצדדים עצמאיים. אם תרצה לשנות את הדשבורד, אין צורך לגעת ב-Apps Script.
