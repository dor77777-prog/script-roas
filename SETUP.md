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
1. היכנס לאדמין של החנות:
   - uzoshop: `https://uzo-d-s-2.myshopify.com/admin`
   - zolplus: `https://2x1gqx-y0.myshopify.com/admin`
   - 360usmile: `https://360usmile.myshopify.com/admin`
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
2. **Install app** → בחר את החנות המתאימה (לכל אפליקציה החנות שלה):
   - לאפליקציה של uzoshop → בחר `uzo-d-s-2.myshopify.com`
   - לאפליקציה של zolplus → בחר `2x1gqx-y0.myshopify.com`
   - לאפליקציה של 360usmile → בחר `360usmile.myshopify.com`
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

1. ראשית הזן ב-Script Properties (שלב 4 בהמשך) - דוגמה מלאה לכל 3 החנויות:
   ```
   uzoshop.shopify.domain         = uzo-d-s-2.myshopify.com
   uzoshop.shopify.clientId       = <Client ID של אפליקציית uzoshop>
   uzoshop.shopify.clientSecret   = <Client Secret של אפליקציית uzoshop>

   zolplus.shopify.domain         = 2x1gqx-y0.myshopify.com
   zolplus.shopify.clientId       = <Client ID של אפליקציית zolplus>
   zolplus.shopify.clientSecret   = <Client Secret של אפליקציית zolplus>

   usmile360.shopify.domain       = 360usmile.myshopify.com
   usmile360.shopify.clientId     = <Client ID של אפליקציית 360usmile>
   usmile360.shopify.clientSecret = <Client Secret של אפליקציית 360usmile>
   ```
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
| Domain | URL של האדמין | `uzo-d-s-2.myshopify.com` (uzoshop), `2x1gqx-y0.myshopify.com` (zolplus), `360usmile.myshopify.com` (usmile) |
| Token (A) | Reveal token once | `shpat_a1b2c3d4...` |
| Client ID (B) | Dev Dashboard → Settings | `1234abcd...` |
| Client Secret (B) | Dev Dashboard → Settings → Reveal | `shpss_...` |

### 1ו. בדיקה מהירה (אופציונלי)
מהטרמינל אפשר לוודא שהטוקן עובד:
```bash
curl -H "X-Shopify-Access-Token: shpat_xxx" \
  "https://uzo-d-s-2.myshopify.com/admin/api/2024-10/shop.json"
```
תשובה תקינה מחזירה JSON עם פרטי החנות. אם מקבל 401 — הטוקן או ה-domain שגויים.

---

## שלב 2 — Meta Marketing API + System User tokens

> ⚠️ **System User token תקף רק לעסק (Business Portfolio) אחד.**
> חשבונות פרסום שיושבים בעסקים שונים דורשים System User נפרד בכל עסק,
> וטוקן נפרד. ל-3 חנויות פרוסות על 2 עסקים → **2 tokens** סה"כ.
>
> טוקן של System User לא פג. עומד בתנאי Meta כל עוד ה-System User לא נמחק
> וה-Meta App לא נמחק/הושעה.

הזרימה הכוללת (חמישה תת-שלבים):

```
2א. למיין: איזה חשבון פרסום בכל עסק
2ב. ליצור Meta App אחד (משותף לכל הטוקנים)
2ג. לכל עסק - לחבר את ה-App ולמצוא ad account IDs
2ד. לכל עסק - ליצור System User, לחבר assets, להוציא טוקן
2ה. לשמור: מי הטוקן של מי
```

---

### 2א. מיפוי חנות → עסק → ad account

מלא לעצמך טבלה לפני שמתחילים:

| חנות | באיזה Business Portfolio | Ad Account ID |
|------|--------------------------|---------------|
| uzoshop | _____________ | _____________ |
| zolplus | _____________ | _____________ |
| 360usmile | _____________ | _____________ |

לדוגמה: אם uzoshop בעסק A ו-zolplus+360usmile בעסק B → tokenA ל-uzoshop, tokenB
ל-zolplus ולגם 360usmile (אותו טוקן, שני חנויות).

---

### 2ב. ליצור Meta App — אחד לכל עסק

> ⚠️ **חשוב: Meta app יכול להיות בבעלות של עסק אחד בלבד.** כשמוסיפים את ה-app
> לעסק הראשון דרך Business Settings → Apps → Add, העסק הזה הופך לבעלים. כשמנסים
> להוסיף את אותו app גם לעסק שני, Meta מציגה את ההודעה "this business portfolio
> **will become the owner**" - כלומר זו בקשה להעברת בעלות, לא לשיתוף.
>
> **תוצאה מעשית**: אם יש לך 2 עסקים שונים, אתה צריך **2 Meta apps נפרדים**.
> כל אפליקציה תיוחס לעסק שלה, ותשמש לייצור טוקנים של System User באותו עסק.

**חזור על השלבים הבאים פעם אחת לכל עסק שלך** (בדרך כלל 2 פעמים).

1. גש ל-**https://developers.facebook.com/apps** והיכנס עם החשבון הראשי שלך.
2. לחץ **Create App** למעלה ימין.
3. **App details**:
   - **App name**: `ROAS Tracker A` (לאפליקציה ראשונה) או `ROAS Tracker B` (לשנייה).
     שמות שונים = יותר קל לזהות איזה app שייך לאיזה עסק.
   - **App contact email**: המייל שלך
   - לחץ **Next**.
4. **Use cases**:
   - ✅ **Measure ad performance data with Marketing API**
     (זו השנייה מלמעלה - "Maximize ROI with ad performance data...").
     זה מעניק את ההרשאה `ads_read` הנדרשת.
   - לחץ **Next**.
5. **Business**:
   - תופיע אזהרה: "Connect a verified business portfolio to your app to get
     access to third-party user and business data..."
   - בחר **"I don't want to connect a business portfolio"** או **"Add later"**.
   - **למה לדלג כאן ולחבר אחר כך ידנית**: בשלב 2ג נחבר את ה-app לעסק
     הספציפי דרך Business Settings - שם זה עובד גם בלי verification.
   - **Next**.
6. **Requirements**: קרא ואשר → **Next**.
7. **Overview**: סקור → **Create app**.
8. ייתכן ויבקש סיסמת facebook לאישור.
9. לאחר היצירה, **App ID** ו-**App Secret** מופיעים ב-**App settings → Basic**.
   - **שמור בטקסט זמני**: `App A ID = ...`, `App B ID = ...`.

> 💡 ה-App יישאר ב-**Development mode**. זה תקין למה שאנחנו עושים - System User
> tokens עובדים גם ב-Development mode עבור Marketing API. **לא צריך לעבור ל-Live.**

חזור על 1-9 לאפליקציה השנייה אם יש לך 2 עסקים. בסוף יהיו לך 2 App IDs.

> 🚨 **טעות נפוצה**: אם יצרת רק app אחד וניסית להוסיף אותו לעסק השני, קיבלת
> את השגיאה "There was an unexpected technical issue". זה כי Meta מסרב להעביר
> בעלות לעסק שני. הפתרון - **תייצר app שני** ותחבר אותו לעסק השני.

---

### 2ג. בכל עסק - לחבר את ה-App ולמצוא Ad Account IDs

> ⚠️ חזור על כל הסעיף הזה **בכל אחד מ-2 העסקים** שלך.

**2ג.1 — בחר את העסק הנכון**
1. גש ל-**https://business.facebook.com**.
2. בפינה הימנית העליונה יש Dropdown שמראה את שם העסק הפעיל - בחר את העסק הראשון.
3. לחץ ⚙️ **Business settings** (פינה ימנית עליונה אחרי הבחירה).

**2ג.2 — לחבר את ה-App של העסק הזה**
1. בסרגל השמאלי תחת **Accounts** → לחץ **Apps**.
2. **Add → Connect an app ID** (או "Add app").
3. הדבק את ה-**App ID של ה-app שתואם לעסק הזה** מ-2ב:
   - לעסק הראשון: השתמש ב-App ID של `ROAS Tracker A`.
   - לעסק השני: השתמש ב-App ID של `ROAS Tracker B`.
4. אשר.
5. ייתכן ותידרש להזין סיסמה.

> 💡 אם אתה רואה את השגיאה "There was an unexpected technical issue" - כנראה
> שאתה מנסה להוסיף app שכבר בבעלות עסק אחר. צור app חדש (חזור ל-2ב) ונסה שוב
> עם ה-App ID של ה-app החדש.

**2ג.3 — לרשום Ad Account IDs**
1. סרגל שמאלי → **Accounts → Ad accounts**.
2. לכל ad account שייך לעסק הזה רשום:
   - שם החשבון (לוודא שזה החנות הנכונה)
   - מספר ID (פורמט `1234567890` ללא הקידומת `act_`)
   - ה-ID מופיע בכותרת של החשבון, או ב-URL בעת הקלקה עליו.

---

### 2ד. בכל עסק - ליצור System User ולהוציא טוקן

> ⚠️ עדיין באותו עסק שבחרת ב-2ג. אחרי שתסיים פה, עבור לעסק הבא וחזור על 2ג + 2ד.

**2ד.1 — צור System User**
1. ב-Business settings → סרגל שמאלי → **Users → System users**.
2. **Add** למעלה.
3. במסך שנפתח:
   - **System Username**: `roas-tracker`
   - **System User Role**: **Admin** (גישה מלאה - נחוץ ליצירת טוקנים)
   - **Create System User** → ייתכן ויבקש סיסמה לאישור.

**2ד.2 — חבר Ad Accounts ל-System User**
1. ה-System User שיצרת מופיע ברשימה. **לחץ עליו** (כניסה לפרטים).
2. **Add Assets** (כפתור באמצע המסך).
3. בחר **Ad accounts** מהרשימה משמאל.
4. סמן את כל חשבונות הפרסום ששייכים לעסק הזה.
5. בצד ימין, תחת **Partial access**, **חובה לסמן**:
   - ✅ **View performance** (מספיק לקריאה - לא נחוצות הרשאות כתיבה)
6. לחץ **Save changes**.

**2ד.3 — חבר את ה-App ל-System User** (נחוץ ליצירת טוקנים)

> 🚨 **שלב קריטי - דילוג עליו גורם לשגיאה "No permissions available" בייצור הטוקן.**

1. עדיין במסך פרטי ה-System User → **Add Assets** שוב.
2. בחר **Apps** מהרשימה משמאל.
3. סמן את **ה-app של העסק הזה** (`ROAS Tracker A` בעסק הראשון, `ROAS Tracker B` בעסק השני).
4. **תפקיד (חובה!)**: סמן ✅ **Manage app**.
   - ⚠️ סימון "Test app" או "Develop app" בלבד **לא מספיק** - חייב Manage app.
5. **Save changes**.
6. וודא: במסך פרטי ה-System User, בטאב **Assigned assets**, ה-app אמור להופיע ברשימה.

> 💡 אם בשלב 2ד.4 קיבלת **"No permissions available. Assign an app role to the
> system user or select another app to continue"** - זה אומר שהשלב הזה (2ד.3)
> לא הושלם או שסומן תפקיד לא מספיק. חזור הנה, סמן Manage app, ושמור.

**2ד.4 — הוצא טוקן**
1. במסך פרטי ה-System User, לחץ **Generate new token**.
2. **App**: בחר את ה-app של העסק הזה (`ROAS Tracker A` או `ROAS Tracker B`).
3. **Token expiration**: **Never** ✓ (חובה - אחרת הטוקן יפוג!)
4. **Available scopes**: סמן:
   - ✅ `ads_read`
   - ✅ `business_management`
5. **Generate token**.
6. **⚠️ העתק את הטוקן מיד** ושמור בטקסט זמני. **הוא לא יוצג שוב.**
   אם איבדת אותו - אפשר לייצר חדש (ישלול את הקודם).
7. סמן בטקסט הזמני באיזה עסק זה (token של עסק A / token של עסק B).

**2ד.5 — עבור לעסק הבא**
חזור ל-2ג ו-2ד עם העסק השני.

---

### 2ה. מה לשמור בסוף

עבור כל חנות, יש לך עכשיו:

| חנות | Ad Account ID | טוקן | מקור |
|------|---------------|------|------|
| uzoshop | (משלב 2ג.3) | (משלב 2ד.4) | טוקן של העסק שלה |
| zolplus | (משלב 2ג.3) | (משלב 2ד.4) | טוקן של העסק שלה |
| 360usmile | (משלב 2ג.3) | (משלב 2ד.4) | טוקן של העסק שלה |

(שתי חנויות באותו עסק = אותו טוקן יחזור פעמיים בעמודה.)

ב-Script Properties (שלב 4) נגדיר לכל חנות:
- `{storeId}.meta.adAccountId` = ה-ID של ה-ad account שלה
- `{storeId}.meta.accessToken` = הטוקן של העסק שלה

---

### 2ו. בדיקת הטוקן (אופציונלי, מומלץ)

לוודא שהטוקן עובד לפני שעוברים הלאה. ב-Apps Script editor, פתח Tools → "Script editor" ובאיזור ה-debug הרץ פקודה:

```bash
curl "https://graph.facebook.com/v20.0/me?access_token=YOUR_TOKEN"
```
תשובה תקינה: `{"name":"roas-tracker","id":"..."}`.

```bash
curl "https://graph.facebook.com/v20.0/act_AD_ACCOUNT_ID/insights?date_preset=yesterday&fields=spend&access_token=YOUR_TOKEN"
```
תשובה תקינה: `{"data":[{"spend":"123.45","date_start":"...","date_stop":"..."}],...}`.

אם 401/400 - הטוקן/ה-ID לא נכונים, או שה-System User לא קיבל הרשאת View performance.

---

## שלב 3 — Google Ads (רק ל-uzoshop)

> ⚠️ **רק אם uzoshop באמת מפרסם ב-Google Ads.** אם uzoshop לא מפרסם בגוגל,
> אפשר לדלג על כל השלב הזה - הקוד יחזיר 0 הוצאה ל-Google Ads. (תצטרך לערוך
> את `Config.gs` ולסמן `hasGoogleAds: false` ל-uzoshop.)

החלק הארוך ביותר. דורש 4 דברים:
1. פרויקט Google Cloud + OAuth credentials (3א)
2. Developer Token של Google Ads API (3ב) - **דורש אישור של 1-2 ימי עסקים**
3. Refresh token דרך OAuth Playground (3ג)
4. Customer ID של חשבון uzoshop ב-Google Ads (3ד)

---

### 3א. Google Cloud project + OAuth Client

> 💡 הפרויקט הזה נפרד מהפרויקט של Apps Script. ב-Google Cloud Console
> ניצור OAuth credentials שדרכן נגיע ל-Google Ads API.

**3א.1 — צור פרויקט**
1. גש ל-**https://console.cloud.google.com**.
2. בפינה השמאלית העליונה ליד "Google Cloud" - לחץ על שם הפרויקט הנוכחי.
3. **New project** → Name: `roas-tracker-ga` → **Create**.
4. המתן ~30 שניות, ואז ודא שהפרויקט הנכון בחור בפינה השמאלית העליונה.

**3א.2 — אפשר את Google Ads API**
1. בתפריט (☰ פינה ימנית עליונה) → **APIs & Services → Library**.
2. בתיבת החיפוש: `Google Ads API` → לחץ עליו → **Enable**.

**3א.3 — הגדר OAuth consent screen**
1. **APIs & Services → OAuth consent screen**.
2. **User Type**: **External** → **Create**.
3. **App information**:
   - **App name**: `ROAS Tracker`
   - **User support email**: המייל שלך
   - **Developer contact email**: המייל שלך
   - דלג על שאר השדות (אופציונליים).
   - **Save and Continue**.
4. **Scopes**: **Add or Remove Scopes** → בחיפוש למעלה הקלד: `adwords`.
   - סמן ✅ `https://www.googleapis.com/auth/adwords`
   - **Update** → **Save and Continue**.
5. **Test users**: **Add Users** → הזן את כתובת הג'ימייל **שיש לה גישה לחשבון Google Ads
   של uzoshop**. **Save and Continue**.
6. **Summary** → **Back to Dashboard**.

> 💡 ה-app יישאר ב-**Testing mode**. זה מספיק לשימוש פרטי. אין צורך להגיש ל-verification.

**3א.4 — צור OAuth Client ID**
1. **APIs & Services → Credentials**.
2. **+ Create Credentials → OAuth client ID**.
3. **Application type**: **Web application**.
4. **Name**: `ROAS Tracker`.
5. **Authorized redirect URIs**: לחץ **+ Add URI** → הדבק:
   ```
   https://developers.google.com/oauthplayground
   ```
   (זה ה-URI של ה-OAuth Playground שדרכו נשיג את ה-refresh token בשלב 3ג)
6. **Create**.
7. **חלון מקפיץ** מציג Client ID + Client secret. **שמור את שניהם** בטקסט זמני.
   (תמיד אפשר לחזור ל-Credentials ולראות אותם שוב.)

---

### 3ב. Developer Token ב-Google Ads

> ⚠️ **זה השלב הארוך ביותר**. Test access מאושר תוך שעות; אפשר להתחיל עם זה.
> Basic access דורש 1-2 ימי עסקים. **Test access מספיק לקריאה** של חשבונות שאתה מורשה
> בהם, אז אפשר להתחיל לעבוד גם בלי Basic.

**3ב.1 — היכנס לחשבון Google Ads הנכון**
1. גש ל-**https://ads.google.com** והיכנס עם החשבון שמנהל את uzoshop.
2. בפינה השמאלית העליונה ודא שאתה ב-**MCC account** (חשבון מנהל) אם יש לך כזה.
   אם uzoshop ישירות תחת חשבון רגיל - השתמש בחשבון הזה.

**3ב.2 — הגש בקשה ל-API Access**
1. בסרגל העליון: **Tools** (כלים, פינה ימנית) → **Setup → API Center**.
2. אם זו פעם ראשונה - יבקש "Apply for token":
   - **Company name**: שם החברה שלך (יכול להיות "Personal")
   - **Company website**: אתר/דומיין כלשהו (uzoshop.com למשל)
   - **Business email**: המייל שלך
   - **API usage**: בחר **"Internal data management"** או דומה
   - **Tools you build with API**: בחר משהו רלוונטי
   - **Save and continue**.
3. תקבל **Test developer token** מיידית - שמור אותו (מתחיל באותיות/מספרים, ~22 תווים).

> 💡 Test token עובד עם חשבונות **שיש לך גישה ישירה אליהם**. זה מספיק לנו.
> אם תקבל שגיאת DEVELOPER_TOKEN_NOT_APPROVED - יכול להיות שצריך לחכות שעה-שעתיים.

---

### 3ג. Refresh Token דרך OAuth Playground

> 💡 ה-refresh token הוא "הזיכרון" של Apps Script - הוא מאפשר ל-script לקבל
> access tokens חדשים בלי שתצטרך להתחבר שוב לגוגל. הוא נשאר תקף לתמיד
> כל עוד לא ביטלת את ההרשאה ולא שינית סיסמה.

1. גש ל-**https://developers.google.com/oauthplayground**.
2. בפינה הימנית העליונה: ⚙️ **OAuth 2.0 configuration** → סמן:
   - ✅ **Use your own OAuth credentials**
   - **OAuth Client ID**: הדבק את ה-Client ID משלב 3א.4
   - **OAuth Client secret**: הדבק את ה-Client secret משלב 3א.4
   - סגור את החלון.
3. **Step 1 - Select & authorize APIs** (פאנל שמאלי):
   - בתיבה התחתונה "Input your own scopes" הדבק:
     ```
     https://www.googleapis.com/auth/adwords
     ```
   - לחץ **Authorize APIs**.
4. תיפתח חלונית של גוגל - **התחבר עם החשבון שמנהל את Google Ads של uzoshop**
   (אותו חשבון מ-3ב.1).
5. אישור הרשאה לאפליקציה (ייתכן ויראה "App not verified" - לחץ Advanced → Go to ROAS Tracker).
6. **Step 2 - Exchange authorization code for tokens**: לחץ **Exchange authorization code for tokens**.
7. בפאנל הימני יופיעו:
   - **Refresh token** ← **העתק ושמור** (מתחיל ב-`1//...`)
   - Access token (לא נחוץ - יתחדש אוטומטית מה-refresh token)

---

### 3ד. Customer ID של uzoshop ב-Google Ads

1. ב-**https://ads.google.com** בחר את חשבון uzoshop.
2. בפינה הימנית העליונה (ליד שם החשבון/המייל) - יש מספר בפורמט `XXX-XXX-XXXX`.
3. **שמור את המספר ללא המקפים**. לדוגמה: `123-456-7890` → `1234567890`.

**אם uzoshop תחת חשבון MCC (חשבון מנהל):**
4. שמור גם את מספר ה-MCC (בפורמט זהה, גם הוא מופיע בפינה כשאתה בחשבון MCC).
5. זה ייכנס ל-Script Property **`googleads.loginCustomerId`**.

**אם uzoshop חשבון עצמאי:**
- אין צורך ב-`loginCustomerId` (אפשר להשאיר ריק).

---

## שלב 4 — Script Properties

ב-Apps Script editor: **Project Settings ⚙️ → Script Properties → Add script property**.

הגדר את כל המפתחות הבאים:

### כללי
| Key | Value | חובה? |
|-----|-------|-------|
| `meta.accessToken` | System User token משלב 2 — *רק* אם כל חשבונות הפרסום באותו עסק | אם רלוונטי |
| `googleads.developerToken` | Developer token משלב 3ב | ✓ |
| `googleads.clientId` | OAuth Client ID משלב 3א | ✓ |
| `googleads.clientSecret` | OAuth Client Secret משלב 3א | ✓ |
| `googleads.refreshToken` | Refresh Token משלב 3ג | ✓ |
| `googleads.loginCustomerId` | מספר MCC (ללא מקפים) | אם uzoshop תחת MCC |

> 💡 **חשבונות פרסום בעסקים שונים?** במקום `meta.accessToken` הגלובלי, הגדר
> `{storeId}.meta.accessToken` לכל חנות עם הטוקן של העסק שבו יושב חשבון
> הפרסום שלה. ניתן לערבב: אפשר להגדיר `meta.accessToken` כברירת מחדל ולגבור
> רק על חנויות חריגות עם `{storeId}.meta.accessToken`.

### uzoshop
| Key | Value | מתי |
|-----|-------|-----|
| `uzoshop.shopify.domain` | `uzo-d-s-2.myshopify.com` | תמיד |
| `uzoshop.shopify.token` | `shpat_...` | מסלול A, או אוטו' אחרי `bootstrapAllShopifyTokens` במסלול B |
| `uzoshop.shopify.clientId` | מ-Dev Dashboard | מסלול B בלבד |
| `uzoshop.shopify.clientSecret` | מ-Dev Dashboard | מסלול B בלבד (אפשר למחוק אחרי bootstrap) |
| `uzoshop.meta.accessToken` | System User token של העסק שבו חשבון הפרסום של uzoshop | אם בעסק שונה |
| `uzoshop.meta.adAccountId` | מספר ה-Ad Account (ללא `act_`) | תמיד |
| `uzoshop.googleads.customerId` | מספר חשבון Google Ads (ללא מקפים) | תמיד |

### Zol Plus
| Key | Value | מתי |
|-----|-------|-----|
| `zolplus.shopify.domain` | `2x1gqx-y0.myshopify.com` | תמיד |
| `zolplus.shopify.token` | `shpat_...` | מסלול A, או אוטו' במסלול B |
| `zolplus.shopify.clientId` | מ-Dev Dashboard | מסלול B בלבד |
| `zolplus.shopify.clientSecret` | מ-Dev Dashboard | מסלול B בלבד |
| `zolplus.meta.accessToken` | System User token של העסק של zolplus | אם בעסק שונה |
| `zolplus.meta.adAccountId` | מספר ה-Ad Account | תמיד |

### 360usmile
| Key | Value | מתי |
|-----|-------|-----|
| `usmile360.shopify.domain` | `360usmile.myshopify.com` | תמיד |
| `usmile360.shopify.token` | `shpat_...` | מסלול A, או אוטו' במסלול B |
| `usmile360.shopify.clientId` | מ-Dev Dashboard | מסלול B בלבד |
| `usmile360.shopify.clientSecret` | מ-Dev Dashboard | מסלול B בלבד |
| `usmile360.meta.accessToken` | System User token של העסק של 360usmile | אם בעסק שונה |
| `usmile360.meta.adAccountId` | מספר ה-Ad Account | תמיד |
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
