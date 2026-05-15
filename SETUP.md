# מדריך הקמה — ROAS Tracker

מדריך מלא להפעלת המערכת מאפס. זמן משוער: 45-90 דקות (רובו ממתין לאישור Developer Token של Google Ads).

---

## שלב 0 — יצירת פרויקט Apps Script

1. היכנס ל-https://script.google.com והקלק **New project**.
2. שנה את שם הפרויקט ל-`ROAS Tracker`.
3. בעורך, מחק את ברירת המחדל `Code.gs`.
4. צור קובץ עבור כל אחד מהבאים והדבק את התוכן מהריפו:
   - `Config.gs`
   - `FX.gs`
   - `Shopify.gs`
   - `MetaAds.gs`
   - `GoogleAds.gs`
   - `SheetBuilder.gs`
   - `DailyUpdate.gs`
   - `Main.gs`
5. בתפריט השמאלי, לחץ על **Project Settings** ⚙️ → סמן **"Show appsscript.json manifest file in editor"**.
6. חזור לעורך → פתח את `appsscript.json` והדבק את התוכן מהריפו.

---

## שלב 1 — Shopify Admin API tokens (×3 חנויות)

Shopify מציעה היום **שני מסלולים** ליצירת Custom App. החדש (Dev Dashboard) הוא
החדיר בחנויות חדשות. שניהם מובילים לאותו טוקן `shpat_...` ששאר המערכת צורכת.

> 💡 **איך תדע איזה מסלול אתה?**
> ב-store admin → Settings → Apps and sales channels → Develop apps:
> - אם רואים כפתור **"Build apps in Dev Dashboard"** או שמפנים אותך ל-`dev.shopify.com` → **מסלול B (חדש)** למטה
> - אם רואים **"Create an app"** ישירות עם **"Reveal token once"** → **מסלול A (קלאסי)** למטה

---

### מסלול A (קלאסי) — Reveal token once

חזור על השלבים לכל אחת מ-3 החנויות. בסוף יהיו לך 3 זוגות (domain + token).

**A1. כניסה למקום הנכון**
1. היכנס לאדמין: `https://{store}.myshopify.com/admin`
2. **⚙️ Settings** → **Apps and sales channels** → **Develop apps**.
3. אם רואים "Allow custom app development" → לחץ ואשר. פעם אחת לחנות.

**A2. יצירת האפליקציה**
1. **Create an app** → App name: `ROAS Tracker` → **Create app**.

**A3. Scopes**
1. **Configuration** → **Admin API integration** → **Configure**.
2. סמן: `read_orders`, `read_all_orders` (חיפוש "orders").
3. אופציונלי: `read_products`.
4. **Webhook API version**: `2024-10` או חדש יותר.
5. **Save** למטה.

**A4. התקנה + טוקן**
1. חזור לטאב **API credentials**.
2. **Install app** (כפתור ירוק למעלה) → **Install**.
3. תחת **Admin API access token** → **Reveal token once** → **העתק מיד** (`shpat_...`).
   הטוקן מוצג פעם אחת בלבד.

קפוץ לסעיף [1ה](#1ה-מה-לשמור-לכל-חנות).

---

### מסלול B (חדש) — Dev Dashboard + Client Credentials

ב-2025-2026 Shopify החלה להעביר חנויות חדשות למסלול חדש: יצירת האפליקציה ב-Dev Dashboard,
release של גרסה, ואז שליפת הטוקן דרך **Client Credentials Grant API**. כפתור
"Reveal token once" לא קיים כאן.

**B1. יצירת האפליקציה ב-Dev Dashboard**
1. בחנות: **Settings → Apps and sales channels → Develop apps**.
2. אם רואים **"Build apps in Dev Dashboard"** — לחץ. (אחרת מגיעים ידנית ל-`https://dev.shopify.com/dashboard`.)
3. **Create app** → שם: `ROAS Tracker`.

**B2. הגדרת גרסה (Create version)**
זה המסך שהראית. הזן/בחר:
- **App name**: `ROAS Tracker`
- **App URL**: `https://example.com` (לא נדרש בפועל - אבל השדה חובה)
- **Embed app in Shopify admin**: ❌ **בטל סימון** (אנחנו לא בונים UI לאדמין)
- **Preferences URL**: השאר ריק
- **Webhooks API version**: הגרסה האחרונה (`2026-04` או דומה)
- **Access → Scopes**: הקלד או הדבק:
  ```
  read_orders, read_all_orders
  ```
  (לחץ **Select scopes** אם נוח, או הקלד ידנית עם פסיקים)
- **Optional scopes**: השאר ריק
- **Use legacy install flow**: ❌ לא לסמן
- **Redirect URLs**: השאר ריק (לא משתמשים ב-OAuth user flow)
- **POS / App proxy**: השאר סגור

עכשיו לחץ **Release** בפינה הימנית העליונה. ⚠️ **קריטי**: ה-scopes לא יחולו עד שתשחרר גרסה.

**B3. התקנה על החנות**
1. בסרגל הצדדי → **Installs**.
2. **Install app** → בחר את החנות (`uzoshop.myshopify.com`).
3. אשר את ההתקנה.

**B4. שלוף Client ID ו-Client Secret**
1. בסרגל הצדדי → **Settings**.
2. במקטע **Client credentials** העתק את:
   - **Client ID** (נראה כמו `1234abc...`)
   - **Client Secret** (לחץ "Reveal" → העתק)
3. שמור אותם לרגע — נשתמש בהם בשלב הבא להוצאת ה-`shpat_` token.

**B5. הוצאת הטוקן (Apps Script עושה את זה אוטומטית)**
המערכת כוללת פונקציה שמבצעת את ה-Client Credentials Grant API call ושומרת
את הטוקן ב-Script Properties. אין צורך לכתוב curl ידני.

1. ראשית הזן ב-Script Properties (שלב 4 בהמשך):
   ```
   uzoshop.shopify.domain        = uzoshop.myshopify.com
   uzoshop.shopify.clientId      = <Client ID מ-B4>
   uzoshop.shopify.clientSecret  = <Client Secret מ-B4>
   ```
   (זהה ל-zolplus ו-usmile360)
2. ב-Apps Script editor הרץ ידנית את הפונקציה `bootstrapAllShopifyTokens`.
3. בלוגים תראה לכל חנות: `Shopify {storeId}: token saved (scope=...)`.
4. ה-tokens נשמרו אוטומטית כ-`{storeId}.shopify.token` ב-Script Properties.
5. ניתן למחוק עכשיו את `*.clientSecret` מ-Script Properties (לא חובה).

> 💡 הטוקן שמתקבל מ-Client Credentials Grant **לא פג**. צריך להוציא אותו
> רק פעם אחת לכל חנות. אם אתה משנה scopes ב-Dev Dashboard, **חובה**:
> (1) Release גרסה חדשה (2) Reinstall ה-app בחנות (3) להריץ שוב את הפונקציה.

---

<a id="1ה-מה-לשמור-לכל-חנות"></a>
### 1ה. מה לשמור לכל חנות

**מסלול A (קלאסי):** domain + token
**מסלול B (Dev Dashboard):** domain + clientId + clientSecret → אז הפונקציה
תייצר ותשמור את הטוקן.

| מה | איפה למצוא | דוגמה |
|----|------------|-------|
| Domain | URL של האדמין | `uzoshop.myshopify.com` |
| Token (A) | Reveal token once | `shpat_a1b2c3d4...` |
| Client ID (B) | Dev Dashboard → Settings | `1234abcd...` |
| Client Secret (B) | Dev Dashboard → Settings → Reveal | `shpss_...` |

### 1ו. בדיקה מהירה (אופציונלי)
מהטרמינל אפשר לוודא שהטוקן עובד:
```bash
curl -H "X-Shopify-Access-Token: shpat_xxx" \
  "https://uzoshop.myshopify.com/admin/api/2024-10/shop.json"
```
תשובה תקינה מחזירה JSON עם פרטי החנות. אם מקבל 401 — הטוקן או ה-domain שגויים.

---

## שלב 2 — Meta System User token

1. https://business.facebook.com → **Business Settings → Users → System Users**.
2. **Add** → צור System User בשם `roas-tracker` עם תפקיד **Admin**.
3. **Add Assets** → צרף את כל 3 חשבונות הפרסום עם הרשאת **View ads**.
4. סמן את ה-System User → **Generate New Token**:
   - בחר את ה-Meta App שלך (אם אין — צור ב-https://developers.facebook.com/apps תחת Business type)
   - הרשאות נדרשות: `ads_read`, `business_management`
   - **Token Expiration: Never** ✓
5. העתק את ה-token (System User tokens לא פגים).

**מצא את ה-Ad Account IDs:** ב-Business Manager → Accounts → Ad Accounts. המספר ללא הקידומת `act_`.

---

## שלב 3 — Google Ads (רק ל-uzoshop)

החלק הארוך ביותר. כולל אישור Developer Token (לרוב מאושר תוך יום-יומיים).

### 3א. Google Cloud project + OAuth
1. https://console.cloud.google.com → צור פרויקט חדש `roas-tracker-ga`.
2. **APIs & Services → Library** → אפשר את **Google Ads API**.
3. **OAuth consent screen**:
   - User Type: **External**
   - App name: `ROAS Tracker`
   - Support email: שלך
   - Scopes: הוסף `https://www.googleapis.com/auth/adwords`
   - Test users: הוסף את כתובת הג'ימייל שלך
4. **Credentials → Create Credentials → OAuth client ID**:
   - Application type: **Web application**
   - Authorized redirect URIs: `https://developers.google.com/oauthplayground`
5. הורד את ה-Client ID וה-Client Secret.

### 3ב. Developer Token
1. https://ads.google.com → היכנס לחשבון ה-MCC (או חשבון רגיל).
2. **Tools → API Center** → הגש בקשה ל-Developer Token.
3. **Test access** מאושר תוך כמה שעות; **Basic access** תוך 1-2 ימי עסקים.

### 3ג. Refresh Token דרך OAuth Playground
1. https://developers.google.com/oauthplayground
2. בפינה ימין למעלה ⚙️ → סמן **Use your own OAuth credentials** → הדבק Client ID + Secret.
3. בצד שמאל, ב-Step 1: בשדה ה-scope המותאם אישית הזן: `https://www.googleapis.com/auth/adwords`
4. **Authorize APIs** → התחבר עם חשבון Google שיש לו גישה לחשבון Google Ads.
5. **Step 2 → Exchange authorization code for tokens**.
6. העתק את ה-**Refresh token**.

### 3ד. Customer ID
ב-Google Ads, מספר החשבון של uzoshop בפינה ימין למעלה (פורמט `XXX-XXX-XXXX`).
- אם הוא תחת חשבון MCC: שמור גם את מספר ה-MCC כ-`login-customer-id`.

---

## שלב 4 — Script Properties

ב-Apps Script editor: **Project Settings ⚙️ → Script Properties → Add script property**.

הגדר את כל המפתחות הבאים:

### כללי
| Key | Value | חובה? |
|-----|-------|-------|
| `meta.accessToken` | System User token משלב 2 | ✓ |
| `googleads.developerToken` | Developer token משלב 3ב | ✓ |
| `googleads.clientId` | OAuth Client ID משלב 3א | ✓ |
| `googleads.clientSecret` | OAuth Client Secret משלב 3א | ✓ |
| `googleads.refreshToken` | Refresh Token משלב 3ג | ✓ |
| `googleads.loginCustomerId` | מספר MCC (ללא מקפים) | אם uzoshop תחת MCC |

### uzoshop
| Key | Value | מתי |
|-----|-------|-----|
| `uzoshop.shopify.domain` | `uzoshop.myshopify.com` | תמיד |
| `uzoshop.shopify.token` | `shpat_...` | מסלול A, או אוטו' אחרי `bootstrapAllShopifyTokens` במסלול B |
| `uzoshop.shopify.clientId` | מ-Dev Dashboard | מסלול B בלבד |
| `uzoshop.shopify.clientSecret` | מ-Dev Dashboard | מסלול B בלבד (אפשר למחוק אחרי bootstrap) |
| `uzoshop.meta.adAccountId` | מספר ה-Ad Account (ללא `act_`) | תמיד |
| `uzoshop.googleads.customerId` | מספר חשבון Google Ads (ללא מקפים) | תמיד |

### Zol Plus
| Key | Value | מתי |
|-----|-------|-----|
| `zolplus.shopify.domain` | `your-zolplus.myshopify.com` | תמיד |
| `zolplus.shopify.token` | `shpat_...` | מסלול A, או אוטו' במסלול B |
| `zolplus.shopify.clientId` | מ-Dev Dashboard | מסלול B בלבד |
| `zolplus.shopify.clientSecret` | מ-Dev Dashboard | מסלול B בלבד |
| `zolplus.meta.adAccountId` | מספר ה-Ad Account | תמיד |

### 360usmile
| Key | Value | מתי |
|-----|-------|-----|
| `usmile360.shopify.domain` | `your-usmile.myshopify.com` | תמיד |
| `usmile360.shopify.token` | `shpat_...` | מסלול A, או אוטו' במסלול B |
| `usmile360.shopify.clientId` | מ-Dev Dashboard | מסלול B בלבד |
| `usmile360.shopify.clientSecret` | מ-Dev Dashboard | מסלול B בלבד |
| `usmile360.meta.adAccountId` | מספר ה-Ad Account | תמיד |

---

## שלב 5 — הפעלה ראשונית

1. בעורך Apps Script, בחר מהדרופ-דאון את הפונקציה **`setupAll`** ולחץ **Run**.
2. תיפתח חלונית הרשאות:
   - אם רואים "App isn't verified" — לחץ **Advanced → Go to ROAS Tracker (unsafe)**.
   - אשר את כל ההרשאות (Sheets, External Requests, Triggers).
3. בלוגים (View → Logs / Executions) צפויה הודעה:
   ```
   Spreadsheet URL: https://docs.google.com/spreadsheets/d/...
   Daily trigger: every day at 06:00 Asia/Jerusalem
   ```
4. פתח את ה-URL → ודא שנוצרו 4 טאבים: `סיכום`, `uzoshop`, `Zol Plus`, `360usmile`.

---

## שלב 6 — בדיקה

הרץ ידנית את `runDailyUpdate` (יעדכן עבור היום הקודם):
1. בדרופ-דאון של הפונקציות → `runDailyUpdate` → **Run**.
2. בדוק את הגיליון: יש לראות שורה ביום אתמול עם הוצאות, הכנסות ו-ROAS צבוע.
3. אם משהו נכשל — ב-Logs יופיע איזה שלב נפל (Shopify/Meta/GoogleAds/FX).

### בדיקה ספציפית של שירות
מהעורך אפשר להריץ פונקציות בודדות לבדיקה:
- `getShopifyRevenue('uzoshop', '2026-05-15')`
- `getMetaSpend('uzoshop', '2026-05-15')`
- `getGoogleAdsSpend('uzoshop', '2026-05-15')`
- `getFxRate('ILS', 'CAD', '2026-05-15')`

(טכנית, צריך לעטוף בקריאה ולהדפיס ב-Logger כי הם פונקציות עזר)

---

## שלב 7 — מילוי היסטורי (אופציונלי)

אם רוצים לייבא נתונים מתחילת החודש או מעבר לזה, הרץ מעורך הסקריפט:

```
backfillRange('2026-05-01', '2026-05-15')
```

⚠️ הגבלה: כל הרצת Apps Script מוגבלת ל-6 דקות. אם הטווח גדול מדי, פצל לכמה הרצות.

---

## איך זה עובד יום-יום

- כל יום ב-06:15 שעון ישראל, הטריגר מפעיל את `runDailyUpdate`.
- הפונקציה מחשבת מה "היום הקודם" לפי `Asia/Jerusalem`.
- שולפת נתונים מכל ה-APIs, מבצעת המרת מטבע, וכותבת לגיליון.
- אם חודש חדש מתחיל — הסקריפט מצרף בלוק חדש בסוף הטאב.
- אם משהו נכשל לחנות מסוימת — הוא ממשיך עם השאר, ושולח לך אימייל סיכום שגיאות.

---

## תחזוקה ופתרון תקלות

| תופעה | סיבה אפשרית |
|-------|-------------|
| `Missing required property: ...` | חסר מפתח ב-Script Properties |
| `Meta ... failed (190)` | טוקן Meta פג / חסר הרשאה לחשבון פרסום |
| `Shopify ... failed (401)` | טוקן Shopify לא תקף / לא מורשה לקרוא orders |
| `Google Ads ... failed (PERMISSION_DENIED)` | חסר Developer Token, או login-customer-id שגוי |
| ROAS עמודה לא צבועה | ה-Conditional Formatting קיים על D1:D5000 בלבד — בלוקים אחרי שורה 5000 צריכים להתעדכן |

לתיקון conditional formatting, אפשר להריץ:
```
ensureSpreadsheet();  // יוצר/פותח
// או ידנית: עבור על כל הטאבים והרץ ensureRoasColorRules_(sheet) על כל אחד
```

---

## אבטחה

- כל הטוקנים נשמרים ב-Script Properties — לא בקוד, ולא בגיליון.
- הטריגר רץ תחת חשבון הגוגל שלך, עם ההרשאות שאישרת בשלב ה-OAuth.
- ה-Spreadsheet ב-Drive שלך. שתף רק עם מי שאתה רוצה שיראה את הנתונים.
