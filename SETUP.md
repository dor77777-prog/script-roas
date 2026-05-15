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

## שלב 1 — Shopify Admin API tokens (×3)

לכל אחת מ-3 החנויות (uzoshop, zolplus, 360usmile), צור Custom App:

1. בלוח הניהול של החנות: **Settings → Apps and sales channels → Develop apps**.
2. **Allow custom app development** → **Create an app** → קרא לה `ROAS Tracker`.
3. **Configure Admin API scopes** → סמן:
   - `read_orders`
   - `read_all_orders` (אופציונלי, נדרש להזמנות ישנות מ-60 יום)
4. **Save** → **Install app** → **Reveal token once**.
5. העתק את ה-Admin API access token (מתחיל ב-`shpat_`).

רשום את ה-`*.myshopify.com` domain ואת ה-token.

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
| Key | Value |
|-----|-------|
| `uzoshop.shopify.domain` | `your-uzoshop.myshopify.com` |
| `uzoshop.shopify.token` | `shpat_...` |
| `uzoshop.meta.adAccountId` | מספר ה-Ad Account (ללא `act_`) |
| `uzoshop.googleads.customerId` | מספר חשבון Google Ads (ללא מקפים) |

### Zol Plus
| Key | Value |
|-----|-------|
| `zolplus.shopify.domain` | `your-zolplus.myshopify.com` |
| `zolplus.shopify.token` | `shpat_...` |
| `zolplus.meta.adAccountId` | מספר ה-Ad Account |

### 360usmile
| Key | Value |
|-----|-------|
| `usmile360.shopify.domain` | `your-usmile.myshopify.com` |
| `usmile360.shopify.token` | `shpat_...` |
| `usmile360.meta.adAccountId` | מספר ה-Ad Account |

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
