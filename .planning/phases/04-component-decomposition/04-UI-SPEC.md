---
phase: 4
slug: component-decomposition
status: draft
shadcn_initialized: false
preset: none
created: 2026-05-18
mode: visual-regression-contract
---

# Phase 4 — UI Design Contract (Visual Regression Mode)

> **Scope qualifier:** Phase 4 is a **mechanical refactor**, not new UI design. CONTEXT.md `<domain>` is explicit: *"אסור שום שינוי התנהגותי. UI, רוויות, חישובים, סדר DOM — הכל זהה לפני ואחרי."* This document therefore inverts the standard UI-SPEC posture: every dimension below documents **what must remain identical after the refactor**, not what to design.
>
> The brand/visual system is already in production (Tailwind tokens in `dashboard-web/tailwind.config.ts`, Heebo font, RTL Hebrew copy, cool-tinted Stripe/Linear-influenced palette). There is **nothing to choose** at the visual layer. The checker, planner, executor, and auditor all consume this file as a reference for "no regression" — the contract that the post-refactor render must match byte-for-byte against the pre-refactor render.

---

## Design System

| Property | Value |
|----------|-------|
| Tool | none (no shadcn) — manual Tailwind v3 with custom token layer |
| Preset | not applicable |
| Component library | none — bespoke React components, Radix primitives are NOT in use |
| Icon library | `lucide-react ^0.469.0` |
| Font | Heebo (loaded via `next/font/google` in `src/app/layout.tsx`) |
| Layout direction | `<html lang="he" dir="rtl">` — all components inherit RTL |
| Chart library | `recharts ^2.15.0` (AreaChart, ComposedChart, Line) |

**Refactor implication:** All extracted hooks live in `dashboard-web/src/lib/hooks/` (D-01). All sub-components stay flat in `dashboard-web/src/components/` (D-02). The icon set, the font, and the Tailwind tokens MUST NOT change as part of this phase.

---

## Spacing Scale

Tailwind v3 default scale is in use (4px base unit, multiples of 4 throughout the codebase). No custom spacing extensions exist in `tailwind.config.ts`. The refactor must preserve every spacing class verbatim.

| Token | Value | Common Usage in 3 Components |
|-------|-------|------------------------------|
| `gap-1`, `gap-1.5` | 4-6px | Inline icon + label, chip internal gap |
| `gap-2`, `gap-2.5` | 8-10px | Toolbar items, KPI strip cells |
| `gap-3`, `gap-3.5` | 12-14px | KPI grid, drawer sections |
| `px-3`, `px-4`, `px-5` | 12/16/20px | Table cells, modal padding |
| `py-1.5`, `py-2`, `py-3` | 6/8/12px | Row height, toolbar height |
| `space-y-5`, `space-y-6` | 20/24px | Drawer panel stacks |

**Critical contract:** When the executor extracts JSX from parent component to sub-component, every `className="..."` string MUST be moved **verbatim** (no normalization, no `cn(...)` introduction unless already present). The 3 source files use only Tailwind utility classes — no CSS modules, no styled-components.

Exceptions: none.

---

## Typography

The codebase uses Tailwind's custom `fontSize` tokens from `tailwind.config.ts`. The 3 source components use the following type roles. Each must be reproduced exactly when JSX is lifted into sub-components.

| Role | Tailwind class | Computed size | Weight | Where it appears |
|------|---------------|---------------|--------|------------------|
| Drawer title | `text-base sm:text-lg` | 16px / 17px | `font-semibold` (600) | `CampaignDrawer` header `<h2>`, `BillingSettings` header `<h2>` |
| Section heading (h3) | `text-sm` | 14px | `font-semibold` (600) | All `<section><h3>` inside drawer + all panels |
| Body / table cell | `text-xs sm:text-sm` | 12px / 14px | default (400) | Every `<td>` in `CampaignsTable`, `AdSetTable`, billing tabs |
| KPI strip primary value | `text-sm sm:text-base` | 14px / 16px | `font-semibold` (600) `tabular-nums` | `Stat`, `DrawerStat` in `CampaignsTable` / `CampaignDrawer` |
| KPI strip secondary | `text-base sm:text-lg` | 16px / 17px | `font-bold` (700) `tabular-nums` | `AttributionGapPanel` 4-stat grid |
| Hero trust score | `text-2xl` | 24px | `font-bold` (700) `tabular-nums` | `AttributionAnalysisPanel` "ציון אמינות" + `MetaShopifyReconciliation` Pearson r |
| Inline tag (CBO/ABO) | `text-[9px]` | 9px | `font-bold` (700) `tracking-wider` | Budget-type chip next to ad-set name |
| Trust chip (in row) | `text-[8px]` | 8px | `font-bold` (700) `uppercase tracking-wider` | `CampaignsTable` ROAS Shopify column |
| Sub-label / meta | `text-[10px] sm:text-[11px]` | 10px / 11px | default (400) | "$store · $platform" line under campaign name |
| Tooltip body | `text-xs` | 12px | default (400), `tabular-nums` | Recharts custom Tooltip content |

**Critical contract:** `tabular-nums` className appears on every numeric cell (see CONVENTIONS.md §React Patterns "`tabular-nums` className on numeric cells"). The `bdi(content)` helper in `src/lib/format.ts` defaults `tabular-nums` automatically — do NOT strip it when lifting JSX.

**Critical contract:** Hebrew text inherits `direction: rtl` from the document root, but inside the AreaChart/ComposedChart Tooltip the `<div dir="rtl">` is set explicitly on the tooltip body (lines 615 + 1015 of `CampaignDrawer.tsx`). When `MetaShopifyReconciliation` and the drawer chart move into their respective sub-components, this `dir="rtl"` MUST move with the tooltip body, not be silently dropped.

---

## Color

Tokens defined in `tailwind.config.ts`. All three source components reference these via Tailwind utility classes; raw hex literals appear ONLY inside Recharts `stop` / `stroke` / `fill` props (where Tailwind classes cannot reach SVG attributes).

### Surface stack (60% dominant + 30% secondary)

| Token | Hex | Refactor-touched usage |
|-------|-----|------------------------|
| `background` | `#f6f9fc` | Page background — unaffected by Phase 4 |
| `surface` | `#ffffff` | Drawer body, modal body, table thead sticky bg, billing modal |
| `surfaceMuted` | `#f0f4f9` | Toolbar bg (`/40` overlay), table head row, drawer sub-panels |
| `surfaceSubtle` | `#fafbfd` | (not heavily used in these 3 files) |
| `border` | `#d9e2ec` | Toolbar control borders, modal edge |
| `borderSubtle` | `#e7ecf2` | Row dividers (`border-b border-borderSubtle`), section dividers |

### Accent (10% — reserved for specific signals)

| Token | Hex | Refactor-touched usage |
|-------|-----|------------------------|
| `primary` (`primary-600`) | `#0d3680` | Active tab buttons (`bg-primary text-white`), drawer header icon bg (`bg-primary/8`), sort-active column header |
| `primary/5` `/8` `/10` | translucent navy | Subtle accent backgrounds for chips + sub-panels (Shopify-plan source chip, KPI summary card gradient) |

### ROAS-semantic chips (the trust chip + ROAS pill MUST match these exact mappings)

| Tone | Bg class | Fg class | Mapped from |
|------|----------|----------|-------------|
| `green` (high trust / ROAS≥3) | `bg-roas-greenBg` (`#e8f6ed`) | `text-roas-green` (`#15803d`) | `trust.level === 'high'`, `roasLabel` `green` |
| `red` (low trust / ROAS<1) | `bg-roas-redBg` (`#fef0f0`) | `text-roas-red` (`#dc2626`) | `trust.level === 'low'`, `roasLabel` `red` |
| `orange` | `bg-roas-orangeBg` (`#fff5e3`) | `text-roas-orange` (`#d97706`) | `roasLabel` `orange` (ROAS 1.0-1.99) |
| `blue` | `bg-roas-blueBg` (`#e3ecff`) | `text-roas-blue` (`#1d4ed8`) | `roasLabel` `blue` (Google) |
| `gray` (unknown / unmapped) | `bg-surfaceMuted` (`#f0f4f9`) | `text-text-muted` (`#7a8a9a`) | `trust.level === 'unknown'`, missing mapping fallback |
| `amber` (medium trust) | `bg-amber-50` | `text-amber-700` | `trust.level === 'medium'` (NOT a `roas-*` token — uses Tailwind built-in) |

**Critical contract — Trust chip color mapping (4 levels + fallback):** Both `CampaignsTable.tsx:1340-1344` and `CampaignDrawer.tsx:1211-1215` define identical color ladders. After the refactor:
- `CampaignsTableRow.tsx` MUST own the first ladder.
- `AdSetTable.tsx` MUST own the second ladder.
- They MUST stay byte-identical to the originals.
- If a shared `TONE_BG` constant is hoisted to `@/lib/format.ts` (per existing 04-PLAN T-C), it MUST export the same 5-entry table the originals use. No silent normalization to a smaller set.

### Text ink

| Token | Hex | Usage |
|-------|-----|-------|
| `text-primary` | `#0d253d` | Body text, primary cell content |
| `text-secondary` | `#3c4858` | Toolbar labels, secondary cell |
| `text-muted` | `#7a8a9a` | Meta info, "—" placeholders, inactive cells |
| `text-subtle` | `#a8b5c2` | Subtle dividers `·` between meta items |

### Recharts SVG colors (load-bearing — these are referenced by hex, not Tailwind class)

| Color | Hex | Where |
|-------|-----|-------|
| Spend area gradient | `#dc2626` (roas-red) | `<linearGradient id="drawer-spend">` lines 590-592, `<Area stroke="#dc2626">` line 635 |
| Value area gradient | `#15803d` (roas-green) | `<linearGradient id="drawer-value">` lines 593-595, `<Area stroke="#15803d">` line 628 |
| Reconciliation Meta line | `#d97706` (amber) | `<Line dataKey="meta" stroke="#d97706">` line 1029 |
| Reconciliation Shopify line | `#15803d` (roas-green) | `<Line dataKey="shopify" stroke="#15803d">` line 1030 |
| Chart axis tick | `#7a8a9a` / `#64748b` | `tick={{ fill: '#7a8a9a' }}` line 600 (drawer chart), `'#64748b'` line 1001 (reconciliation chart) |

**Critical contract:** These hex literals MUST move with the JSX when split into sub-components. They cannot be replaced with Tailwind classes (Recharts props are SVG attributes, not className). The two `<linearGradient>` IDs `drawer-spend` and `drawer-value` are page-global SVG IDs; if a future task creates a second drawer alongside, the IDs would collide — but Phase 4 keeps a single drawer instance and these IDs stay verbatim.

Accent reserved for: active tab/button states (primary), trust chips, ROAS pill, attribution-gap "tone" callout border + bg, lag-detection banner (amber), Phase-1 recommendation chips (green/amber). **No new accent surfaces are introduced.**

---

## Copywriting Contract

D-05 is **the most load-bearing decision in CONTEXT.md** for this UI-SPEC: every Hebrew string literal moves **verbatim** with its JSX block. No translation. No normalization. No reordering of inline text. Phase 8 (i18n) is the future extraction to `strings.he.ts`; Phase 4 only relocates files.

The table below is **not exhaustive** — it documents the **invariant strings** that the checker / auditor will spot-check post-refactor. The executor's job is "every Hebrew string in source X stays byte-identical in target Y."

### Trust chip labels (drive the visual rendering — `level → label` mapping is enforced by `attributionAnalysis.ts`)

| Level | Hebrew label | Source |
|-------|--------------|--------|
| `high` | `'אמין'` | `attributionAnalysis.ts:317, 745` + `CampaignsTable.tsx:171` |
| `medium` | `'חלקי'` | `attributionAnalysis.ts:332, 382, 751, 778` + `CampaignsTable.tsx:171` |
| `low` | `'לא אמין'` | `attributionAnalysis.ts:357, 766` + `CampaignsTable.tsx:171` |
| `unknown` (no conv) | `'אין המרות'` | `attributionAnalysis.ts:294, 731` |
| `unknown` (ambiguous) | `'לא ניתן לקבוע'` | `attributionAnalysis.ts:305, 740` |
| Heuristic fallback marker | `'·מיפוי'` | `CampaignsTable.tsx:1396` (sub-label suffix next to label) |

**Critical contract:** The 4-levels + fallback success criterion (ROADMAP §Phase 4 SC#5) is fulfilled iff all 6 of these labels render correctly across the visible drawer + table after the refactor. The trust-chip rendering code in `CampaignsTable.tsx:1338-1399` MUST move byte-identical into `CampaignsTableRow.tsx`. The ad-set trust chip in `CampaignDrawer.tsx:1199-1233` MUST move byte-identical into `AdSetTable.tsx`.

### CampaignsTable — Toolbar + states

| Element | Hebrew copy | Source line |
|---------|-------------|-------------|
| Mode label | `'תצוגה:'` | line 819 |
| Mode option (campaign) | `'קמפיינים'` | line 838 |
| Mode option (adset) | `'אד-סטים'` | line 838 |
| Platform option (all) | `'כולם'` | line 864 |
| Store filter (all) | `'כל החנויות'` | line 879 |
| Custom-range reset tooltip | `'חזור לטווח הגלובלי'` | line 928 |
| Optimized counter suffix | `'מסומנים'` | line 941 |
| Clear-all action | `'נקה הכל'` | line 949 |
| Clear-all tooltip | `'הסר את כל הסימונים'` | line 947 |
| Item count suffix (campaign) | `'קמפיינים'` | line 956 |
| Item count suffix (adset) | `'אד-סטים'` | line 956 |
| Loading state | `'טוען נתוני קמפיינים…'` | line 1008 |
| Empty heading | `'אין קמפיינים פעילים בטווח הזה.'` | line 1014 |
| Empty body | `'נסה להרחיב את טווח התאריכים או לשנות פלטפורמה.'` | line 1015 |
| Error heading | `'שגיאה בטעינת קמפיינים'` | line 999 |
| Show-more action | `'הצג עוד {N}'` | line 1480 |
| Show-less action | `'הצג פחות'` | line 1475 |

### CampaignsTable — Column headers (sort order MUST be preserved)

| Column | Hebrew label | Sort key |
|--------|--------------|----------|
| (toggle col) | `aria-label="סימון אופטימיזציה"` | n/a |
| Name | `'קמפיין'` / `'אד-סט'` | `name` |
| Spend | `'הוצאה'` | `spend` |
| Budget | `'תקציב יומי'` | `budget` |
| Conv. value | `'ערך המרות'` | `conversionValue` |
| ROAS | `'ROAS'` | `roas` |
| ROAS Shopify | `'ROAS Shopify'` | `shopifyRoas` |
| Shopify value | `'ערך Shopify'` | (not sortable) |
| Shopify units | `'יח\' Shopify'` | (not sortable) |
| Conversions | `'המרות'` | `conversions` |
| CTR | `'CTR'` | `ctr` |
| CPC | `'CPC'` | `cpc` |
| CPA | `'CPA'` | `cpa` |
| (actions col) | `aria-label="פעולות"` | n/a |

**Critical contract:** The column order, the sort-key names, and the Hebrew labels MUST remain identical when JSX moves to `CampaignsTableRow.tsx`. The `<thead>` block STAYS in `CampaignsTable.tsx` (orchestration shell); only the per-row `<td>` block moves to `CampaignsTableRow.tsx`.

### CampaignsTable — AttributionGapPanel (the toolbar-adjacent callout)

| Element | Hebrew copy | Source line |
|---------|-------------|-------------|
| Section eyebrow | `'התאמת שיוך · Meta & Google ↔ Shopify'` | line 1569 |
| Stat 1 label | `'פלטפורמות מדווחות'` | line 1576 |
| Stat 2 label | `'Shopify בפועל'` | line 1589 |
| Stat 3 label | `'פער (Shopify − Platforms)'` | line 1602 |
| Stat 4 label | `'יחס אמינות'` | line 1620 |
| Stat 4 subtext | `'Platforms ÷ Shopify'` | line 1628 |
| Interpretation lead | `'משמעות:'` | line 1634 |
| Interpretation copy (3 branches) | See `CampaignsTable.tsx:779-794` — 3 long Hebrew interpretations for `gap<10%` / `gap>10% under` / `gap>10% over` | lines 779-794 |

This panel stays inside `CampaignsTable.tsx` orchestration shell (it's a top-of-table summary that consumes `aggregated` + `dailyRows` from the orchestrator's scope). It does NOT split into its own file per CONTEXT D-04b (line cap is a target, not a hard one).

### CampaignDrawer — Hero + KPI

| Element | Hebrew copy | Source line |
|---------|-------------|-------------|
| Title fallback | `'(ללא שם)'` | line 526 |
| Active-days suffix | `'ימים פעילים'` | line 535 |
| Close button aria-label | `'סגור'` | line 543 |
| External link label | `'פתח ב-{platform} Ads Manager'` | line 555 |
| KPI: ROAS | `'ROAS'` | line 563 |
| KPI: Spend | `'הוצאה'` | line 564 |
| KPI: Value | `'ערך המרות'` | line 565 |
| KPI: Conversions | `'המרות'` | line 566 |
| Secondary: CTR | `'CTR'` | line 571 |
| Secondary: CPC | `'CPC'` | line 572 |
| Secondary: CPA | `'CPA'` | line 573 |
| Footer hint | `'לחץ Esc או על הרקע לסגירה'` | line 1247 |

### CampaignDrawer — Daily trend chart section

| Element | Hebrew copy | Source line |
|---------|-------------|-------------|
| Section heading | `'הוצאה ↔ ערך המרות לאורך הזמן'` | line 582 |
| Tooltip: spend | `'הוצאה:'` | line 619 |
| Tooltip: value | `'ערך המרות:'` | line 620 |
| Legend: value | `'ערך המרות'` | line 645 |
| Legend: spend | `'הוצאה'` | line 649 |

### CampaignDrawer — Mapped-products section (stays in shell, not split)

| Element | Hebrew copy | Source line |
|---------|-------------|-------------|
| Section heading | `'מוצרי Shopify משויכים'` | line 668 |
| Edit action (has mappings) | `'ערוך מיפוי'` | line 681 |
| Edit action (no mappings) | `'שייך מוצרים'` | line 681 |
| Empty body | `'לא משויכים מוצרים. לאחר שיוך, ה-ROAS יחושב מחדש לפי מכירות Shopify אמיתיות במקום ערך ההמרה ש-Meta דיווח (לרוב מנופח).'` | lines 685-688 |

### CampaignDrawer — AttributionAnalysisPanel (extracted in T-D)

| Element | Hebrew copy | Source line |
|---------|-------------|-------------|
| Section heading | `'ניתוח attribution'` | line 758 |
| Score label | `'ציון אמינות'` | line 765 |
| Score suffix | `'/100'` (numeric, but inline) | line 768 |
| Det ROAS label | `'ROAS אמיתי (click-id)'` | line 775 |
| Det ROAS interval prefix | `'טווח 95%:'` | line 781 |
| Meta ROAS label | `'ROAS לפי Meta'` | line 786 |
| Meta value suffix | `'מדווח'` | line 791 |
| Breakdown: tagged | `'click-id מתויג: {N} הזמנות (CAD {X})'` | line 802 |
| Breakdown: modeled | `'modeled: CAD {X}'` | line 803 |
| Recommendation lead | `'💡 המלצה:'` | line 833 |
| Stability label prefix | `'יציבות ({N} שבועות):'` | line 842 |
| Stability verdicts | `'יציב'` / `'מעורב'` / `'תנודתי'` | line 843 |
| Stability suffix | `'(σ={X}%)'` | line 844 |
| Outlier label | `'{N} ימי spike מ-Meta (modeled)'` | line 849 |

### CampaignDrawer — ProductChannelBreakdown (Phase 1 section, extracted in T-F)

| Element | Hebrew copy | Source line |
|---------|-------------|-------------|
| Section heading | `'מכירות לפי ערוץ של המוצרים המשויכים'` | line 876 |
| Section tooltip (on heading) | `'סיגנל זה משלים את ה-trust chip. הוא מודד \'מאיפה הגיעו הקונים של המוצרים המשויכים\' גם כש-utm_id חסר.'` | line 875 |
| Summary line | `'{N} הזמנות של מוצרים משויכים · CAD {X} סה"כ'` | line 882 |
| Bar breakdown | `'פייסבוק: {N} · גוגל: {N} · ישיר: {N} · אחר: {N}'` | line 888 |
| Recommendation (green ≥60%) | `'💡 {N}% מהמכירות הגיעו מפייסבוק → ביטחון להעלאת תקציב הקמפיין'` | lines 907-910 |
| Recommendation (amber <30% + ≥5 orders) | `'⚠️ רק {N}% מהמכירות הגיעו מפייסבוק → ייתכן שהקמפיין לא הוא המניע — בדוק לפני העלאת תקציב'` | lines 915-918 |

### CampaignDrawer — MetaShopifyReconciliation (extracted in T-E)

| Element | Hebrew copy | Source line |
|---------|-------------|-------------|
| Section heading | `'Meta מול Shopify — מתאם יומי'` | line 936 |
| Pearson label | `'מתאם (Pearson r)'` | line 942 |
| Interpretation (r≥0.7) | `'מתאם גבוה. Meta תופס את הטרנדים נכון. אם יש פער במספרים — סביר שזה bias קבוע (view-through credit, halo). החלטות גידול תקציב על בסיס מגמות Meta אמינות.'` | lines 959-962 |
| Interpretation (0.3≤r<0.7) | `'מתאם חלקי. Meta תופס חלק מהתנועות אבל יש ימים שהוא חורג. התעלם מ-Meta ברמת יום בודד, התייחס רק לאגרגציה של 7+ ימים.'` | lines 969-971 |
| Interpretation (r<0.3) | `'אין מתאם. Meta מדווח על המרות שלא מופיעות ב-Shopify. או שהמיפוי לא מלא (חסרים מוצרים), או שיש over-attribution אגרסיבי. אל תקבל החלטות על בסיס המרות Meta של הקמפיין הזה.'` | lines 977-980 |
| Lag banner (positive) | `'זוהה lag של {N} ימים: Meta מדווח על המרה {N} ימים לפני שהמכירה מופיעה ב-Shopify (חלון attribution).'` | lines 989-991 |
| Lag banner (negative) | `'Shopify מקדים את Meta ב-{N} ימים — לא טיפוסי, בדוק.'` | line 992 |
| Tooltip: Meta | `'Meta: CAD {X}'` | line 1019 |
| Tooltip: Shopify | `'Shopify: CAD {X}'` | line 1023 |
| Legend: Meta | `'Meta (מדווח)'` | line 1037 |
| Legend: Shopify | `'Shopify (בפועל)'` | line 1041 |
| Day-by-day disclosure | `'יום-לפי-יום ↓'` | line 1047 |
| Day-by-day table cols | `'תאריך'` / `'Meta'` / `'Shopify'` / `'פער'` | lines 1053-1056 |

### CampaignDrawer — AdSetTable (extracted in T-G)

| Element | Hebrew copy | Source line |
|---------|-------------|-------------|
| Section heading | `'אד-סטים ({N})'` | line 1094 |
| Col: name | `'שם'` | line 1109 |
| Col: spend | `'הוצאה'` | line 1110 |
| Col: budget | `'תקציב יומי'` | line 1111 |
| Col: value | `'ערך'` | line 1112 |
| Col: ROAS | `'ROAS'` | line 1113 |
| Col: ROAS Shopify | `'ROAS Shopify'` | line 1118 |
| Col: conversions | `'המרות'` | line 1120 |
| Toggle tooltip (off) | `'סמן כאופטימיזציה בוצעה'` | line 1174 |
| Toggle tooltip (on) | `'לחץ להסרת הסימון'` | line 1174 |
| Row hover hint | `'לחץ לראות את המודעות באד-סט'` | line 1155 |
| Trust tooltip header | `'ROAS אמיתי · {label} ({score}/100)'` | line 1217 |

### BillingSettings — Modal shell + tabs

| Element | Hebrew copy | Source line |
|---------|-------------|-------------|
| Trigger button label | `'עלויות חודשיות'` | line 211 |
| Trigger tooltip | `'הגדרות עלויות חודשיות'` | line 208 |
| Trigger subtitle | `'({N} פעילות · CAD {X})'` | line 213 |
| Modal title | `'עלויות חודשיות'` | line 235 |
| Modal subtitle | `'Shopify plan, אפליקציות, שירותים — מתעדכנים ב-P&L האמיתי'` | line 238 |
| Close aria-label | `'סגור'` | line 245 |
| Tab: recurring | `'חודשי קבוע'` | line 254 |
| Tab: onetime | `'חד-פעמיים'` | line 255 |
| Tab: import | `'ייבא CSV מ-Shopify'` | line 256 |

**Critical contract:** The 3 tabs render in **exactly this order**: recurring → onetime → import. The `<nav>` mapping at line 252-275 MUST stay in `BillingSettings.tsx` shell. Tab content panels (`RecurringTab`, `OneTimeTab`, `BillingCsvImport`) are mounted by the shell via the `tab` state.

### BillingSettings — Auto-detect plan callout (stays in RecurringTab; not in this phase's split)

| Element | Hebrew copy | Source line |
|---------|-------------|-------------|
| Plan-error heading | `'זיהוי אוטומטי של תוכניות Shopify נכשל'` | line 423 |
| Plan-detect heading | `'זיהינו אוטומטית תוכניות Shopify'` | line 467 |
| Plan-detect add-all | `'הוסף את כולן ({N})'` | line 474 |

These strings stay verbatim wherever `RecurringTab` ends up living (per existing 04-PLAN T-J fallback discussion, `RecurringTab` may move to `BillingRecurringTab.tsx` if the shell still exceeds 500 lines — D-04 permits this).

---

## DOM Structural Invariants (Visual Regression Anchors)

This is the **highest-leverage section of the contract**. The checker and auditor look here first when validating that the refactor preserved every panel and every order.

### CampaignsTable — Top-down DOM order

After refactor, the orchestration shell renders in this exact sequence:

1. `toolbar` — mode tabs (campaign | adset) → platform tabs (all | Meta | Google) → store select → date range (from / to / reset) → optimized counter (conditional) → row count (`{N} קמפיינים`)
2. `<AttributionGapPanel gap={attributionGap} />` — the 4-stat callout (stays in shell)
3. `summary` — 6-stat KPI strip (ROAS / הוצאה / ערך המרות / המרות / קליקים / CTR) + footer trio (CPC · CPA · חשיפות)
4. Error block (conditional) — red-bg AlertCircle + "שגיאה בטעינת קמפיינים"
5. Loading block (conditional) — "טוען נתוני קמפיינים…"
6. Empty block (conditional) — Megaphone icon + "אין קמפיינים פעילים בטווח הזה."
7. `<table>` (conditional) — `<thead>` 14-col + `<tbody>{display.map(a => <CampaignsTableRow ... />)}`
8. Show-more footer (conditional) — chevron + count
9. `<CampaignDrawer ... />` (conditional mount)
10. `<AdsDrawer ... />` (conditional mount)

**Invariant:** The shell renders these exactly in this order. No new elements are introduced between blocks during refactor. `<CampaignsTableRow>` replaces the inline `(a, i) => { ... return <tr>...</tr>; }` IIFE at lines 1145-1461.

### CampaignDrawer — Top-down DOM order (inside the `<aside>`)

After refactor, the drawer shell renders these sections in this exact sequence:

1. `<header>` (sticky) — Megaphone icon → `<h2>` campaign name → meta line (store · platform · `{N} ימים פעילים`) → close button → `<a>` "פתח ב-{platform} Ads Manager"
2. **KPI row** (4-col grid) — ROAS / הוצאה / ערך המרות / המרות
3. **Secondary metrics** (3-col grid) — CTR / CPC / CPA
4. **Daily trend chart** `<section>` (conditional `summary.dailyArr.length >= 2`) — heading "הוצאה ↔ ערך המרות לאורך הזמן" + AreaChart + 2-item legend
5. **Mapped products** `<section>` (conditional `summary.platform === 'Meta'`) — "מוצרי Shopify משויכים" + edit button + chip list OR empty body
6. **`<AttributionAnalysisPanel ... />`** (conditional non-null from `analyzeAttribution`)
7. **`<ProductChannelBreakdown breakdown={...} />`** (conditional `productChannelBreakdown && ...`)
8. **`<MetaShopifyReconciliation reconciliation={...} />`** (conditional `reconciliation && ...`)
9. **`<AdSetTable adSets={sortedAdSets} ... />`** (conditional `summary.adSets.length > 0`)
10. Footer hint — "לחץ Esc או על הרקע לסגירה"
11. `<ProductPickerModal ... />` (always mounted, conditional open via prop)
12. `<AdsDrawer ... />` (conditional mount inside drawer)

**Critical invariant — panel order:** Items 6 → 7 → 8 → 9 (AttributionAnalysis → ProductChannelBreakdown → MetaShopifyReconciliation → AdSetTable) MUST appear in this order. ROADMAP Phase 4 SC #6 names "3 panels (attribution / channel-breakdown / reconciliation)" — this contract pins them to positions 6, 7, 8 in the drawer DOM. Reordering during extraction is forbidden.

### BillingSettings — Modal DOM order

1. Trigger pill (outside modal) — Settings icon + "עלויות חודשיות" + count subtitle
2. Backdrop + modal shell (conditional `open`)
3. `<header>` — Receipt icon + "עלויות חודשיות" + subtitle + close button
4. `<nav>` tabs — recurring → onetime → import (this order)
5. Body — exactly one of: `<RecurringTab>` / `<OneTimeTab>` / `<BillingCsvImport>`

**Critical invariant:** Tab content is mounted conditionally via the `tab` state value; only ONE tab body is in the DOM at a time. The refactor must preserve this mount-style (do NOT switch to `display: none` hidden tabs, which would change React unmount behavior + lose form state).

---

## Components (Inventory + Responsibilities)

This table is the contract the planner and executor use to verify the right boundary was extracted.

| File (post-refactor) | Owns visual element | Receives via props |
|----------------------|---------------------|---------------------|
| `CampaignsTable.tsx` (≤500 lines) | toolbar, KPI summary, AttributionGapPanel, table thead, table empty/error/loading states, drawer + ads drawer mount | (none — orchestrator) |
| `CampaignsTableRow.tsx` | one `<tr>` with 14 `<td>` cells: toggle, name+meta+CBO/ABO chip, spend, budget, value, ROAS pill, ROAS Shopify trust chip, Shopify value, Shopify units, conversions, CTR, CPC, CPA, external link | `a`, `i`, `mode`, `trueRevenueByKey`, `adAccounts`, `optimized`, `onToggleOptimized`, `onDrillCampaign`, `onDrillAd` |
| `CampaignDrawer.tsx` (≤500 lines) | aside shell, sticky header, KPI rows, daily trend chart, mapped-products section, productMap state, drill-into-ads state | (top-level: rows, campaignId, open, onClose, adAccounts, rangeFrom, rangeTo) |
| `AttributionAnalysisPanel.tsx` | trust verdict callout — score header, det/meta ROAS row, breakdown bar, reasons list, recommendation, stability + outlier footer | `summary`, `campaignId`, `storeId`, `orderRows`, `rangeFrom`, `rangeTo` |
| `MetaShopifyReconciliation.tsx` | Pearson r header, interpretation paragraph (3 branches), lag-detection banner, line chart, day-by-day disclosure table | `reconciliation` (ReconciliationData object) |
| `ProductChannelBreakdown.tsx` | Phase 1 channel breakdown — heading, summary line, 4-segment bar, recommendation chip (green or amber) | `breakdown` (analyzeProductChannel result) |
| `AdSetTable.tsx` | ad-sets table with 7 col sort headers, per-row optimization toggle, drill-to-ads on click, per-ad-set ROAS Shopify trust chip | `adSets`, `sortKey`, `sortDir`, `onSort`, `attributionByAdSet`, `optimized`, `onToggleOptimized`, `onDrillAds` |
| `BillingSettings.tsx` (≤500 lines) | modal shell, header, tab nav, tab routing (recurring/onetime/import), Shopify-plan auto-detect SWR fetch | `storeNames` |
| `BillingCsvImport.tsx` | CSV import surface — paste textarea, file dropper, parse + preview table, per-row override (store / source / amount), confirm button | `storeNames`, `currentRecurring`, `onImported` |

**Critical contract:** Sub-components are **dumb / presentational**. They do NOT read from localStorage, do NOT subscribe to `roas-*-changed` events, do NOT call `useSWR`. All state lives in the parent / shell. The hooks (`useCampaignTrueRevenue`, `useCampaignAttribution`, `useBillingRecurring`, `useBillingOneTime`) are the ONLY places that consume state-management primitives, and they're called from the orchestration shells.

---

## Interaction Contracts (Wiring That Must Stay Identical)

These behaviors are checked during manual smoke (D-03). Every one of them needs the exact event wire it has today.

### CampaignsTable interactions

| Action | Trigger | Expected behavior |
|--------|---------|-------------------|
| Click row (campaign mode) | `<tr onClick>` | `setDrillCampaignId(a.campaignId)` + `setDrillPlatform(a.platform)` → CampaignDrawer opens |
| Click row (adset mode, Meta only) | `<tr onClick>` | `setAdDrill({storeId, campaignId, adSetId, adSetName})` → AdsDrawer opens |
| Click row (adset mode, Google) | `<tr onClick>` | no-op (canDrillToAds false) |
| Click optimization toggle | `<button onClick stopPropagation>` | `toggleOptimized(a.key)` → updates `Set<string>` → persists via `lib/campaignOptimized` → dispatches `roas-campaign-optimized-changed` |
| Click external link icon | `<a onClick stopPropagation>` | opens `buildAdsManagerLink(...)` in new tab; does NOT trigger row drill |
| Click sort header | `SortHeader onClick` | toggles dir if same key, else switches key + resets dir to `desc` (or `asc` for name col) + collapses showAll |
| Click "Show more / less" | bottom button | toggles `showAll` |
| Type in date range | `<input type="date" onChange>` | clamps to today, normalizes from > to or to < from, sets `localRange` |

### CampaignDrawer interactions

| Action | Trigger | Expected behavior |
|--------|---------|-------------------|
| Esc key | `useDrawerEsc(open, onClose)` | closes only the topmost drawer (drawer stack pattern — WR-01) |
| Click backdrop | `<div onClick={onClose}>` | closes drawer |
| Click close button | `<button onClick={onClose}>` | closes drawer |
| Click "פתח ב-{platform} Ads Manager" | `<a target="_blank">` | opens deep link in new tab |
| Click "ערוך מיפוי" / "שייך מוצרים" | `<button onClick={() => setPickerOpen(true)}>` | opens `ProductPickerModal` |
| Click ad-set sort header | `AdSetSortHeader onClick` | toggles dir or switches key (drawer-local state) |
| Click ad-set toggle | `<button onClick stopPropagation>` | toggles optimized for `markKey = storeId::platform::campaignId::adSetId` |
| Click ad-set row (Meta only, has id) | `<tr onClick>` | `setAdDrillSet({...})` → AdsDrawer opens NESTED over the drawer |
| Open day-by-day disclosure | `<details><summary>` | native browser disclosure — toggles open state |

**Critical contract — IN5-01 visual consequence:** `analyzeAttributionForAdSet` is called inside `useMemo` in `CampaignDrawer.tsx:299-326`, NOT inside `.map(...)` of the AdSetTable row. After refactor:
- `AdSetTable.tsx` receives `attributionByAdSet: Map<key, AttributionAnalysis | null>` as a prop.
- It looks up via `attributionByAdSet.get(key)` per row — no recomputation per render.
- If a future refactor accidentally moves `analyzeAttributionForAdSet` inside the row map, the visual symptom is chip flicker on sort + opacity flash during scroll (because trust score recomputes on every render frame).
- The checker MUST grep `AdSetTable.tsx` and verify zero direct calls to `analyzeAttributionForAdSet`.

### BillingSettings interactions

| Action | Trigger | Expected behavior |
|--------|---------|-------------------|
| Click trigger pill | `<button onClick={() => setOpen(true)}>` | opens modal |
| Click backdrop | `<div onClick={() => setOpen(false)}>` | closes modal |
| Click close button | `<button onClick={() => setOpen(false)}>` | closes modal |
| Click tab | `<button onClick={() => setTab(t.key)}>` | switches active tab → mounts corresponding tab content |
| Edit recurring row → save | `<button onClick>` (inside RecurringTab) | `onChange(next)` → `persistRecurring(next)` → `writeRecurring` → dispatches `roas-billing-changed` → cloud sync |
| Edit onetime row → save | `<button onClick>` (inside OneTimeTab) | `onChange(next)` → `persistOneTime(next)` → `writeOneTime` → dispatches `roas-billing-changed` → cloud sync |
| Paste CSV / drop file | `<textarea onChange>` / `<input type="file">` | parses → `setPreview(...)` → renders preview table |
| Per-row override in preview | per-cell `onChange` | `setPreview(prev => prev.map(...))` |
| Click "Confirm import" | preview confirm button | builds new recurring/onetime arrays → calls `onImported(newRec, newOne, destination)` → shell merges + persists + switches to `destination` tab |

**Critical contract — Custom event wiring:** Both `writeRecurring` and `writeOneTime` (in `dashboard-web/src/lib/billing.ts:79`) dispatch the SAME event name: `'roas-billing-changed'`. **The pre-existing 04-PLAN.md T-I description that references `'roas-billing-onetime-changed'` is incorrect — no such event exists in the codebase.** After refactor:
- `useBillingRecurring` listens to `'roas-billing-changed'` and re-reads recurring.
- `useBillingOneTime` listens to `'roas-billing-changed'` and re-reads onetime.
- Both hooks listen to the SAME event. Either both re-read on any billing write (acceptable), or each hook filters by its own STATE_KEY check before re-reading (optimization, not required for correctness).
- The cloud-sync layer in `cloudSync.ts:58-66` confirms BOTH `billing-recurring` and `billing-onetime` map to `'roas-billing-changed'` — this is the single source of truth.

---

## Empty States, Loading States, Error States (Visual Inventory)

The refactor must preserve every conditional render branch. The table below enumerates each.

### CampaignsTable

| State | Trigger | Rendered output |
|-------|---------|-----------------|
| Loading | `isLoading === true` | "טוען נתוני קמפיינים…" centered |
| Error | `error \|\| data?.error` | red AlertCircle + heading "שגיאה בטעינת קמפיינים" + error message |
| Empty | `data && !error && aggregated.length === 0` | Megaphone icon + 2-line empty copy |
| AttributionGap null | `attributionGap === null` | panel hidden entirely |
| Toolbar: optimized counter | `optimized.size > 0` | CheckCircle2 + count + clear-all button (otherwise hidden) |
| Toolbar: range reset | `isCustomRange === true` | X button (otherwise hidden) |
| Row: trust chip fallback | `info.attribution === null \|\| attrUnknown` | mapping-based chip with `·מיפוי` suffix |
| Row: trust chip primary | `info.attribution !== null && trust.level !== 'unknown'` | click-id-based chip with `·{N}` suffix |
| Row: Shopify ROAS empty | `!info` for that campaignKey | "—" placeholder with tooltip about no mapping |
| Show-more footer | `aggregated.length > TOP_N_DEFAULT (10)` | chevron + remaining count |

### CampaignDrawer

| State | Trigger | Rendered output |
|-------|---------|-----------------|
| Closed | `!open \|\| !summary` | `return null` — no DOM |
| Open shell | `open && summary` | full aside |
| Daily chart hidden | `summary.dailyArr.length < 2` | section hidden entirely |
| Mapped products: empty | `mappedIds.length === 0` | empty body paragraph |
| Mapped products: list | `mappedIds.length > 0` | wrap of `<li>` chips |
| AttributionAnalysisPanel | `analysis === null` | section hidden entirely (panel returns null) |
| ProductChannelBreakdown | `productChannelBreakdown === null` | section hidden (covers Google + unmapped + <3 orders) |
| ProductChannelBreakdown: recommendation chip | `facebookShare >= 0.6` → green chip; `facebookShare < 0.3 && total >= 5` → amber chip; else no chip | conditional per chip |
| MetaShopifyReconciliation | `reconciliation === null` | section hidden (covers <5 days or no mapping or Google) |
| MetaShopifyReconciliation: lag banner | `bestLag !== 0 && abs(bestR) > abs(r) + 0.1` | amber banner (otherwise hidden) |
| AdSet table | `summary.adSets.length === 0` | section hidden |
| AdSet row: trust chip empty | `attributionByAdSet.get(key) === null` | "—" |
| AdSet row: canDrillToAds | `platform === 'Meta' && a.id` | cursor-pointer + onClick wired; else no-op |

### BillingSettings

| State | Trigger | Rendered output |
|-------|---------|-----------------|
| Closed | `!open` | only trigger pill |
| Open modal | `open === true` | backdrop + shell |
| Tab: recurring | `tab === 'recurring'` | RecurringTab mounted |
| Tab: onetime | `tab === 'onetime'` | OneTimeTab mounted |
| Tab: import | `tab === 'import'` | BillingCsvImport mounted |
| Plan-error callout | `planErrorStores.length > 0` | amber callout with per-store error lines |
| Plan-detect callout | `missingDetected.length > 0` | primary-tinted callout with add buttons |
| Plan-detect: bulk add | `missingDetected.length > 1` | "הוסף את כולן" button (otherwise hidden) |
| CSV preview empty | `preview.length === 0` | (no preview table) |
| CSV preview rows | `preview.length > 0` | per-row override grid |

---

## Manual Smoke Checklist (D-03 Per-Task Verification)

This checklist is what the executor visually verifies after each Phase 4 task lands. The verifier reuses it at phase close. **All items must pass before the task is marked done.**

### After every T-* task

- [ ] `npm run build` — green (TypeScript catches missing exports / type drift)
- [ ] `npm run test` — green (84 Phase 2 tests catch logic regressions in `lib/`)
- [ ] `wc -l` on the host file (CampaignsTable / CampaignDrawer / BillingSettings) shows expected reduction
- [ ] No new lint warnings (`next lint`)

### After T-A (useCampaignTrueRevenue extracted)

- [ ] CampaignsTable still renders 14 columns including trust chip
- [ ] Trust chip shows 4 levels — pick 4 different campaigns whose data spans `high` / `medium` / `low` / `unknown`. Each chip color matches the contract table above.
- [ ] `·{N}` suffix appears for click-id chips, `·מיפוי` suffix for fallback chips
- [ ] Shopify value column shows CAD numbers when a campaign has a mapping; "—" otherwise

### After T-B (useCampaignAttribution extracted)

- [ ] Drawer opens on row click
- [ ] AdSet table per-row trust chip renders correctly with no flicker on sort change
- [ ] Sort the ad-sets by spend, then by ROAS — chips stay stable, do not recompute (IN5-01 visual symptom)

### After T-C (CampaignsTableRow extracted)

- [ ] Row hover bg-surfaceMuted appears
- [ ] Optimized rows render at opacity 0.5; hover restores to 1.0
- [ ] Row 1-based index shows in the leading 5×5 circle
- [ ] CBO/ABO chip appears next to Meta ad-set/campaign names (NOT for Google)
- [ ] Click row → drawer opens; click toggle → no row click; click external link → no row click
- [ ] Click in campaign mode → campaign drawer; click in adset mode on Meta → ads drawer; click in adset mode on Google → no-op
- [ ] Trust chip 4 levels + fallback all visible across the table

### After T-D (AttributionAnalysisPanel extracted)

- [ ] Drawer shows the trust verdict callout below mapped products
- [ ] Score 0-100 number renders with `/100` suffix in tabular-nums
- [ ] Breakdown bar (det/modeled) renders only when `summary.value > 0`
- [ ] 95% interval renders only when `analysis.roasInterval !== null`
- [ ] Recommendation `💡 המלצה:` appears when present
- [ ] Stability + outlier footer appears when `windowStability || outlierDays.length > 0`

### After T-E (MetaShopifyReconciliation extracted)

- [ ] Drawer section "Meta מול Shopify — מתאם יומי" still appears (post-AttributionPanel, post-ProductChannelBreakdown)
- [ ] Pearson r shown with 2 decimals, color-coded by abs(r) (green ≥0.7, amber 0.3-0.7, red <0.3)
- [ ] One of 3 interpretation paragraphs renders based on r value
- [ ] Lag-detection banner appears ONLY when `bestLag !== 0 && abs(bestR) > abs(r) + 0.1`
- [ ] ComposedChart renders Meta line (amber) + Shopify line (green)
- [ ] "יום-לפי-יום ↓" expands → 4-column table with date / Meta / Shopify / פער%

### After T-F (ProductChannelBreakdown extracted)

- [ ] Section appears between AttributionAnalysisPanel and MetaShopifyReconciliation in the drawer DOM
- [ ] 4-segment bar shows blue (facebook) / amber (google) / muted (direct) / subtle (other)
- [ ] Green chip "ביטחון להעלאת תקציב הקמפיין" appears when `facebookShare >= 0.6`
- [ ] Amber chip "ייתכן שהקמפיין לא הוא המניע" appears when `facebookShare < 0.3 && total >= 5`
- [ ] Section is hidden for Google campaigns AND for unmapped Meta campaigns AND when `total < 3`

### After T-G (AdSetTable extracted)

- [ ] Section "אד-סטים ({N})" renders at the bottom of the drawer
- [ ] 7-column header with sort triangles
- [ ] Click sort header → toggles direction, then click different header → switches + dir=desc
- [ ] Per-row optimization toggle works (and the same key marks in CampaignsTable also reflect)
- [ ] Click ad-set row (Meta with id) → AdsDrawer mounts NESTED over the campaign drawer
- [ ] Esc closes only the topmost drawer (drawer stack contract)
- [ ] Per-ad-set ROAS Shopify trust chip color matches `attributionByAdSet.get(key).trust.level`

### After T-H + T-I (useBillingRecurring + useBillingOneTime extracted)

- [ ] Trigger pill subtitle "{N} פעילות · CAD {X}" shows correct counts
- [ ] Open modal → 3 tabs render in order: חודשי קבוע → חד-פעמיים → ייבא CSV מ-Shopify
- [ ] Switch to onetime tab → edits persist via `writeOneTime` → reload page → data still there
- [ ] Edit a recurring row in BillingSettings, then check that another component listening to `roas-billing-changed` (e.g., P&L card) also re-reads — verifies the event still fires from `lib/billing.ts:79`
- [ ] Open the auto-detect callout (if missing plans exist) → "הוסף" button works → row appears in recurring list
- [ ] Cloud sync — partner makes a recurring edit from another device → 30s poll re-hydrates → list updates

### After T-J (BillingCsvImport extracted)

- [ ] Paste a Shopify Bills CSV → preview table renders with per-row override
- [ ] Per-row override (store / source / amount) updates the preview row only
- [ ] Click "Confirm" → rows merge into the correct tab (recurring vs onetime) → modal switches to the destination tab automatically
- [ ] Recurring entries with matching pre-existing rows are flagged (no double-add)

### Phase-wide final smoke (after all tasks)

- [ ] Open dashboard fresh — Campaigns tab renders without errors
- [ ] Pick a campaign with: spend > 0, mapping present, click-id data present → drawer shows all 4 sub-panels in order (Attribution → ChannelBreakdown → Reconciliation → AdSetTable)
- [ ] Pick a Google campaign → drawer shows: KPI / chart / NO mapped-products / NO Attribution / NO ChannelBreakdown / NO Reconciliation / AdSetTable only
- [ ] Pick a Meta campaign with < 5 days of data → Reconciliation section HIDDEN (effectiveN gate)
- [ ] Pick a Meta campaign with mapping but < 3 mapped orders → ChannelBreakdown HIDDEN (threshold gate)
- [ ] BillingSettings → 3 tabs work → CSV import works → cloud sync still works
- [ ] Switch range from 30d to 7d → all chips + numbers + chart re-compute (memo deps still complete)
- [ ] Drill into ad-set, then close that drawer with Esc — only that drawer closes, the campaign drawer stays open (WR-01)

---

## Registry Safety

| Registry | Blocks Used | Safety Gate |
|----------|-------------|-------------|
| (none — no shadcn, no third-party registry) | not applicable | not required |

shadcn was not initialized for this project; the design system is bespoke Tailwind + custom tokens. Phase 4 introduces zero new external dependencies. The registry vetting gate is not applicable. No `npm install` is expected as part of this phase.

---

## Out-of-Scope (Defended Boundaries)

Per CONTEXT.md `<deferred>`:

- New tests for extracted hooks → deferred to Phase 7 (D-03b)
- Visual regression tooling (Playwright/Storybook) → rejected — manual smoke is the regression net
- `components/` subdirectory reorganization → deferred indefinitely (D-02)
- i18n extraction to `strings.he.ts` → Phase 8 (D-05 says Phase 4 only relocates Hebrew strings byte-identical)
- Splitting other large components (Dashboard, ProductsTable, AdsDrawer) → not Phase 4 scope

---

## Checker Sign-Off

The standard 6 dimensions are reframed for visual-regression mode. The checker validates that the contract above is internally consistent and that the implementation will not introduce visual change.

- [ ] Dimension 1 Copywriting: PASS — every Hebrew string in source is captured verbatim in this contract; the executor has a checkable reference
- [ ] Dimension 2 Visuals: PASS — DOM order pinned for all 3 hosts; sub-component boundaries match existing 04-PLAN artifacts list
- [ ] Dimension 3 Color: PASS — Tailwind token usage is documented; ROAS-semantic 5-tone table is the trust chip's only source of truth
- [ ] Dimension 4 Typography: PASS — text-xs / text-sm / text-base / text-lg / text-2xl roles are unchanged; tabular-nums on numeric cells is preserved by `format.ts`
- [ ] Dimension 5 Spacing: PASS — all Tailwind utility classes move verbatim; no custom spacing introduced
- [ ] Dimension 6 Registry Safety: PASS — no registry; no new dependencies; not applicable

**Approval:** pending
