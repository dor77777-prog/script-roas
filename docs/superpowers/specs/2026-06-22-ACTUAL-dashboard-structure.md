# ACTUAL DASHBOARD STRUCTURE — Faithful Reference (2026-06-22)

> Compiled from 6 faithful structural scans of the REAL dashboard codebase. This is the
> ground-truth reference for what actually renders today — every tab, sub-tab, card/section,
> drawer, modal, table column, chart, and control. Nothing here is invented; nothing scanned
> was dropped. Use this to correct prior mockups before any redesign work.

---

## NAVIGATION REALITY

The real sidebar is a **FLAT 10-item list — NOT grouped.** There are no "Dashboards / Settings / Tools"
category headers, no separators between nav items. The sidebar (`Sidebar.tsx`) has exactly three zones:

1. **Brand section** (top)
2. **Nav items 1–10** (one unbroken list)
3. **Footer section** (operator link, theme toggle, logout, pin toggle)

**The 10 main tabs (in real render order, with their keyboard shortcuts):**

| # | Hebrew label | Tab key | Shortcut |
|---|--------------|---------|----------|
| 1 | בית (Home) | `home` | ⌘1 |
| 2 | פעילות (Activity) | `activity` | ⌘2 |
| 3 | לקוחות (Customers) | `customers` | ⌘3 |
| 4 | טבלאות אופטימיזציה (Optimization Tables) | — | ⌘4 |
| 5 | P&L | — | ⌘5 |
| 6 | מגמות (Trends) | — | ⌘6 |
| 7 | קמפיינים (Campaigns) | — | ⌘7 |
| 8 | מוצרים (Products) | — | ⌘8 |
| 9 | תשלומים (Payments) | — | ⌘9 |
| 10 | פירוט (Detail) | — | ⌘10 |

> Note on naming/order: the sidebar label for ⌘4 is "טבלאות אופטימיזציה"; the analysis-area scans
> describe Trends (מגמות), Archive (ארכיון/"טבלאות"), and Detail (פירוט) as distinct surfaces. The
> sidebar exposes Trends (⌘6) and Detail (⌘10) as top-level tabs; Archive renders inside the analysis
> area alongside Trends. P&L, Payments, Products are their own top-level tabs.

The **operator page** (`/operator`, "ניהול") is reached via a footer link in the sidebar — it is NOT
one of the 10 main tabs.

### App Shell — Sidebar
- **Desktop:** right-rail; 72px icon-rail by default, expands to 220px on hover (200ms ease-out) or when pinned.
- **Mobile:** left off-canvas drawer at 256px, always expanded.
- Active tab = accent wash + vertical brand-500 indicator. Surface uses `--sidebar` token (white light / navy-800 dark).
- **Footer controls:** ניהול (Operator) link → `/operator` · Theme toggle (Monitor=System / Sun=Light / Moon=Dark) · Logout (LogOut icon) · Pin toggle (Pin/PinOff, desktop only, ⌘\).

### App Shell — TopStrip (floating navbar)
Non-sticky, floats in normal flow (`mt-4`, rounded-full frosted bar, backdrop blur + border + shadow-soft). Always mounts.
- **Left:** Mobile hamburger (Menu icon, md:hidden) → opens mobile drawer · Breadcrumb "עמודים / **<page-label>**" · Large bold page title (matches active tab).
- **Right cluster:** CommandPalette (⌘K, always mounts even during loading) · FreshnessChip (freshness + adSpendFreshness) · SyncIndicator · AI Export button (**Home-only**: Bot icon + "ייצא דוח ל-AI"; full pill md+, icon-only <md, aria-label always present).

---

## TAB 1 — בית (HOME) · key `home`

**Description:** "שנה טווח או חנות לעדכון כל המסך". **No sub-tabs/toggles** — single unified view with an
independent chart-range selector.

### Mobile-only
- **MobileStickyRoas** — collapsing sticky ROAS summary (pinned top-0): ROAS number, target (3.0), delta vs previous, range label. Tracks the main-page range filter.

### Cards/sections (render order)

1. **Header & Global Controls** (full width)
   - **TabHeader** — title "בית" + description + Filters component: preset range buttons (היום / 7 ימים / 30 ימים / …), store dropdown (All / per store), compare-baseline toggle, saved views.
   - **AiReportButton** (modal-only here), **PageScope** (store + range label + currency), **AnnotationsPanel** (pin authoring overlay for chart event markers).

2. **Per-Store Row** (full width)
   - SectionIntro: Store icon · "לפי חנות" · description.
   - **PerStoreRow** — 3-store carousel/grid (mobile = swipeable deck 88% card width; desktop = responsive grid, 1–3 stores fixed cols, 4+ auto-fit 360px min). Carousel dots mobile-only.
   - **Per-store card** (banded glass, vivid ROAS-state gradient): header (store name bdi LTR + FreshnessBadge + band-tag pill); ROAS hero (caption "ROAS · <range>" + big climbing number or "אורגני"/"0.00x"); red-alarm note (white-on-dark scrim: "הוצאה מעל $100 ללא מכירות — בדוק את הקמפיינים"); mobile spark + delta chip (≥2 points); **4-up metric grid** (Spend red wash / Revenue green wash / Orders neutral count / AOV emphasis-colored, all via `<Money>`); per-platform CPM section (logo dot + label + CPM + spend caption); no-spend strip alternative ("אין הוצאת פרסום היום" / "אין נתונים עדיין").

3. **Store Comparison Grid — ניתוח השוואתי** (full-width glass Card)
   - **Table (7 cols, horizontal scroll):** חנות (bdi LTR) · הוצאה (red, compact ≥$1k) · הכנסה (green, compact ≥$1k) · ROAS (AA-safe band chip) · CPM (Money or "—") · AOV (compact floor 100k) · הזמנות (count).
   - **NC-ROAS / nCAC footer** (recessed bg-pill-track well): when not suppressed → NC-ROAS · נטו + value + "ביטחון נמוך" badge | divider | nCAC $ value + order-mix line ("N חדשות · M חוזרות · X% לא מסווג"). When suppressed → "לא מספיק דאטה לסיווג" + order-mix line.

4. **Hero Strip — סיכום עסקי** (SectionIntro: Building2 icon)
   - **CommandCenterHero** = TWO rows of compact KPI Widget tiles (NOT a giant block):
     - **Row 1 (4-up lg / 2-up mobile):** הוצאת פרסום (DollarSign; red delta on ↑; ProvenanceFlag "סופי"/"אומדן חי" + OverrideFlag "● ידני") · הכנסות (TrendingUp; green ↑) · רווח תפעולי (LineChart; green "LIVE" pill; tooltip "הכנסות − פרסום − מלאי…"; FreshnessBadge below delta) · MER (Gauge; band-colored widget; "X.XXx"/"אורגני"/"0.00x"; tooltip "MER — Marketing Efficiency Ratio…").
     - **Row 2 (3-up lg / 2-up mobile):** הזמנות (ShoppingCart; green ↑) · CPM עסקי (BarChart3; "—" when 0/null; green delta on ↓) · מלאי (Package; $ + "~X.X% מהמחזור"; tooltip; informational, no band).
   - **NC-ROAS / nCAC subordinate tile** (own banded Card, band from `newCustomer.ncRoas`): header "לקוחות חדשים · שאלה אחרת" + confidence badge if low; NC-ROAS · נטו (אחרי החזרים) + nCAC + order-mix; per-channel breakdown (ChannelTruthPanel: Meta/Google/TikTok) when present; suppressed → "לא מספיק דאטה לסיווג".
   - **Attribution Coverage Chip** (hero only, above widget grid): shows when orders carry click-id/UTM; if >30% unattributed expands inline `<UnknownBucketPanel>` (direct/no-click breakdown by source).

5. **ROAS vs Target Chart** (full-width neutral glass Card)
   - Header: eyebrow "מטרה 3.0 · 30 ימים אחרונים"; band-tinted TL;DR sentence; FreshnessBadge; scope; pin-count chip (🟡 "X ציוני דרך"); **RoasChartDateRangePicker** (7/30/90/MTD/QTD/YTD/custom — independent of page filter).
   - **KPI strip (5-up):** הכנסות · ROAS (band chip / "אורגני" / "—") · הוצאת פרסום · רווח תפעולי · CPM.
   - Legend + min/max ("מקסימום: … · מינימום: …").
   - **SVG chart:** Y axis (1.0/2.0/3.0/4.0+) + X axis (first/mid/last date); gridlines per 1 ROAS; dashed target line at 3.0 (fixed); band-hue area fill 0.2→0; smooth monotone band-colored line (dashed gray if organic); min/max dots ("שפל …"/"שיא …"); dashed pin guides at annotation dates; violet "היום" marker + pulsing dot; crosshair tooltip (date · ROAS · target · delta).
   - Footer: "ROAS תקופה קודמת: … (−4%)" · "הכנסות שכבר נצברו: …" · "ימי פעילות: …".

6. **New Customers by Platform — לקוחות חדשים לפי פלטפורמה** (full-width glass Card)
   - Header: title + unclassifiable note "X% מההזמנות לא-מסווגות" + business NC-ROAS chip ("NC-ROAS עסקי · 2.13×").
   - Per-platform cards (3-up md / stack mobile): dot + name + count ("N חדשים") · share bar · nCAC ($ via Money) + NC-ROAS (band chip).

7. **Bottom 2-up grid (items-start)**
   - **Left: InsightsBoard** — clickable header (Sparkles icon · "תובנות חכמות" · subtitle "N תובנות פעילות…" / "מנתח…" · severity badges · chevron). Expanded: AI-insight pill; severity-grouped collapsible sections (critical→warning→opportunity→positive→info; critical+warning open by default) with rows (icon · title + scope badge · detail · Mark Done / Hide / InsightActions); hidden-insights section (Restore buttons).
   - **Right: ActivityFeed** — self-fetching `/api/store-events` (SWR 12s). Header + **LiveBadge** (GREEN pulsing "LIVE" ≤15min / GRAY "מאזין" / RED "נותק"). Event rows (max 20, newest first): status-colored icon · type + $ amount · product title · store chip + SourceBadge + relative time. Empty state (pulsing dot + listening/disconnected copy). Footer "מאזין ל-… · מתעדכן רגעית". "ראה הכל ‹" → Activity tab.

### Drawer/Modal — StoreDetailModal (opens on store-card click)
1. Vivid ROAS-band header slab (white-on-band: store name + FreshnessBadge + band-tag pill + close ✕; ROAS hero; band-ink sparkline + relative time).
2. KPI cards + delta vs previous (carousel mobile / 5-up md): Spend, Revenue, Operating Profit, Orders, AOV (each recessed well + "▲/▼ X%").
3. Per-store NC-ROAS / nCAC tile (own band; "לקוחות חדשים · שאלה אחרת"; confidence badge; order-mix + per-channel).
4. ROAS over Time — "ROAS לאורך זמן" (store-scoped RoasChart, hidden if only 1 day).
5. Per-platform breakdown (3-up sm+): dot + name + spend + CPM + ROAS chip.
6. Top campaigns (divided clickable rows: name bdi LTR + revenue/orders/spend + ROAS chip → campaign drawer or Campaigns tab).
7. Footer: primary "פתח את כל הקמפיינים של [store] ‹" · secondary "סגור".

### Data-quality signals (overlaid above tab)
- **FreshnessChip** ("סופי"/"אומדן חי"/"—") · **SourceHealthChip** (red "● Meta · error · 6h") · **ReconcileBanner** (cross-source violations alert).

---

## TAB 2 — פעילות (ACTIVITY) · key `activity`

**Sub-tabs (SegmentedControl, role=tablist):**
- **פיד חי** (`feed`, default) — live paginated events.
- **סטטיסטיקות והתפלגויות** (`stats`) — attribution stats + per-product breakdown.

> Store filter applies to BOTH sub-views. Date-range picker (Filters) appears on STATS only — the feed is real-time, last 30 days.

### Sub-tab: פיד חי (Live Feed)
1. **Header** (Zap icon · "פעילות" · "כל האירועים · 30 הימים האחרונים").
2. **Compact filters row:** Store NativeSelect ("כל החנויות" + stores) · Day NativeSelect ("כל הימים" + 30 ISO days, "היום"/"אתמול"/"d/m/y") · Type pills (Button set, aria-pressed): הכל / מכירות / החזרים / עגלה.
3. **Body states:** error ("טעינת האירועים נכשלה" / "ננסה שוב אוטומטית…") · loading (skeleton table 6 rows) · empty ("אין אירועים בטווח/בפילטר שנבחר") · success.
   - **Grouped events** by IL calendar day: sticky day header ("היום · 1 ביוני"); event rows = type icon (sale green / refund red / add_to_cart blue) · type label + Money amount (not for ATC) · product title · store chip (dot + bdi LTR) · SourceBadge (except refunds) · time (bdi LTR tabular-nums).
4. **Pagination:** Previous (ChevronRight + "הקודם") · "עמוד {page} מתוך {totalPages}" · Next ("הבא" + ChevronLeft). 40 events/page, 1-indexed.

### Sub-tab: סטטיסטיקות והתפלגויות (Attribution Stats)
1. **Data-truncation warning** (conditional): "הנתונים חלקיים — נחתכו ב-50,000 שורות…".
2. **Header + toggle:** BarChart3 icon · "סטטיסטיקות והתפלגויות" · subtitle · SegmentedControl "לפי הזמנות" / "לפי הכנסה".
3. **KPI row (4 compact cards):** הזמנות בטווח (count) · מיוחס לפרסום ממומן (% accent) · הוספות לעגלה (count) · כיסוי קליק-ראשון (% + Info HelpTooltip).
4. **Two donuts (lg 2-col):**
   - **ממומן מול לא-ממומן** — conic ring (center % + "ממומן") + legend (swatch · label · value · share).
   - **התפלגות לפי פלטפורמה** — conic ring (center top-platform + share) + legend sorted by share.
5. **Per-product table** (Card flat): header "לפי מוצר — מאיפה מגיעים" + SegmentedControl "רכישות"/"הוספות לעגלה" + data note "מציג {len} מתוך {total} מוצרים"; bucket legend (swatch + SOURCE_BUCKET_LABEL); **columns:** מוצר · הוספות לעגלה · רכישות · המרה (%) · "פילוח מקור (רכישות | הוספות לעגלה)" (stacked source bar w-40%); footer = 3 explanatory paragraphs with `<code>` field names.
   - States: loading (4 KPI skeletons + 2 donut skeletons + table skeleton) · error · empty ("אין נתונים בטווח שנבחר").

---

## TAB 3 — לקוחות (CUSTOMERS) · key `customers`

**No sub-tabs.** Single integrated view, 6 sections.

1. **Section intro + controls** (Gem icon · "כמה שווה לך לקוח" + description): right slot = CohortAsOfBadge ("עודכן ל-YYYY-MM-DD") · Scope NativeSelect ("כל העסק" + stores) · Basis SegmentedControl "רווח"(profit) / "הכנסה"(revenue).
2. **Verdict Card** (`cv-verdict`) — primary plain-language sentence:
   - No mature LTV → nCAC + repeat-rate copy.
   - Mature LTV → "לקוח חדש שווה לך {LTV} רווח/הכנסה לאורך שנה" + nCAC + net-per-customer (green/red) + payback clause (0 / N months / "לא מחזיר…") + repeat-rate + LTV:nCAC ratio + tone badge ("בריא ✓" / "מבוסס על קבוצות בוגרות…" / "מתחת לסף הרווחיות…" / "רווחי · מתחת ליעד ×3") + recent-bridge clause when applicable.
   - States: error (StateBlock + retry) · loading (verdict silhouette + 4-up KPI skeleton).
3. **KPI row (4 cards):** שווי לקוח (12 ח׳, {basis}) · עלות גיוס לקוח (nCAC) · החזר עלות (payback, "{N} ח׳"/"—") · חוזרים לקנות (repeat %). Each with hint.
4. **LTV Curve Card** — "העקומה: כמה לקוח מחזיר ככל שעובר הזמן" + HelpTooltip "על מה זה מתבסס". `<CustomerValueCurve>` SVG: Y $ gridlines, X month labels (0 "רכישה", 2/4/6/8/10 "ח׳ N"); accent line + gradient fill + glow; warning/profit zones split at payback; dashed break-even nCAC line ("קו עלות-גיוס ${ncac}"); pulsing payback marker + callout pill ("↩ נקודת החזר · חודש M"); hover crosshair tooltip. Legend (3 swatches).
5. **New vs Old Cohorts Card** — "הלקוחות החדשים — טובים יותר או פחות מהוותיקים?" + dynamic subheading; two meters: חדשים (green bar) vs ותיקים (ink-muted bar), each "label / Money".
6. **Advanced Cohort Grid** (`<details>`, collapsed) — summary "תצוגה מתקדמת — רשת ה-cohorts המלאה…"; `<CohortGridAdvanced>` retention matrix (by-year accordion); nCAC-availability footer ("זמינה רק מ-מאי 2026…") + by-year nCAC groups (month + value or "אין נתוני הוצאה", "(חלקי)" for ref month).

> Notes: verdict ratio/badge/net/payback are profit-pinned regardless of basis toggle; nCAC line only on profit curve; scope synced to Dashboard or internal fallback; COGS % via localStorage cross-tab event.

---

## TAB 7 — קמפיינים (CAMPAIGNS)

**Mode toggle (SegmentedControl):** קמפיין (campaign) / אד-סט (ad-set).
**Top controls:** Platform dropdown (כל הפלטפורמות / Meta / Google / TikTok) · Store dropdown (dynamic + uzoshop/Zol Plus/360usmile fallback) · Search box · secondary filters (mobile collapsible): "🔗 רק קמפיינים ממופים", "כל הקמפיינים" (expand beyond TOP_N_DEFAULT=10) · Column-visibility menu (20+ cols, 11 hidden by default, localStorage cloud-synced) · URL-persisted sort (default `roas` desc).

### Summary strip (sticky, 7 KPI tiles)
ROAS (פלטפורמה, band chip) · הוצאה (DollarSign) · ערך המרות (Coins) · המרות (ShoppingCart) · קליקים (MousePointerClick) · CTR (Percent) · CPM (BarChart3, interactive: "הצג מגמה"/"הסתר מגמה" expands CpmTrendChart).
- Secondary row: CPC · CPA · חשיפות (plain text).
- **Expandable CPM trend chart** (CPM time-series + optional ROAS overlay; baseline toggle "חצי"/"קודם"; analysis box).
- **Attribution Gap Panel** (conditional, range-coherent): platform claim vs Shopify revenue, over/under-count, reliability ratio.

### Campaigns table (min-width 1340px, sticky header, row-click → CampaignDrawer)
**Pinned columns:** סימון אופטימיזציה (toggle, 36px) · ציון (health grade A/B/C/D/F or ⏳, sortable `health`) · קמפיין/אד-סט (name, sortable, platform pill + store + bdi LTR + CBO/ABO icon) · מגמה (ROAS sparkline 80px, ≥2 days) · … reorderable cols … · Ads Manager deep link (ExternalLink, 40px).
**Reorderable metric columns:** budget (תקציב יומי) · spend (הוצאה) · conversionValue (ערך המרות) · roas (ROAS פלטפ) · roasShopify (ROAS Shopify מוקצה, blue chip) · firstClickRoas* · roasShopifyPlatform* · shopifyValuePlatform* · shopifyValueAllocated* · shopifyUnitsPlatform* · shopifyValueTotal* · shopifyUnitsTotal* · shopifyOrdersTotal* · conversions (המרות) · clicks* · impressions* · ctr (CTR) · cpc (CPC) · cpm (CPM) · cpa (CPA). (*=hidden by default.)
**Per-row chips:** multi-mapped/cannibalization (🏷️ לא ממופה / 🔗 ממופה ל-X) · status (כבוי / live) · active-days (X ימים) · pending ROAS label ("מתעדכן…"/"ממתין…"). Google = read-only preview.

### Campaigns Top List — קמפיינים מובילים (Card, 2-col)
- **מנצחים** (Trophy, ROAS desc): rank · name + platform/store · ROAS (band) · הוצאה + CAC · green verdict ("הגדל תקציב משמעותית" / "מקום להגדיל תקציב" / "יציב — שמור על תקציב").
- **לתשומת לב** (AlertTriangle, ROAS asc): rank · name + platform/store · ROAS · הוצאה + CAC · red verdict ("סגור או בדוק מיפוי" / "הקטן תקציב / אופטימיזציה" / "בדוק מה רץ פה").

### Drawer — CampaignDrawer (centered modal, 880px / full-screen mobile)
Header: name (bdi LTR) · platform pill · store chip · ROAS health chip (if roas>0) · active-days chip · Ads Manager deep link.
**6 sub-tabs (underline):**
1. **סקירה (Overview)** — Scorecard (4 tiles: ROAS פלטפורמה + badge · ערך המרות · אמינות attribution /100 + badge · ציון בריאות grade); KPI grid (הוצאה · המרות · CTR · CPC · CPA); optional TikTok store-mapping section (dropdown + warning chip); collapsible accordions: ציון בריאות קמפיין (HealthScorePanel) · מוצרי Shopify משויכים (+ edit) · השוואת cohort (cannibalization) · **ניתוח attribution (open by default)** · פילוח מוצר × ערוץ (Meta only) · התאמת ערוצים↔Shopify.
2. **יומי (Daily)** — stacked area (הוצאה ↔ ערך המרות) + CPM trend (+ROAS overlay) + baseline toggle (חצי/קודם) + analysis box.
3. **סטים (Ad-Sets)** — count badge + sortable table: toggle · שם · הוצאה · תקציב יומי · ערך · ROAS (band badge) · ROAS Shopify · המרות. Meta/TikTok row → AdsDrawer; Google = preview.
4. **מודעות (Ads)** — per-ad-set drill buttons (ChevronLeft + name + spend); Google warning (no ad-level rows).
5. **סטטוס (Status)** — Configured/Effective/Delivery status · First Seen At · Status Changed At · Last Status Success At · Last Live Tick At.
6. **היסטוריה (History)** — status-change timeline/log.

### Nested Drawer — AdsDrawer (over CampaignDrawer, Sheet side=end, 820px / full-screen mobile)
Header "מודעות ב-ad-set" + ad-set name + fullscreen toggle (localStorage `drawer:ad:fullscreen`). Totals strip (4-col: הוצאה · ערך · ROAS · המרות).
**Table (sticky, h-scroll):** toggle · מודעה · הוצאה · ערך · ROAS (band badge) · ROAS Shopify (+ trust chip) · first-click (delta vs last-click + coverage chip) · המרות · חשיפות · קליקים · Ads Manager link. States: loading ("טוען נתוני מודעות…") · error (+retry) · empty ("אין נתוני מודעות לטווח הזה").

---

## TAB 5 — P&L ("כמה נשאר ביד?")

**Single section, no sub-tabs.**
- **Hero strip (3 proportional stat cards):** הכנסות (Revenue, "100% — בסיס החישוב") · סך עלויות (Total Costs, "X% מההכנסות") · רווח נטו (Net Profit, "X% מרג'ין", green/red).
- **Expandable detail** ("הסתר פירוט"/"הצג פירוט מלא"):
  - Alert banner when no fixed costs ("טרם הוגדרו עלויות חודשיות" + "עלויות חודשיות" button).
  - **Cascade table** (Label | Amount + % | running total "נשאר"): הכנסות (נטו) · החזרים בתקופה (if>0) · הוצאות פרסום (provenance/override flags) · עלות סחורה (COGS, effective %) · עמלות עיבוד תשלום (6.5%) · הוצאות קבועות (יחסי) · משכורות (if>0) · **רווח נטו אמיתי** (bold, green/red, margin %).
  - **By-source breakdown** (`<details>` "פירוט עלויות קבועות לפי קטגוריה"): table קטגוריה | סכום (יחסי) | % מההכנסה | % מהקבועים; rows = Shopify Plan / אפליקציה דרך Shopify / אפליקציה חיצונית / שירות אימייל / חיוב סף / חד-פעמי / אחר; grand-total row "סך הכל".

---

## TAB 9 — תשלומים (PAYMENTS / אמצעי תשלום)

**Single section, controls:** Granularity toggle (month / quarter / third) · Scope toggle (כלל-העסק / פר-חנות) · Store picker (per-store scope only).
- **Summary strip (4 cards, all history):** main "חלוקת הזמנות — כל התקופה" (X הזמנות · CAD + stacked share bar + legend אשראי/PayPal/אחר) · 3 per-gateway cards (label · orders + % · revenue).
- **States:** error (+retry) · loading (card skeleton) · empty · pre-backfill hint ("כל ההזמנות מסווגות כרגע כ'אחר / לא ידוע'" + "ממתין ל-backfill").
- **By-year accordion** (Card, "פילוח לפי שנה", max-h-62vh): one `<details>` per year (desc, latest open) — header = year · order count · CAD + share bar + per-gateway strip (orders·CAD·% × credit/PayPal/אחר) + chevron.
  - **PeriodRowsTable** (two-row header): תקופה | אשראי(3) | PayPal(3) | אחר(2) | סה״כ(2) | חלוקה; sub-headers הזמנות/CAD/% per gateway + share bar; period rows; grand-total footer ("סך הכל").
- Note: "המספרים מגיעים מ-Shopify (payment_gateway_names) על כל היסטוריית ההזמנות. 'אחר' = מתנה / manual / COD…".

---

## TAB 8 — מוצרים (PRODUCTS)

**Single section, controls:** Period SegmentedControl (יומי / שבועי / חודשי / חצי-שנתי / שנתי) · Store NativeSelect (independent: כל החנויות + stores).
- **Toolbar** (bg-pill-track): period + store + right span "X ימים · Y תקופות" / "יום אחד · DATE".
- **Summary card** (gradient): store + date range; grid (2/4/5 cols): הזמנות · יחידות (attention) · ברוטו (Money) · נטו (neutral, discount subtitle) · מוצרים שונים; daily-average row ("ממוצע ליום: X יחידות · CAD ברוטו") if days>1.
- **States:** error ("שגיאה בטעינת המוצרים") · loading (table skeleton 8 rows) · empty ("אין מוצרים שנמכרו בטווח הזה").
- **Product buckets** (per period): bucket header (live pulsing dot "חי · TIME" + label · inline metrics הזמנות/יחידות/ברוטו/נטו); live-empty state ("עוד לא נמכרו מוצרים היום…"); **products table** (2-row sticky header, max-h-70vh): מוצר | [הזמנות] | יחידות | ברוטו | [נטו] | [מרג'ין] | % יחידות — rows = rank badge + title · orders (+"×UPO" if >1.05) · units (bold) · ברוטו (Money) · נטו · מרג'ין (color-coded ≥95% green / 80–95% ink / <80% orange / <50% red) · % of bucket; "הצג עוד X מוצרים"/"הצג פחות" toggle (>5).

### Drawer/Modal — Product Picker (nested Radix Sheet, z-60 over campaign drawer, 560px / full-screen)
- Header: Package icon · "שייך מוצרי [STORE] לקמפיין" · campaign title · "מוצגים רק מוצרים מחנות: [STORE]" · close ✕.
- Search section: info text + search input ("חפש מוצר…", auto-focus); banners (catalog-not-synced warning "הקטלוג עוד לא סונכרן…"; error +retry).
- Product list: loading ("טוען מוצרים…") · empty · list (checkbox + title + "X יחידות · CAD" / "עדיין לא בוצעו מכירות" + multi-mapping chip "גם ב-N קמפיינים: …", Link2 icon).
- Footer: "N נבחרו" + ביטול (secondary) + שמור (primary, Check icon).

---

## TAB 6 — מגמות (TRENDS)

**Single section** (analysis area). Filter here affects ONLY the trend graph + annotations (monthly tables live in Archive).
1. **SectionIntro** (CalendarDays · "טווח לניתוח" · description).
2. **PageScope** card (store · range label · CAD).
3. **PageSynthesis** block (synthesis text + anchor metric + confidence).
4. **Filters** component (store + date range).
5. **SectionIntro** (TrendingUp · "מגמת ROAS לאורך זמן" · description re: one line per store, red dashed target 3.0).
6. **RoasChart** (Recharts LineChart, bare in Card): one line per visible store; X = DD/MM; Y = ROAS (auto); dashed reference line at 3.0 (`--chart-target`); RTL legend (primary store bold + swatches + "יעד 3.0" dashed legend); hover tooltip (date + per-store ROAS + heavy-refund amber warning line/ring); annotation pins (vertical dashed + label); per-store colors (brand_color token / canonical / palette); primary store thicker line; empty state "אין נתוני ROAS בטווח שבחרת".
7. **AnnotationsPanel** (collapsible): header (CalendarDays · "יומן אירועים" · subtitle "N אירועים…" · chevron). Expanded: "תעד אירוע חדש" (Plus) → inline AnnotationForm (Kind selector | Title | Date(max today) // Notes // conditional Store selector // Save/Cancel + "יסומן על הגרף"); annotation list ("אין אירועים בטווח הזה" / items: kind icon + title + date + store badge + notes + Edit/Delete).

---

## ARCHIVE (ארכיון / "טבלאות") — renders in analysis area alongside Trends

**Single section.**
1. **SectionIntro** (CalendarDays · "טבלאות חודשיות" [+ store name] · description re: ROAS bands + black "0" for spend-no-sale days).
2. **ROAS band legend** (chips): "< 2" red · "2–2.7" orange · "2.7–3" green · "> 3" blue (band-chip recipe, ranges bdi LTR).
3. Loading skeleton ("טוען טבלאות חודשיות…").
4. **PageScope** card (store · "MM/YYYY" or "YYYY" · CAD).
5. **PageSynthesis** block (suppressed on fetch error).
6. **Lifted controls row** (one row): Year selector (current ±2) · Month selector ("כל השנה" + 12 Hebrew months) · Mode SegmentedControl ("לפי חנות" / "סיכום כללי") · Store picker (per-store mode only).
7. **MonthlyTables** (descending months, current+prev open):
   - **MonthBlockPerStore:** collapsible header "{Month} {Year} • {StoreName}"; table (sticky, max-h-60vh): תאריך | [פייסבוק if hasFb] | [גוגל if hasGa] | [טיקטוק if hasTt] | יצא סה"כ/יצא | נכנס (+RefundIndicator) | ROAS (color badge, centered); one row/day (missing days muted); total row "סך הכל".
   - **MonthBlockSummary:** header "{Month} {Year} • סיכום כל החנויות ({N})"; same columns aggregated across stores; total row.

---

## TAB 10 — פירוט (DETAIL)

**Single section, data-driven (no UI controls).**
- Card header: Table icon · "פירוט יומי" · "(N שורות אחרונות)" (last 100).
- **Table** (sticky, max-h-70vh, min-width 900): תאריך · חנות · מגמת חנות (per-store ROAS sparkline 64×20px, built once/store, "—" if <2 pts) · פייסבוק · גוגל · [טיקטוק if any ttSpend>0] · סה"כ הוצאה · הכנסה (+RefundIndicator) · ROAS (color badge) · רווח גולמי · [COGS if any hasCogs] · [רווח תפעולי if showCogs, green/red by sign]. Rows sorted date desc, cap 100.
- Empty state: "אין נתונים בטווח שבחרת".
- Bare mode (CollapsibleSection): omits Card wrapper, toolbar meta + table.

---

## OPERATOR PAGE — ניהול (`/operator`, footer link — NOT a main tab)

**Header:** "ניהול" + subheading "ניהול אוטומציה: ריצות הצינור, backfill, החלפות ידניות, ו-Sync." · StatusPill (freshness % + token failures → GREEN/YELLOW/RED) · OperatorRefreshButton · OperatorSecretBanner.

**7 operator tabs (Radix underline, flat list):**

1. **בריאות (Health)** [default]
   - 1.1 בעיות טוקן (TokenFailuresTable + Resolve button).
   - 1.2 TikTok attribution disclaimer (static orange card).
   - 1.3 תקציב Meta BUC (MetaBucPanel, per ad-account).
   - 1.4 טריות נתונים (FreshnessPanel, 15s SWR): cols חנות · פלטפורמה · Scope · טבלה · סטטוס (icon) · Lag (דק׳) · ניסיון אחרון · הצלחה אחרונה · הערות; status icons CheckCircle2/AlertCircle/XCircle; synthetic "stuck (was X)" badge.
   - 1.5 התאמת מקורות (ReconcilePanel, 15s): all-clear line or violations table.
   - 1.6 כיסוי מיפוי TikTok (TikTokCoveragePanel, 15s).

2. **סנכרון (Sync)**
   - 2.1 סנכרון עכשיו (SyncNowButtons: 1 global + 3 per-store).
   - 2.2 Backfill טווח תאריכים (BackfillPicker).
   - 2.3 החלפות הוצאה ידניות (ManualOverridesCrud, 15s): add form (תאריך · חנות · פלטפורמה meta/google/tiktok · סכום · מטבע ILS/CAD/USD · הערות · "הוסף"); table (תאריך · חנות · פלטפורמה · סכום Money · מטבע · הערות · Trash2); delete-confirm Sheet modal; empty "אין רשומות…"; footer notes.

3. **פעילות (Activity)**
   - 3.1 ריצות אחרונות (RunsPanel, 20s): table job · סטטוס (StatusPill) · הצלחה אחרונה · תזמון · פרטים (הצג/הסתר → cron-tick nested table tick_id/fan_out/done/skip/fail OR JSON). Static schedule reference (cron-live ~10min, cron-daily ~00:30 IL, etc.).
   - 3.2 סטטוס אירועים (StatusEventsFeed, 15s): 50 latest; icon + relative time + store·platform·entity + entity id + "from → **to**"; empty state.
   - 3.3 סנפשוטים של cron ticks (CronTickSnapshotsViewer, 15s): table tick_id · fan_out · ✓ completed · ⚠ skipped · ✗ failed · duration; empty "אין ticks עדיין.".

4. **מסוכן (Danger)**
   - 4.1 התראות WhatsApp (WhatsappTestButtons: 3 daily sends 12:00/18:00/00:10).
   - 4.2 ניקוי וריסט (ResetData, red border, typed-token confirm modal).

5. **מצב פרסום (Ads / Ad State)** — AdStateTab: fetches /api/operator/ad-state + /api/store-meta; AdStatePanel store×platform matrix (toggle ON/OFF or "לא מחובר" + "חבר" link → Stores tab); error banner on load fail.

6. **חנויות (Stores / Credential Matrix)** — StoresTab: list view (header + "+ הוסף חנות"; StoreList credential matrix per store; RemovedStores "חנויות שהוסרו" restore/delete); wizard view (AddStoreWizard ADD/EDIT, "← חזרה לרשימה"); error banners.

7. **אבחון סיווג (Attribution Diag)** — AttributionDiagPanel (self-fetch /api/operator/attribution-diag): orders + ATC source distributions, murky-bucket breakdowns, first-touch coverage; default last 30 days; "הרץ מחדש" button.

---

## CORRECTIONS TO PRIOR MOCKUPS

Concrete mismatches the real scans reveal — fix these before any redesign:

1. **Business-state hero is NOT a giant block.** `CommandCenterHero` ("סיכום עסקי") renders as **TWO rows of compact KPI Widget tiles** (Row 1: Spend/Revenue/Operating Profit/MER; Row 2: Orders/CPM/Inventory) PLUS a separate subordinate NC-ROAS/nCAC banded tile below. Any mockup showing one large mostly-empty hero panel is wrong.

2. **Per-store comes FIRST, business-total second.** Real Home order is PerStoreRow → StoreCompareGrid → סיכום עסקי hero → RoasTargetChart → NcByPlatform → InsightsBoard+ActivityFeed. The hero is mid-page, not top.

3. **The ROAS-vs-Target chart has its OWN date-range picker**, independent of the page-level filter. Mockups that bind it to the global range are wrong.

4. **Sidebar is a flat 10-item list — no grouping.** No "Dashboards/Settings/Tools" sections, no separators between nav items. Only Brand / Nav(1–10) / Footer.

5. **Campaign drawer has exactly 6 sub-tabs** (סקירה · יומי · סטים · מודעות · סטטוס · היסטוריה), and is a **centered 880px modal** — not a side sheet. The Ads drawer (AdsDrawer) is the nested Sheet (side=end, 820px) that opens over it. Overview's "ניתוח attribution" accordion is open by default; the rest collapsed.

6. **Store card click opens StoreDetailModal**, not a direct drill to Campaigns. The modal has 7 sections (band header → KPI+delta → NC-ROAS tile → ROAS-over-time → per-platform → top campaigns → footer).

7. **Activity tab has 2 sub-tabs** (פיד חי / סטטיסטיקות). Date-range picker exists ONLY on the stats sub-tab; the feed is fixed at real-time/last-30-days. Type filter uses a Button pill set (aria-pressed), not a SegmentedControl.

8. **Operator is NOT one of the 10 tabs** — it's a footer link to `/operator`, which has its OWN 7-tab Radix bar (Health/Sync/Activity/Danger/Ads/Stores/Attribution Diag). Don't represent it as a main sidebar tab.

9. **Campaigns table has 20+ metric columns with 11 hidden by default** plus 4 pinned controls (optimization toggle, health grade, name, ROAS sparkline) + an Ads-Manager deep link. Mockups showing a handful of fixed columns understate the real density and the column-visibility menu.

10. **TopStrip is non-sticky and floats** (mt-4 rounded-full frosted bar). The AI Export button lives there but is Home-only. Mockups with a sticky full-width header bar are wrong.

11. **No giant single P&L number block** — P&L leads with 3 proportional stat cards (Revenue/Costs/Net Profit) and the detail is an expandable income-statement cascade with a per-category by-source `<details>`.

12. **Money/numbers always render through the `<Money>` primitive** (tabular-nums, compact-floor, full value in title). No raw clipped/truncated numbers; band/status colors are token-driven (no hardcoded hex). Any mockup with ad-hoc number styling or same-hue-on-hue text violates the live readability guards.
