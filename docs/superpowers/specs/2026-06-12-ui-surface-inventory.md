# מיפוי-עומק של משטח-ה-UI — יסוד הרי-דיזיין

**תאריך:** 2026-06-12 · **שיטה:** 7 סוכני-סריקה מקביליים + בודק-שלמות (8 סוכנים, 292 קריאות-כלים, run `wf_929d2d94-88e`) · **כיסוי:** 211 קומפוננטות, כל claim עם file-path

מסמך-עבודה לעיצוב-העומק: כל טאב/מגירה/מודאל/גרף/פרימיטיב, מה הוא מרנדר, על אילו פרימיטיבים הוא נשען, ומה החוב-העיצובי שלו.

## חוב-עיצובי חוצה-פרוסות (מהבודק — הגרוע קודם)

- ROAS-band rendering is forked in at least 7 places inside the LOCKED color system (worst — correctness-visible): home-tab found 5 parallel band→style maps (useRoasBandGradient canonical vs RoasTargetChart.bandClassForRoas vs StoreCompareGrid.PILL_TONE_CLASS vs roasCell.ROAS_TONE_BG vs ChannelTruthPanel's private 3-band scale that DROPS the 2.7 orange boundary and blue band — src/components/home/ChannelTruthPanel.tsx); campaigns-tab found AdsDrawer.tsx:667 still on the pre-2026-06-01 pale full-cell tint while every sibling uses the solid badge; trends found the band legend encoded as Hebrew prose instead of RoasBadge chips (AnalysisArchiveTab.tsx SectionIntro); charts-primitives found three separate chip systems (ui/Badge vs .band-chip vs .band-tag/.fresh-chip in globals.css). Consolidate to ONE band module + ONE chip primitive before any reskin or the locked red/orange/green/blue system forks again.
- Hand-rolled overlays/popovers/confirms bypass the Radix Sheet/Dialog standard in every slice — the exact incident class the project already logged twice (ProductPickerModal 2026-06-03, ColumnHeaderTh portal): shell (mobile Sidebar drawer, CommandPalette modal, SyncIndicator error popover — src/components/Sidebar.tsx/CommandPalette.tsx/SyncIndicator.tsx), home (AiReportButton fixed overlay, no Esc/focus-trap/drawerStack — src/components/AiReportButton.tsx), campaigns (CampaignsColumnsMenu absolute panel + HealthScoreBadge popover clippable inside overflow-auto — CampaignsColumnsMenu.tsx, HealthScoreBadge.tsx), trends/misc (SavedViewsDropdown manual pointerdown panel in Filters.tsx; BillingSettings.tsx translate-hacking a bottom Sheet into a centered dialog), operator (ManualOverridesCrud.tsx:377 + ResetData.tsx:253 hand-rolled inset-0 confirm divs vs RemovedStores.tsx:236 doing it right), plus native window.confirm in TabFreshnessHeader.tsx and alert() in TokenFailuresTable.tsx — the app's least-themed moments sit on its most destructive actions.
- The 'numbers never clip' <Money>/<Metric> guarantee is non-hermetic in 5 of 7 slices: raw formatCurrency/fmtMoney/toFixed strings in AdsDrawer/AdSetTable/CohortComparisonPanel/MetaShopifyReconciliation/AttributionGapPanel (campaigns), MonthlyTables/DetailTable/ProductCentricView/BillingSettings/BillingCsvImport (trends), ManualOverridesCrud + mono count strings in CronTickSnapshotsViewer/JobsTable/MetaBucPanel (operator), CommandCenterHero's 7 private formatters with hardcoded en-US/'$' + RoasTargetChart KPI tiles (home), and the unscanned PnLBreakdown.tsx hand-prepending text-[10px] CAD spans (lines 431/615). Any column tightening in the redesign will clip 7-digit values exactly where the mandate forbids it; extend moneyPrimitiveGuard to ratchet these files.
- No shared SegmentedControl primitive — the same toggle pattern is hand-rolled 12+ times with different active-state treatments: shell's 3 switcher visuals (desktop preset Buttons / mobile sliding-thumb pill bar in Filters.tsx / Products divide-x rail in Dashboard.tsx), customers' 3 ghost-Button radiogroups missing arrow-key a11y (CustomerValueTab.tsx, PaymentMethodsTab.tsx), trends' six (MonthlyTables, CogsSettings/SalarySettings rails, BillingSettings tab nav, BillingCsvImport sub-44px micro-toggle), charts' 3 more (CampaignDrawerDaily, CampaignsTable CPM panel, ActivityStatsTab) — every call-site fights Button defaults with h-auto/px-2/text-[10px] overrides, the same missing-small-variant gymnastics home-tab flagged on Card (!p-* overrides in PerStoreRow/StoreDetailModal).
- Micro-typography anarchy with no type-ramp token in ALL seven slices: text-[8px] uppercase trust chips below any legibility floor (AdSetTable.tsx:274, AdsDrawer.tsx:702), 9px chips + 10px headers in the most cramped surface (ProductCentricView.tsx), text-[9px]→[15.5px] arbitrary pixel sizes across customers/payments, shell kbd hints and SectionIntro page copy at 11px, home's text-[50px]/[60px]/[10.5px]/[13.5px], 9px Recharts axis ticks (MetaShopifyReconciliation.tsx), PnLBreakdown's text-[10px]/[11px] throughout — the project's own AA standard sets a floor the inventory shows is breached on every tab; the redesign needs a tokenized ramp plus a guard.
- Large duplicated UI blocks guaranteed to diverge: ~250-line CPM chart assembly ×2 (CampaignsTable.tsx:1783-1913 vs campaign-drawer/CampaignDrawerDaily.tsx:303-433, margins already differ); 3 sparkline engines (ui/Sparkline.tsx vs NetSparkline+MiniSparkline inlined in home/CommandCenterHero.tsx with Math.random ids + raw oklch); 3 sort-header clones (SortHeader/AdSortHeader/AdSetSortHeader); accent-gradient collapsible header ×3 (InsightsBoard/ActionListPanel/AnnotationsPanel); activity-event presentation ×3 (ActivityFeed/ActivityEventsTab/ActivityStatsTab); NC-ROAS tile ×2 (CommandCenterHero vs StoreDetailModal); COGS/Salary settings byte-copies already diverging on <Money> (CogsSettings.tsx vs SalarySettings.tsx); SOURCE_LABEL ×2 (PnLBreakdown.tsx:73 + BillingSettings.tsx); GRADE_STYLES ×2 (HealthScoreBadge/HealthScorePanel); error-strip/accordion/ShareBar duplicates across CustomerValueTab/PaymentMethodsTab. Extract shared components BEFORE restyling or every fix lands twice.
- Secondary states are far below Home polish everywhere: ONE Home-shaped loading skeleton lies about all 10 tab layouts (Dashboard.tsx) while MonthlyTables/ProductCentricView/ProductsTable and every operator panel degrade to bare 'טוען…' text; 4 divergent error-card designs in campaigns (two without retry); charts have no shared empty state (RoasChart returns null and the section vanishes vs em-dash vs axes-only frame vs gray conic donut); freshness/staleness desaturation exists only on Home cards — customers/payments financial data and the entire operator console render stale data indistinguishably from live (CustomerValueTab has only CohortAsOfBadge, a THIRD freshness idiom beside FreshnessChip/FreshnessBadge); operator SWR fetchers swallow !res.ok into false-calm empty states.
- The visual system lives in a 2017-line globals.css monolith coupled to TSX by string class hooks and to CI by regex: the vivid band-card look is .v/.banded/.sl/.sv/.cell selector ladders resolved ~1500 lines from PerStoreRow/StoreDetailModal (which fakes Card with className='glass per-store-card'); dead-but-kept rules, !important overrides, repeated rgba(0,0,0,.22) scrim literals, legacy '.glass' naming for opaque mesh surfaces; FocusMode targets the rail by Hebrew aria-label, sticky offsets hardcode header height (top-[3.25rem] in MobileStickyRoas), Recharts margin constants hand-mirrored into ChartAnnotationPins overlays, z-index magic ladder z-[15]/20/30/40/50/[60] alongside drawerStack; and contrastGuard/themeParity/chartTokens parse globals.css with format-fragile regexes — the redesign must port guards FIRST and migrate band styling into typed component variants or every reskin step risks silent breakage.
- Token misuse and palette leakage across domains: PayPal colored with the locked Meta brand token bg-chart-meta (PaymentMethodsTab.tsx ShareBar + PeriodRowsTable — retuning Meta blue recolors PayPal); BillingSettings maps chips to text tokens as backgrounds (bg-ink-muted text-ink-secondary); arbitrary-value escapes bg-[color:var(--surface-sunken)] (MetaBucPanel/TikTokCoveragePanel); FALLBACK_PALETTE raw hexes bypass theming (lib/storeColors.ts); CohortGridAdvanced tints its heatmap with operational --status-green instead of a data-viz ramp; two-to-three competing chart-ink token families between Recharts and hand-SVG engines (--chart-axis remapped by ChartContainer vs --chart-grid-line/--text-subtle in RoasTargetChart/CustomerValueCurve). New domains need their own token groups (gateway palette, data-viz ramp, single chart-ink set).
- Header/section/navigation anatomy diverges per tab: TabHeader (hero Heading + filter/action slots + AI-report access) is Home-only while every other tab fakes an H1 with SectionIntro; Filters silently loses compare-baseline and saved-views off Home (showCompareBaseline/showSavedViews default false in Filters.tsx) exactly where comparisons matter most; the operator console has NO shell at all (no sidebar, no route back, useState-only tabs, all 7 panels polling simultaneously — src/app/operator/) plus a flattened hero-Heading-with-inline-explainer repeated 12+ times and 5 distinct thead treatments; FreshnessChip mounts twice simultaneously in the dashboard shell. Pick one header primitive, one Filters capability set, and one table-header recipe and roll them everywhere.
- HelpTooltip is simultaneously overloaded and abused: the richest data ships as giant \n-concatenated ASCII-aligned plain strings (campaigns ROAS-Shopify breakdowns), ~19 solid-violet ⓘ triggers crowd a single thead (ColumnHeaderTh in CampaignsTable.tsx), HelpTooltip wraps non-phrasing <tr>/<td> in at least 6 spots (CampaignsTableRow.tsx:238, AdsDrawer.tsx:644, CohortComparisonPanel.tsx:189, ProductCentricView, 3 operator tables) leaning on the phrasing.ts escape hatch, the customers curve uses a faint outline '?' contradicting the operator-locked solid-ⓘ standard (commit 7452b9b), and tooltip/popover chrome is rebuilt 5× with radius drift (ChartTooltip, RoasTargetChart crosshair, ChartAnnotationPins bubble, CustomerValueCurve card, RichPopover family).
- Iconography is split between lucide and emoji/raw glyphs in data surfaces across 5 slices: 🥇🥈🥉/🔗/🏪/⏳/💡/⚠️ in campaigns (CohortComparisonPanel, ProductPickerModal, CampaignsTableRow chips), 💰 pins/⚠️/▼◀/✓✗ on Home (AnnotationsPanel, InsightsBoard), 🥇/🔗/⚠️/⬅️ in trends-products (ProductCentricView, BillingCsvImport), ✓/⚠️ in operator (ReconcilePanel), plus a static non-rotating '▸' expander (CustomerValueTab advanced card) one level above rotating-chevron accordions — RTL/bidi-fragile and off-brand against the lucide system; note charts-primitives flags the emoji annotation-pin glyphs as a LOCKED exception to preserve.
- Operator-console Button-variant bypass mirrors Home's missing-variant gymnastics: 6+ components repaint variant=ghost via token classNames instead of semantic variants — SyncNowButtons (bg-accent), WhatsappTestButtons (bg-status-greenBtn + armed orange ring), ResetData (bg-status-redBtn/orangeBtn) while the destructive variant exists unused, TokenFailuresTable resolve pill, OperatorSecretBanner — and raw <input type=checkbox> persists in BackfillPicker/ManualOverridesCrud/AddStoreWizard with no Checkbox primitive. Same root cause as home-tab's chip-size Button/Card-padding gap: the primitive API is missing variants, so call-sites mutate instead.

## משטחים שנשמטו מהסריקה הראשית (הושלמו ע"י הבודק)

- PnLBreakdown — /Users/dorperetz/script-roas/dashboard-web/src/components/PnLBreakdown.tsx (641 lines) — the MAIN content of the P&L tab, rendered at Dashboard.tsx:1768 between GoalTracker and the settings stack. Every slice assumed another slice owned it: trends-archive-misc explicitly said 'GoalTracker/PnLBreakdown belong to another slice', home-tab only inventoried GoalTracker, charts-primitives gave it a one-phrase chart-adjacent mention ('gradient header+bar'). Never inventoried: bespoke raw <section rounded-2xl bg-glass-1 border-glass-edge shadow-glass> (NOT the Card primitive, line 246), accent-gradient hero header (bg-gradient-to-br from-accent-bg, line 251), 3× private HeroStat tiles (line 516, tone bars bg-status-green/red), PnLLine cascade rows (line 563) with hand-prepended text-[10px] 'CAD' spans bypassing <Money> (lines 431, 615), provenance warning banner (bg-status-warningBg, line 315), collapsed <details> by-source fixed-costs table with raw <tr>/<th> markup (lines 439-503), SOURCE_LABEL map (line 73) that trends slice noted is duplicated in BillingSettings, and text-[10px]/[11px] micro-type throughout — i.e. it carries most of the cross-cutting debt themes and is the single biggest unscanned surface.
- SourceBadge — /Users/dorperetz/script-roas/dashboard-web/src/components/ui/SourceBadge.tsx — per-event attribution badge primitive used by home/ActivityFeed.tsx and activity/ActivityEventsTab.tsx (classify-v2 T3). Appears in NO tree (home-tab tree lists 'EventRow list' without it; charts-primitives' primitive layer omits it). Visually load-bearing for the redesign: paid sources = FILLED glowing dot + solid glass chip, organic = hollow RING dot + outline chip, composed from PlatformBadge + chart-platform brand tokens, plus a secondary muted 'קליק ראשון: {platform}' first-touch lens chip; renders nothing for null/'' sources. Has its own dom test (home/__tests__/activityFeedSourceBadge.dom.test.tsx).
- /dev/primitives showcase route — /Users/dorperetz/script-roas/dashboard-web/src/app/dev/primitives/page.tsx — a real navigable page rendering EVERY src/components/ui/* export in all key variants (RTL, Hebrew labels, one <hr>-separated section per primitive with stable section IDs). Mentioned only as a Playwright target name ('states.spec /dev/primitives') in the charts-primitives guard layer, never inventoried as a UI surface. A visual redesign MUST update this page in lock-step with primitive changes or the visual-regression gate (tests/visual/states.spec.ts primitives.png) silently goes stale; it also intentionally excludes network primitives (StatusPill, OperatorRefreshButton), so those have NO snapshot coverage.
- CampaignDrawer shim — /Users/dorperetz/script-roas/dashboard-web/src/components/CampaignDrawer.tsx — not a visual surface (pure re-export of campaign-drawer/index.tsx preserving the old import path after the Wave-5 6-sub-tab split), but absent from all trees; flagged so the redesign doesn't style/delete the wrong file — Dashboard.tsx and CampaignsTable.tsx still import through it.
- PnL tab full composition — no single tree shows the actual P&L tab assembly order (Dashboard.tsx:1746-1800: SectionIntro 'הרווח שלך לתקופה' with formula prop → PageScope → PageSynthesis(synthesizePnl) → Filters → GoalTracker → PnLBreakdown → right-aligned BillingSettings trigger → CogsSettings → SalarySettings). The tab was split three ways (GoalTracker in home-tab tree, settings stack in trends-archive-misc, PnLBreakdown nowhere), so the redesign has no holistic picture of the app's only money-statement page. Note SectionIntro's 'formula' prop is used only here — an unscanned SectionIntro variant.

---

# מעטפת וניווט (shell-nav) — 31 קומפוננטות

## עץ-המשטח

```
App shell (src/app/layout.tsx — html[dir=rtl][data-theme], Heebo/Rubik/GeistMono fonts, pre-paint theme script, ThemeProvider > TooltipProvider > ErrorBoundary)
	Login page (app/login/page.tsx — bg-canvas centered)
		LoginForm (glass Card: gradient logo mark, password Input, error line, submit Button)
	Dashboard root (components/Dashboard.tsx — div[dir=rtl] bg-canvas flex)
		Sidebar (right rail in RTL, dark surface both themes)
			Desktop icon-rail 72px → hover/pin expand 220px (⌘\ toggle)
				Brand block (violet gradient logo + "דשבורד ROAS")
				Nav (10 tab Buttons: בית/פעילות/לקוחות/טבלאות אופטימיזציה/P&L/מגמות/קמפיינים/מוצרים/תשלומים/פירוט) + RailTooltip (⌘N hints, collapsed only)
				Footer: /operator Link (ניהול) · theme toggle (Monitor/Sun/Moon icon trio) · LogoutButton · pin toggle
			Mobile off-canvas drawer (< md, hand-rolled: bg-scrim backdrop + slide-in solid bg-canvas-1 panel, X close)
		Main column
			CloudSync (invisible, 30s cloud-state poll)
			FocusMode (invisible, ⌘\ → dims rail+header via globals.css [data-focus-mode])
			Top header strip (sticky z-30, glass-1/85 + backdrop-blur, border-b)
				Mobile hamburger Button (md:hidden)
				FreshnessChip (green/yellow/red/gray "עודכן לפני X דק׳" pill)
				CommandPalette trigger pill (חיפוש + ⌘K kbd) → full-screen scrim + Card modal (search Input, 6 grouped sections, kbd footer hints)
				SyncIndicator (sync OK/שומר…/שגיאה pill → hand-rolled error popover)
			<main> (max-w-7xl)
				Degraded-data banner (role=alert, red, named failing sources) [conditional]
				Loading skeleton (1 hero block + 6 card blocks) [isLoading]
				TabFreshnessHeader row (FreshnessChip + "מרענן…" toast chip + רענן הכל Button + window.confirm) + SourceHealthChip (red per store×platform badges) [conditional]
				ReconcileBanner (warning Card, home only) [conditional]
				Active tab content (View-Transition cross-fade switch):
					home → MobileStickyRoas (mobile sticky headline) · TabHeader(title+Filters+AiReportButton) · PageScope · …
					pnl/campaigns/products/detail/trends → SectionIntro · PageScope · (PageSynthesis) · Filters · content
					products → bespoke inline sub-tab segmented control (טבלה/פיבוט)
					activity/customers/payments/archive → own components (other slices)
				Filters bar (Card: ⚡ quick-range pills [desktop buttons / mobile sliding-thumb pill bar], store NativeSelect, 📅 range chip, טווחים נוספים toggle → secondary presets + custom date Inputs, בסיס השוואה pill row [Home only], SavedViewsDropdown תצוגות שמורות [Home only])
				Footer (עדכון אחרון timestamp · "מתעדכן אוטומטית כל 2 דקות")
	ErrorBoundary crash card (full-screen centered glass card, נסה שוב/רענן דף)
```

## חוב-עיצובי בפרוסה (הגרוע קודם)

- P1 keyboard-shortcut collision: ⌘/Ctrl+\ is bound by BOTH Sidebar pin-toggle (Sidebar.tsx:411) and FocusMode chrome-dim (FocusMode.tsx:13) — two document-level listeners fire on one keypress, so pinning the rail also fades the sidebar+header to 30% opacity. One of the two must move (and RailTooltip advertises ⌘\ for the pin).
- Four hand-rolled overlay/popover patterns bypass the Radix Sheet/Dialog standard the rest of the app converged on: mobile Sidebar drawer, CommandPalette modal, SyncIndicator error popover, SavedViewsDropdown panel — no focus traps, manual scroll-locks/z-index choreography (z-20/30/40/50), and the project already has a logged incident class ('modal over a Sheet must be Radix') these invite.
- Two competing page-header systems: TabHeader (hero Heading + border + filter/action slots) is used ONLY by Home; P&L/Campaigns/Products/Detail use SectionIntro as a pseudo-H1 — so title scale, AI-report access, and header anatomy differ tab-to-tab. A redesign should pick one header primitive and roll it to all 10 tabs.
- Filter-bar capability silently varies by tab: compare-baseline pills and saved views (תצוגות שמורות) mount only on Home (opt-in props default false); other tabs get a stripped Filters with no comparison basis and no saved views — operator loses tooling on the very tabs (Campaigns, P&L) where comparisons matter.
- Native window.confirm() in TabFreshnessHeader ('רענן הכל') is the lowest-polish moment in the shell — an unthemed browser dialog carrying 6 lines of RTL Hebrew copy; FreshnessChip is also mounted twice simultaneously (header strip + per-tab header) showing the same value.
- Three different segmented/tab-switcher visuals coexist: desktop preset Buttons, the mobile sliding-thumb pill bar (bespoke thumb math + dedicated pill tokens), and the Products inline divide-x sub-tab rail — none share the ui/Tabs primitive.
- Magic-number coupling in the sticky stack: header strip height (py-2 ≈ 3.25rem) is hardcoded as MobileStickyRoas's top-[3.25rem]; sidebar widths are inline 72/220px styles; FocusMode CSS targets the rail via its Hebrew aria-label string — all break silently on refactor.
- Single Home-shaped loading skeleton serves all 10 tabs, and the CommandPalette trigger (the only search affordance) is unmounted until /api/data resolves — initial load and error states degrade navigation.
- Micro-typography sprawl in the shell: bespoke text-[9px]/[10px]/[11px]/[13px]/text-2xs sprinkled across chips, kbd hints, descriptions and footers instead of a type-scale token; SectionIntro carries paragraph-length page copy at 11px.
- Misc consistency nits: FreshnessChip hand-rolls a pill instead of using Badge; ErrorBoundary hand-rolls its card instead of Card; ReconcileBanner uses a raw <a> with var(--accent-link); degraded banner builds its border from inline color-mix; PageScope looks like a breadcrumb but is fully inert; RailTooltip promises ⌘1-⌘10 tab shortcuts that are not implemented anywhere; SyncIndicator's Supabase-down state shows amber while still reading 'sync OK'.

## קומפוננטות

### RootLayout · `primitive`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/app/layout.tsx
- **משטח-אב:** app shell (wraps everything)
- **ויזואלית:** html[lang=he][dir=rtl] + body font-sans antialiased text-ink bg-canvas. Loads Heebo (UI), Rubik (tabular numerals — real tnum), Geist Mono as CSS vars. Inline pre-paint script sets data-theme from localStorage 'roas-theme' / OS preference (dark fallback on error). Mounts ThemeProvider > TooltipProvider(delay 200/skip 300) > ErrorBoundary.
- **פרימיטיבים:** ThemeProvider, TooltipProvider (Radix root), ErrorBoundary
- **חוב:** viewport themeColor hardcodes raw hex (#0a0c1d dark / #f3f4f8 light) with a code comment admitting light is 'provisional… will be reconciled with the real light canvas token in a later phase' — browser chrome tint can drift from the actual canvas token.

### Dashboard (shell root + tab switcher) · `nav`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/Dashboard.tsx
- **משטח-אב:** page.tsx → app shell
- **ויזואלית:** div[dir=rtl] min-h-screen bg-canvas flex: Sidebar (start/right) + main column (sticky header strip + max-w-7xl main). Owns activeTab state (10 TabKeys), URL sync (replaceState), popstate reconcile, View-Transitions cross-fade on tab switch (useTabTransition, 180ms cubic-bezier tuned in globals.css), coordinated 120s auto-refresh of all SWR keys, IL-midnight range rollover.
- **פרימיטיבים:** Sidebar, CloudSync, FocusMode, FreshnessChip, CommandPalette, SyncIndicator, TabFreshnessHeader, SourceHealthChip, ReconcileBanner, Button, Footer
- **חוב:** 2050-line god-file: tab switcher + 5 inline tab components (HomeTab/PnLTab/CampaignsTab/ProductsTab/DetailTab) + Footer all live here. Tab-content mount is a chain of `activeTab === 'x' &&` conditionals, not a primitive. Header strip + error banner + skeleton are bespoke inline markup.

### Top header strip (inline) · `nav`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/Dashboard.tsx (lines 728-762)
- **משטח-אב:** Dashboard main column
- **ויזואלית:** sticky top-0 z-30 bg-glass-1/85 backdrop-blur-xl border-b border-glass-edge px-4 py-2. RTL: mobile hamburger (secondary icon Button, md:hidden) on start side; FreshnessChip + CommandPalette trigger + SyncIndicator grouped at the end. Very slim (~3.25rem).
- **פרימיטיבים:** Button (secondary/icon), FreshnessChip, CommandPalette, SyncIndicator
- **חוב:** Not a named component — anonymous JSX in Dashboard.tsx. Its height is a magic number other components depend on (MobileStickyRoas hardcodes top-[3.25rem] 'sticky top-0 z-30, py-2 ≈ 3.25rem'). No page title/brand on desktop (brand only in rail). CommandPalette trigger only renders once `data` resolves — search/⌘K trigger invisible during initial load and on fetch error.

### Sidebar (desktop rail + mobile drawer host) · `nav`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/Sidebar.tsx
- **משטח-אב:** Dashboard root, right edge (RTL start)
- **ויזואלית:** Desktop: sticky h-screen aside, DARK surface in BOTH themes via --sidebar (#15182a) / --sidebar-fg (#8b91ad) / --sidebar-fg-active (#fff) tokens; width animates 72↔220px (inline style + transition-[width] duration-200 ease-out) on 200ms hover-intent or pin. Mobile: hand-rolled off-canvas drawer — fixed inset-0 bg-scrim backdrop-blur-sm backdrop (z-40) + fixed start-0 w-64 solid bg-canvas-1 panel (z-50) sliding translate-x-full↔0, manual documentElement overflow-hidden scroll lock, role=dialog aria-modal.
- **פרימיטיבים:** SidebarBody, Button, useSidebarPin (localStorage), cn
- **חוב:** P1 SHORTCUT COLLISION: Sidebar binds ⌘/Ctrl+\ for pin toggle (line 411) AND FocusMode.tsx binds the SAME ⌘/Ctrl+\ to dim chrome (line 13) — both document-level listeners fire on one keypress, so toggling the pin also fades the rail to 30% opacity. Mobile drawer is hand-rolled, not the Radix Sheet primitive (violates the project's 'modal must be Radix' convention; no focus trap). Width is hardcoded inline px (72/220), not tokens. Sidebar colors are raw hex in globals.css (tokenized but identical in both theme blocks — light theme never re-skins the rail).

### SidebarBody (nav items + footer controls + theme toggle) · `nav`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/Sidebar.tsx (lines 95-338)
- **משטח-אב:** Sidebar (desktop rail + mobile drawer)
- **ויזואלית:** Brand block (7×7 violet gradient square from --sidebar-logo-1/2 + 'דשבורד ROAS' text) · nav role=tablist of 10 ghost Buttons (16px lucide icon + Hebrew label, truncate min-w-0; collapsed = centered icon-only); active = accent 22% color-mix tint + white text + ring-1 ring-glass-edge · footer: /operator Cog Link, theme-toggle trio (Monitor/Sun/Moon icon Buttons, active gets railActive accent tint), LogoutButton, pin toggle (Pin/PinOff glyph swap). Three computed class bundles (railText/railHover/railActive) branch desktop-dark vs mobile-canvas.
- **פרימיטיבים:** Button (ghost), Link, HelpTooltip (via RailTooltip), LogoutButton, useTheme, lucide icons
- **חוב:** Heavy bespoke color-mix() utility strings inline ('bg-[color-mix(in_oklab,var(--accent)_22%,transparent)]' etc.) with a long comment explaining a tailwind-merge fight against the ghost Button's own hover — the active-state styling is a workaround, not a variant. Theme toggle is 3 unlabeled 14px icon buttons with no visible grouping/segmented control; in collapsed rail they stack vertically with no tooltips (RailTooltip not applied to them). role=tablist on the nav but tabs are Buttons navigating an app-level switch — aria-selected without aria-controls.

### RailTooltip · `primitive`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/Sidebar.tsx (lines 57-87)
- **משטח-אב:** Sidebar collapsed rail
- **ויזואלית:** HelpTooltip(variant=text, side=left) wrapper showing label + ⌘N shortcut in <bdi dir=ltr> font-mono text-2xs, only when collapsed; expanded = passthrough (content null).
- **פרימיטיבים:** HelpTooltip
- **חוב:** Advertises ⌘1-⌘10 shortcuts in tooltips but no keydown handler anywhere registers ⌘N tab switching — the hints promise a shortcut that does not exist (grep: no numeric-key listener in Dashboard/Sidebar/CommandPalette).

### LogoutButton · `primitive`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/LogoutButton.tsx
- **משטח-אב:** Sidebar footer
- **ויזואלית:** Ghost Button, LogOut icon 16px + 'התנתק' label (label hidden when collapsed). Inherits railText/railHover class strings via props so it reads on the dark rail. POSTs /api/logout then hard-navigates '/'; busy state only disables.
- **פרימיטיבים:** Button (ghost)
- **חוב:** Style injection via railText/railHover string props is a leaky pattern — the parent passes raw className fragments instead of the component exposing a surface variant. No loading spinner during the logout POST (just disabled).

### ThemeProvider · `primitive`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/ThemeProvider.tsx
- **משטח-אב:** app shell (layout.tsx)
- **ויזואלית:** Non-visual context: choice ('system'|'light'|'dark', localStorage) + resolved paint value; writes data-theme on <html>; live matchMedia listener for OS changes. SSR baseline = dark (matches bootstrap script fallback).
- **פרימיטיבים:** lib/theme (readStoredTheme/resolveTheme/writeStoredTheme)
- **חוב:** None significant — clean. Theme switching UI is scattered though: Sidebar footer trio + 3 CommandPalette commands, with no single 'appearance' surface.

### FreshnessChip · `chip`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/FreshnessChip.tsx
- **משטח-אב:** Top header strip AND TabFreshnessHeader (mounted twice per page)
- **ויזואלית:** inline-flex px-2 py-1 rounded-md ring-1 tabular-nums text-[11px]/xs pill. 4 tones from status tokens: green '<20min עודכן לפני X דק׳', yellow 20-60min (+AlertCircle 11px), red >60min / absolute DD/MM HH:MM, gray 'אין נתונים'. 30s self-tick; HelpTooltip shows absolute cron write time (Asia/Jerusalem).
- **פרימיטיבים:** HelpTooltip, status-*Bg/Fg tokens
- **חוב:** Rendered TWICE simultaneously (header strip line 748 + TabFreshnessHeader line 72) showing the identical value — visual duplication a redesign should consolidate. Bespoke template-string class assembly rather than the Badge primitive used by sibling chips (SourceHealthChip uses Badge; this one hand-rolls the same pill anatomy).

### SyncIndicator · `chip`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/SyncIndicator.tsx
- **משטח-אב:** Top header strip
- **ויזואלית:** Ghost Button pill (Cloud/CloudOff/spinning RefreshCw 13px + label, label hidden <sm). 4 states: neutral glass 'שומר N…' (syncing), red destructive-token 'sync שגיאה', amber warning 'sync OK' (Supabase down), green 'sync OK'. Error click opens a hand-rolled absolute popover (w-80, bg-glass-1 shadow-overlay): red AlertTriangle tile, font-mono error text, Hebrew checklist (Service Account Editor? env vars?), 'נסה שוב' link Button. aria-live polite on the label.
- **פרימיטיבים:** Button (ghost, link), HelpTooltip, status tokens, useSWR /api/health (30s)
- **חוב:** Error popover is a hand-rolled absolute div (z-50) — not Radix/Sheet, no focus management, no outside-click dismiss (only re-click of the pill). Label mixes Latin 'sync' into Hebrew copy. The amber state confusingly reads 'sync OK' while signalling Supabase is DOWN — tone and text disagree.

### CommandPalette (⌘K) · `modal`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/CommandPalette.tsx
- **משטח-אב:** Top header strip (trigger) → full-screen overlay (modal)
- **ויזואלית:** Trigger: ghost Button pill (Search 14px + 'חיפוש' + ⌘K kbd chip, bg-glass-2 border-glass-edge). Modal: fixed inset-0 z-50 bg-scrim backdrop-blur-md, Card max-w-xl !p-0 !shadow-sheet animate-fade-in-up at 8-12vh from top; search Input row with X close; 55-60vh scroll list of 6 GroupedSections (ניווט/טווח זמן/חנות/קמפיינים 30d/מוצרים 30d/פעולות) — each row ghost Button with 6×6 icon tile (accent-soft when active), title + tiny subtitle, active = bg-accent-bg; footer hint bar with ↑↓/↵/esc kbd chips + Sparkles result count. Empty state 'אין תוצאות עבור …'. <bdi dir=ltr> wraps all Latin names. Lazy warm-cache fetch of campaigns/products on first open; ESC via shared drawer stack.
- **פרימיטיבים:** Card, Button, Input, HelpTooltip, useDrawerEsc, useSWR, lucide icons
- **חוב:** Hand-rolled modal (fixed div + stopPropagation), not the Sheet/Radix primitive — no focus trap or aria-activedescendant; arrow-key listener is window-level. role=dialog sits on the Card with aria-label in English ('Command Palette'). kbd chips are bespoke text-[9px]/[10px] micro-type. Trigger pill duplicates Input-like styling rather than a shared 'fake search field' primitive. Mounted only when data loaded (see header strip debt).

### CloudSync · `primitive`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/CloudSync.tsx
- **משטח-אב:** Dashboard main column (invisible)
- **ויזואלית:** Renders null. Hydrates localStorage state from cloud on mount + every 30s + window focus.
- **פרימיטיבים:** lib/cloudSync
- **חוב:** None visual.

### FocusMode · `primitive`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/FocusMode.tsx (+ globals.css 1044-1052)
- **משטח-אב:** Dashboard main column (invisible) → CSS dims aside[aria-label=ניווט ראשי] + header[role=banner] to opacity .3
- **ויזואלית:** Renders null; ⌘/Ctrl+\ toggles data-focus-mode='on' on <html>; CSS also display:none's any [data-focus-hide=true].
- **פרימיטיבים:** globals.css attribute selectors
- **חוב:** Same P1 collision as Sidebar: shares ⌘\ with the sidebar pin toggle, so the screen-share dim and the pin always co-trigger. CSS targets the sidebar by its Hebrew aria-label string ('aside[aria-label="ניווט ראשי"]') — renaming the label silently breaks the feature. No visible affordance/indicator that focus mode is on.

### Degraded-data error banner · `card`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/Dashboard.tsx (lines 773-797)
- **משטח-אב:** main column, above all tabs (conditional: SWR error / 200-with-error / orders fetch fail)
- **ויזואלית:** role=alert rounded-xl bg-status-redBg p-4, border = inline color-mix(status-red 30%); AlertCircle 20px + bold 'שגיאה בטעינת הנתונים' + per-source detail lines naming /api/data and /api/orders-attribution with raw error message text.
- **פרימיטיבים:** status-red tokens, lucide AlertCircle
- **חוב:** Bespoke inline markup (not Card/Badge); border via raw color-mix utility instead of a token; raw API paths + English error strings rendered to the operator inside Hebrew copy with no bdi isolation.

### Loading skeleton · `primitive`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/Dashboard.tsx (lines 799-809, .skeleton @ globals.css:981)
- **משטח-אב:** main column (isLoading)
- **ויזואלית:** animate-fade-in: one h-40/48 rounded-2xl block + 6 h-28/36 rounded-xl blocks in a 2/3/6-col grid; sr-only 'טוען נתונים…'.
- **פרימיטיבים:** .skeleton CSS class
- **חוב:** One Home-shaped skeleton serves ALL 10 tabs — deep-linking to e.g. תשלומים flashes a hero+6-KPI ghost that matches nothing on the destination. Skeleton is not a reusable <Skeleton> primitive; shape duplicated ad hoc.

### TabFreshnessHeader (+ refresh confirm + progress toast) · `chip`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/TabFreshnessHeader.tsx
- **משטח-אב:** main column, above every tab
- **ויזואלית:** flex justify-between row: FreshnessChip + (while refreshing) amber role=status toast chip 'מרענן את כל הדשבורד... ייקח 60-120 שניות' with spinning RefreshCw; end side = secondary sm 'רענן הכל' Button (spinner when busy) wrapped in HelpTooltip. Click → native window.confirm() multi-line Hebrew cost warning before firing sync-now for all stores.
- **פרימיטיבים:** FreshnessChip, Button, HelpTooltip, useDashboardRefresh, useStores
- **חוב:** window.confirm() is the single lowest-polish surface in the shell — unthemed, un-RTL-styled browser dialog carrying 6 lines of Hebrew copy; should be a Sheet/dialog primitive. The 'toast' is an inline chip, not a toast system (the app has none — grep shows only here + operator ResetData). Second FreshnessChip duplication (see FreshnessChip).

### SourceHealthChip · `chip`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/home/SourceHealthChip.tsx
- **משטח-אב:** main column, beside TabFreshnessHeader (all tabs); hidden while healthy
- **ויזואלית:** inline-flex wrap of red Badge pills '● <platform> · <status> · 6h' (<bdi dir=ltr>), each wrapped in HelpTooltip pointing to /operator. Self-fetches /api/freshness-summary every 15s, soft-fails to hidden.
- **פרימיטיבים:** Badge (tone=red), HelpTooltip, fetchJsonOrNull
- **חוב:** Lives in components/home/ but is mounted shell-wide on every tab — misfiled. cursor-help on a Badge that isn't actionable (tooltip says go to /operator but the chip itself is not a link).

### ReconcileBanner · `card`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/home/ReconcileBanner.tsx
- **משטח-אב:** Home tab only, above hero; hidden unless material violations
- **ויזואלית:** Card row px-4 py-3: warning Badge 'אי-התאמה' + 'נמצאו N אי-התאמות בין מקורות-הנתונים' + ms-auto accent-link anchor 'לפרטים: /operator ←'. Polls /api/reconcile 15s.
- **פרימיטיבים:** Card, Badge (warning), fetchJsonOrNull
- **חוב:** Raw <a> with bespoke text-[color:var(--accent-link)] instead of a Button variant=link; arrow glyph '←' typed into copy (RTL-fragile) rather than an icon.

### Filters (global filter bar) · `form`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/Filters.tsx
- **משטח-אב:** Mounted per-tab: Home (inside TabHeader filterSlot, with compare+saved-views), P&L/Campaigns/Products/Detail (standalone, base config)
- **ויזואלית:** Card !p-0 single wrapping flex strip: ⚡ Zap label 'טווח מהיר' → 4 featured preset Buttons (primary when active w/ border-accent shadow-glass; desktop md+ only) | MOBILE replacement: full-width sliding-thumb pill bar (bg-pill-track recessed track, absolutely-positioned bg-pill-thumb slab animating via insetInlineStart %, 44px touch targets, RTL-correct) | Store NativeSelect with Store icon | range chip (bg-glass-2: Calendar icon + from—to + '· N ימים' tabular) | 'טווחים נוספים' chevron toggle → secondary preset pills + custom date Inputs (max=today-IL, clamped) | opt-in compare-baseline pill row 'בסיס השוואה' (5 pills) | opt-in SavedViewsDropdown.
- **פרימיטיבים:** Card, Button, Input, NativeSelect, pill-track/thumb/ink tokens, lucide icons
- **חוב:** Capability varies silently by tab: compare-baseline + saved views exist ONLY on Home (showCompareBaseline/showSavedViews default false) — operator loses both when filtering on Campaigns/P&L/etc. Active-pill styling duplicated 3× (featured, secondary, compare rows) as inline ternary class strings instead of a 'pill' Button variant. Mobile pill bar is a bespoke one-off (thumb math, bg-pill-thumb raw hex #6354e6 light/#0c8090 dark tokens) not shared with the visually-similar Products sub-tab control or ui/Tabs. Custom-range = two native date Inputs, no calendar popover — clashes with the premium feel of Home.

### SavedViewsDropdown (תצוגות שמורות) · `form`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/Filters.tsx (lines 387-561)
- **משטח-אב:** Filters bar (Home only)
- **ויזואלית:** Ghost trigger (Bookmark + 'תצוגות שמורות' + chevron) → hand-rolled absolute panel w-72 (rounded-control bg-glass-2 shadow-glass, insetInlineEnd:0 inline style): MRU list rows (apply Button flex-1, Pencil rename → inline Input with Enter/Esc/blur commit, Trash2 delete with hover:text-status-redFg), divider, footer 'שם לתצוגה הנוכחית' Input + primary 'שמור תצוגה' Button. Empty state 'אין תצוגות שמורות'. Outside-pointerdown dismiss.
- **פרימיטיבים:** Button, Input, useSavedViews/savedViews lib
- **חוב:** Another hand-rolled popover (absolute div + manual outside-click) instead of a shared Popover/Sheet primitive — third bespoke overlay pattern in the shell (SyncIndicator popover, CommandPalette modal). Delete is instant with no confirm/undo. w-72 fixed width can clip on narrow phones (max-w-sm only).

### TabHeader · `primitive`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/TabHeader.tsx
- **משטח-אב:** Home tab only (title 'בית' + Filters in filterSlot + AiReportButton in actionSlot)
- **ויזואלית:** header: flex col gap-3 pb-3 border-b border-glass-edge mb-4; Heading level=hero + optional muted description + actionSlot end-aligned; filterSlot row below.
- **פרימיטיבים:** Heading (Typography), cn
- **חוב:** The page-header primitive exists but is adopted by exactly 1 of 10 tabs — every other tab uses SectionIntro as a pseudo page header instead (grep: single <TabHeader usage at Dashboard.tsx:1604). Two competing header systems = inconsistent title hierarchy across tabs (Home gets hero Heading + bottom border; others get icon-tile section Heading with no border, no action slot, no AI-report button).

### SectionIntro · `primitive`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/SectionIntro.tsx
- **משטח-אב:** All tabs (page-top header on P&L/Campaigns/Products/Detail; section headers within Home)
- **ויזואלית:** Default: 7-8px-radius accent-bg icon tile (w-7/8) + Heading level=section + text-[11px]/xs description + optional LTR font-mono formula pill (bg-glass-2 border) + rightSlot. Inline mode: single Info-icon muted line.
- **פרימיטיבים:** Heading (Typography), Info icon, cn
- **חוב:** Doing double duty as both page H1 (on 5+ tabs) and in-page section header (Home uses it twice below TabHeader) — semantics and visual weight identical, so page hierarchy flattens. Descriptions are very long Hebrew paragraphs at text-[11px] — dense, sub-AA-feeling micro-type for primary page copy.

### PageScope (breadcrumb/scope line) · `primitive`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/ui/PageScope.tsx
- **משטח-אב:** Directly under every tab's header (Home, P&L, Campaigns, Products, Detail at Dashboard.tsx:1618/1753/1861/1924/2013)
- **ויזואלית:** mt-1 flex gap-2 text-xs text-ink-muted tabular-nums, role=status: store • (platform) • Hebrew range label • currency, bullet separators; Latin atoms in <bdi dir=ltr>.
- **פרימיטיבים:** cn, bdi
- **חוב:** Static text only — none of the scope items are interactive (clicking the store/range doesn't open the corresponding picker), so it reads like a breadcrumb but acts like a caption. Currency hardcoded to the literal 'CAD' default at every call-site.

### PageSynthesis (Hebrew TL;DR line) · `primitive`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/ui/PageSynthesis.tsx
- **משטח-אב:** P&L + Detail tabs, under PageScope
- **ויזואלית:** p mt-1 text-base font-medium text-ink-secondary, role=status aria-live=polite; empty text renders nothing; confidence=low → opacity-60.
- **פרימיטיבים:** cn
- **חוב:** Only 2 of the eligible tabs mount it (P&L, Detail) — Campaigns/Products have synthesizers' siblings absent, so the 'authoritative TL;DR under every H1' pattern is half-rolled-out. Low-confidence opacity-60 on ink-secondary risks sliding under AA in light mode.

### Footer · `primitive`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/Dashboard.tsx (lines 2034-2050)
- **משטח-אב:** main column, below active tab
- **ויזואלית:** Centered text-[11px]/xs text-ink-muted tabular-nums: 'עדכון אחרון: <he-IL timestamp>' · 'מתעדכן אוטומטית כל 2 דקות'.
- **פרימיטיבים:** none (raw markup)
- **חוב:** Anonymous inline component; refresh-cadence copy is hand-synced to the useAutoRefresh constant (already drifted once, fixed P1-26) — no single source of truth.

### MobileStickyRoas · `chip`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/home/MobileStickyRoas.tsx
- **משטח-אב:** Home tab, mobile only (md:hidden), sticky under the header strip
- **ויזואלית:** sticky top-[3.25rem] z-20 frosted bar (color-mix canvas 86% + backdrop-blur-xl, border-b hairline): big extrabold tabular ROAS (text-3xl → text-xl on scroll-collapse via 1px IntersectionObserver sentinel), green/red delta pill (▴ +0.12 / ▾ −, status tokens), 'ROAS · מול יעד' caption, collapsible 'יעד 3.0 · range' line (opacity+max-h transition, reduced-motion aware).
- **פרימיטיבים:** cn, formatNumber, useReducedMotion, status-green/red tokens, rounded-pill
- **חוב:** top-[3.25rem] is a magic offset hand-matched to the header strip's padding — header resize silently overlaps it. Target 3.0 passed as literal at the call-site (Dashboard.tsx:1598). Delta glyphs ▴/▾ typed into strings rather than shared with a Delta primitive.

### Products sub-tab segmented control (inline) · `nav`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/Dashboard.tsx (~lines 1934-1945)
- **משטח-אב:** Products tab, under Filters
- **ויזואלית:** Centered inline-flex role=tablist rounded-lg border-glass-edge bg-glass-1 divide-x rail (dir=ltr) switching טבלה/פיבוט; local state only (not URL-persisted).
- **פרימיטיבים:** raw divs (NOT ui/Tabs)
- **חוב:** Bespoke segmented control duplicating the visual job of ui/Tabs.tsx and the mobile pill bar — third tab-switcher pattern in the shell. dir=ltr workaround for divide-x under RTL.

### LoginPage · `form`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/app/login/page.tsx
- **משטח-אב:** app shell (pre-auth route)
- **ויזואלית:** min-h-screen bg-canvas centered main; Suspense-wrapped LoginForm.
- **פרימיטיבים:** LoginForm, Suspense
- **חוב:** Suspense fallback={null} — blank screen flash before the form mounts.

### LoginForm · `form`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/app/login/LoginForm.tsx
- **משטח-אב:** LoginPage
- **ויזואלית:** Glass Card max-w-sm: 11×11 rounded-xl violet gradient brand mark (same --sidebar-logo tokens as rail), 'דשבורד ROAS' h1, muted subtitle, LTR password Input (error prop + aria-invalid), red role=alert error line 'סיסמה שגויה. נסו שוב.', full-width lg primary Button with 'מתחבר…' busy text.
- **פרימיטיבים:** Card, Input, Button
- **חוב:** h1 is a raw <h1 className="text-lg font-semibold"> instead of the Heading primitive used elsewhere. Error text at bespoke text-[13px]. Otherwise the most token-clean form in the slice.

### ErrorBoundary (crash card) · `card`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/ErrorBoundary.tsx
- **משטח-אב:** app shell (wraps all routes)
- **ויזואלית:** Full-screen bg-canvas center; max-w-md rounded-2xl border-glass-edge bg-glass-1 shadow-sheet card: Heading hero 'משהו השתבש', muted explainer, font-mono detail (raw message in dev / generic Hebrew in prod), 'נסה שוב' primary + 'רענן דף' secondary Buttons. Sentry capture.
- **פרימיטיבים:** Button, Heading (Typography)
- **חוב:** Card surface hand-rolled (rounded-2xl border bg-glass-1) instead of the Card primitive — drifts from Card's rounded-card/p-5/glass recipe.

### FreshnessChip tones / shell status-token usage (cross-cutting) · `primitive`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/app/globals.css (status-*, sidebar, pill tokens; focus-mode 1044-1052; view-transition 1055-1061; .skeleton 981)
- **משטח-אב:** all shell chips/banners
- **ויזואלית:** Token layer the shell leans on: status-{green,orange/warning,red}Bg/Fg pairs, glass-1/2/3 surfaces + glass-edge hairlines, scrim, sidebar dark-rail tokens, pill-track/thumb/ink, accent family. Light + dark blocks both defined.
- **פרימיטיבים:** CSS custom properties
- **חוב:** Sidebar + pill-thumb tokens are raw hex (with thumb intentionally re-hued per theme); sidebar block is byte-identical in light and dark, so the rail never participates in theming — fine per locked design but a single-point hex source a redesign must respect or consciously re-lock.

---

# טאב הבית (home-tab) — 29 קומפוננטות

## עץ-המשטח

```
Dashboard shell (src/components/Dashboard.tsx, dir=rtl, bg-canvas, Sidebar right-rail + slim glass top strip)
	[shell, every tab] degraded-error banner (role=alert, status-redBg) · loading skeletons (h-40 hero + 6 tile skeletons) · TabFreshnessHeader + SourceHealthChip row
	tab=home
		ReconcileBanner (home-only, invisible unless cross-source violations)
		HomeTab (Dashboard.tsx:950-1718 — container; all SWR plumbing lives here)
			MobileStickyRoas (md:hidden sticky collapsing ROAS bar, z-20 under app header)
			TabHeader "בית"
				Filters strip (range presets / store / compare-baseline / saved views)
				AiReportButton → AI-report modal (hand-rolled fixed overlay, NOT Sheet)
			PageScope (store • range • CAD scope line)
			AnnotationsPanel "יומן אירועים" (collapsible card → AnnotationForm inline editor; writes localStorage pins consumed by RoasTargetChart)
			SectionIntro "לפי חנות"
			PerStoreRow (vivid band StoreCards; mobile scroll-snap carousel + dots; desktop md:grid-cols-N)
				StoreCard ×N (band slab header + LIVE FreshnessBadge + band-tag pill + 50-60px CountUp ROAS + mobile Sparkline/delta-chip + 4-up spend/revenue/orders/AOV grid + per-platform CPM mini-cells)
			StoreCompareGrid "ניתוח השוואתי" (TableBase ledger: חנות·הוצאה·הכנסה·ROAS pill·CPM·AOV·הזמנות)
			StoreDetailModal (Sheet variant=modal, opens on store-card click)
				vivid band header slab → KPI carousel/5-grid → NC-ROAS card + ChannelTruthPanel → embedded RoasChart → per-platform cards → top-campaigns list → footer CTA
			SectionIntro "סיכום עסקי"
			CommandCenterHero
				CoverageChip (hero-only attribution coverage; disclosure → UnknownBucketPanel accordion)
				Row 1: Revenue · Spend (+ProvenanceFlag/OverrideFlag) · FEATURED Operating-Profit (banded, NetSparkline)
				Row 2: CPM · Orders · Inventory/COGS · FEATURED MER (banded, CountUp)
				NC-ROAS / nCAC subordinate tile (own band) → ChannelTruthPanel (Meta/Google/TikTok cards + blended strip + subsidy insight)
			RoasTargetChart (independent chart range)
				header TL;DR synthesis + FreshnessBadge + pin-count chip + RoasChartDateRangePicker (6 preset chips + custom native date inputs)
				5-up KpiTile strip (הכנסות · ROAS-banded · הוצאת פרסום · רווח תפעולי · CPM)
				hand-rolled SVG plot (two-tone area, dashed 3.0 target, min/max שיא/שפל labels, today pulse marker, crosshair + rich HTML tooltip, ChartAnnotationPins overlay)
				footer (prev-period ROAS · cumulative revenue · days active)
			bottom 2-up grid (items-start)
				InsightsBoard
					ActionListPanel "פעולות דחופות כרגע" (always visible; loading→error→all-clear→rows)
					collapsed-by-default board "תובנות חכמות" (severity badges, AiInsightPill, InsightCardGroup/InsightCardRow, hidden-insights drawer, InsightActions per row)
				ActivityFeed "פעילות בזמן אמת" (12s poll; LiveBadge LIVE/מאזין/נותק; EventRow list; empty/disconnected states; "ראה הכל" →)
	tab=activity (deep-linked from ActivityFeed)
		ActivityTab (underline sub-tab switcher)
			"פיד חי" → ActivityEventsTab (paged 30-day event browser, day-grouped, compact filters)
			"סטטיסטיקות והתפלגויות" → Filters + ActivityStatsTab (KPI row · 2 conic-gradient donuts + orders/revenue toggle · per-product table with stacked source bars)
	tab=pnl (NOT home — noted because slice listed it)
		GoalTracker "יעד חודשי" (Dashboard.tsx:1766; month stepper, current/past/future/empty/edit/error states)
```

## חוב-עיצובי בפרוסה (הגרוע קודם)

- BAND/THRESHOLD FRAGMENTATION (worst, touches the locked color system): at least five parallel ROAS-band→style maps live in this slice alone — useRoasBandGradient/BAND_TAG_LABEL (canonical), RoasTargetChart's chipClassForBand+bandClassForRoas, StoreCompareGrid's PILL_TONE_CLASS, roasCell's ROAS_TONE_BG, and ChannelTruthPanel's private 3-band scale. ChannelTruthPanel actually DIVERGES from the locked thresholds (≥3/≥2/<2 instead of <2/2.7/≤3/>3 — drops the 2.7 orange boundary and the blue band), so a 2.9× channel reads 'תקין' there but orange everywhere else. Any redesign must consolidate to ONE band module or it will silently fork the locked red/orange/green/blue system again.
- CSS-HOOK COUPLING: the vivid band-card look (PerStoreRow, StoreDetailModal header, hero featured cards) is implemented as string class hooks resolved ~1,500 lines away in globals.css (.v.banded/.v.neutral/.band-tag/.sl/.sv/.cell.spend/.store-delta-chip/.hero-eyebrow/.hero-delta). StoreDetailModal even fakes a Card by hand-writing className="glass per-store-card" + data-mounted on a raw header. Re-skinning requires editing TSX and CSS in lock-step with zero type safety — highest breakage risk for a visual overhaul.
- DUPLICATED LAYOUTS: the NC-ROAS/nCAC tile exists twice nearly verbatim (CommandCenterHero vs StoreDetailModal); insight row action bars exist twice (InsightsBoard.InsightBoardRow vs ActionListPanel.ActionRow); activity event presentation (type→color/icon maps, resolveStoreId, relative-Hebrew time) exists three times (ActivityFeed, ActivityEventsTab, ActivityStatsTab); the accent-gradient collapsible header is hand-copied three times (InsightsBoard, ActionListPanel, AnnotationsPanel).
- SPARKLINE/FORMATTER BESPOKE-NESS: CommandCenterHero ships two private inline-SVG sparklines (Math.random ids, raw oklch stroke constant) instead of ui/Sparkline, plus seven local number formatters with hardcoded en-US/'$' that bypass the Money/format layer; RoasTargetChart's KPI tiles also bypass Money (preformatted strings, no overflow guarantee).
- MODAL INCONSISTENCY: AiReportButton is the slice's only hand-rolled fixed-overlay modal — no Radix/Sheet, no Esc, no focus trap, outside the drawerStack — while StoreDetailModal correctly uses Sheet variant=modal. Per the project's own incident memory (inert-overlay-over-Radix), it should be migrated before more surfaces copy it.
- MISSING SMALL VARIANTS → OVERRIDE GYMNASTICS: there is no chip-size Button variant and no Card padding variant, so CoverageChip, RoasChartDateRangePicker, insight mark-buttons and ActivityTab's tablist all fight Button defaults with h-auto/h-7/!p-* className overrides, and PerStoreRow/StoreDetailModal use !important padding overrides on Card. Two range-picker chip styles (Filters pills vs chart mono chips) and two table dialects (StoreCompareGrid's TableHeaderCell/TableCell vs ActivityStatsTab's raw th/td inside TableBase) coexist on the same screen.
- SPEC DRIFT TO RECONCILE: freshness desaturation shipped at saturate 0.96/0.88 (deliberately softened 2026-05-31 per CSS comment) while the locked decision memory still says aggressive 0.60/0.30; RoasChartKpis.netProfit field actually carries operating profit; the ROAS target 3.0 is independently hardcoded at two call sites; GoalTracker lives on the P&L tab, not Home.
- MICRO-TYPOGRAPHY ANARCHY (lower priority): pixel-literal font sizes (text-[50px]/[60px]/[1.625rem]/[10.5px]/[13.5px]…), magic layout numbers (top-[3.25rem] sticky offset, max-h-[420px] feed, tooltip top:-84), emoji-as-icon (💰 pins, ⚠️ insight, ▼/◀ expanders, ✓/✗ verdicts) sprinkled against an otherwise lucide-based icon system.

## קומפוננטות

### HomeTab (container) · `nav`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/Dashboard.tsx (lines 950-1718)
- **משטח-אב:** Dashboard shell → tab=home
- **ויזואלית:** Vertical space-y-4/5 stack with animate-fade-in-up: MobileStickyRoas → TabHeader+Filters+AiReportButton → PageScope → AnnotationsPanel → SectionIntro+PerStoreRow → StoreCompareGrid → StoreDetailModal (portal) → SectionIntro+CommandCenterHero → RoasTargetChart → 2-up InsightsBoard/ActivityFeed grid. Owns ~10 SWR fetches (campaigns cur+prev, data prev, orders prev, chart data cur+prev, chart campaigns) and all adapter memos (toHeroPeriod/toHeroDelta/toPerStoreData/toStoreDetail/toChartData).
- **פרימיטיבים:** TabHeader, Filters, AiReportButton, PageScope, AnnotationsPanel, SectionIntro, PerStoreRow, StoreCompareGrid, StoreDetailModal, CommandCenterHero, RoasTargetChart, InsightsBoard, ActivityFeed, MobileStickyRoas
- **חוב:** God-file: Dashboard.tsx holds the shell, HomeTab, PnLTab, CampaignsTab, ProductsTab, DetailTab and all their data plumbing in one ~2,400-line file. Hero target 3.0 is hardcoded at the MobileStickyRoas call site (target={3.0}) while RoasTargetChart defaults it separately — two sources for the same business constant.

### ReconcileBanner · `card`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/home/ReconcileBanner.tsx
- **משטח-אב:** tab=home, mounted above HomeTab (Dashboard.tsx:832)
- **ויזואלית:** Slim Card row: warning Badge 'אי-התאמה' + Hebrew count sentence + end-aligned accent link 'לפרטים: /operator ←'. Invisible by default; renders only on material reconcile violations (self-fetch /api/reconcile every 15s, soft-fail hidden).
- **פרימיטיבים:** Card, Badge, useSWR + fetchJsonOrNull
- **חוב:** Raw <a href="/operator"> with a literal '←' arrow glyph instead of a Button/link primitive + lucide icon; arrow direction is hardcoded rather than RTL-logical.

### SourceHealthChip · `chip`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/home/SourceHealthChip.tsx
- **משטח-אב:** shell strip above all tabs (Dashboard.tsx:825, beside TabFreshnessHeader)
- **ויזואלית:** Hidden while healthy; when a store×platform pipe is stuck renders one red Badge per source: '● platform · status · 6h' wrapped in HelpTooltip pointing at /operator. Token-only, bdi-isolated Latin.
- **פרימיטיבים:** Badge, HelpTooltip, useSWR + fetchJsonOrNull
- **חוב:** Minimal. Badge shows platform+status but not WHICH store when two stores share a platform (storeId only in the React key).

### MobileStickyRoas · `card`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/home/MobileStickyRoas.tsx
- **משטח-אב:** tab=home (mobile only, md:hidden)
- **ויזואלית:** Sticky frosted bar (color-mix canvas 86% + backdrop-blur-xl + bottom hairline) pinned at top-[3.25rem] z-20. Big tabular ROAS (text-3xl → text-xl when collapsed via IntersectionObserver sentinel), green/red pill delta chip (▴/▾ ±0.00 ROAS points, mirrors hero exactly), 'יעד 3.0 · range' caption that max-height/opacity-collapses on scroll. Reduced-motion gates transitions.
- **פרימיטיבים:** cn, formatNumber, useReducedMotion (no Card — bespoke surface)
- **חוב:** top-[3.25rem] is a magic number coupled to the app header's py-2 height (comment admits '≈') — a header padding change silently breaks the pin offset. Bespoke frosted surface rather than a shared sticky-bar primitive.

### TabHeader · `nav`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/TabHeader.tsx
- **משטח-אב:** tab=home (and every tab)
- **ויזואלית:** Header block: Heading level=hero title + muted description, actionSlot pinned end (AI button), filterSlot row below, bottom hairline border.
- **פרימיטיבים:** Heading (Typography)
- **חוב:** None significant — clean slot-based primitive.

### Filters (home instance) · `form`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/Filters.tsx
- **משטח-אב:** TabHeader filterSlot on tab=home (showCompareBaseline + showSavedViews)
- **ויזואלית:** Preset pill row (mobile A3 short labels), secondary presets folded behind a toggle on small screens, store picker, compare-baseline select, saved-views. 561 lines.
- **פרימיטיבים:** Button, NativeSelect, Input, presets lib, useSavedViews
- **חוב:** Shared shell component (deep audit belongs to the shell slice); on Home it visually competes with RoasChartDateRangePicker further down — two different range-picker chip styles on one screen (Filters pills vs chart's mono h-7 chips).

### PageScope · `primitive`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/ui/PageScope.tsx
- **משטח-אב:** tab=home under TabHeader
- **ויזואלית:** One muted xs line: store • range • CAD with bullet separators, Latin items in <bdi dir=ltr>, role=status.
- **פרימיטיבים:** none (leaf)
- **חוב:** None — exemplary.

### AnnotationsPanel (יומן אירועים) · `form`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/AnnotationsPanel.tsx
- **משטח-אב:** tab=home, thin overlay above per-store section
- **ויזואלית:** Collapsible section: gradient header (accent-bg→glass-1) with Pin icon tile + count subtitle, text glyph '▼'/'◀' expander. Open state: dashed 'תעד אירוע חדש' add button → inline AnnotationForm (kind NativeSelect with emoji options, title/notes Inputs, date input, store scoping, save/cancel); list rows with emoji kind-chip (color-mix tinted), title+date+store meta, hover edit/delete icon buttons.
- **פרימיטיבים:** Button, Input, NativeSelect, HelpTooltip, Heading; localStorage annotations lib + 'roas-annotations-changed' event
- **חוב:** Root is a raw <section className="rounded-2xl bg-glass-1 border…"> re-implementing Card instead of using it. Expander is literal '▼'/'◀' text glyphs while sibling InsightsBoard uses an animated lucide ChevronDown — inconsistent disclosure language. Emoji-as-icon kind system (ANNOTATION_KIND_EMOJI) vs the lucide icon system everywhere else. Gradient header pattern is hand-copied across AnnotationsPanel / InsightsBoard / ActionListPanel with slightly different paddings.

### AiReportButton + AI-report modal · `modal`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/AiReportButton.tsx
- **משטח-אב:** TabHeader actionSlot on tab=home (also opened via CommandPalette openSignal)
- **ויזואלית:** Primary sm Button 'ייצא דוח ל-AI' with Bot icon. Modal: hand-rolled fixed inset-0 z-50 scrim (bg-scrim + backdrop-blur) with a bottom-sheet-on-mobile / centered max-w-3xl glass card; header (Bot + title + X), scope summary box, error strip (status-red, with retry) when products/campaigns fetch fails, warning note when orders/ads missing, full-width generate Button (spinner/disabled-with-reason states), then copy/download/regenerate buttons + 400-500px readonly mono Textarea + tip line.
- **פרימיטיבים:** Button, Textarea, Heading; SWR fetchJsonStrict ×4, generateAiReport, aggregate/salariesForRange
- **חוב:** The ONLY hand-rolled modal in the slice: not Sheet/Radix — no focus trap, no Esc key handling (backdrop click + X only), not registered in drawerStack, body scroll not locked. Violates the project's 'modals go through the Sheet primitive' convention (StoreDetailModal/CampaignDrawer both use Sheet). Scope copy hardcodes report shape ('25 מוצרים מובילים… 5 הקמפיינים') — drifts if aiReport.ts changes.

### PerStoreRow + StoreCard · `card`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/home/PerStoreRow.tsx
- **משטח-אב:** tab=home section 2 'לפי חנות'
- **ויזואלית:** Desktop: md:grid-cols-N (literal classes for 1-4 stores, inline auto-fit style for 5+). Mobile: scroll-snap carousel (basis-[88%]) + RTL-aware carousel dots. Each StoreCard = vivid full-band Card (data-band strong gradient slab over top ~35%, all-white text per locked rule): header with LTR store name, FreshnessBadge, white-alpha band-tag pill (canonical BAND_TAG_LABEL); 50/60px font-light CountUp ROAS in band ink ('0.00x' static for alarm-red zero-sales, 'אורגני'/'0' for ads-off states); mono 'ROAS · range' caption; mobile-only band-ink Sparkline + dark-scrim ▲/▼ delta chip; 4-up metric grid with semantic CSS hooks (spend always red↓, revenue always green↑, orders neutral, AOV conditional aov-good/bad/mid) all via <Money compactAbove>; dashed-border CPM zone with PlatformBadge dot + spend caption + 20-22px CPM Money per platform. Card freshness desaturation via useStaleness stage.
- **פרימיטיבים:** Card (band/freshness/bandStrength), Money, CountUp, Sparkline (bandInk), FreshnessBadge, Heading, PlatformBadge, useRoasBandGradient, aovEmphasis, useStaleness, adDisplayState
- **חוב:** Visual identity lives split between this file and ~300 lines of distant globals.css class hooks (.store-top/.band-tag/.sl/.sv/.cell.spend/.cpm-spend-cap/.roas-cap) — fragile string coupling, hard to re-skin safely. !p-6 md:!p-7 !important padding override on Card. Pixel-literal type (text-[50px]/[60px]/[11px]) outside any type scale. Latin literal 'spend ·' caption inside an otherwise Hebrew card. Orders cell is a bespoke span while siblings use <Money>.

### StoreCompareGrid (ניתוח השוואתי) · `table`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/home/StoreCompareGrid.tsx
- **משטח-אב:** tab=home, directly below PerStoreRow (same PerStoreData array)
- **ויזואלית:** Section Heading + horizontally-scrollable TableBase (minWidth 560): one row per store — LTR store name; spend in a subtle red wash pill, revenue in green wash (translucent status-Bg behind Money); ROAS as a band pill (roasLabel tone → status bg/fg pair, with ads-off 'אורגני'/'0' states); blended CPM (recovered from per-platform spend/cpm), AOV, orders neutral.
- **פרימיטיבים:** TableBase/TableHead/TableHeaderCell/TableRow/TableCell, Money, Heading, roasLabel, adDisplayState
- **חוב:** blendedCpm() re-derives impressions as spend/cpm*1000 — a lossy client-side reconstruction rather than upstream truth. PILL_TONE_CLASS is yet another local band→class map (parallel to RoasTargetChart's chipClassForBand, roasCell's ROAS_TONE_BG and ChannelTruthPanel's bandChip).

### StoreDetailModal · `modal`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/home/StoreDetailModal.tsx
- **משטח-אב:** tab=home modal (opens on store-card click; Sheet variant=modal, full-screen on mobile)
- **ויזואלית:** Sticky vivid band header slab (raw <header className="glass per-store-card" data-band data-mounted> replicating the store-card treatment): white store name, FreshnessBadge, band-tag pill, scrim-styled ✕; 44/54px CountUp ROAS + caption + white band-ink Sparkline. Body: KPI cards (mobile scroll-snap carousel / md 5-grid) with ▲▼% delta chips (spend polarity inverted); NC-ROAS/nCAC Card (own muted band, confidence Badge / suppressed state) + ChannelTruthPanel; embedded store-scoped RoasChart in a neutral Card (hidden for 1-day ranges); per-platform 3-up Cards (spend/CPM/ROAS dl); top-campaigns Card of ghost-Button rows (PlatformBadge, LTR name, revenue+orders/spend stack, solid ROAS_TONE_BG chip → deep-links drawer). Footer: primary 'פתח את כל הקמפיינים' + secondary 'סגור'.
- **פרימיטיבים:** Sheet/SheetContent/SheetBody/SheetFooter, Card, HelpTooltip, Badge, Money, CountUp, Sparkline, Button, Heading, FreshnessBadge, PlatformBadge, RoasChart (bare), ChannelTruthPanel, useDrawerEsc, useRoasBandGradient, ROAS_TONE_BG/ROAS_BADGE_SHAPE
- **חוב:** Header slab manually re-creates Card's band rendering on a raw element via the 'glass per-store-card' class-string + data-mounted="true" hack — second copy of the band-card recipe. Heavy !important overrides (!rounded-none !p-5, !w-[30px] !h-[30px] close button). The NC-ROAS tile is a near-duplicate of CommandCenterHero's hero-nc-roas markup (third copy of that layout counting both).

### CommandCenterHero · `card`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/home/CommandCenterHero.tsx
- **משטח-אב:** tab=home section 3 'סיכום עסקי'
- **ויזואלית:** 7-card business-summary grid. Row 1 (grid-cols-2 → md 1fr 1fr 1.15fr): neutral-muted band Revenue + Spend cards (eyebrow label, 1.625rem white-gradient Money countUp, green/red DeltaLine, semantic MiniSparkline green/red; Spend carries ProvenanceFlag 'סופי/אומדן חי' + OverrideFlag '● ידני'), FEATURED Operating-Profit card (full ROAS-band gradient, col-span-2 on mobile, 2.25-2.75rem banded Money countUp, delta+% vs comparisonLabel or 'אין נתוני השוואה' hint, band-stroked NetSparkline with neutral --plot-bg casing). Row 2 (2→4 cols): CPM, Orders, Inventory/COGS ('~X% מהמחזור' subtitle), FEATURED MER card (banded CountUp + band sparkline). Optional NC-ROAS/nCAC tile (own muted band, 'ביטחון נמוך' Badge / suppressed copy, new·returning·unclassified counts line, ChannelTruthPanel under a divider). CoverageChip row above when coverage present. All cards share one freshness stage → uniform desaturation; FreshnessBadge only on the featured card header.
- **פרימיטיבים:** Card (band/bandStrength/freshness), Money (countUp), CountUp, Badge, FreshnessBadge, HelpTooltip, CoverageChip, ProvenanceFlag, OverrideFlag, ChannelTruthPanel, useRoasBandGradient, useStaleness
- **חוב:** Seven bespoke local formatters (fmtMoneyCompact/fmtPctDelta/fmtRoasDelta/fmtCountDelta/fmtMoneyDelta…) duplicating lib/format + Money capabilities, with hardcoded en-US locale + '$'. Operating-profit delta % is inline math with a Math.max(1,…) denominator hack. NetSparkline + MiniSparkline are hand-rolled inline SVGs using Math.random() gradient ids (not React useId, not the shared ui/Sparkline). NEUTRAL_SPARK_STROKE is a raw oklch string in TSX. HelpTooltip wraps entire Cards as triggers (huge hover targets). Pixel micro-typography (text-[10.5px]/[1.625rem]) everywhere. The big number styling depends on globals.css '.v num banded/neutral' string hooks.

### CoverageChip · `chip`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/home/CoverageChip.tsx
- **משטח-אב:** CommandCenterHero header row (hero-only, never per-store)
- **ויזואלית:** Quiet muted-ink micro chip 'NN% כיסוי ייחוס' with ShieldCheck; flips to warning-band (warningBg/Fg + border + ShieldAlert) when unknown share >30%. With a breakdown present it becomes an aria-expanded Button disclosure with rotating ChevronDown that accordion-opens UnknownBucketPanel full-width beneath the hero row.
- **פרימיטיבים:** Button, HelpTooltip, UnknownBucketPanel
- **חוב:** Disclosure path fights Button's ghost/sm defaults with override gymnastics (h-auto + CHIP_BASE re-collapse) — a chip-size Button variant doesn't exist so every micro-chip-button in the codebase re-derives it.

### UnknownBucketPanel · `card`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/home/UnknownBucketPanel.tsx
- **משטח-אב:** CommandCenterHero ← CoverageChip accordion
- **ויזואלית:** Rounded glass-2 section with warning-tinted header band (HelpCircle title 'פירוק הבלתי-מזוהה', honest-framing copy, orders+revenue totals dl); body: 3 Stat-tile grids (new/returning/unclassified · AOV bands <50/50–70/>70 · payment credit/PayPal/other) each with colored square swatch + count; per-store list rows; accent-bg disclaimer strip with AlertTriangle ('תיאור בלבד — לא חלוקה-מחדש').
- **פרימיטיבים:** Money, Heading, cn (bespoke Block/Stat internals)
- **חוב:** TONE_SWATCH maps different semantics to identical colors (paypal=mid=blue, other=unclassified=ink-muted) so swatches don't disambiguate across blocks; Stat/Block are local one-offs rather than the shared Stat primitive (ui/Stat.tsx exists).

### ChannelTruthPanel · `card`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/home/ChannelTruthPanel.tsx
- **משטח-אב:** CommandCenterHero NC tile + StoreDetailModal NC section
- **ויזואלית:** 3-up channel cards (Meta/Google/TikTok): 3px brand-color top bar + brand square swatch (CHART_COLORS inline style), 2xl NC-ROAS in band-tinted fg, nCAC/NC-revenue/spend/new-orders rows, optional 'ספירת-יתר +N%' overcount row, net-profit row green/red, band chip pill ('בריא/תקין/חלש' or 'אין גיוס'/'אין נתונים'). Below: dashed blended-summary strip + conditional warning insight '⚠️ הבלנדי מסתיר את הפער… שקול להזיז תקציב.'
- **פרימיטיבים:** Money, CHART_COLORS tokens
- **חוב:** Defines its OWN 3-band ROAS scale (≥3 good / ≥2 warn / <2 bad) that diverges from the locked 4-band system (<2 red / 2–2.7 orange / ≤3 green / >3 blue) — the 2.7 boundary and blue 'above target' band vanish, so a 2.9× channel reads 'תקין' here but orange elsewhere. Cards are bespoke divs, not the Card primitive. Literal ⚠️ emoji instead of a lucide icon.

### RoasTargetChart · `chart`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/home/RoasTargetChart.tsx
- **משטח-אב:** tab=home section 4 (full-width neutral Card)
- **ויזואלית:** 1,204-line hand-rolled SVG chart card. Header: mono eyebrow 'מטרה 3.0 · range', Hebrew TL;DR sentence with band-tinted anchor number (synthesizeRoasChart, low-confidence fallback sentence), FreshnessBadge + scope text + amber 💰 pin-count chip + range picker. KPI strip: 5 gap-px KpiTiles on glass-edge grid — only ROAS tile carries band color + canonical BAND_TAG_LABEL chip. Legend row + שיא/שפל min-max readout. Plot: dynamic y-domain (grows past 4.0 floor), integer gridlines, two-tone area gradient split exactly at the 3.0 dashed target line (green above/red below via --chart-area-* tokens), Catmull-Rom smoothed line with draw-in dash animation, min/max colored dots + mono labels, violet 'היום' pulsing today marker + HTML badge, pointer-driven crosshair with rich RTL glass tooltip (date/ROAS/target/±delta, touch tap + tap-outside dismiss), dashed pin guides + ChartAnnotationPins overlay (hover-and-click only). Footer: prev-period ROAS + %, cumulative revenue, days active. Card desaturates via freshness stage.
- **פרימיטיבים:** Card, FreshnessBadge, ChartAnnotationPins, Heading, RoasChartDateRangePicker, useRoasBandGradient/BAND_TAG_LABEL, useStaleness, formatCurrency/formatNumber/formatDate, chart-* CSS tokens
- **חוב:** Single massive file mixing geometry, synthesis rendering, tooltip state and layout. All SVG styling via inline style={{}} objects (token vars, but uncomposable). Magic numbers: tooltip top:-84, viewBox 1000×220, dash length 1600. kpis.netProfit field actually carries OPERATING profit (label 'רווח תפעולי') — naming drift across the adapter contract. 💰 emoji hardcoded as pin glyph/chip. chipClassForBand/bandClassForRoas are this file's private band→class maps (4th+ copy in the slice). KpiTiles don't use Money (preformatted strings, no overflow guarantee).

### RoasChartDateRangePicker · `form`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/home/RoasChartDateRangePicker.tsx
- **משטח-אב:** RoasTargetChart header
- **ויזואלית:** Row of 7 mono h-7 chip Buttons (7/30/90 ימים, מהחודש/מהרבעון/מהשנה, מותאם) — active = accent border + accent-bg; 'מותאם' reveals two native <input type=date> + 'החל' apply button. Persists to ?chartRange/?chartFrom/?chartTo via history.replaceState.
- **פרימיטיבים:** Button, Input; exports readChartRangeFromUrl/writeChartRangeToUrl
- **חוב:** Chip look is achieved by overriding Button's secondary/ghost variants with long className strings — same missing 'chip' Button variant problem as CoverageChip; its visual language (mono lowercase chips) differs from the page-level Filters preset pills shown 600px above.

### InsightsBoard · `card`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/InsightsBoard.tsx
- **משטח-אב:** tab=home bottom 2-up grid (start column)
- **ויזואלית:** Stack of ActionListPanel + a !p-0 Card board. Board header = full-width ghost Button with accent gradient wash, Sparkles icon tile, 'תובנות חכמות' Heading, status line (spinner 'מנתח…', counts '· 30 ימים אחרונים'), severity count pills + rotating chevron. Expanded: AiInsightPill headline, severity groups via InsightCardGroup (critical/warning always open) with InsightCardRow rows (scope badge, 'טיפלתי'/'הסתר' micro-buttons, InsightActions, why-disclosure), show-more toggles, hidden-insights drawer (eye toggle, muted rows + 'שחזר' restore). States: loading, feed-error 'לא ניתן לטעון תובנות כרגע' (never false all-clear), true empty 'אין תובנות חדשות'. Fixed trailing-30-day window independent of page filters.
- **פרימיטיבים:** Card, Button, Heading, HelpTooltip, AiInsightPill, InsightCardGroup/InsightCardRow, InsightActions, ActionListPanel, SWR fetchJsonStrict ×4, localStorage insight-states
- **חוב:** SEVERITY_META is a local 5-tone × 5-class style matrix partially duplicated by ActionListPanel's SEVERITY_ICON and InsightCard's own severity styling — three places to update per severity. Row mark-buttons (h-auto px-2 py-1 text-[11px] overrides) are copy-pasted between InsightBoardRow and ActionListPanel.ActionRow (comment admits mirroring). Card-inside-Card nesting (board Card > InsightCardGroup surfaces) reads heavier than the Home hero polish.

### ActionListPanel (פעולות דחופות כרגע) · `card`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/insights/ActionListPanel.tsx
- **משטח-אב:** rendered by InsightsBoard, above the board (tab=home)
- **ויזואלית:** !p-0 Card: accent-gradient header (Zap icon tile, hero Heading, dynamic subtitle, accent-soft count pill). Body states in strict order: loading spinner row → error row (AlertTriangle, 'לא ניתן לטעון תובנות כרגע… זה לא אומר שהכול תקין') → calm all-clear (ping green dot + 'אין פעולות דחופות כרגע. הכול נראה תקין.') → divided InsightCardRow list with mark buttons + InsightActions.
- **פרימיטיבים:** Card, Button, Heading, HelpTooltip, InsightCardRow, InsightActions
- **חוב:** Header is the third hand-copied accent-gradient header in the slice; ActionRow duplicates InsightsBoard's row assembly nearly verbatim — a shared InsightRowActions wrapper would collapse both.

### InsightActions · `primitive`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/insights/InsightActions.tsx
- **משטח-אב:** every insight row (ActionListPanel + InsightsBoard) on tab=home
- **ויזואלית:** Two-action cluster: secondary Button 'פתח קמפיין' (dispatches roas-open-campaign-drawer CustomEvent → CampaignDrawer) + external link 'פתח ב-{platform} Ads Manager' with ExternalLink icon. Either omitted when not applicable.
- **פרימיטיבים:** Button, HelpTooltip, buildAdsManagerLink
- **חוב:** The secondary action is a raw <a> hand-styled to imitate a Button (border/hover classes re-typed) instead of Button asChild — diverges in focus-ring/disabled behavior from every sibling button.

### ActivityFeed (פעילות בזמן אמת) · `feed`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/home/ActivityFeed.tsx
- **משטח-אב:** tab=home bottom 2-up grid (end column)
- **ויזואלית:** !p-0 Card: header with Zap accent icon + LiveBadge (GREEN pulsing 'LIVE · לפני 2ד׳' / gray 'מאזין' / red 'נותק', server-clock derived, reduced-motion gated ping). Scrollable max-h-[420px] body: EventRows — 9×9 rounded glyph box (sale=greenBg ShoppingBag / refund=redBg Undo2 / atc=blueBg ShoppingCart), bold type label + Money amount in matching fg, truncated product title, store chip with brand-color dot (buildStoreBrandColorMap) + SourceBadge, relative Hebrew timestamp; newest row slides in (animate-fade-in-up, motion-gated). Empty state: pulsing dot + 'מאזין בזמן אמת…' with dynamic store-count copy; disconnected state red copy. Footer scope line + ghost 'ראה הכל ‹' Button (≥44px) deep-linking the Activity tab. 12s SWR poll.
- **פרימיטיבים:** Card, Heading, Money, Button, SourceBadge, useReducedMotion, storeColor/useStores
- **חוב:** relativeHebrew + TYPE_PRESENTATION + resolveStoreId are triplicated between ActivityFeed, ActivityEventsTab and (partially) ActivityStatsTab — three private copies of the same maps. max-h-[420px] magic height. Literal '‹' glyph as the see-all affordance.

### ActivityTab (sub-tab switcher) · `nav`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/activity/ActivityTab.tsx
- **משטח-אב:** tab=activity (deep-linked from Home ActivityFeed 'ראה הכל')
- **ויזואלית:** role=tablist underline switcher: 'פיד חי' / 'סטטיסטיקות והתפלגויות' as ghost Buttons with border-b-2 accent underline when active. Feed sub-tab range-free; stats sub-tab mounts the shared Filters strip wired to GLOBAL setFilters.
- **פרימיטיבים:** Button, Filters
- **חוב:** Hand-rolled tablist with Button overrides while ui/Tabs.tsx exists — bespoke sub-tab pattern; tab state is local useState (not URL-persisted, unlike the chart range picker), so a refresh loses the stats view.

### ActivityEventsTab (פיד חי) · `feed`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/activity/ActivityEventsTab.tsx
- **משטח-אב:** tab=activity → 'פיד חי' sub-tab
- **ויזואלית:** Paginated 30-day event browser grouped by IL calendar day: compact filter row (fixed-width store NativeSelect + 4 type pills הכל/מכירות/החזרים/עגלה), day headers, same green/red/blue glyph-box rows as the Home feed, page controls. Same /api/store-events source, paged branch.
- **פרימיטיבים:** Card, Heading, Money, Button, NativeSelect, SourceBadge, useStores/storeColor
- **חוב:** Duplicates ActivityFeed's TYPE_PRESENTATION / resolveStoreId / relative-time helpers wholesale (acknowledged 'mirrors the Home feed tones' comment) — the canonical event-row presentation has no shared module.

### ActivityStatsTab (סטטיסטיקות והתפלגויות) · `chart`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/activity/ActivityStatsTab.tsx
- **משטח-אב:** tab=activity → stats sub-tab (the 'activity stats sub-screen')
- **ויזואלית:** Header (BarChart3 accent tile + hero Heading) + SegToggle radiogroup 'לפי הזמנות/לפי הכנסה'; KPI Card row (orders, %paid emphasized accent, ATC, first-click coverage); two donut Cards — conic-gradient rings (140px, glass-2 inner hole with center stat) + text legends (swatch · label · count/Money · %): paid-vs-organic (accent vs text-muted) and per-platform (brand-mirrored bucket tokens meta-blue/google-amber/tiktok-pink/email-teal/referral-violet/other-paid-orange/direct-gray); per-product flat Card with bucket legend strip, TableBase (sticky header) rows: title · ATC · purchases · conversion% · StackedBar (rounded pill of bucket segments, sr-only labels), 'רכישות/הוספות לעגלה' toggle; footer data-source note with mono code refs. States: 4-skeleton + 2-donut + table skeleton loading, error card, empty card with BarChart3 tile.
- **פרימיטיבים:** Card, Heading, Money, Button, TableBase, buildDateRangeKey, SOURCE_BUCKET_LABEL, chart-platform tokens
- **חוב:** Donuts are static conic-gradient divs — no hover/touch segment readout (every other chart in the slice has tooltips). Table body uses raw <thead>/<th>/<td> with hand-typed border/padding classes inside TableBase instead of the TableHeaderCell/TableCell primitives StoreCompareGrid uses — two table dialects in one slice. Third private resolveStoreId copy.

### GoalTracker (יעד חודשי) · `card`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/GoalTracker.tsx
- **משטח-אב:** tab=pnl (Dashboard.tsx:1766) — NOT on Home despite being a 'monthly goal' Home-adjacent widget; global business-wide goal per locked memory
- **ויזואלית:** 741-line month-keyed Card with six render branches: (1) empty non-single-month state with Target tile + guidance; (2) inline edit form (CAD-prefixed numeric Input, save/cancel, validation error); (3) wide-fetch error card (status-red strip + retry, honest 'זה לא אומר שלא היו מכירות'); (4) no-goal CTA card on a vivid accent gradient (accent→55%-darker oklch) with 'קבע יעד' button; (5) past-month verdict: ✓עמד/✗לא-עמד pill, 3-col actuals/goal/diff grid with green/red deltas, progress bar; (6) current-month pacing: MTD + month-end forecast + pacing badge + daily-target tick bar + 'יום N מתוך M' footer. ‹month› stepper with RTL-correct chevron semantics + carry-forward 'נגרר מ-' tag.
- **פרימיטיבים:** Card, Button, Input, Money, Heading, HelpTooltip, SWR fetchJsonStrict, useGoalSettings/useCogsSettings/useSalarySettings, computePacing/forecastMonthEnd
- **חוב:** Listed under Home in the slice brief but actually renders on the P&L tab — the Home redesign must not assume it. No-goal card paints an arbitrary-value gradient class bg-[linear-gradient(135deg,var(--accent),oklch(from_var(--accent)…))] — token-derived but a bespoke inline recipe. Text glyphs '✓'/'✗' instead of lucide icons. Six layout branches in one component make the visual surface hard to audit per state.

### SectionIntro · `primitive`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/SectionIntro.tsx
- **משטח-אב:** tab=home (before PerStoreRow 'לפי חנות' and CommandCenterHero 'סיכום עסקי')
- **ויזואלית:** Thin label bar: accent-bg rounded icon tile + section Heading + xs secondary description; optional mono formula pill and inline (single info-line) mode.
- **פרימיטיבים:** Heading
- **חוב:** None significant.

### CountUp + useCountUp (count-up behavior) · `primitive`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/ui/CountUp.tsx (+ /Users/dorperetz/script-roas/dashboard-web/src/lib/hooks/useCountUp.ts)
- **משטח-אב:** primitive used by CommandCenterHero (MER, NC-ROAS), PerStoreRow + StoreDetailModal ROAS heroes, Money countUp prop
- **ויזואלית:** Animates 0→value over 900ms on FIRST reveal only, then snaps instantly on subsequent changes (hasAnimatedRef, the 2026-06-05 anti-flicker fix); null/NaN → '—'; reduced-motion + SSR safe; caller owns formatter.
- **פרימיטיבים:** useCountUp hook
- **חוב:** None — the animate-once-then-snap contract is the load-bearing fix for the CLS/'shake' report; the redesign must preserve it.

### FreshnessBadge + Card freshness pipeline (desaturation stages) · `chip`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/ui/FreshnessBadge.tsx (+ /Users/dorperetz/script-roas/dashboard-web/src/lib/freshness/useStaleness.ts, globals.css:1561-1596)
- **משטח-אב:** primitive on every Home card (hero featured card, per-store headers, chart header, StoreDetailModal)
- **ויזואלית:** Mono uppercase pill: fresh = green 'LIVE · HH:MM' with animated pulse dot; aging = orange 'AGING · Nmin' static dot; stale = red 'STALE · Xh Ymin'; worst-platform label ('TikTok stuck · 1h 47min') for per-platform inputs. Thresholds: <15min fresh, 15-30 aging, ≥30 stale. Paired Card data-freshness CSS dims the surface (aging saturate .96/opacity .98, stale saturate .88/.95) with per-platform CPM cells re-saturated (×1.04/×1.14) so brand dots survive the fade.
- **פרימיטיבים:** useStaleness; .fresh-chip CSS
- **חוב:** Shipped fade is deliberately MUCH gentler (0.96/0.88) than the originally locked aggressive spec (0.60/0.30 + brightness .95) — documented in the CSS comment as a 2026-05-31 softening, but the locked-decision memory still says aggressive; reconcile the spec before the redesign treats either as truth. Chip + Card stage must be threaded together manually at every call site (the file's own comment warns a STALE chip on a saturated card is possible if a consumer forgets).

---

# טאב קמפיינים (campaigns-tab) — 30 קומפוננטות

## עץ-המשטח

```
Campaigns tab (CampaignsTab in src/components/Dashboard.tsx:1844)
	SectionIntro header + PageScope chip + Filters (shared shell components)
	QuadrantScatterCard → CampaignsTopList ("הקמפיינים הבולטים" winners/losers dual ranked lists)
	glass card wrapper (rounded-xl bg-glass-1 border-glass-edge shadow-glass, Dashboard.tsx:1868)
		CampaignsTable (CampaignsTable.tsx)
			Toolbar strip (bg-glass-2/40): mode tablist (קמפיינים/אד-סטים) · store NativeSelect · search Input · CSV export Button · mobile "סינון נוסף" expander · platform tablist (כולם/Meta/Google/TikTok) · 🔗 multi-mapped checkbox · optimized-marks counter + נקה הכל · row count · CampaignsColumnsMenu popover
			AttributionGapPanel (conditional full-bleed green/red trust band: 4 KPI columns + interpretation copy)
			Summary strip (accent gradient): 7 Stat tiles (ROAS+Badge / הוצאה / ערך המרות / המרות / קליקים / CTR / CPM-clickable)
				expandable CPM-over-time LineChart (half-vs-prev baseline toggle, ROAS overlay, dashed prev line, legend, fallback warning, tone-coded ניתוח box)
				CPC · CPA · impressions footnote line
			error strip (red) / loading text / empty state (Megaphone icon)
			TableBase (stickyHeader, minWidth 1340, max-h 60vh scroll, hidden-columns injected <style>)
				thead: ColumnHeaderTh + SortHeader ×~19 columns, each with solid-accent ⓘ rich HelpTooltip
				CampaignsTableRow ×N
					optimized Circle/CheckCircle2 toggle · HealthScoreBadge (grade chip + hand-rolled popover) · name cell (rank circle, bdi name, CBO/ABO chip, כבוי chip, לא-ממופה chip, CampaignFreshnessChip, טוען-מ-Platform chip, platform·store subtitle)
					Sparkline ROAS-trend cell · 15 reorderable metric cells (Money cells, solid ROAS badge / מתעדכן…/ממתין… pending states, ROAS Shopify + first-click cells w/ FirstClickCoverageChip, Shopify value/units/orders cells)
					deep-link ExternalLink cell
			show-more footer (הצג עוד N / הצג פחות)
			CampaignDrawer — CENTERED MODAL (campaign-drawer/index.tsx, Sheet variant="modal", 880px, mobile full-screen)
				SheetHeader (neutral glass): campaign name hero · platform-pill+PlatformBadge · store chip · band-tone ROAS chip · active-days chip · Ads Manager link
				fetch-error strip (role=alert)
				Tabs variant="underline" — 6 sub-tabs
					סקירה (CampaignDrawerOverview): scorecard ×4 Stat (ROAS / ערך / אמינות attribution / ציון בריאות) · KPI grid ×5 Stat · TikTok store-mapping slot (NativeSelect + warnings) · OverviewAccordion <details> stack: HealthScorePanel · מוצרי-Shopify-משויכים (chips + ערוך-מיפוי button) · CohortComparisonPanel (rank chip, cannibalization banners, intra/cross CohortSection tables, footer explainer) · AttributionAnalysisPanel (open by default) · ProductChannelBreakdown (5-segment bar) · MetaShopifyReconciliation (5-line chart + r-values + day-by-day details table)
					יומי (CampaignDrawerDaily): spend↔value AreaChart + legend · CPM LineChart (prev baseline toggle, ROAS overlay, legend, fallback warning, ניתוח box)
					Ad Sets (CampaignDrawerAdSets → AdSetTable): sortable 8-col table, drillable rows, ROAS solid badge + pending states, ROAS Shopify trust mini-chips / empty state
					מודעות (CampaignDrawerAds): ad-set quick-launch list rows (name, spend·conversions, ROAS badge, פתח-מודעות button) · PMax-unsupported hint / empty state
					סטטוס (CampaignDrawerStatus → CampaignDrawerStatusSection): configured/effective/delivery chips · BACKFILL_UNKNOWN explainer · status-history timeline grid
					היסטוריה (CampaignDrawerHistory): 4 timestamp Row pills + Phase-E2 placeholder copy
				Esc hint footer
				ProductPickerModal (nested modal Sheet z-[60], 560px)
				AdsDrawer (nested side sheet z-[60] over the modal)
			AdsDrawer (also opened directly from ad-set-mode row clicks)
				SheetHeader: accent Layers icon chip · "מודעות ב-ad-set" label · name · fullscreen ⤢ toggle
				totals Stat strip ×4 (הוצאה/ערך/ROAS+Badge/המרות)
				loading / role=alert error card w/ נסה-שוב retry / empty state
				ad TableBase (minWidth 720, stickyHeader): AdSortHeader ×7 + non-sort ROAS Shopify / first-click headers · rows: optimized toggle, bdi ad name, spend/value, ROAS full-cell tint OR pending text, ROAS-Shopify cell w/ trust mini-chip, first-click cell w/ delta + FirstClickCoverageChip, conversions/impressions/clicks, deep-link
```

## חוב-עיצובי בפרוסה (הגרוע קודם)

- ROAS band-signal renders two different ways one click apart: AdsDrawer ad rows still use the pre-2026-06-01 pale full-cell BADGE_TONE_BG tint (AdsDrawer.tsx:667) while CampaignsTableRow, AdSetTable, CampaignDrawerAds and the drawer header all use the operator-mandated solid ROAS_BADGE_SHAPE + ROAS_TONE_BG badge — direct inconsistency inside the LOCKED band-color system that any redesign must unify (to the solid badge, not away from it).
- Two hand-rolled, non-portalled popovers survive inside scroll containers — CampaignsColumnsMenu (absolute, manual Esc/outside-click, z-30) and HealthScoreBadge's breakdown popover (z-[15] inside the table's overflow-auto box, clippable) — the exact bug class the project already fixed twice (ColumnHeaderTh portal migration, ProductPickerModal Radix incident). Should ride Radix Popover.
- Tooltip system abuse: the richest data in the slice (ROAS Shopify numerator breakdowns, trust verdicts, ad attribution) is delivered as giant \n-concatenated plain strings with manual ASCII space-alignment ('דיווח:        …') through HelpTooltip — unstyleable, alignment breaks in proportional fonts, and several HelpTooltips wrap non-phrasing elements (<tr> in CampaignsTableRow:238, <td> in AdsDrawer:644 and CohortComparisonPanel:189), leaning on the phrasing.ts escape hatch.
- Micro-typography chaos with no ramp: 10 ad-hoc sizes (text-[8px] through text-[13px], plus 10.5/11.5px) across the slice; text-[8px] uppercase trust chips (AdSetTable:274, AdsDrawer:702) and text-[9px] name-cell chips are below any legibility floor and below the project's own AA standard.
- Number-rendering split: <Money> (overflow-safe, compact-floor) is used only in CampaignsTableRow and CampaignsTopList; AdsDrawer, AdSetTable, CohortComparisonPanel, MetaShopifyReconciliation and AttributionGapPanel all render raw formatCurrency/fmtMoney strings — the 'numbers never clip' guarantee is not hermetic in this slice.
- Large duplicated blocks: the ~250-line CPM chart + baseline-toggle + legend + analysis-verdict assembly exists twice (CampaignsTable summary vs CampaignDrawerDaily); three private sort-header clones (SortHeader / AdSortHeader / AdSetSortHeader); trust-tone 4-level ladder inlined three times; GRADE_STYLES duplicated between HealthScoreBadge and HealthScorePanel; three different segmented-control hand-rolls from ghost Buttons.
- Header ⓘ overload: ~19 solid violet accent-circle ⓘ buttons in a single thead row (ColumnHeaderTh) — correct primitive, but the density makes the header the loudest element on the tab; needs a quieter trigger treatment in the redesign.
- Iconography split: emoji (🥇🥈🥉 🔗 🏪 ⏳ 💡 ⚠️) mixed with lucide icons across CohortComparisonPanel, ProductPickerModal, mapped-products chips, recommendation callouts; platform identity is a plain-text string in main table row subtitles while the drawer header and CampaignsTopList use the canonical PlatformBadge.
- Stacked-layer interaction model inconsistent: centered 880px modal (no fullscreen, ⤢ removed) → side-anchored 820px AdsDrawer WITH a fullscreen ⤢ toggle → centered 560px picker; z-index magic numbers (z-[15]/20/30/50/[60]) and a parallel drawerStack-Esc system alongside Radix dismissal.
- No loading skeletons anywhere and four divergent error-card designs (two without retry buttons); empty states are inconsistent one-offs — all visibly below the Home tab's polish bar.
- Status (סטטוס) and History (היסטוריה) sub-tabs are low-polish placeholders: string-concatenated classNames, raw English status enums (DELIVERING, BACKFILL_UNKNOWN) shown verbatim, metricsLagMinutes hardwired null, and the two tabs redundantly present the same 4 timestamps in different formats.
- Bespoke structural mechanisms to preserve carefully in a redesign (work, but are fragile): column visibility via injected <style dangerouslySetInnerHTML> keyed on data-col-id; columnOrder-driven th/td map rendering that must stay in lock-step between CampaignsTable and CampaignsTableRow; the 1340px min-width + 60vh scroll container that makes laptop viewing horizontally cramped with a non-sticky summary strip.

## קומפוננטות

### CampaignsTab (tab shell) · `nav`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/Dashboard.tsx (lines 1844-1879)
- **משטח-אב:** Campaigns tab
- **ויזואלית:** Vertical stack (space-y-4/5): SectionIntro (Megaphone icon, Hebrew title/description/formula line), PageScope chip, shared Filters bar, the winners/losers card, then ONE big glass card (rounded-xl bg-glass-1 border-glass-edge shadow-glass overflow-hidden) containing the entire CampaignsTable.
- **פרימיטיבים:** SectionIntro, PageScope, Filters, CampaignsTopList, CampaignsTable
- **חוב:** Everything below the intro lives inside a single monolithic glass card — no visual sectioning between toolbar/trust-panel/summary/table; the tab has no Home-tier hero or hierarchy, it opens straight into a dense data wall.

### QuadrantScatterCard → CampaignsTopList · `card`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/CampaignsTopList.tsx (mounted from Dashboard.tsx:1808-1842)
- **משטח-אב:** Campaigns tab, above the table card
- **ויזואלית:** rounded-xl glass card with two side-by-side ranked lists (md:grid-cols-2): מנצחים (Trophy, green heading) and לתשומת לב (AlertTriangle, red heading). Each Row: mono rank number, bdi campaign name, PlatformBadge+store line, big tabular ROAS number colored by band (green/blue winners, red/orange losers), spend+CAC line, verdict text with lucide ArrowLeft in green/red. Empty state: centered muted text.
- **פרימיטיבים:** Heading, Money, HelpTooltip, PlatformBadge, lucide icons
- **חוב:** Verdict thresholds (>=4, >=2.7, <1, <2) hardcoded in JSX, parallel to but separate from roasLabel band logic; ROAS number color ladder is bespoke per-variant rather than the shared ROAS tone map; CAC shown here but nowhere in the main table.

### CampaignsTable (root) · `table`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/CampaignsTable.tsx (2840 lines)
- **משטח-אב:** Campaigns tab glass card
- **ויזואלית:** Owns toolbar → AttributionGapPanel → summary strip → states → scrollable TableBase (sticky thead, min-w 1340px, max-h 60vh/calc(100vh-180px)) → show-more footer. Column show/hide implemented by injecting a <style dangerouslySetInnerHTML> that display:none's td/th[data-col-id] within .roas-campaigns-table. Hosts CampaignDrawer + AdsDrawer state, URL (c_*) state sync, and the roas-open-campaign-drawer event subscription.
- **פרימיטיבים:** TableBase, Button, Input, NativeSelect, Stat, Badge, HelpTooltip, Heading, ChartContainer, ChartTooltip*, CampaignsColumnsMenu, CampaignsTableRow, CampaignDrawer, AdsDrawer, Money (via row)
- **חוב:** 2840-line monolith mixing data plumbing and four visual sections; column hiding via raw injected CSS string is bespoke (no primitive); no density option; the summary strip is NOT sticky while scrolling 60vh of rows; CSV export covers only 7 of the ~19 visible columns.

### Toolbar (filters row) · `form`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/CampaignsTable.tsx (lines 1462-1641)
- **משטח-אב:** CampaignsTable top
- **ויזואלית:** Wrapping flex strip on bg-glass-2/40 with border-b. Mode + platform segmented controls are dir=ltr rounded-lg bordered tablists of ghost Buttons (active = bg-accent text-accent-fg with a color-mix hover). Store NativeSelect with StoreIcon, search Input with Search prefix, secondary CSV Button, mobile-only 'סינון נוסף' expander revealing platform/multi-mapped/optimized block, emoji 🔗 checkbox label, optimized counter (CheckCircle2 + 'N מסומנים' + נקה הכל ghost), muted row-count, CampaignsColumnsMenu button.
- **פרימיטיבים:** Button, Input (incl. type=checkbox), NativeSelect, HelpTooltip, CampaignsColumnsMenu, lucide icons
- **חוב:** Segmented controls are hand-built from ghost Buttons with rounded-none + divide-x rather than a shared SegmentedControl primitive (duplicated twice in this file and again in the drawer Daily tab); checkbox styling rides Input with accent-accent only; emoji 🔗 as icon; the active-tab hover uses an inline color-mix() expression — a one-off token escape.

### AttributionGapPanel · `card`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/CampaignsTable.tsx (lines 2558-2657)
- **משטח-אב:** CampaignsTable, between toolbar and summary
- **ויזואלית:** Full-bleed section tinted by verdict: border/bg status-green (good) or status-red (flag). Uppercase tracking-wider Hebrew/English mixed title 'התאמת שיוך · Meta & Google & TikTok ↔ Shopify'. 4-column grid: פלטפורמות מדווחות, Shopify בפועל, פער (signed, green/red), יחס אמינות % — each with tiny uppercase label, large tabular number with inline tiny 'CAD' span, sub-line ROAS. Footer interpretation paragraph ('משמעות:').
- **פרימיטיבים:** cn + formatCurrency only — no Stat/Card/Money primitives
- **חוב:** Completely bespoke KPI tiles that visually echo but do not reuse the Stat primitive sitting 20px below; numbers are raw formatCurrency strings (not <Money>, can overflow); only two tones (good/flag) so a 40% undercount renders 'good' green; the binary full-band tint is louder than anything on Home.

### Summary Stat strip + CPM expandable chart · `chart`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/CampaignsTable.tsx (lines 1643-1979)
- **משטח-אב:** CampaignsTable, under AttributionGapPanel
- **ויזואלית:** Strip on bg-gradient-to-l from-accent-bg to-glass-2: 7 Stat tiles (3/4/7 responsive grid); ROAS tile carries band Badge; CPM tile is clickable (active state) and expands a rounded glass panel: heading + scope label, half-vs-prev pill toggle (tiny 10px ghost buttons), 'הוסף ROAS לגרף' checkbox, X close; Recharts LineChart (CPM solid, prev dashed warning-color, ROAS dashed green on right axis), custom ChartTooltip with prev-delta %, manual legend swatches (inline-style background from CHART_COLORS), warning fallback banner, tone-coded ניתוח verdict box; footer CPC·CPA·impressions text line.
- **פרימיטיבים:** Stat, Badge, Button, Input(checkbox), Heading, ChartContainer, ChartTooltip/Label/Row/Value, recharts Line/XAxis/YAxis, CHART_COLORS tokens
- **חוב:** This entire ~300-line chart+analysis block is duplicated nearly byte-identical in CampaignDrawerDaily.tsx; legend swatches use inline style attrs; the accent gradient background is a one-off surface treatment; pill toggle is a third hand-rolled segmented control at text-[10px].

### ColumnHeaderTh + SortHeader · `primitive`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/CampaignsTable.tsx (lines 2676-2837)
- **משטח-אב:** CampaignsTable thead
- **ויזואלית:** Every <th> hosts a ghost-Button sort label (active = text-accent semibold + ArrowUp/Down; inactive arrow hidden until hover) PLUS a 20px solid accent circle ⓘ Button opening a rich HelpTooltip (portalled Radix popover) with multi-paragraph Hebrew metric explanations. Multi-line column labels (e.g. 'ערך Shopify / פלטפורמה') stack two spans at text-[9px]. aria-sort lives on the th.
- **פרימיטיבים:** Button, HelpTooltip (variant=rich, touchTrigger=child), lucide ArrowUp/Down/UpDown/Info
- **חוב:** ~19 solid violet ⓘ circles in one header row is severe visual noise vs Home polish; the RTL arrow-before-label ordering trick is hand-tuned per align value; SortHeader is re-implemented twice more (AdSortHeader in AdsDrawer, AdSetSortHeader in AdSetTable) with drifting hover-opacity details instead of one shared sortable-header primitive.

### CampaignsColumnsMenu · `form`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/CampaignsColumnsMenu.tsx
- **משטח-אב:** CampaignsTable toolbar
- **ויזואלית:** Secondary 'עמודות' Button (turns warning-toned with count pill when columns are hidden) opening a hand-rolled absolute popover (w-[300px], rounded-xl bg-glass-1 shadow-overlay z-30): heading + X, explainer, scrollable checkbox list (label+description per column) with per-row up/down chevron micro-buttons (w-6 h-6 bordered) for reordering, footer ghost-link actions (default view / restore all / reset order).
- **פרימיטיבים:** Button, Input(checkbox), HelpTooltip, Heading, lucide Columns3/RotateCcw/Chevrons
- **חוב:** Hand-rolled popover (manual Esc + mousedown-outside listeners, absolute positioning) instead of the Radix pattern the project standardized on after the inert-modal incident; not portalled so it depends on ancestor overflow; cramped 6px chevron buttons; drag-reorder absent (chevron-only).

### CampaignsTableRow · `table`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/CampaignsTableRow.tsx
- **משטח-אב:** CampaignsTable tbody
- **ויזואלית:** Whole <tr> wrapped in a HelpTooltip ('לחץ לפרטים מלאים'), hover bg-glass-2/40, cursor-pointer, keyboard-drillable (tabIndex + Enter/Space), optimized rows fade to opacity-50. Cells: (1) round optimized toggle Circle/CheckCircle2; (2) HealthScoreBadge; (3) name cell — numbered circle, truncated bdi name with tooltip, chip row: CBO/ABO accent chip, 'כבוי · DD/MM' Pause chip (glass), 'לא ממופה' Tag warning chip, CampaignFreshnessChip dot, 'טוען מ-Platform' Hourglass warning chip; platform·store muted subtitle; (4) Sparkline blue ROAS trend (64×20) or em-dash; (5) 15 reorderable metric cells: Money cells (compactAbove 100k), budget with 95% pacing warning color, conversionValue green when profitable, ROAS as SOLID rounded band badge (ROAS_BADGE_SHAPE+ROAS_TONE_BG) with 'מתעדכן…'/'ממתין…' pending fallbacks, ROAS Shopify number with giant concatenated-string tooltip, first-click cell at opacity-80 with delta (green/red) + FirstClickCoverageChip, deterministic/total Shopify value/units/orders cells with * fractional marker; (6) ExternalLink deep-link.
- **פרימיטיבים:** Money, Button, HelpTooltip, Sparkline, HealthScoreBadge, CampaignFreshnessChip, FirstClickCoverageChip, ROAS_TONE_BG/ROAS_BADGE_SHAPE tokens, lucide icons
- **חוב:** HelpTooltip wrapping a <tr> leans on the phrasing.ts asChild escape hatch (fragile DOM contract); chip row can stack 5 chips at text-[9px] and truncate the name to near-nothing; tooltips are plain strings with manual whitespace alignment ('דיווח:        ') that breaks in proportional fonts; trustLabel/confTone computed then void-ed (dead styling path); 7 inline IIFEs per row hurt scanability.

### HealthScoreBadge · `chip`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/HealthScoreBadge.tsx
- **משטח-אב:** CampaignsTableRow ציון cell
- **ויזואלית:** Solid band grade chip (A green / B blue / C #EF9331 orange / D-F red / ⏳ neutral) with white letter + score, ring-1. Click opens a hand-rolled absolute popover (w-320/340, rounded-xl glass, shadow-overlay, z-[15], start-0 anchored): header grade chip + label + ×, 4 weighted component rows each with label(weight), value/100, 1.5px progress bar colored by value bracket (green/blue/orange/red), reason text; footer formula + ROAS-basis explainer.
- **פרימיטיבים:** Button, HelpTooltip, cn; status-*Btn/Solid tokens
- **חוב:** Second hand-rolled popover (manual Esc/outside-click, not portalled) — at z-[15] inside the table's overflow-auto scroll box it can be clipped by the container edge, the exact bug class the column tooltips were portalled to fix; duplicates GRADE_STYLES + component-bar rendering with HealthScorePanel (two parallel grade→style tables to keep in sync).

### CampaignFreshnessChip · `chip`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/CampaignFreshnessChip.tsx
- **משטח-אב:** CampaignsTableRow name-cell chip row
- **ויזואלית:** 1.5px colored dot (green <15min / orange <60 / red ≥60 / gray null) + relative-minutes text in ink-secondary; tooltip shows the raw ISO timestamp.
- **פרימיטיבים:** HelpTooltip
- **חוב:** Tooltip content is the raw ISO string or English 'no live tick' (untranslated); dot uses template-string class concat; thresholds (15/60) differ from the dashboard-wide 15/30 stale-fade standard; no aria description of freshness state.

### FirstClickCoverageChip · `chip`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/FirstClickCoverageChip.tsx
- **משטח-אב:** CampaignsTableRow first-click cell + AdsDrawer first-click cell
- **ויזואלית:** Tiny rounded chip 'NN% first-click' at text-[10px] tabular-nums; quiet glass tone ≥50% coverage, warning tone below; cursor-help with explanatory tooltip; % display clamped to 100.
- **פרימיטיבים:** HelpTooltip, cn
- **חוב:** Minor: English 'first-click' literal inside Hebrew UI; consistent token usage otherwise.

### CampaignDrawer (compound modal root) · `modal`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/campaign-drawer/index.tsx (+ shim /Users/dorperetz/script-roas/dashboard-web/src/components/CampaignDrawer.tsx)
- **משטח-אב:** Portal over Campaigns tab (opened by row click / roas-open-campaign-drawer event)
- **ויזואלית:** Centered MODAL via Sheet variant='modal' (880px, mobile full-screen, zoom/fade entrance, p-0). Sticky neutral glass SheetHeader: hero-level campaign name (bdi), chip row — brand-tinted platform-pill wrapping PlatformBadge, store chip (glass pill + StoreIcon), solid band-tone ROAS chip ('ROAS 3.41×'), active-days chip (Calendar), accent Ads-Manager external link. SheetBody: red fetch-error strip (role=alert) when any of 3 strict fetchers fail; underline-variant Tabs with 6 triggers (סקירה/יומי/Ad Sets/מודעות/סטטוס/היסטוריה); footer 'לחץ Esc…' hint. Mounts ProductPickerModal + nested AdsDrawer as siblings inside the Sheet.
- **פרימיטיבים:** Sheet/SheetContent/Header/Body, Tabs/TabsList/Trigger/Content, Heading, PlatformBadge, NativeSelect, ROAS_TONE_BG, lucide icons, useDrawerEsc
- **חוב:** 1004-line stateful root still doing all fetching+derivation; manual body-scroll-lock effect alongside Radix; mixed-language tab labels ('Ad Sets' English vs Hebrew siblings); the TikTok store-mapping JSX is built inline in the root as a 'slot' IIFE rather than a component; onEscapeKeyDown preventDefault + custom drawerStack is parallel plumbing to Radix's own dismiss.

### CampaignDrawerOverview (סקירה sub-tab) · `card`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/campaign-drawer/CampaignDrawerOverview.tsx
- **משטח-אב:** CampaignDrawer › tab סקירה
- **ויזואלית:** (1) Scorecard: 4 Stat tiles — ROAS+band Badge, ערך המרות (positive accent), אמינות attribution score/100 + trust Badge, ציון בריאות letter/⏳ + grade Badge. (2) KPI grid: 5 Stats (הוצאה/המרות/CTR/CPC/CPA, compact density). (3) storeMappingSlot. (4) 'ניתוח מעמיק' heading + stack of OverviewAccordion <details> cards: HealthScorePanel, mapped-products (Edit3 'ערוך מיפוי' secondary Button, mono accent product-ID chips with 🔗 +N multi-map markers, warning footnote), CohortComparisonPanel, AttributionAnalysisPanel (open by default, trust Badge in summary), ProductChannelBreakdown, MetaShopifyReconciliation.
- **פרימיטיבים:** Stat, Badge, Button, HelpTooltip, Heading, OverviewAccordion(local details/summary), child panels
- **חוב:** OverviewAccordion is a local re-copy of the details.acc pattern (third copy in codebase per its own comment — CustomerValueTab/PnLBreakdown) rather than a shared Accordion primitive; product chips show raw numeric product IDs in mono font (no titles) with emoji 🔗; two parallel grade→tone maps (HEALTH_GRADE_META here vs GRADE_STYLES in panels) must stay in sync by hand.

### TikTok store-mapping slot · `form`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/campaign-drawer/index.tsx (lines 705-778)
- **משטח-אב:** CampaignDrawer › Overview tab, between KPI grid and accordions
- **ויזואלית:** Section: '🏪 חנות בעלת הקמפיין' panel Heading with orange '(לא ממופה · ברירת מחדל uzoshop)' suffix; muted explainer paragraph on bg-glass-2/40 with inline <code>; NativeSelect of stores (+'__unmapped__' option); orange AlertTriangle caveat line when remapped (data lags ~10 min).
- **פרימיטיבים:** Heading, NativeSelect, lucide AlertTriangle
- **חוב:** Emoji 🏪 as section icon; hardcoded 'uzoshop' default in copy; status-orangeFg caption text on glass is small (11px) for a destructive-ish action; lives inline in the root component rather than its own file.

### CampaignDrawerDaily (יומי sub-tab) · `chart`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/campaign-drawer/CampaignDrawerDaily.tsx
- **משטח-אב:** CampaignDrawer › tab יומי
- **ויזואלית:** Two chart sections in glass-bordered rounded-xl ChartContainers (min-h 200px): (1) הוצאה↔ערך stacked AreaChart with gradient fills (CHART_COLORS.spend red / value green), custom ChartTooltip, dot legend; (2) CPM LineChart — identical chrome to the table's expandable chart: half/prev pill toggle, ROAS-overlay checkbox, dashed prev + ROAS lines, swatch legend, PREV_PERIOD fallback warning banner, tone-coded ניתוח verdict box. Hidden entirely when <2 active days / range <3 days.
- **פרימיטיבים:** ChartContainer, ChartTooltip*, recharts Area/Line/Axes, Button, Input(checkbox), Heading, CHART_COLORS/CHART_AXIS_COLOR
- **חוב:** ~280 lines duplicated nearly verbatim from CampaignsTable's CPM block (toggle, legend, tooltip, analysis box) — two sources of truth for one visualization; legend swatches via inline style; the section renders nothing (no explanatory empty state) when the day-count gate fails.

### CampaignDrawerAdSets (Ad Sets sub-tab) · `table`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/campaign-drawer/CampaignDrawerAdSets.tsx
- **משטח-אב:** CampaignDrawer › tab Ad Sets
- **ויזואלית:** Thin wrapper: centered empty state (Layers icon + 'אין נתוני ad-sets לטווח הזה.') or AdSetTable.
- **פרימיטיבים:** AdSetTable, lucide Layers
- **חוב:** None local — inherits AdSetTable's debt.

### AdSetTable · `table`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/AdSetTable.tsx
- **משטח-אב:** CampaignDrawer › Ad Sets tab
- **ויזואלית:** Section heading 'אד-סטים (N)' + rounded-xl bordered scroll box (max-h 50vh) with TableBase (minWidth 720, sticky head): AdSetSortHeader ×6 (שם/הוצאה/תקציב יומי/ערך/ROAS/המרות, center-aligned) + non-sortable 'ROAS Shopify' th with tooltip. Rows: optimized toggle, truncated name, formatCurrency cells, budget with 95% pacing warning, value green-when-profitable, ROAS as SOLID band badge or plain 'מתעדכן…/ממתין…' text, ROAS Shopify cell — number + tiny text-[8px] uppercase trust chip (4-tone ladder) with mega string tooltip. Rows drillable to AdsDrawer (Meta/TikTok), keyboard reachable, optimized fade.
- **פרימיטיבים:** TableBase, Button, HelpTooltip, Heading, ROAS_TONE_BG/ROAS_BADGE_SHAPE, pendingRoasLabel, lucide icons
- **חוב:** HelpTooltip wraps both the <tr> and a bare <td> (invalid-DOM-adjacent pattern); text-[8px] trust chip is below any legibility floor; the 4-level trust tone ladder is inlined here AND in AdsDrawer AND CampaignsTableRow.computeTrustTone — three copies; numbers are raw formatCurrency (no <Money> overflow guard); AdSetSortHeader is the third private sort-header clone.

### CampaignDrawerAds (מודעות sub-tab) · `card`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/campaign-drawer/CampaignDrawerAds.tsx
- **משטח-אב:** CampaignDrawer › tab מודעות
- **ויזואלית:** Section heading + muted explainer ('נתוני מודעות נטענים לפי ad-set…') with inline orange AlertTriangle hint when platform unsupported (Google PMax). List of glass pill rows (rounded-lg border bg-glass-1 hover:bg-glass-2): ad-set name (bdi), spend·conversions subline, ROAS solid badge / pending text, ghost 'פתח מודעות' Button with ChevronLeft. Empty state: 'אין ad-sets עם מזהה לדריל-דאון.'
- **פרימיטיבים:** Button, HelpTooltip, Heading, ROAS_TONE_BG/ROAS_BADGE_SHAPE, pendingRoasLabel, fmtMoney, lucide icons
- **חוב:** This tab is a launcher list, not an ads roll-up — same data as the Ad Sets tab re-rendered as pills (acknowledged stopgap in its header comment); duplicates the ROAS-badge/pending IIFE from AdSetTable.

### CampaignDrawerStatus + CampaignDrawerStatusSection (סטטוס sub-tab) · `card`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/campaign-drawer/CampaignDrawerStatus.tsx + /Users/dorperetz/script-roas/dashboard-web/src/components/CampaignDrawerStatusSection.tsx
- **משטח-אב:** CampaignDrawer › tab סטטוס
- **ויזואלית:** Bordered rounded-lg section 'סטטוס + טריות': 3-column chip grid (configured/effective/delivery labels in tiny ltr bdi English) — configured turns warning chip '⏳ טוען מ-Platform' on BACKFILL_UNKNOWN, delivery chip colored by DELIVERY_TONE map (green/blue/orange/red/glass); optional warning explainer paragraph; 'היסטוריית סטטוס' 2-col grid of relative timestamps (נראה לראשונה, last status change, last success, last_live_tick, metrics lag).
- **פרימיטיבים:** Heading only — bespoke chips
- **חוב:** Visibly lowest-polish surface in the drawer: string-concatenated className (no cn), raw English enum values (DELIVERING, BACKFILL_UNKNOWN) shown verbatim, no Badge primitive reuse, '!text-ink-secondary' important override on Heading, metricsLagMinutes is always passed null so 'metrics lag' permanently renders '—'.

### CampaignDrawerHistory (היסטוריה sub-tab) · `card`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/campaign-drawer/CampaignDrawerHistory.tsx
- **משטח-אב:** CampaignDrawer › tab היסטוריה
- **ויזואלית:** 'ציר זמן רישומי' heading + muted explainer admitting the change-log doesn't exist yet (Phase E2+); 4 pill Rows (glass border, Clock icon label / tabular date) for firstSeen/statusChanged/lastSuccess/lastLiveTick; centered empty state when all null.
- **פרימיטיבים:** Heading, formatDate, lucide Calendar/Clock
- **חוב:** Essentially a placeholder tab duplicating 4 of the 6 timestamps already shown on the סטטוס tab in different formatting (relative there, absolute here) — two tabs for one dataset.

### AdsDrawer · `drawer`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/AdsDrawer.tsx
- **משטח-אב:** Nested over CampaignDrawer modal (z-[60]) OR directly over Campaigns tab from ad-set-mode rows
- **ויזואלית:** Side sheet (side='end', 820px default, animated max-width fullscreen ⤢ toggle persisted in localStorage). Header: accent-soft Layers icon square, uppercase 'מודעות ב-ad-set' kicker, bdi ad-set name, Maximize2/Minimize2 ghost button. Body: 4 Stat totals strip; loading text; rich role=alert error card (AlertTriangle, mono error, secondary 'נסה שוב' retry); empty state with worker-cadence copy; rounded-xl scroll box (max-h 60vh) with TableBase: AdSortHeader ×7, ROAS Shopify + first-click plain th's with tooltips. Rows: optimized toggle, bdi ad name (HelpTooltip wrapping <td>), spend/value end-aligned, ROAS as FULL-CELL pale tint via BADGE_TONE_BG (or plain pending text), ROAS Shopify number + text-[8px] trust chip + concatenated-string mega tooltip, first-click number + delta + FirstClickCoverageChip at opacity-80, conversions/impressions/clicks, ExternalLink deep-link.
- **פרימיטיבים:** Sheet/SheetContent/Header/Body, Stat, Badge tokens (BADGE_TONE_BG), Button, HelpTooltip, Heading, TableBase, FirstClickCoverageChip, pendingRoasLabel, useDrawerEsc
- **חוב:** WORST band-color inconsistency in the slice: ad-row ROAS still uses the pre-2026-06-01 pale full-cell BADGE_TONE_BG tint while every sibling surface (campaign rows, ad-set rows, drawer chips) migrated to the solid ROAS_BADGE_SHAPE badge — the locked V4 ROAS signal renders two different ways one drilldown apart; keeps a fullscreen ⤢ the Campaign modal explicitly removed (inconsistent interaction model across the stack); side-sheet-over-centered-modal geometry reads oddly; raw formatCurrency numbers (no Money); text-[8px] trust chips; AdSortHeader clone #2.

### AdSortHeader / AdSetSortHeader · `primitive`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/AdsDrawer.tsx (796-860) + /Users/dorperetz/script-roas/dashboard-web/src/components/AdSetTable.tsx (299-366)
- **משטח-אב:** AdsDrawer table / AdSetTable theads
- **ויזואלית:** Both mirror CampaignsTable's SortHeader: ghost Button label + accent arrow when active, hover-revealed ArrowUpDown otherwise, aria-sort on th, RTL arrow-before-label for end-aligned columns.
- **פרימיטיבים:** Button, lucide arrows
- **חוב:** Three near-identical private sort-header implementations with subtle drift (hover opacity-100 vs opacity-60; no tooltip/ⓘ support outside the main table) — prime consolidation target before any visual redesign.

### ProductPickerModal · `modal`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/ProductPickerModal.tsx
- **משטח-אב:** Nested modal over CampaignDrawer (z-[60], 560px; full-screen on mobile)
- **ויזואלית:** Sheet variant='modal' with bespoke header (accent Package icon square, kicker 'שייך מוצרי {store} לקמפיין', truncated campaign name, store scope line, custom X), search strip (warning banner 'הקטלוג עוד לא סונכרן' with mono 'Sync now' kbd-style code, explainer, autoFocus search Input with suffix icon), body: loading / role=alert error card with retry / empty states / product list — each row a full-width ghost Button with custom 5px checkbox square (accent when on), title + units·revenue subline or 'עדיין לא בוצעו מכירות', 🔗 multi-mapping warning chip listing other campaigns; SheetFooter: 'N נבחרו' + ביטול/שמור (Check icon) buttons.
- **פרימיטיבים:** Sheet (nested Radix dialog), SheetHeader/Body/Footer/Title, Button, Input, HelpTooltip, Heading, fmtMoney, markEscHandledByInnerLayer
- **חוב:** Custom-drawn checkbox square instead of a shared Checkbox primitive (third checkbox style in the slice after Input[type=checkbox] and the optimized Circle toggle); emoji 🔗 chips; the catalog warning banner references operator-console UI ('Sync now') inside an operator-facing flow without a link.

### HealthScorePanel · `card`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/HealthScorePanel.tsx
- **משטח-אב:** CampaignDrawer › Overview › accordion 'ציון בריאות קמפיין'
- **ויזואלית:** InsightCard (neutral) hosting: 56-64px solid band grade tile (white letter on green/blue/#EF9331/red, ring) + tone-colored label + score/100 + explainer; 4 component rows with 2px progress bars (value-bracket colors) + reason lines; 'המלצה' list (← arrows) derived from weakest component; tiny formula + ROAS-basis footer; InsightActions Ads-Manager deep-link footer (hidePrimary).
- **פרימיטיבים:** InsightCard, InsightActions, cn, status-*Btn/Solid tokens
- **חוב:** Duplicates GRADE_STYLES/COMPONENT_LABELS/barColor from HealthScoreBadge (parallel tables, acknowledged in comments); '←' is a raw text arrow rather than an icon; long Hebrew copy blocks at 12-13px with no max-width rhythm.

### AttributionAnalysisPanel · `card`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/AttributionAnalysisPanel.tsx
- **משטח-אב:** CampaignDrawer › Overview › accordion 'ניתוח attribution' (open by default)
- **ויזואלית:** Whole card tinted by trust level (green/warning/glass/red bg+border+Fg text). Optional red role=alert pixel-broken banner ('הילה חריגה'). Header: big trust score /100 + label, 2-col ROAS pair (click-id ROAS with 95% interval vs platform ROAS). Deterministic-vs-modeled split bar using bg-current at opacity-70/25. Bullet reasons list, 💡 recommendation callout (bg-glass-1/60 border-current/20), window-stability + outlier footer chips, InsightActions deep-link footer.
- **פרימיטיבים:** Heading, InsightActions, fmtMoney, cn, lucide TrendingUp/AlertTriangle
- **חוב:** Heavy reliance on bg-current/border-current + opacity-60..90 layers over tone backgrounds — contrast is derived, not guaranteed by paired tokens, so AA depends on each tone color in each theme; emoji 💡 in copy; uppercase English micro-labels ('ROAS אמיתי (click-id)') mix scripts mid-line.

### CohortComparisonPanel · `table`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/CohortComparisonPanel.tsx
- **משטח-אב:** CampaignDrawer › Overview › accordion 'השוואת cohort'
- **ויזואלית:** Header: Trophy heading + explainer; rank chip 'במקום X מתוך Y' with 🥇/🥈/🥉/#N MedalIcon, green only when leader qualifies (≥2x), red when weakest of ≥3, else warning. Cannibalization banner (red/amber/accent by worst risk) listing per-product spend→revenue growth + marginal ROAS + reason; neutral 'composition changed' info banner. Two CohortSection tables (intra = warning-tinted shell with AlertCircle, cross = glass with Equal icon): TableBase rows with medal rank, 'את/ה כאן' accent-highlighted current row, shared-product count, spend, ROAS Shopify (מוקצה), ROAS פלטפ., conversions, פעיל/כבוי StatusBadge; non-current rows clickable to swap the drawer. Educational footer card 'איך לקרוא'.
- **פרימיטיבים:** TableBase, Heading, HelpTooltip, fmtMoney, lucide icons
- **חוב:** Emoji medals 🥇🥈🥉 + '⚠️' inside an otherwise lucide-icon system; HelpTooltip wraps a raw <td> (line 189); intra section paints its ENTIRE table shell status-warningBg — a full-surface warning tint stronger than actual alerts elsewhere; 9-10px header text in tables.

### MetaShopifyReconciliation · `chart`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/MetaShopifyReconciliation.tsx
- **משטח-אב:** CampaignDrawer › Overview › accordion 'התאמת ערוצים↔Shopify'
- **ויזואלית:** Glass panel: dismissible info chip (mapping is current-state), dark-traffic warning chip, correlation verdict block (colored strong text: מתאם גבוה/חלקי/אין מתאם across ~12 copy branches), r-value chip row (r(Meta)/r(Google)/r(TikTok)/r(Organic)/r(Combined)), lag-detected warning banner, h-32 ComposedChart — 4 solid brand-colored platform lines + dominant dashed green Shopify truth line, custom tooltip with magnitude-aware precision, 5-entry legend (inline-style swatches + SVG dashed swatch for Shopify), two centered denomination-disclaimer paragraphs, <details> 'יום-לפי-יום' expandable day table (7 cols, פער delta colored green/red).
- **פרימיטיבים:** ChartContainer, ChartTooltip*, recharts ComposedChart/Line/Axes, TableBase, Heading, Button, HelpTooltip, CHART_COLORS
- **חוב:** 858-line file mixing pure math (pearson, buildReconciliation) with the view; bare <details>/<summary> for the day table (no OverviewAccordion/acc styling — a fourth accordion look); legend swatches inline-style; h-32 chart is small for 5 overlapping series; long disclaimer paragraphs at text-[10px] centered — dense reading.

### ProductChannelBreakdown · `chart`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/ProductChannelBreakdown.tsx
- **משטח-אב:** CampaignDrawer › Overview › accordion 'פילוח מוצר × ערוץ'
- **ויזואלית:** Glass panel: dismissible info chip (sessionStorage), totals line, channel counts line (פייסבוק/גוגל/טיקטוק/ישיר/אחר), 2.5px-high 5-segment horizontal bar (Meta/Google/TikTok via CHART_COLORS inline styles, direct/other neutral grays), conditional recommendation chips — green '💡 NN% מפייסבוק → ביטחון להעלאת תקציב' (≥60%) or amber '⚠️ …בדוק לפני העלאת תקציב' (<30% & ≥5 orders).
- **פרימיטיבים:** Button, HelpTooltip, Heading, CHART_COLORS, lucide Info/Package/X
- **חוב:** Segment bar has no labels/legend on the bar itself (counts only in a text line above — color mapping must be inferred); emoji 💡/⚠️ chips; HelpTooltip wraps the entire info-chip div (block trigger).

### Fetch-error strips & empty/loading states (slice-wide inventory) · `card`

- **קובץ:** CampaignsTable.tsx:1989-2011, campaign-drawer/index.tsx:859-868, AdsDrawer.tsx:472-529, ProductPickerModal.tsx:341-393
- **משטח-אב:** All campaigns surfaces
- **ויזואלית:** Four error treatments: table-level red card (AlertCircle + message); drawer red strip listing failed sources ('שגיאה בטעינת X · Y'); AdsDrawer/ProductPicker rich error cards with mono error text + retry Button. Empty states: Megaphone (table), Layers (ad-sets/ads), Package (picker) icon + 1-2 muted lines. Loading: plain centered 'טוען…' text everywhere (no skeletons).
- **פרימיטיבים:** Button, lucide icons
- **חוב:** Four bespoke error layouts with different paddings/radii/copy structure and inconsistent retry affordance (table + drawer strip have NO retry button, AdsDrawer/Picker do); zero loading skeletons anywhere in the slice — every surface pops in from a text placeholder, far below Home-tab polish.

---

# לקוחות + תשלומים (customers-payments) — 21 קומפוננטות

## עץ-המשטח

```
Dashboard shell (src/components/Dashboard.tsx, dir="rtl" bg-canvas, Sidebar right-rail)
	Sidebar nav — 'לקוחות' (key customers, slot 3, Users icon) · 'תשלומים' (key payments, slot 9, CreditCard icon)
	TAB לקוחות — CustomerValueTab (scope OWNED by Dashboard.customersScope; blendedNcac + spendByMonth computed in Dashboard.tsx:631-702, mapping-aware)
		SectionIntro header "כמה שווה לך לקוח" (Gem icon) + rightSlot
			CohortAsOfBadge — freshness chip (null → nothing / ≤7d blue "עודכן: DD/MM" / >7d warning + ⚠️ + HelpTooltip)
			NativeSelect scope picker (כל העסק / per-store) — the "per-store sub-tabs" mechanism
			Basis segmented toggle רווח|הכנסה (bespoke radiogroup of ghost Buttons)
		[error] cv-error red alert strip + "נסה שוב" retry Button
		[loading] cv-loading skeleton (1× h-24 hero + 4× KPI blocks + "טוען…")
		1. Verdict Card — run-on Hebrew sentence: LTV/nCAC/net-per-customer/payback/repeat + LTV:nCAC ratio badge + B1 era-tag "מבוסס על קבוצות בוגרות" + B1 bridge line (cv-recent-bridge) + A4 empty-copy variants
		2. KPI Card ×4 (grid-cols-2 → sm:4): שווי לקוח / nCAC / payback / repeat
		3. Curve Card → CustomerValueCurve (SVG zones LTV chart: amber/green payback zones, dashed nCAC line, glow line, pulsing payback pill, hover/tap crosshair + bespoke HTML tooltip) + "?" HelpTooltip trigger + 3-swatch legend
		4. New-vs-old Card — verdict subtitle (green/red/empty-copy) + two bespoke horizontal bars (חדשים green / ותיקים gray)
		5. Advanced Card
			<details> cv-advanced "▸ תצוגה מתקדמת" (collapsed by default)
				CohortGridAdvanced → CohortYearAccordion per cohort-year (newest open, rotating chevron) → CohortYearGrid M0..M11 green heatmap (TableBase; striped future cells, dimmed "(חלקי)" partial cells)
			per-cohort nCAC footer — by-year month lists; muted "אין נתוני הוצאה" pre-May; "(חלקי)" current-month flag
	TAB תשלומים — PaymentMethodsTab
		SectionIntro header "אמצעי תשלום" (CreditCard icon) + rightSlot
			Granularity segmented toggle חודש|רבעון|שליש
			Scope segmented toggle כלל-העסק|פר-חנות
			NativeSelect store picker (renders only in store scope)
		[error] pm-error red alert strip + retry
		[loading] pm-loading 4-skeleton grid
		[settled-empty] pm-empty Card ("הדאטה תופיע ברגע שהזמנות יסונכרנו")
		Summary strip — pm-summary-total Card (orders · CAD + ShareBar + 3-chip legend) + GatewaySummaryCard ×3 (אשראי / PayPal / אחר)
		[pre-backfill] pm-backfill-hint Card ("אחר / לא ידוע" relabel)
		"פילוח לפי שנה" Card (variant="flat" p-0, header icon-chip, max-h-[62vh] scroll body)
			YearAccordion per year (newest open) — summary row: year totals + w-24 ShareBar + per-gateway inline stat chips
				PeriodRowsTable — 12-col two-tier-header TableBase (minWidth 720, stickyHeader)
			PaymentGrandTotal — SEPARATE TableBase footer row "סך הכל" + ShareBar + sr-only label row
			pm-note footer strip (payment_gateway_names source caveat)
NOTE: CohortComparisonPanel.tsx is NOT in this slice — it renders inside campaign-drawer/CampaignDrawerOverview.tsx (campaign↔store cohort mapping panel), not in either tab.
```

## חוב-עיצובי בפרוסה (הגרוע קודם)

- Duplicated bespoke patterns with no shared primitive — the SAME hand-rolled chrome appears 2-3× across the slice: error alert strip (cv-error ≡ pm-error), segmented radio-toggle (×3, also missing radiogroup arrow-key a11y), details-accordion shell (CohortYearAccordion ≡ YearAccordion), and stacked/progress bars (ShareBar vs new-vs-old bars vs heatmap tiles). A visual redesign must extract Alert, SegmentedControl, Accordion, and StackedBar primitives FIRST or it will fork these further.
- Semantic token collision: PayPal is colored with the Meta platform chart token (bg-chart-meta / text-chart-meta) in ShareBar + PeriodRowsTable headers — repurposing the locked brand-mirrored chart palette for a non-platform domain; retuning Meta blue would silently recolor PayPal. Needs its own gateway-palette tokens.
- Verdict card density + correctness coupling: CustomerValueTab's single run-on sentence carries 6+ metrics, a hand-rolled (non-Badge-primitive) ratio badge, era-tag, and bridge line, all driven by correctness-load-bearing guards (B1 badge downgrade, B3 profit-pinning, A4 missing-side copy, A7 ratio/net floors). Highest-risk element in the slice for redesign-induced truth regressions — restructure visually, never simplify the copy logic.
- Grand-total column drift: PaymentGrandTotal is a separate <table> from the per-year PeriodRowsTable instances, so the totals row's 12 columns can never align with the columns being totaled — a visible artifact of the accordion refactor; same family as the triple-nested scroll (page → max-h-[62vh] card body → minWidth-720 horizontal table) on mobile.
- Arbitrary-px typography everywhere: text-[15.5px]/[13.5px]/[12.5px]/[11.5px]/[10.5px]/[10px] and raw SVG fontSize 10.5-12 across both tabs instead of the token type ramp — the slice has its own ad-hoc scale, below Home polish; % cells and explainers sit at the legibility floor.
- No freshness/staleness system on financial data: neither tab uses Card freshness desaturation; CustomerValueTab only has the CohortAsOfBadge (a third freshness idiom vs FreshnessChip/TabFreshnessHeader), PaymentMethodsTab has nothing — stale payment splits render indistinguishably from live data.
- Chart-engine fragmentation: CustomerValueCurve is a fully bespoke 540-line SVG chart (third idiom beside Recharts and Sparkline) with hardcoded geometry (122px callout pill, fixed PAD/viewBox), a fourth bespoke tooltip surface, possible zone-label/pill collisions, and legend swatches drawn with pale *Bg background tokens that likely miss the 3:1 graphical bar in light theme.
- Inconsistent expand affordances + section chrome: the customers advanced card uses a static '▸' literal that never rotates, one level above rotating-chevron accordions; PaymentMethodsTab's main section is a Card variant='flat' p-0 (no surface at all) while every customers-tab section is a full glass Card — and its icon-chip uses bg-accent-soft where SectionIntro uses bg-accent-bg.
- Sub-Home-tier secondary states: loading skeletons ghost only the top sections (below-fold layout pop-in), skeleton radii don't match real card radii, pm-empty/pm-backfill-hint are plain prose Cards with no status tint or icon, and the curve-help '?' trigger is a faint outline circle contradicting the operator-locked solid-accent ⓘ standard (commit 7452b9b).
- Mobile heatmap scroll: CohortGridAdvanced's M0..M11 grid (min 620px) scrolls horizontally with NO sticky cohort-month label column, so row identity is lost mid-scroll; single-hue green ramp also compresses the meaningful 8-20% retention range and partial-cell opacity-60 dimming is ambiguous with low retention.

## קומפוננטות

### CustomerValueTab (tab root) · `card`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/CustomerValueTab.tsx
- **משטח-אב:** Dashboard shell → tab 'customers' (לקוחות), Dashboard.tsx:859-868
- **ויזואלית:** Vertical stack (space-y-4 sm:space-y-5, animate-fade-in-up): SectionIntro header with right-slot controls (CohortAsOfBadge chip, w-40 NativeSelect scope picker, segmented רווח/הכנסה toggle in a bordered bg-glass-2 pill, active = bg-accent-btn text-accent-fg) → verdict Card → 4-KPI grid → curve Card → new-vs-old Card → advanced Card. Three top-level states: error (red rounded-xl alert strip, border-status-red bg-status-redBg, AlertTriangle, mono error excerpt, secondary retry Button), loading (skeleton h-24 hero + 2×2/4-up skeleton KPI blocks, aria-busy), data. Profit verdict is profit-pinned regardless of basis toggle (B3); LTV:nCAC badge tones via status tokens (good ≥3 green / 1–3 warning / <1 red, B1 downgrade to amber when recent cohorts pay back).
- **פרימיטיבים:** Card, Button, NativeSelect, Money, HelpTooltip, SectionIntro, CohortAsOfBadge, CustomerValueCurve, CohortGridAdvanced; SWR + fetchJsonStrict; cn; status-* and glass tokens
- **חוב:** Heavy arbitrary-px type ramp throughout (text-[15.5px]/[17px]/[13.5px]/[12.5px]/[11.5px]/[10px]) instead of the token scale — lower consistency than Home. Segmented toggle is a bespoke pattern (ghost Buttons + role=radio inside a bordered div) duplicated 3× across this slice with no shared SegmentedControl primitive and no arrow-key radiogroup keyboard support. The '?' curve-help trigger (line 648-654) is a faint h-4 w-4 border-glass-edge text-ink-muted outline circle — contradicts the operator-locked solid-accent ⓘ trigger standard (commit 7452b9b). No Card freshness/band props used — the 3-stage freshness desaturation system that Home cards get is absent here (CohortAsOfBadge partially compensates). No settled-empty card distinct from the verdict copy (empty state is prose inside the verdict card).

### Verdict card (cv-verdict, 'THE BOTTOM LINE') · `card`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/CustomerValueTab.tsx
- **משטח-אב:** CustomerValueTab section 1 (lines 474-599)
- **ויזואלית:** Default glass Card holding ONE long run-on Hebrew sentence (text-[15.5px] sm:text-[17px] font-semibold leading-relaxed) with ~8 inline bold colored spans: LTV in green/accent, nCAC in ink, net-per-customer green or red 'מפסיד', payback months in accent, repeat % in ink, ratio ×N in band tone, then an inline pill badge (rounded-full px-2.5, bg-status-greenBg/redBg/warningBg) + a muted '· מבוסס על קבוצות בוגרות (12 ח׳+)' era-tag + optional green block bridge line (cv-recent-bridge '↗ אבל הקבוצות שגייסת לאחרונה חזקות יותר…'). Empty variants: A4 copy naming WHICH side is missing (mature LTV vs nCAC), muted ink.
- **פרימיטיבים:** Card, Money, cn; status-greenFg/redFg/warningFg + Bg tokens
- **חוב:** A single paragraph carrying 6+ metrics, a badge, an era-tag and a bridge is the densest typography in the app — visually cramped vs Home's structured hero; redesign risk is HIGH here because the copy logic (B1/B3/A4/A7 guards: ratio floor 0.99 when losing, −$1 net floor, badge downgrade) is correctness-load-bearing and must survive any visual split. Badge is hand-rolled spans, not the Badge primitive. All sizes arbitrary px.

### KPI card row (cv-kpi ×4) · `card`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/CustomerValueTab.tsx
- **משטח-אב:** CustomerValueTab section 2 (lines 602-635)
- **ויזואלית:** grid-cols-2 gap-3 sm:grid-cols-4 of identical p-4 glass Cards: xs font-semibold ink-secondary label → text-2xl font-extrabold value (Money or tabular text, e.g. '4 ח׳', '6%') → text-[11.5px] ink-muted explainer line. Neutral ink values (no band coloring).
- **פרימיטיבים:** Card, Money
- **חוב:** Bespoke KPI markup repeated 4× inline instead of a shared Metric/KpiCard primitive (Home hero uses richer primitives); payback and repeat values bypass Money (plain tabular spans — fine for short strings but inconsistent); '—' em-dash fallback for null payback has no sr-only explanation. Explainer at 11.5px is near the legibility floor.

### CustomerValueCurve (zones LTV chart) · `chart`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/CustomerValueCurve.tsx
- **משטח-אב:** CustomerValueTab section 3 curve Card
- **ויזואלית:** 720×320 viewBox responsive SVG: neutral plot scrim (chart-grid-line @ .5 opacity, rx10) → amber/green background zones split at payback (status-warning-bg / status-green-bg, fade-in cv-anim-zone) → 5 y-gridlines + compact $ labels (chart-axis, 11px) → 6 x labels ('רכושה'/'ח׳ N') → accent-gradient area fill → green profit wedge (status-green @ .16) → dashed status-warning nCAC line + 'קו עלות-גיוס $N' label → glowing 3.4px accent Catmull-Rom line with draw-in dash animation (cv-anim-line, --cv-line-len) → payback marker: dashed accent drop-line, pulsing ring (cv-pulse), solid dot, and a 122×38 callout pill (fill var(--accent-btn), white accent-fg text '↩ נקודת החזר / חודש N'). Hover/tap: accent crosshair + dot + bespoke HTML tooltip (rounded-card border-glass-edge bg-glass-1 shadow-overlay, dir=rtl, Money value, green/amber above/below-line verdict line). Touch: pointerdown shows, document tap-out dismisses. prefers-reduced-motion collapses all cv-* animations (globals.css:887-917).
- **פרימיטיבים:** Money, fmtMoneyCompact; CSS vars --accent/--accent-btn/--accent-fg/--status-green*/--status-warning*/--chart-grid-line/--chart-axis/--glass-1; cv-* keyframes in globals.css
- **חוב:** Fully bespoke SVG chart engine — shares nothing with RoasTargetChart/Sparkline/Recharts (third charting idiom in the app). Hardcoded geometry constants (VIEW_W/H, PAD, pill w=122/h=38) — long Hebrew strings could overflow the fixed pill; SVG font sizes (10.5–12) are raw numbers outside the type ramp. Zone labels ('עדיין מחזיר עלות') suppressed below 70px width but the green 'רווח' label can still collide with the callout pill. Tooltip is a fourth tooltip surface (not HelpTooltip/RichPopover/ChartTooltip — chrome matched by hand per the comment). Legend swatches in the parent card use BACKGROUND tokens (bg-status-warningBg/greenBg) as graphical swatch colors — pale, likely under the 3:1 graphical-object bar in light theme.

### New-vs-old comparison card · `card`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/CustomerValueTab.tsx
- **משטח-אב:** CustomerValueTab section 4 (lines 686-743)
- **ויזואלית:** Glass Card: bold heading 'הלקוחות החדשים — טובים יותר או פחות מהוותיקים?' → verdict subtitle (green '<b>N% יותר</b>' / red 'N% פחות' / muted empty-copy 'אין עדיין מספיק קבוצות…') → when comparable, two flex-wrapped bars (min-w-[180px] flex-1): label row (xs ink-secondary + bold Money) over an h-3.5 rounded-full bg-glass-2 track with inline-width fill — recent = bg-status-green, veterans = bg-ink-muted. Bars gated on the SAME canCompare condition as the sentence (A5).
- **פרימיטיבים:** Card, Money; status-green / ink-muted tokens
- **חוב:** Bespoke progress bars (inline style width %, no shared Bar/Progress primitive — ShareBar in PaymentMethodsTab is a parallel reinvention). Veteran bar fill reuses a TEXT token (bg-ink-muted) as a data fill. No animated growth, no value-on-bar, no axis — flatter polish than Home's chart work. Bars carry no aria/role=meter semantics.

### Advanced cohort card (cv-advanced details + nCAC footer) · `card`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/CustomerValueTab.tsx
- **משטח-אב:** CustomerValueTab section 5 (lines 746-801)
- **ויזואלית:** Glass Card containing a native <details>: marker-less summary '▸ תצוגה מתקדמת — רשת ה-cohorts המלאה (לחובבי דאטה)' in accent bold 13.5px; body = explainer line + CohortGridAdvanced. Below a border-t divider: per-cohort nCAC footer (11.5px ink-muted prose) — by-year groups (DESC) each a bold year label + flex-wrapped <ul> of 'YYYY-MM $N' items, muted 'אין נתוני הוצאה' for pre-May-2026 cohorts, '(חלקי)' suffix on the current month (A2).
- **פרימיטיבים:** Card, Money; details/summary; glass-edge token
- **חוב:** The '▸' is a hardcoded literal glyph that never rotates on open — inconsistent with the rotating ChevronDown carets used by the year accordions one level down (two expand affordances in the same card). The nCAC footer is a wall of tiny 11.5px wrapped list items — the least scannable element in the tab; the same by-year data begs for the grid's accordion treatment. No transition on details open/close.

### CohortGridAdvanced (by-year retention heatmap) · `table`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/CohortGridAdvanced.tsx
- **משטח-אב:** CustomerValueTab → advanced card → <details> body
- **ויזואלית:** space-y-2.5 stack of CohortYearAccordion blocks: each a <details class='group rounded-card border border-glass-edge bg-glass-2/40'> with marker-less summary (rotating ChevronDown group-open:rotate-180, bold tabular year, '· N קבוצות' muted count); newest year open by default. Body = overflow-x-auto CohortYearGrid: TableBase minWidth 620, border-separate 3px spacing, M0..M11 header (10.5px bold ink-muted), row label = cohort month (11px bold ink-secondary, text-end), cells = h-7 min-w-[42px] rounded-md tiles: green heatmap via inline color-mix(in srgb, var(--status-green) N%, var(--glass-2)) with sqrt-eased tint capped at 55% so text-ink keeps AA; future cells = striped repeating-linear-gradient placeholder @ opacity-40; current-month partial cell = opacity-60 + aria-label 'N% (חלקי)'.
- **פרימיטיבים:** TableBase, ChevronDown (lucide), cn; --status-green/--glass-2 vars; monthsBetween/COHORT_HORIZON from lib
- **חוב:** Heatmap tint + stripe pattern are inline style attributes (token-driven values but unhookable by the theme/ratchet guards that scan classes). Single-hue green ramp encodes 0–100% — low differentiation in the 8–20% range typical of retention; partial-cell dimming (opacity-60) is visually identical to 'slightly lower retention' at a glance. min-w-[42px]×12 forces ~620px horizontal scroll on mobile with no sticky row-label column, so month labels scroll out of view. Accordion surface (bg-glass-2/40) is a one-off alpha variant rather than a tokenized sub-surface.

### CohortAsOfBadge (freshness chip) · `chip`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/customers/CohortAsOfBadge.tsx
- **משטח-אב:** CustomerValueTab SectionIntro rightSlot
- **ויזואלית:** Badge primitive: fresh (≤7d) = blue tone 'עודכן: DD/MM' with LTR-isolated <bdi> date; stale (>7d) = warning tone + ⚠️ emoji + cursor-help, wrapped in HelpTooltip ('נתוני קוהורט מתעדכנים שבועית (שני 04:00)'); asOf null renders nothing (no false freshness claim). Israel-TZ date math, deterministic `now` seam for tests.
- **פרימיטיבים:** Badge (status-blueBg/warningBg on-color tokens), HelpTooltip
- **חוב:** Minimal. The ⚠️ emoji glyph is an allowlisted exception but a lucide icon would match the rest of the system; this is the ONLY freshness signal on the tab (no card-level desaturation like Home). Tab-level freshness style diverges from FreshnessChip/TabFreshnessHeader used by other tabs — a third freshness idiom.

### CustomerValueTab error strip (cv-error) · `card`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/CustomerValueTab.tsx
- **משטח-אב:** CustomerValueTab — full-tab replacement state (lines 340-378)
- **ויזואלית:** SectionIntro stays; below it a role=alert rounded-xl strip: border-status-red bg-status-redBg text-status-redFg, AlertTriangle icon, bold 13px title 'שגיאה בטעינת נתוני הלקוחות', 11px honest explainer (fail ≠ no data, names /api/cohorts in mono), 10px mono error message @ opacity-60, secondary 'נסה שוב' Button with RefreshCw icon. Fired on thrown fetch OR 200-with-error body (fetchJsonStrict, P1-2 honesty sweep).
- **פרימיטיבים:** SectionIntro, Button, AlertTriangle/RefreshCw (lucide); status-red tokens
- **חוב:** Hand-rolled alert markup duplicated nearly verbatim in PaymentMethodsTab (pm-error) — no shared ErrorStrip/Alert primitive; rounded-xl differs from rounded-card used by sibling Cards; 10-11px arbitrary text sizes; opacity-modulated redFg text (opacity-60/80 on an already-tinted fg) flirts with sub-AA in light theme.

### CustomerValueTab loading skeleton (cv-loading) · `primitive`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/CustomerValueTab.tsx
- **משטח-אב:** CustomerValueTab — full-tab replacement state (lines 380-399)
- **ויזואלית:** SectionIntro + aria-busy stack: one h-24 rounded-2xl .skeleton hero block, a grid of 4 h-24 rounded-xl skeleton blocks (KPI ghosts), centered ink-muted 'טוען נתוני לקוחות…' caption. Mirrors final layout coarsely (no curve/grid ghosts).
- **פרימיטיבים:** .skeleton class (globals.css:981), SectionIntro
- **חוב:** Skeleton corner radii (rounded-2xl / rounded-xl) don't match the real Cards' rounded-card token; only the top 2 of 5 sections get ghosts so the page visibly 'grows' after load (layout shift below the fold). Redundant text caption + aria-busy duplicates the announcement.

### PaymentMethodsTab (tab root) · `card`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/PaymentMethodsTab.tsx
- **משטח-אב:** Dashboard shell → tab 'payments' (תשלומים), Dashboard.tsx:891-893
- **ויזואלית:** Stack (space-y-4/5, animate-fade-in-up): SectionIntro 'אמצעי תשלום' (CreditCard icon) with right-slot: granularity segmented toggle (חודש/רבעון/שליש), scope segmented toggle (כלל-העסק/פר-חנות), conditional w-40 NativeSelect store picker. Four mutually-exclusive body states: pm-error red alert strip + retry → pm-loading 4-skeleton grid + caption → pm-empty Card prose → data (summary strip + optional pre-backfill hint Card + by-year accordion Card). Scope/store auto-sync from the global store filter; granularity regroups sub-rows client-side (month/quarter/third). Pre-backfill heuristic relabels 'אחר' → 'אחר / לא ידוע'.
- **פרימיטיבים:** Card, Heading, NativeSelect, Button, Money, TableBase, SectionIntro, ShareBar (local); SWR + fetchJsonStrict; lucide AlertTriangle/CreditCard/ChevronDown/RefreshCw
- **חוב:** Three header controls flex-wrap into 2-3 rows on mobile — crowded vs the Home header. Segmented-toggle pattern duplicated again (×2 here) with no primitive and no arrow-key support. Like the customers tab, NO freshness/staleness signal at all on financial data (not even an asOf badge). Error strip is a copy-paste of cv-error (shared primitive missing). Granularity 'third' (שליש, T1-T3) is a nonstandard period taxonomy with no tooltip explaining the Jan-Apr/May-Aug/Sep-Dec split.

### ShareBar (stacked gateway share bar) · `chip`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/PaymentMethodsTab.tsx
- **משטח-אב:** PaymentMethodsTab — summary card, year accordion summaries, period rows, grand-total row
- **ויזואלית:** h-3 rounded-pill border-glass-edge flex strip; segments sized by order-count share via inline width %: credit = bg-accent, paypal = bg-chart-meta (the Meta brand-blue chart token), other = bg-ink-subtle. Zero-width segments omitted. Used at 3 sizes: full-width (summary), w-24 (year header), w-[88px] (table rows/footer).
- **פרימיטיבים:** cn; accent / chart-meta / ink-subtle tokens; rounded-pill
- **חוב:** PayPal segment REUSES the Meta-platform chart token (bg-chart-meta) — semantic collision with the locked brand-mirrored chart palette: if Meta blue is retuned, PayPal silently recolors, and on any surface showing both (e.g. future mixed dashboards) the hue would lie. Component is local to this file though CohortGridAdvanced/CustomerValueTab reinvent similar bars — should be a shared StackedBar primitive. No accessible text alternative for the proportions (legend chips nearby carry the % but the bar itself is aria-silent).

### Summary strip (pm-summary-total + GatewaySummaryCard ×3) · `card`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/PaymentMethodsTab.tsx
- **משטח-אב:** PaymentMethodsTab data state, above the by-year accordion (lines 499-537, 587-610)
- **ויזואלית:** grid-cols-2 sm:grid-cols-4: (1) totals Card — 2xs uppercase tracked eyebrow 'חלוקת הזמנות — כל התקופה', xl extrabold order count + muted '· הזמנות · $rev' inline Money, full-width ShareBar, 3 legend chips (2px square swatch + label + %); (2-4) GatewaySummaryCard per gateway — eyebrow label, xl extrabold orders + '· N%' muted, Money revenue line.
- **פרימיטיבים:** Card, Money, ShareBar; formatNumber via countText
- **חוב:** Eyebrow style (text-2xs uppercase tracking-[0.06em]) is a one-off here — KPI cards on the customers tab use plain xs sentence-case labels for the identical role (two KPI-card dialects within the slice). Mixed-baseline value line (xl number + xs annotations in the same line) reads cramped at grid-cols-2 mobile width. Gateway cards carry no tone/iconography distinguishing credit vs PayPal beyond text — the ShareBar legend colors aren't echoed on the cards themselves.

### Pre-backfill hint card (pm-backfill-hint) · `card`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/PaymentMethodsTab.tsx
- **משטח-אב:** PaymentMethodsTab data state, conditional between summary strip and accordion (lines 539-548)
- **ויזואלית:** p-3 glass Card with xs ink-secondary prose: all orders currently classified 'אחר / לא ידוע', bold ink 'ממתין ל-backfill' emphasis; appears only when every order is 'other' (NULL gateway heuristic).
- **פרימיטיבים:** Card
- **חוב:** Plain Card styling for what is semantically a warning/info banner — no status tint, icon, or Badge; visually indistinguishable from a content card. Should share an InfoBanner primitive with similar hints elsewhere.

### By-year accordion shell ('פילוח לפי שנה' Card) · `card`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/PaymentMethodsTab.tsx
- **משטח-אב:** PaymentMethodsTab data state (lines 553-579)
- **ויזואלית:** Card variant='flat' overflow-hidden p-0 (NOTE: flat strips the glass surface entirely): header row (border-b, h-7 w-7 rounded-lg bg-accent-soft accent icon-chip + Heading level='section' 'פילוח לפי שנה') → scrollable body (overflow-auto max-h-[62vh] p-3 space-y-2.5) of YearAccordion blocks + PaymentGrandTotal → footer note strip (pm-note: border-t bg-glass-2 text-2xs ink-subtle, mono payment_gateway_names ref, 'אחוז מחושב לפי מספר הזמנות').
- **פרימיטיבים:** Card (flat), Heading, TableBase (children); accent-soft token
- **חוב:** variant='flat' + p-0 means this 'card' has NO surface/border in practice — its children (bg-glass-2/40 accordions) float on the canvas, unlike every boxed section on the customers tab; inconsistent section chrome within the slice. Icon-chip uses bg-accent-soft while SectionIntro's identical chip uses bg-accent-bg — two accent-tint tokens for the same role. max-h-[62vh] is an arbitrary magic viewport number creating a scroll-within-scroll (page + card body) with a sticky table header inside — three nested scroll contexts on mobile.

### YearAccordion (per-year payment block) · `drawer`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/PaymentMethodsTab.tsx
- **משטח-אב:** PaymentMethodsTab → by-year accordion shell (lines 620-685)
- **ויזואלית:** Native <details class='group rounded-card border-glass-edge bg-glass-2/40'> (newest year open): marker-less flex-wrap summary — rotating ChevronDown + bold tabular year + muted '· N הזמנות · $rev' + w-24 ShareBar + a flex-wrapped strip of 3 per-gateway inline stat chips (2px swatch + label + orders + Money + %, text-2xs tabular). Body = overflow-auto PeriodRowsTable at the chosen granularity.
- **פרימיטיבים:** details/summary, ChevronDown, Money, ShareBar, TableBase (via PeriodRowsTable)
- **חוב:** The summary row packs year + totals + bar + 9 stat fragments into one flex-wrap line — on mobile it wraps into a 3-line dense cluster with no hierarchy (the most cramped element in the slice). Same details-accordion idiom as CohortYearAccordion but built independently (copy of the pattern, not a shared Accordion primitive). No open/close animation.

### PeriodRowsTable (monthly/quarterly methods table) · `table`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/PaymentMethodsTab.tsx
- **משטח-אב:** PaymentMethodsTab → YearAccordion body (lines 689-805)
- **ויזואלית:** TableBase minWidth=720 stickyHeader, two-tier 12-column header: tier 1 group headers — תקופה / אשראי (text-accent) / PayPal (text-chart-meta) / אחר (ink-muted) / סה״כ / חלוקה, with border-s vertical group separators; tier 2 — הזמנות/CAD/% per group (2xs ink-muted). Rows per period (DESC): bold tabular period label (periodLabel: 'מאי 2026'/'רבעון 2 2026'/'שליש 1 2026'), tabular order counts, Money CAD cells, 2xs muted % cells, bold totals, centered w-[88px] ShareBar cell.
- **פרימיטיבים:** TableBase (stickyHeader → glass-3 blur via globals.css [data-sticky-header]), Money, ShareBar
- **חוב:** Group-header colors lean on text-chart-meta (PayPal=Meta token again) and text-accent — column identity by hue alone, no swatch echo for color-blind users. 12 columns at minWidth 720 inside a max-h-[62vh] scroll inside the page scroll = horizontal+vertical+page triple-scroll on mobile, with the sticky header only sticking within the card body. % cells at text-2xs are the smallest data text in the slice.

### PaymentGrandTotal (footer grand-total row) · `table`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/PaymentMethodsTab.tsx
- **משטח-אב:** PaymentMethodsTab → by-year accordion shell, after the YearAccordion list (lines 809-866)
- **ויזואלית:** A standalone TableBase minWidth=720 holding one bold 'סך הכל' row (border-t-2, bg-glass-2): credit/paypal/other orders + Money + %, totals, ShareBar — same 12-cell shape as a period row; plus an sr-only row carrying the (possibly relabeled) gateway labels for AT.
- **פרימיטיבים:** TableBase, Money, ShareBar
- **חוב:** It is a SEPARATE <table> from every PeriodRowsTable, so its column widths can NEVER align with the sub-row tables above it — the 'grand total' visually drifts off-grid from the columns it totals (classic split-table artifact of the accordion refactor). It also has no header of its own (cells rely on reading the last open accordion's header). The sr-only label row is a clever but bespoke a11y patch.

### PaymentMethodsTab states (pm-error / pm-loading / pm-empty) · `card`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/PaymentMethodsTab.tsx
- **משטח-אב:** PaymentMethodsTab body, mutually exclusive (lines 451-495)
- **ויזואלית:** pm-error: role=alert rounded-xl border-status-red bg-status-redBg strip — AlertTriangle, bold 13px title, 11px honest explainer naming /api/payment-methods, 10px mono error, secondary retry Button (identical chrome to cv-error). pm-loading: aria-busy grid of 4 h-24 rounded-xl .skeleton blocks + centered 'טוען נתוני אמצעי-תשלום…'. pm-empty (settled, 0 rows): plain Card with sm ink-secondary reassurance prose.
- **פרימיטיבים:** Button, Card, .skeleton, AlertTriangle/RefreshCw
- **חוב:** Error strip duplicated verbatim from CustomerValueTab — the slice contains two hand-rolled copies of the same alert (no Alert primitive). Loading ghosts only the summary strip (the accordion area pops in afterward). pm-empty styling is identical to a normal content card — no empty-state illustration/icon, weaker than Home-tier empties.

### Segmented radio-toggle (bespoke shared pattern ×3) · `form`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/CustomerValueTab.tsx
- **משטח-אב:** SectionIntro rightSlot of BOTH tabs (CustomerValueTab basis toggle lines 430-463; PaymentMethodsTab granularity lines 357-388 + scope lines 389-427)
- **ויזואלית:** inline-flex rounded-md border-glass-edge bg-glass-2 p-0.5 wrapper of ghost Buttons (h-7 font-semibold, size sm) with role=radiogroup/radio + aria-checked; active option = bg-accent-btn text-accent-fg hover:bg-accent-btnHover (AA-deepened accent), inactive = text-ink-secondary.
- **פרימיטיבים:** Button (ghost), cn; accent-btn/accent-fg/glass tokens
- **חוב:** Three near-identical instantiations with no SegmentedControl primitive — a redesign must touch all three by hand. ARIA pattern incomplete: role=radio buttons without roving tabindex/arrow-key navigation (each is a separate tab stop, violating the radiogroup keyboard contract). Wrapper rounded-md vs the buttons' own radius produces slightly mismatched inner corners.

### SectionIntro (shared section header) · `primitive`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/SectionIntro.tsx
- **משטח-אב:** Top of both tabs (and other tabs app-wide)
- **ויזואלית:** Flex header: optional 7/8px rounded-lg bg-accent-bg accent icon-chip, Heading level='section' title, 11px/xs ink-secondary description, optional LTR mono formula pill (bg-glass-2 border-glass-edge), shrink-0 rightSlot for controls; inline mode = single Info-icon hint line.
- **פרימיטיבים:** Heading (Typography), Info (lucide), cn
- **חוב:** Healthy primitive; only note: its icon-chip token (bg-accent-bg) differs from the bg-accent-soft chip inside PaymentMethodsTab's accordion header — same visual role, two tokens. Description fixed at 11px on mobile is small for a tab's only explanatory text.

---

# מגמות / ארכיון / הגדרות (trends-archive-misc) — 35 קומפוננטות

## עץ-המשטח

```
Dashboard shell (src/components/Dashboard.tsx — TabKey switcher: home|activity|customers|pnl|archive|trends|campaigns|products|payments|detail; degraded-error banner, skeleton loader, Footer)
	TabFreshnessHeader + SourceHealthChip (rendered once above EVERY tab)
	Trends tab ('trends') — AnalysisTrendsTab.tsx
		SectionIntro "טווח לניתוח" (explains split from Archive)
		PageScope (store · range · CAD)
		PageSynthesis (synthesizeTrends TL;DR)
		Filters (shared strip; no saved-views/compare here)
		SectionIntro "מגמת ROAS לאורך זמן"
		glass card → RoasChart (bare)
			custom RTL legend (store swatches + dashed "יעד 3.0")
			ChartContainer → Recharts LineChart (per-store lines, target ReferenceLine y=3, heavy-refund amber dot rings)
			ChartTooltip (per-store ROAS rows + refund-day footer strip)
			ChartAnnotationPins overlay (absolute, measured via ResizeObserver)
		AnnotationsPanel (collapsible event journal)
			AnnotationForm (inline add/edit: kind select, title, date, notes, store scope)
	Archive tab ('archive') — AnalysisArchiveTab.tsx
		SectionIntro (ROAS color legend in prose) + PageScope + PageSynthesis (suppressed on fetch error)
		controls row: YearSelector · MonthSelector · Tab segmented (לפי חנות/סיכום כללי) · NativeSelect store picker
		MonthlyTables (CONTROLLED mode; year-wide SWR fetch shared with synthesiser)
			loading text line / red error line / null when empty
			MonthBlockPerStore × N (collapsible black-bar month card → TableBase day-rows: FB/GA/TT spend, total, revenue+RefundIndicator, RoasBadge; totals row)
			MonthBlockSummary × N (same shape, all-store aggregate)
	Products tab ('products') — ProductsTab() in Dashboard.tsx
		SectionIntro + PageScope + Filters
		centered sub-tab segmented control (טבלה / פיבוט)
		'table' → glass card → ProductsTable (period tablist, store picker, bucket accordions, LIVE ping dot, product TableBase)
		'pivot' → ProductCentricView
			states: select-a-store hint / error card + retry / 'טוען…' / empty
			header row + showSolo checkbox
			ProductRow × N (expandable: title + 🔗 chip, cohort stats line, platform count chips)
				per-platform group → TableBase (9 cols, every header = ColHelp violet ⓘ → rich popover; pixel↔Shopify delta chip → HoverTooltip; פעיל/כבוי status chip)
	Detail tab ('detail') — DetailTab() in Dashboard.tsx
		SectionIntro + PageScope + PageSynthesis + Filters
		glass card → DetailTable (last-100 day×store rows: Sparkline trend col, platform spends, revenue+RefundIndicator, RoasBadge, profit cols)
	P&L tab ('pnl') — PnLTab() hosts the settings stack (GoalTracker/PnLBreakdown belong to another slice)
		BillingSettings (trigger Button "עלויות חודשיות (N פעילות · CAD …)" → Sheet modal)
			tab nav: חודשי קבוע / חד-פעמיים / ייבא CSV
			RecurringTab (plan-error warning banner, auto-detected-plans accent banner, item list, RecurringEditForm with fixed/% toggle)
			OneTimeTab (dated item list, OneTimeEditForm)
			BillingCsvImport (how-to box, store select, file/paste Textarea, warnings strip, preview list w/ skip checkboxes + type segmented toggle)
		CogsSettings (inline Card: mode toggle, % PctFields, apply-scope radios, collapsible month timeline TableBase)
		SalarySettings (inline Card: %/amount toggle, value Input, scope radios, double-count warning, timeline)
	Filters strip (shared across tabs) — Filters.tsx
		desktop preset buttons / mobile sliding-thumb pill bar / store select / range chip / advanced presets + custom date inputs
		compare-baseline pill row (Home only, showCompareBaseline)
		SavedViewsDropdown (Home only, showSavedViews — hand-rolled absolute panel: MRU list, rename/delete, save-current input)
	Tooltip primitive family — ui/Tooltip.tsx HelpTooltip auto-router
		mode A desktop-simple → Radix Tooltip (glass-2 bubble)
		mode B desktop-rich → RichPopover (Radix Popover role=dialog, hover-intent 180/150ms, glass-1 + arrow)
		mode C touch-simple/short-rich → Toggletip (paired ⓘ button, role=status live region)
		mode D touch-long-rich → RichSheet (bottom Sheet, visible ✕, max-h-80vh)
	Store color/branding (resolver: lib/storeColors.ts storeColor() — brandColor token > STORE_COLORS name map > hex FALLBACK_PALETTE)
		/operator → AddStoreWizard brand-color Field (BRAND_COLORS 8 CSS-var tokens, NativeSelect + swatch preview row, "בשימוש" marking)
		/operator → StoreRow identity swatch (token-driven bg, aria-hidden)
```

## חוב-עיצובי בפרוסה (הגרוע קודם)

- NUMBERS BYPASS <Money>: MonthlyTables, DetailTable, ProductCentricView, BillingSettings (both tabs) and BillingCsvImport render money/metrics as raw formatNumber()/fmtMoney()/formatCurrency() strings with hand-prepended 10px 'CAD' spans — the mandated overflow-safe <Money>/<Metric> primitive is used only in SalarySettings + RefundIndicator within this slice. Any redesign that tightens columns will clip 7-digit values exactly where the rule says it must not.
- SUB-11px TYPE SPRAWL: dozens of inline text-[10px]/text-[11px] and one text-[9px] (ProductCentricView status chip) micro-labels with no type-ramp token; ProductCentricView's 9-column pivot at 10px headers + 9px chips is the most cramped, lowest-legibility surface reachable from the tab bar — far below Home polish.
- SIX BESPOKE SEGMENTED CONTROLS: MonthlyTables/Archive Tab rail (divide-x, dir=ltr), ProductsTab centered min-w-140 pair, Filters mobile sliding-thumb pill bar, CogsSettings/SalarySettings p-0.5 rail, BillingSettings tab nav, BillingCsvImport 10px micro-toggle — six different active-state treatments for one interaction pattern; no shared SegmentedControl primitive. The CSV-import toggle is also far below the 44px touch floor inside a touch-first bottom sheet.
- HAND-ROLLED / HACKED OVERLAYS: SavedViewsDropdown is a manually positioned div with document pointerdown dismissal and no Esc — the exact pattern the 2026-06-03 ProductPickerModal incident banned over Sheets; BillingSettings fakes a centered desktop dialog by translate-hacking a bottom Sheet (sm:top-1/2 sm:-translate-y-1/2) instead of a real centered variant in the Sheet primitive; TabFreshnessHeader gates full-refresh behind native window.confirm() — the most jarring unthemed surface in the app, reachable above every tab.
- COPY-PASTE TRIPLETS IN SETTINGS: CogsSettings and SalarySettings duplicate Badge, Radio and lastNMonths byte-for-byte (divergence already visible: salary timeline uses <Money>, COGS uses toFixed strings); HE_MONTHS exists twice (MonthlyTables + MonthSelector); ColHelp duplicates CampaignsTable's header-help; SOURCE_LABEL/COLOR has an acknowledged second copy in PnLBreakdown. Settings architecture itself is split: billing in a sheet, COGS/salary as permanently-open page cards.
- BAND/LEGEND SEMANTICS AS PROSE, NOT CHIPS: Archive's SectionIntro encodes the locked ROAS band colors as a Hebrew sentence ('אדום (<2), כתום (2-2.7), ירוק (2.7-3), כחול (>3)') and Detail does the same for the failure-cell — no visual legend rendered with the actual RoasBadge chips. A redesign must add a chip legend WITHOUT touching roasCell/RoasBadge thresholds, the solid-chip treatment, or the operator-locked #EF9331 orange.
- EMOJI ICONOGRAPHY IN DATA SURFACES: 🥇 leader rows and 🔗 multi-map chips (ProductCentricView), ⚠️ duplicate warnings and '⬅️' directional copy (Billing CSV / one-time empty state), emoji annotation kinds and a raw-glyph '▼/◀' chevron (AnnotationsPanel) — clashes with the lucide icon language everywhere else and is RTL/bidi-fragile.
- STATE INCONSISTENCY ACROSS TABS: mount animation (animate-fade-in-up) on Trends/Archive/PnL but missing on Products/Detail; global loading skeleton is hero-shaped and lies about non-Home layouts while MonthlyTables/ProductCentricView/ProductsTable degrade to bare 'טוען…' text lines; Archive year/month and Products sub-tab are not URL-persisted while the campaigns drill IS; saved-views and compare-baseline are Home-only despite being generic.
- KNOWN ARCHIVE STORE-DESYNC SURFACE: MonthlyTables retains three resolution modes (controlled / hideStoreToolbar / internal) plus one-way global→local store sync with local override; the legacy internal toolbar duplicates the lifted Archive controls row — consolidate before reskinning or two toolbars get styled and drift.
- ONE-OFF INVERTED SURFACES + TOKEN MISUSE: MonthlyTables month headers are solid bg-ink/text-canvas black bars (unique in the app); BillingSettings SOURCE_COLOR maps 'one-off'/'other' chips to bg-ink-muted text-ink-secondary — a text token used as a background, the only chip pair not on status Bg/Fg token pairs, with gray-on-gray contrast risk in both themes.
- SMALL CORRECTNESS-ADJACENT NITS TO PRESERVE/FIX DURING REDESIGN: YearSelector uses local-tz getFullYear (not IL-tz) and caps at 3 years though data reaches 2023; OneTimeTab seeds dates from UTC toISOString instead of getTodayInIsraelTz; DetailTable repeats an identical per-store Sparkline on every one of up to 100 rows; RoasChart's annotation-pin overlay hardcodes Recharts margin constants that must move in lock-step with the plot; ProductCentricView's HelpTooltip-wrapping-<td> relies on fragile non-phrasing asChild handling.

## קומפוננטות

### AnalysisTrendsTab · `nav`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/AnalysisTrendsTab.tsx
- **משטח-אב:** Trends tab (Dashboard activeTab==='trends')
- **ויזואלית:** Vertical stack (space-y-4/5, animate-fade-in-up): two SectionIntros, PageScope line, PageSynthesis TL;DR, Filters strip, then the ROAS chart wrapped in rounded-xl bg-glass-1 border-glass-edge shadow-glass, then AnnotationsPanel. Per-store lines colored via buildStoreBrandColorMap (Phase 6a brand_color tokens).
- **פרימיטיבים:** SectionIntro, PageScope, PageSynthesis, Filters, RoasChart, AnnotationsPanel, useStores/storeColors
- **חוב:** Thin tab — fine. Description prose hardcodes '17 חודשים' (duplicates MONTHLY_TABLES_HISTORY_MONTHS constant — copy can drift). No skeleton/empty state of its own: if filtered.series is empty RoasChart returns null and the tab shows a bare glass card frame around nothing.

### RoasChart · `chart`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/RoasChart.tsx
- **משטח-אב:** Trends tab (bare inside glass card); also exports a self-carded variant (unused header path with Heading + TrendingUp icon)
- **ויזואלית:** Recharts LineChart h-64/sm:h-80: one monotone line per store (primary uzoshop cyan gets 2.75px stroke + bold legend label, others 2px), quiet dashed CartesianGrid (opacity .55, horizontal only), 11px tabular-nums axis ticks via --chart-axis, dashed target ReferenceLine at y=3 (--chart-target), dashed crosshair cursor. Heavy-refund days get filled dot + CHART_WARNING_COLOR ring. Custom RTL legend row (3.5×3px color slabs + dashed 'יעד 3.0'). Custom tooltip = ChartTooltip card with 'ROAS <value>' rows + amber refund footer ('יום רפאנד כבד'). ChartAnnotationPins absolutely overlaid using hardcoded margin constants (MARGIN_LEFT 8 / Y_AXIS_WIDTH 32 / MARGIN_RIGHT 12) + ResizeObserver width.
- **פרימיטיבים:** ChartContainer, ChartTooltip/Label/Row/Value, ChartAnnotationPins, Heading, storeColor tokens, CHART_WARNING_COLOR (chartColors bridge)
- **חוב:** Pin-overlay left% math manually coupled to Recharts margins via module constants — any margin tweak silently desyncs pins. connectNulls={false} gaps are correct but unexplained to the user. Returns null on empty data (parent shows empty card shell). Legend is bespoke markup, not a shared ChartLegend primitive (hero RoasTargetChart has its own). 'יעד 3.0' label + y=3 hardcoded in two places. Dual bare/carded render paths — carded path appears dead in current usage.

### AnnotationsPanel (+ AnnotationForm) · `form`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/AnnotationsPanel.tsx
- **משטח-אב:** Trends tab (below chart) AND Home tab (above hero) — shared overlay card
- **ויזואלית:** rounded-2xl glass card with gradient header button (from-accent-bg to-glass-1, Pin icon in accent square); collapsed by default with '▼/◀' text glyph chevron. Open: dashed 'תעד אירוע חדש' ghost button, list rows (emoji kind chip tinted via color-mix 12% of ANNOTATION_KIND_COLOR var, title + date + store microcopy, edit/trash icon buttons). Inline AnnotationForm: 3-col grid (kind NativeSelect with emoji options, title Input autoFocus, date Input max=today), notes Input, optional store-scope select, save/cancel Buttons + 'יסומן על הגרף' hint.
- **פרימיטיבים:** Button, Input, NativeSelect, HelpTooltip, Heading, annotations lib (localStorage + roas-annotations-changed event)
- **חוב:** Collapse chevron is a raw text glyph '▼'/'◀' instead of lucide ChevronDown — only place in the app doing this. Emoji-as-icon for annotation kinds (vs lucide everywhere else). uppercase tracking-wide text-[10/11px] micro-label style repeated across forms with no token. localStorage-only persistence (no cloud sync like COGS/salary — annotations vanish cross-device, inconsistent with sibling editors).

### AnalysisArchiveTab · `nav`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/AnalysisArchiveTab.tsx
- **משטח-אב:** Archive tab (Dashboard activeTab==='archive')
- **ויזואלית:** Stack: SectionIntro whose description encodes the ROAS color legend as PROSE ('אדום (<2), כתום (2-2.7), ירוק (2.7-3), כחול (>3)'), PageScope (M/YYYY), PageSynthesis (year verdict; suppressed when the year fetch errors), then ONE aligned controls row (items-end flex-wrap): year w-28, month w-40, mode tablist (exported Tab pills, dir=ltr, divide-x), store picker w-40 (per-store mode only), each captioned by a 10-11px muted label. MonthlyTables below in controlled mode.
- **פרימיטיבים:** YearSelector, MonthSelector, MonthlyTables.Tab, NativeSelect, SectionIntro, PageScope, PageSynthesis, SWR (key shared with MonthlyTables)
- **חוב:** ROAS legend lives as Hebrew prose in a description string — should be rendered chips matching the locked band colors (and the prose says 2.7-3 ירוק vs the memory-locked 2-2.7 orange / 3x-target wording — boundary copy worth verifying against roasCell). Store-filter sync is one-way (global→local via useEffect, local override allowed) so the picker can silently diverge from the global filter — the known 'MonthlyTables store desync' note. Local year/month state not URL-persisted: deep-link loses archive position while campaigns/products persist tab-local state in the URL.

### MonthlyTables (+ MonthBlockPerStore, MonthBlockSummary, Tab) · `table`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/MonthlyTables.tsx
- **משטח-אב:** Archive tab
- **ויזואלית:** One collapsible card per month (rounded-xl glass): full-width header Button in INVERTED bg-ink text-canvas (solid near-black bar) with month-name • store and chevron; default-open only current+previous month. Body: overflow-auto max-h-[60vh] TableBase (minWidth 500/640, stickyHeader) listing EVERY calendar day (missing days = empty muted rows), columns תאריך/פייסבוק/גוגל/טיקטוק (each platform col appears only if it spent that month)/יצא סה"כ/נכנס(+RefundIndicator)/ROAS as solid RoasBadge chip. Totals row border-t-2 bg-glass-2 font-semibold. Loading = plain text line; error = red text line role=alert; empty = null. Legacy internal toolbar (mode pills + store select + 'N חודשים' counter) still exists for the uncontrolled path.
- **פרימיטיבים:** TableBase, Button, NativeSelect, RoasBadge + roasCell (locked band colors), RefundIndicator, Heading, isStoreFullyOff adState
- **חוב:** Numbers render as raw formatNumber() text — NOT through the shared <Money>/<Metric> primitive, so the overflow-safe-numbers guarantee doesn't apply here. The inverted black month-header bar (bg-ink text-canvas + color-mix hover) is a one-off pattern found nowhere else — visibly lower-polish than Home. Loading/error are bare text lines, no skeleton. THREE state-resolution modes (controlled / hideStoreToolbar / internal) with toolbar markup duplicated here AND in AnalysisArchiveTab — drift risk. Up to 31 rows × 12 months in 'כל השנה' view with no virtualization. text-[10px] micro counters.

### YearSelector · `primitive`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/YearSelector.tsx
- **משטח-אב:** Archive tab controls row
- **ויזואלית:** Bare NativeSelect listing endYear-2..endYear (3 years), font-medium.
- **פרימיטיבים:** NativeSelect
- **חוב:** Uses new Date().getFullYear() — local timezone, not the Asia/Jerusalem helper used everywhere else (ilTodayParts); a Dec-31 midnight straddle can show the wrong year. Hardcoded 3-year window while the deep backfill reaches 2023 (~46.5k orders) — operator cannot reach 2023 from the picker.

### MonthSelector · `primitive`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/MonthSelector.tsx
- **משטח-אב:** Archive tab controls row
- **ויזואלית:** NativeSelect: 'כל השנה' + 12 Hebrew month names.
- **פרימיטיבים:** NativeSelect
- **חוב:** HE_MONTHS constant is copy-pasted in MonthlyTables.tsx AND here — two sources of truth for month names.

### RoasBadge / roasCell · `primitive`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/lib/format/RoasBadge.tsx (+ roasCell.ts)
- **משטח-אב:** MonthlyTables, DetailTable, CampaignsTableRow, AdSetTable — the canonical ROAS cell
- **ויזואלית:** Solid rounded badge chip (ROAS_BADGE_SHAPE): white number on solid red/green/blue (bg-status-*Btn text-accent-fg), operator-locked bright #EF9331 orange with DARK on-color (status-orangeSolidFg), failure '0' = roas-cell-fail token chip (dark-navy bg + pink), gray/no-data = plain text. roasCellTdClass intentionally returns '' (no td wash).
- **פרימיטיבים:** cn, status-* tokens, adState off-state
- **חוב:** NONE to change — this IS the locked V4 band-color system (red/orange/green/blue solid chips). Redesign must consume it as-is. Stale doc-comment contains a self-equal comparison typo ('text-status-redFg (not text-status-redFg)') — comment debt only.

### RefundIndicator · `chip`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/RefundIndicator.tsx
- **משטח-אב:** Revenue cells in MonthlyTables, DetailTable (+ other tables)
- **ויזואלית:** Tiny ↩ RotateCcw (14px) in status-warningFg appended inline after a revenue figure; opens HelpTooltip variant=rich titled 'פירוט החזרים' with gross + refund lines (Money, refund in warning color with − sign).
- **פרימיטיבים:** HelpTooltip(rich), Money, Button(ghost, p-0)
- **חוב:** Good citizen — uses Money + sanctioned tooltip. Only nit: 14px icon-only trigger with no hit-area expansion on the desktop path (touch path inherits the primitive's ⓘ).

### ProductsTab (shell) · `nav`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/Dashboard.tsx (function ProductsTab, ~line 1899)
- **משטח-אב:** Products tab (Dashboard activeTab==='products')
- **ויזואלית:** SectionIntro (title/description swap per sub-tab; formula pill 'ברוטו = מחיר × כמות…' only on table view), PageScope, Filters, then a CENTERED segmented tablist (dir=ltr rail, two min-w-[140px] Buttons primary/ghost, dir=rtl labels): 'טבלה' → ProductsTable in glass card; 'פיבוט' → ProductCentricView.
- **פרימיטיבים:** SectionIntro, PageScope, Filters, Button, cn
- **חוב:** Sub-tab state local-only (campaigns tab DOES persist its drill in URL — inconsistent shareability). Yet another bespoke segmented-control variant (centered, min-w buttons) — fifth distinct segmented style in this slice alone. No animate-fade-in-up on this tab (Trends/Archive/PnL have it) — inconsistent mount transition.

### ProductCentricView · `table`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/ProductCentricView.tsx
- **משטח-אב:** Products tab → 'פיבוט' sub-tab
- **ויזואלית:** rounded-2xl glass section. Header: Package icon + 'מוצרים → קמפיינים' + 11px count microcopy + showSolo checkbox. Body: <ul> of ProductRow items — rounded-lg bordered rows whose whole header is a ghost Button (chevron, truncated product title in HelpTooltip, 🔗 N-קמפיינים warning-tinted chip for multi-mapped, 11px muted cohort stats line, desktop-only platform-count chips). Expanded: bg-glass-2/20 panel per platform group (Trophy header + intra-spend/allocated microcopy) → dense TableBase (minWidth 480, 9 columns, EVERY header a ColHelp violet solid-accent ⓘ opening a rich Hebrew/LTR-code explainer popover). Cells: fmtMoney/fmtPct raw text; leader row bg-accent-bg with 🥇 prefix; pixel↔Shopify delta chip (good/warn/bad/neutral status-toned bordered chip, 10px, cursor-help → HoverTooltip rich dialog with statBlock dl); סטטוס chip 'פעיל/כבוי' at text-[9px]. States: All-stores hint card, explicit error card (red box, mono error text, 'נסה שוב' retry Button), 'טוען…' text, two empty-state messages.
- **פרימיטיבים:** Button, Input(checkbox), TableBase, Heading, HelpTooltip (variant=rich, touchTrigger=child), fmtMoney/fmtMoneyString, buildProductCentricView, aggregate
- **חוב:** Most cramped surface in the slice: 9 columns at text-[10px] headers and a text-[9px] status chip (below any sane legibility floor; Home uses nothing under 11px). Money values are raw fmtMoney strings, not <Money> — overflow-safety rule not applied. Emoji iconography (🥇, 🔗) clashes with lucide language. 9 violet ⓘ dots per header row = heavy accent noise. HelpTooltip wrapping a <td> relies on non-phrasing asChild handling — fragile. Loading is bare 'טוען…' text, no skeleton. Per-row platform chips hidden on mobile with no replacement (info loss <sm).

### ColHelp + HoverTooltip (local helpers) · `primitive`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/ProductCentricView.tsx (bottom of file)
- **משטח-אב:** ProductCentricView column headers + delta chips
- **ויזואלית:** ColHelp: label + 20px (w-5 h-5) solid bg-accent text-accent-fg circular ⓘ Button (!p-0 override) opening HelpTooltip variant=rich titled with the column label; touchTrigger='child' so touch taps the violet ⓘ itself. HoverTooltip: thin alias over HelpTooltip rich for the delta chip.
- **פרימיטיבים:** HelpTooltip(rich), Button(ghost)
- **חוב:** Local-only helpers duplicating CampaignsTable's header-help pattern (comment admits it 'mirrors CampaignsTable') — should be ONE shared ColumnHeaderHelp primitive. !p-0 important-override on Button to fight its own padding (same class of bug as the 7452b9b oval-ⓘ hotfix) — the primitive should support an icon-dot size natively.

### ProductsTable · `table`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/ProductsTable.tsx
- **משטח-אב:** Products tab → 'טבלה' sub-tab (inside glass card)
- **ויזואלית:** Toolbar bar (bg-glass-2/40 border-b): period tablist (same divide-x rail pattern), store NativeSelect, muted tabular counter. Bucket accordions: header row with animate-ping green LIVE dot + greenBg 'עד עכשיו' chip for today bucket, inline stats (הזמנות/יחידות/ברוטו/נטו green) with some hidden sm/md; open bucket → overflow-auto max-h-[70vh] TableBase (minWidth 680, sticky). Error red box, loading text, Calendar-icon empty state.
- **פרימיטיבים:** TableBase, HelpTooltip, Money/fmtMoney (mixed), NativeSelect, Button, status tokens
- **חוב:** (Included as the pivot's sibling for completeness.) Mixed fmtMoney-string vs <Money> usage in the same file; stat labels at 10px; responsive strategy HIDES ברוטו <sm and נטו <md entirely instead of reflowing — info loss on mobile, against the no-info-loss rule.

### DetailTab (shell) · `nav`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/Dashboard.tsx (function DetailTab, ~line 1990)
- **משטח-אב:** Detail tab (Dashboard activeTab==='detail') — raw daily log for power users
- **ויזואלית:** SectionIntro (Table icon, long description incl. the black-'0' failure-cell legend as prose), PageScope, PageSynthesis(synthesizeDetail), Filters, glass card → DetailTable bare.
- **פרימיטיבים:** SectionIntro, PageScope, PageSynthesis, Filters, DetailTable
- **חוב:** No animate-fade-in-up (inconsistent with trends/archive/pnl). Failure-cell legend again encoded as prose instead of a visual legend chip row.

### DetailTable · `table`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/DetailTable.tsx
- **משטח-אב:** Detail tab
- **ויזואלית:** overflow-auto max-h-[70vh] TableBase (minWidth 900, stickyHeader): up to 12 columns — date, store, 64×20 'מגמת חנות' Sparkline (tone=blue), FB/GA/TT spends, total, revenue+RefundIndicator, RoasBadge chip, gross profit, conditional COGS + רווח תפעולי (green/red by sign). Caps at last 100 rows with '(100 שורות אחרונות)' meta strip on bg-glass-2/40. Empty state: centered muted text. Bare + self-carded variants.
- **פרימיטיבים:** TableBase, Sparkline, RoasBadge/roasCell, RefundIndicator, Heading, status tokens
- **חוב:** Sparkline column repeats the IDENTICAL per-store series on every row of that store (up to 100 duplicate sparklines — redundant ink + render cost; belongs once per store group). All money via formatNumber/formatCurrency raw text, not <Money>. Hard 100-row cap is silent beyond the meta strip — no pagination/'show more'. minWidth 900 horizontal scroll on mobile with no column-priority strategy.

### BillingSettings (shell + Sheet modal) · `modal`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/BillingSettings.tsx
- **משטח-אב:** P&L tab ('pnl') — trigger button right-aligned above CogsSettings; opens app-level Sheet
- **ויזואלית:** Trigger: secondary Button 'עלויות חודשיות' + live '(N פעילות · CAD total)' tabular suffix (hidden <sm), wrapped in HelpTooltip. Modal: Sheet side='bottom' h-[92vh] mobile, CSS-hacked into a CENTERED desktop dialog via 'sm:max-w-3xl sm:bottom-auto sm:top-1/2 sm:-translate-y-1/2 rounded-t-2xl sm:rounded-2xl'. Header: accent-soft Receipt icon square, SheetTitle + truncating subtitle, manual ✕ (hideDefaultClose). Sticky tab nav (bg-glass-2/95 + backdrop blur var): 3 text tabs with active bg-accent-bg text-accent + (count). Body scrolls via SheetBody.
- **פרימיטיבים:** Sheet/SheetContent/SheetHeader/SheetBody/SheetTitle, Button, HelpTooltip, useDrawerEsc drawer-stack, useBillingRecurring/OneTime cloud hooks
- **חוב:** Desktop 'centered modal' is faked by overriding a bottom-Sheet with translate utilities instead of a real centered Dialog variant in the Sheet primitive — bespoke positioning hack any Sheet refactor will break. Tab Buttons pass variant ternary 'ghost':'ghost' (dead code) and restyle by className. SOURCE_COLOR maps 'one-off'/'other' chips to 'bg-ink-muted text-ink-secondary' — a TEXT token used as chip BACKGROUND, gray-on-gray contrast risk in both themes (only non-status-token pair in the map). Counts/prices at 10px.

### RecurringTab + RecurringEditForm · `form`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/BillingSettings.tsx (RecurringTab ~line 293)
- **משטח-אב:** BillingSettings sheet → 'חודשי קבוע' tab
- **ויזואלית:** Optional warning banner (status-warning box, AlertCircle, per-store mono LTR error strings) for failed Shopify plan auto-detect; accent banner (Sparkles, 'זיהינו אוטומטית תוכניות Shopify') listing detected plans with ≈CAD estimate + per-row 'הוסף' / bulk link Button. Item list: rounded-lg rows (inactive = opacity-60), active-checkbox via Input type=checkbox in HelpTooltip, name + SOURCE_COLOR chip + store microcopy, bold CAD or % figure with 10px '/חודש' caption, edit/trash icon Buttons. Edit form: 2-col grid, fixed-vs-% segmented Button pair (accent active w/ color-mix hover), inline validation via Input error prop, notes, save/cancel. Empty state: Receipt icon + CTA.
- **פרימיטיבים:** Button, Input(+error), NativeSelect, HelpTooltip, status tokens, fmtMoney/formatCurrency
- **חוב:** Checkbox-as-active-toggle uses raw Input type=checkbox while ui/Switch.tsx exists — inconsistent control for an on/off state. Money figures are formatCurrency text with hand-prepended 'CAD' 10px span, not <Money prefix>. Fixed/% segmented pair duplicates the same color-mix hover literal twice inline. uppercase 10-11px label style copy-pasted ~12 times in this file.

### OneTimeTab + OneTimeEditForm · `form`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/BillingSettings.tsx (OneTimeTab ~line 866)
- **משטח-אב:** BillingSettings sheet → 'חד-פעמיים' tab
- **ויזואלית:** Newest-first list: each row leads with stacked min-w-[64px] date block (MM-DD over YYYY, 10-11px), description + source chip + store, bold CAD figure, edit/trash. Edit form mirrors Recurring (date, store, source, amount w/ inline error, notes). Empty state references the CSV tab with directional emoji '⬅️'.
- **פרימיטיבים:** Button, Input, NativeSelect, status tokens
- **חוב:** Directional emoji '⬅️' in empty-state copy is RTL-fragile emoji-as-UI. Same raw-CAD-string + 10px-label debts as RecurringTab. addNew() seeds date from new Date().toISOString() — UTC date, not Israel-tz (off-by-one before 03:00 IL; getTodayInIsraelTz exists for exactly this).

### BillingCsvImport · `form`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/BillingCsvImport.tsx
- **משטח-אב:** BillingSettings sheet → 'ייבא CSV מ-Shopify' tab
- **ויזואלית:** How-to box (glass-2/60, ordered Shopify Admin steps), store-target NativeSelect + 'בחר קובץ' upload Button (hidden file Input), LTR mono Textarea for paste + 'נתח' parse button, warnings box (status-warning), preview panel: header strip with tabular counts + 'ייבא (N)' Button, max-h-80 scrolling list — each line: include-checkbox in HelpTooltip, 10px date, description (+ '⚠️ קיים כבר' duplicate hint), LTR mini segmented חודשי/חד-פעמי toggle (10px Buttons), SOURCE chip, CAD amount.
- **פרימיטיבים:** Button, Input, NativeSelect, Textarea, HelpTooltip, SOURCE_LABEL/COLOR shared from BillingSettings
- **חוב:** Smallest interactive controls in the app: px-1.5 py-0.5 text-[10px] toggle Buttons — far under the 44px touch floor, inside a touch-first bottom sheet. ⚠️ emoji duplicate warning instead of token-colored AlertCircle. Skipped rows communicated only by opacity-50 (no strike/label for color-blind users).

### CogsSettings · `form`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/CogsSettings.tsx
- **משטח-אב:** P&L tab — inline Card below PnLBreakdown
- **ויזואלית:** Card (space-y-4): bold 14px h3 'הוצאות מלאי (COGS)'; mode segmented (רמת עסק/רמת חנות — ghost Buttons in bg-glass-2 p-0.5 rail, active bg-accent); PctField rows (label + w-28 centered bold Input with % prefix); apply-scope fieldset of 4 custom Radio rows (current/specific+month-select/all-previous/everything); full-width primary 'החל שינוי'; 2xs explainer; collapsible month timeline → compact TableBase with per-month effective % + 'נערך' accent-soft / 'ברירת מחדל' glass-3 Badges, non-edited rows dimmed.
- **פרימיטיבים:** Card, Button, Input(prefix), NativeSelect, TableBase family, useCogsSettings cloud hook
- **חוב:** Local Badge + Radio + lastNMonths are COPY-PASTED verbatim into SalarySettings.tsx — three duplicated private helpers begging for promotion to ui/. Mode toggle is yet another segmented variant (different rail style from MonthlyTables and Filters). Sits as a permanently-expanded full Card on the P&L page while billing hides in a sheet — two architectures for the same class of settings editor. h3 styled inline instead of Heading primitive.

### SalarySettings · `form`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/SalarySettings.tsx
- **משטח-אב:** P&L tab — inline Card below CogsSettings
- **ויזואלית:** Mirror of CogsSettings: %-vs-CAD-amount segmented, single 'כל העסק' value Input (dir=ltr, prefix flips %/CAD), same 4-radio scope fieldset, primary apply, status-warning double-count note box (AlertCircle: 'אם הזנת משכורות בעלויות קבועות — הסר משם'), business-only caption, collapsible timeline (amount rows use <Money> + '/ חודש' caption).
- **פרימיטיבים:** Card, Button, Input(prefix), NativeSelect, Money, TableBase, useSalarySettings hook
- **חוב:** ~80% structural duplicate of CogsSettings (Badge/Radio/lastNMonths byte-identical copies) — divergence already visible: salary timeline uses <Money>, COGS timeline uses raw toFixed string. The cross-editor double-count warning is static prose; nothing detects an actual salary row in BillingSettings (honor-system).

### Filters (shared filter strip) · `form`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/Filters.tsx
- **משטח-אב:** Every data tab in this slice (Trends/Products/Detail/PnL); Home adds showCompareBaseline+showSavedViews
- **ויזואלית:** Card !p-0 single wrap-row: '⚡ טווח מהיר' label (orange Zap), desktop featured-preset Buttons (primary w/ border-accent shadow-glass when active), MOBILE replacement = sliding-thumb pill bar (bg-pill-track rail, absolutely-positioned bg-pill-thumb slab animating via inset-inline-start RTL math, 44px pills), store NativeSelect, range chip (glass-2, Calendar icon, from—to · N ימים tabular), 'טווחים נוספים' chevron toggle → secondary preset row + custom date Inputs (max=IL-today, clamped). Optional compare-baseline pill row.
- **פרימיטיבים:** Card, Button, Input(date), NativeSelect, presets lib, rangeClamp, pill-track/thumb tokens
- **חוב:** Desktop active-preset (primary button) and mobile active-preset (sliding thumb) are two different visual languages for the same state. Pill-bar thumb math is bespoke manual % strings. Saved-views/compare are Home-only flags so Trends/Archive/Detail users can't reuse saved views even though the dropdown is generic.

### SavedViewsDropdown (saved-views manager) · `form`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/Filters.tsx (function SavedViewsDropdown, ~line 387)
- **משטח-אב:** Filters strip (Home tab only — showSavedViews; mounted via Dashboard.tsx ~line 1613)
- **ויזואלית:** Bookmark ghost Button 'תצוגות שמורות' + rotating chevron → hand-rolled absolutely-positioned w-72 panel (rounded-control, bg-glass-2, shadow-glass, insetInlineEnd:0): MRU list rows (44px apply Button, Pencil rename → inline Input with Enter/Esc/blur commit, Trash delete with red hover), divider, save-current row (Input + primary 'שמור תצוגה', disabled when empty). Outside-pointerdown dismiss via document listener. Applying a view re-derives relative ranges (saved 'this month' tracks current month).
- **פרימיטיבים:** Button, Input, useSavedViews hook, savedViews lib (save/delete/rename/touch)
- **חוב:** Hand-rolled positioned div + manual outside-click instead of Radix Popover — the codebase has a hard rule that hand-rolled overlays go inert over Sheets (ProductPickerModal incident); survives only because it never renders over a Sheet today. No Esc-to-close on the panel itself. No delete confirmation. Home-exclusive mounting makes the 'manager' undiscoverable from any other tab or the command palette.

### HelpTooltip (mode router) + TooltipContent · `primitive`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/ui/Tooltip.tsx
- **משטח-אב:** App-wide primitive — every ⓘ/help in this slice routes through it
- **ויזואלית:** Auto-selects: desktop-simple Radix Tooltip (glass-2 bubble, text-xs, arrow fill-glass-2, Esc-dismiss marked for drawer stack); desktop-rich → RichPopover; touch-simple/short-rich → Toggletip; touch-long-rich → RichSheet. Pointer-capability gated (hover:none/pointer:coarse), not viewport width. null/'' content passes child through untouched.
- **פרימיטיבים:** Radix Tooltip/Popover, RichPopover, Toggletip, RichSheet, drawerStack markEscHandledByInnerLayer
- **חוב:** Healthy, hermetically-tested core. Knob surface is growing (variant/richTouch/touchTrigger/withinDrawer/forceChildTrigger) — call-sites like ColHelp already need 2 knobs to avoid double-ⓘ; a dedicated ColumnHelp wrapper would absorb that. withinDrawer z-[60] is a manual flag callers must remember inside Sheets.

### RichPopover · `primitive`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/ui/tooltip/RichPopover.tsx
- **משטח-אב:** HelpTooltip mode B (desktop rich) — used by ColHelp headers, delta chips, RefundIndicator, annotation kind chips
- **ויזואלית:** Portalled Radix Popover role=dialog: max-w-sm rounded-card bg-glass-1 border-glass-edge shadow-overlay, dir=rtl, optional text-sm semibold title, text-xs ink-secondary whitespace-pre-line body, glass-1 arrow, fade/zoom-in. Hover-intent open 180ms / close grace 150ms, click toggles, Esc consumed for drawer stack, no focus-yank on hover-open.
- **פרימיטיבים:** Radix Popover, drawerStack, tokens only
- **חוב:** None significant — this is the standard the bespoke popovers were migrated TO.

### Toggletip · `primitive`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/ui/tooltip/Toggletip.tsx
- **משטח-אב:** HelpTooltip mode C (touch simple/short-rich)
- **ויזואלית:** Pairs the child with a 24px ⓘ button (border-glass-edge bg-glass-1, ::after inset to ≥44px hit area, accent on focus/hover) toggling a Radix Popover; content announced via role=status live region; non-phrasing children become the tap trigger themselves (forceChildTrigger extends this to phrasing help-affordance children).
- **פרימיטיבים:** Radix Popover, phrasing.ts isNonPhrasingChild, createPortal
- **חוב:** None notable; but gray ⓘ here vs ProductCentricView's violet ⓘ means touch users see two different help-dot skins across the same table family (auto vs child-trigger paths).

### RichSheet · `drawer`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/ui/tooltip/RichSheet.tsx
- **משטח-אב:** HelpTooltip mode D (touch long-rich) — column explainers, attribution bodies on phones
- **ויזואלית:** ⓘ affordance → bottom Sheet (variant=drawer side=bottom, h-auto max-h-[80vh], squared bottom corners, dir=rtl): header with never-empty SheetTitle + visible ✕ SheetClose, sr-only SheetDescription, scrolling SheetBody (text-sm ink-secondary whitespace-pre-line). Esc marked consumed for drawer stack; stopPropagation so in-row ⓘ taps don't trigger row drills.
- **פרימיטיבים:** Sheet family, phrasing.ts, drawerStack
- **חוב:** None significant — the sanctioned escalation path.

### ChartContainer + ChartTooltip family · `primitive`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/ui/chart/ChartContainer.tsx (+ ChartTooltip.tsx)
- **משטח-אב:** RoasChart (and all Recharts surfaces)
- **ויזואלית:** ChartContainer: ResponsiveContainer wrapper injecting --chart-grid/axis/cursor/target CSS vars (mapped to glass-edge/text-muted/glass-edge-hot/CHART_TARGET_COLOR), dir=ltr default for chronological axes. ChartTooltip: dir=rtl glass-1 card (rounded-lg, shadow-overlay, min-w-[160px], text-xs) + Label (10px muted) / Row (color dot + label) / Value (mono).
- **פרימיטיבים:** Recharts ResponsiveContainer, chartColors bridge (local/no-cross-palette-import guard)
- **חוב:** ChartTooltipLabel at 10px is below the slice's informal 11px floor. Otherwise the clean token bridge the redesign should keep.

### TabFreshnessHeader · `chip`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/TabFreshnessHeader.tsx
- **משטח-אב:** Dashboard shell — rendered once above every tab incl. all slice-5 tabs
- **ויזואלית:** Row: FreshnessChip (data_daily last-write), conditional warning toast chip ('מרענן את כל הדשבורד… 60-120 שניות', ring-status-warning, spinning RefreshCw), and a secondary 'רענן הכל' Button (HelpTooltip, spinner while refreshing, disabled during run).
- **פרימיטיבים:** FreshnessChip, Button, HelpTooltip, useDashboardRefresh, useStores
- **חוב:** Uses native window.confirm() with a 6-line plain-text bullet dialog for the full-refresh gate — the single most jarring un-themed surface reachable from every tab; should be a styled confirm Sheet/dialog. Copy-truth itself is well maintained (shared REFRESH_DURATION_TEXT).

### SectionIntro · `primitive`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/SectionIntro.tsx
- **משטח-אב:** Header of every slice-5 tab
- **ויזואלית:** Icon in accent-bg rounded square (w-7/8) + Heading level=section + 11-12px ink-secondary description; optional LTR mono formula pill (glass-2 chip); inline mode = single Info-icon hint line; rightSlot for actions.
- **פרימיטיבים:** Heading (Typography), cn, lucide
- **חוב:** Description prop is a plain string — tabs abuse it to encode legends/thresholds as prose (Archive ROAS legend, Detail failure-cell legend) because there's no slot for structured legend chips.

### PageScope · `primitive`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/ui/PageScope.tsx
- **משטח-אב:** Under each tab's intro (Trends/Archive/Products/Detail/PnL)
- **ויזואלית:** role=status 12px muted tabular line: store • (platform) • range-label • CAD (+extra), Latin items in <bdi dir=ltr>, dot separators.
- **פרימיטיבים:** cn, bdi bidi handling
- **חוב:** None — exemplary bidi handling.

### PageSynthesis · `primitive`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/ui/PageSynthesis.tsx
- **משטח-אב:** Trends/Archive/Detail/PnL (NOT Home — RoasTargetChart owns its TL;DR)
- **ויזואלית:** Single text-base font-medium ink-secondary Hebrew TL;DR sentence, role=status aria-live=polite; empty string renders nothing; low confidence = opacity-60.
- **פרימיטיבים:** cn
- **חוב:** anchorMetric prop accepted but unused (reserved band-tint integration never landed) — the TL;DR carries no band color even when the verdict is band-shaped.

### Brand-color picker (AddStoreWizard Step 1 field) · `form`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/operator/AddStoreWizard.tsx (~lines 60-90, 760-790)
- **משטח-אב:** /operator page → Add-Store wizard (store branding source for Trends chart lines / home cards)
- **ויזואלית:** 'צבע-מותג' Field: NativeSelect of 8 token-driven BRAND_COLORS (var(--store-uzo|usm|3..8) with Hebrew hue labels, taken colors suffixed '· בשימוש', default = first free color) + aria-hidden preview row of 5×5 rounded swatches painted by the CSS var directly.
- **פרימיטיבים:** NativeSelect, Field wrapper, storeColors token contract (storeColor(): brandColor > STORE_COLORS > hex FALLBACK_PALETTE)
- **חוב:** Color choice via a text <select> with a separate non-interactive swatch row — swatches aren't clickable and don't indicate WHICH option is selected; a radio-swatch grid would be prettier and more usable. 'בשימוש' is advisory only (no hard uniqueness). FALLBACK_PALETTE in lib/storeColors.ts is raw hex with no dark-mode override (acknowledged edge case).

### StoreRow brand swatch · `primitive`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/operator/StoreRow.tsx (~lines 135-145)
- **משטח-אב:** /operator page → StoreList rows
- **ויזואלית:** Decorative aria-hidden square painted by store.brandColor CSS var (fallback var(--glass-1)) beside store name/slug + platform status matrix; consumed downstream by RoasChart/home cards via buildStoreBrandColorMap.
- **פרימיטיבים:** storeColors tokens (design-color guard compliant)
- **חוב:** brandColor is editable only through the /operator wizard — no recolor affordance from the dashboard proper despite the color driving Trends/Home identity; fallback var(--glass-1) renders an effectively invisible swatch for a color-less store.

### Dashboard shell states (error banner / skeleton / Footer) · `card`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/Dashboard.tsx (~lines 764-905, 2034)
- **משטח-אב:** Wraps all tabs in this slice
- **ויזואלית:** Degraded banner: rounded-xl status-redBg with color-mix red border, AlertCircle, NAMED failing sources (/api/data vs /api/orders-attribution). Loading: skeleton hero (h-40/48 rounded-2xl) + 6 skeleton KPI cards grid + sr-only 'טוען נתונים…'. Footer: centered 11-12px muted 'עדכון אחרון … · מתעדכן אוטומטית כל 2 דקות'.
- **פרימיטיבים:** skeleton utility class, status tokens, lucide AlertCircle
- **חוב:** Skeleton shape mimics the HOME layout only — loading into Archive/Trends shows a hero+KPI skeleton that morphs into a totally different page (layout lie). Per-tab skeletons absent throughout the slice.

---

# קונסולת Operator (operator-console) — 33 קומפוננטות

## עץ-המשטח

```
/operator (sibling Next.js route, NOT a Dashboard.tsx tab — src/app/operator/page.tsx + layout.tsx RTL bg-canvas wrapper; NO main-dashboard Sidebar/shell)
	Page header — Heading level="display" «ניהול» + StatusPill (rolled-up green/yellow/red health chip) + OperatorRefreshButton (global SWR mutate) + muted subtitle
	OperatorSecretBanner (always visible; 2 states: orange entry form ↔ subtle glass "secret stored" strip with change/clear links)
	OperatorTabs (Radix Tabs variant="underline", controlled, 7 Hebrew triggers, horizontal-scroll on mobile)
		בריאות (Health, default) — HealthTab
			TokenFailuresTable (red-bordered expandable failure table + collapsed <details> resolved list + 15s footer)
			[inline] TikTok historical-attribution disclaimer strip (orange-tinted prose section, no component)
			MetaBucPanel (per store×ad-account card → 2 BucBlocks → 3 ProgressBars each)
			FreshnessPanel (store×platform×scope×table lag matrix, status icons)
			ReconcilePanel (green pulse "all clear" line ↔ material-violations table + collapsed explained-gaps <details>)
			TikTokCoveragePanel (Card: dashed disclaimer + 4 StatCells + unmapped-campaigns table)
		סנכרון (Sync) — SyncTab
			SyncNowButtons (1 primary + N per-store buttons, single pendingKey, status/error lines, cost footnote)
			BackfillPicker (2 date Inputs + store checkboxes + submit, boundary-gated)
			ManualOverridesCrud (inline add-row form on bg-glass-2 + CRUD table + hand-rolled fixed-overlay delete-confirm modal)
		פעילות (Activity) — ActivityTab
			StatusEventsFeed (self-carded section; icon + relative-time + mono entity-id list rows, 50 latest)
			CronTickSnapshotsViewer (self-carded section; mono table of 144 ticks, green/orange/red count columns)
			JobsTable (Inngest runs table, StatusBadge chips, הצג/הסתר row detail → single JSON <pre> below the table, 15s footer)
		מסוכן (Danger) — DangerTab
			WhatsappTestButtons (3 green buttons → arm-to-orange ring 3s double-confirm → send)
			<hr border-glass-edge>
			ResetData (2 destructive buttons red/orange + hand-rolled typed-token confirm modal + green success result card)
		מצב פרסום (Ads) — AdStateTab (error line) → AdStatePanel (store×platform Switch matrix; unconnected cells show «לא מחובר» + «חבר» link → jumps to חנויות tab)
		חנויות (Stores) — StoresTab (list ↔ inline wizard swap)
			List view: header + «הוסף חנות» Button · loadError line · actionError alert box
				StoreList («חנויות פעילות») → StoreRow (Card: brand swatch + name/slug + «פעילה» Badge + #order + archive Button) → 5× CredCell (PlatformBadge/webhook label + green/warning Badge + חבר/החלף Button)
				RemovedStores («חנויות שהוסרו», renders nothing when empty) → RemovedStoreRow (muted Card + «הוסרה» Badge + שחזר + מחק-לצמיתות) → DeleteConfirmModal (Radix Sheet variant="modal", typed-name gate)
			Wizard view: «→ חזרה לרשימה» ghost Button + AddStoreWizard (Card max-w-3xl)
				StepDots (3-dot progress: accent active / green done / glass idle)
				Step 1 — basics form (slug/name/domain Inputs, headless Switch, brand-color NativeSelect + swatch row, displayOrder, PlatformToggle pills, advanced customer-journey Switch)
				Step 2 — creds (PlatformCredBlock per platform: Card + «בדוק» verify button + ✓/✗ result line; accent-ring highlight on focusPlatform; save-anyway checkbox)
				Step 3 — success (green check heading, masked secrets list, CodeBlock snippet(s) with copy button, Shopify checklist, «סיום»)
		אבחון סיווג (Attribution diag) — AttributionDiagTab → AttributionDiagPanel
			Range line + «הרץ מחדש» refresh Button · error alert strip
			first-touch coverage Card → 2 CoverageStats (big tabular %)
			2× DistributionTable Cards (orders / ATC source distribution)
			«פירוק דליים עמומים» → 3× BucketTable Cards (other-paid / other-referral / direct)
```

## חוב-עיצובי בפרוסה (הגרוע קודם)

- MODAL FRAGMENTATION (worst): three coexisting confirm-destroy paradigms — ManualOverridesCrud.tsx:377 and ResetData.tsx:253 hand-roll fixed inset-0 z-50 overlay divs with manual aria (no focus trap, no Esc), while RemovedStores.tsx:236 correctly uses the Radix Sheet variant=modal per the project's own modal-over-Sheet rule. The two hand-rolled ones predate the rule and were never migrated; any redesign must converge all destructive confirms on the Sheet modal.
- BUTTON VARIANT BYPASS: at least 6 components repaint variant=ghost Buttons via className token overrides instead of semantic variants — SyncNowButtons (bg-accent text-accent-fg per-store), WhatsappTestButtons (bg-status-greenBtn / armed bg-status-orangeBtn + ring + arbitrary ring-offset-[color:var(--canvas-1)]), ResetData (bg-status-redBtn / bg-status-orangeBtn), TokenFailuresTable resolve pill (bg-status-greenBg), OperatorSecretBanner (bg-status-orangeBtn). The destructive variant exists but is bypassed for the most destructive buttons on the page.
- TABLE-HEADER CHAOS: 5 distinct thead treatments across one console — bg-status-redBg (TokenFailuresTable), bg-glass-3 uppercase (FreshnessPanel, JobsTable), TableHead primitive bg-glass-2 (ReconcilePanel, TikTokCoveragePanel, AttributionDiagPanel), bare uppercase no-bg (ManualOverridesCrud, CronTickSnapshotsViewer), uppercase ink-muted (AdStatePanel). Half the tables use raw <th>/<thead> instead of TableHead/TableHeaderCell; FreshnessPanel (9 cols) has no minWidth while TokenFailuresTable got the mobile minWidth fix.
- SECTION/HEADING HIERARCHY FLATTENED + DOUBLED: every tab section uses Heading level=hero with an inline xs parenthetical explainer span (bespoke, repeated 12+ times); StatusEventsFeed and CronTickSnapshotsViewer additionally render their OWN bordered section + level=section Heading INSIDE the parent's hero-headed section (duplicate titles), and AdStatePanel self-titles at hero level inside its tab. Panels are inconsistently bare / self-carded / Card-wrapped.
- NO LOADING/STALENESS SYSTEM: every panel hand-rolls a one-line 'טוען…' text loading state — zero skeletons, zero freshness-fade, no last-updated treatment parity with Home (only TokenFailuresTable and JobsTable even print refresh-cadence footers). Several SWR fetchers (MetaBucPanel, FreshnessPanel, StatusEventsFeed, CronTickSnapshotsViewer, JobsTable, AttributionDiagPanel) swallow !res.ok and render the EMPTY state on auth failure — false-calm; only TokenFailuresTable's fetcher was hardened (P1-8).
- NUMBERS BYPASS THE <Money>/<Metric> RULE: ManualOverridesCrud renders spend as Number(r.spend).toFixed(2) raw text; CronTickSnapshotsViewer/JobsTable/MetaBucPanel render counts/durations/percents as plain mono strings — versus ReconcilePanel/TikTokCoveragePanel which correctly use <Money>. CronTickSnapshotsViewer also encodes completed/skipped/failed with COLOR ONLY (greenFg/orangeFg/redFg, no icon/label).
- ONE-OFF PATTERNS THAT SHOULD BE PRIMITIVES: native browser alert() in TokenFailuresTable.handleResolve (only one in the console); HelpTooltip wrapping <td> elements between <tr> children in 3 tables (fragile markup); three near-identical bespoke stat-tiles (TikTokCoveragePanel.StatCell, AttributionDiagPanel.CoverageStat, vs Home metric cards); arm-to-confirm button logic private to WhatsappTestButtons; raw Input type=checkbox (no Checkbox primitive) in BackfillPicker/ManualOverrides/AddStoreWizard; arbitrary-value classes bg-[color:var(--surface-sunken)] in MetaBucPanel/TikTokCoveragePanel.
- MOBILE GAPS: StatusEventsFeed rows are rigid shrink-0 flex spans with a fixed w-24 time column (wraps badly, no overflow guard); MetaBucPanel forces grid-cols-2 at all widths; AdStatePanel matrix and FreshnessPanel rely purely on overflow-x scroll; ManualOverridesCrud's 6-field inline form strip is cramped under 400px; 7-tab strip needs momentum-scroll discovery on phones.
- NAVIGATION/SHELL: the console has no app shell — no sidebar, no mesh chrome, no link back to the dashboard (layout.tsx is a bare RTL div); tab state is useState-only so tabs are not deep-linkable and ALL 7 tab panels mount + poll simultaneously (every 15s SWR timer runs even on hidden tabs); JobsTable's row detail renders its JSON <pre> BELOW the whole table instead of under the clicked row.
- LANGUAGE/SEMANTICS DRIFT: English headings/labels scattered through the Hebrew console (Cron-tick snapshots, Sync now, running…, success/budget_skip status enums, other-paid/other-referral card titles); ReconcilePanel uses emoji ✓/⚠️ where siblings use lucide; the danger tab has no danger-zone visual identity (plain hr separator before a 7-table wipe); StatusPill speaks the band-* color vocabulary while everything below speaks status-* tokens. NOTE for redesign: StoreRow/StoreList/RemovedStores/AddStoreWizard (Phase 6) are the in-slice gold standard to converge on, and the locked ROAS band system + the .fresh-chip family must not be touched.

## קומפוננטות

### OperatorLayout · `nav`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/app/operator/layout.tsx
- **משטח-אב:** /operator route shell
- **ויזואלית:** Bare RTL wrapper: div dir=rtl, min-h-screen bg-canvas text-ink. No top bar, no sidebar, no mesh-gradient chrome — just the token canvas.
- **פרימיטיבים:** none
- **חוב:** The operator console has NONE of the main dashboard's shell (slim sidebar, mesh background, page chrome) — it reads as a second, plainer app. Comment says the layout is a 'scoping seam' for chrome that was never added.

### OperatorPage (header) · `nav`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/app/operator/page.tsx
- **משטח-אב:** /operator route shell
- **ויזואלית:** max-w-7xl centered main, px-4 py-6. Flex-wrap header row: Heading level=display «ניהול» on the right (RTL), StatusPill + OperatorRefreshButton on the left, ink-secondary sm subtitle under it.
- **פרימיטיבים:** Heading (Typography), StatusPill, OperatorRefreshButton, OperatorSecretBanner, OperatorTabs
- **חוב:** Server component, force-dynamic. Minimal polish vs the Home hero; padding/typography fine but no breadcrumb/back-link to the dashboard.

### OperatorTabs · `nav`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/app/operator/OperatorTabs.tsx
- **משטח-אב:** /operator below header
- **ויזואלית:** Radix Tabs variant=underline: flat trigger row with border-b glass-edge; active trigger = text-ink + 2px accent underline; 7 Hebrew triggers (בריאות/סנכרון/פעילות/מסוכן/מצב פרסום/חנויות/אבחון סיווג). TabsList overflow-x scrolls on phones (scrollbar hidden). Content fades in over 120ms.
- **פרימיטיבים:** Tabs/TabsList/TabsTrigger/TabsContent (ui/Tabs)
- **חוב:** Tab state is local useState — not URL-synced, so refresh/deep-link always lands on בריאות. 7 tabs at text-sm overflow on narrow phones with only momentum-scroll affordance. All 7 TabsContent panels mount simultaneously (every SWR poller for every tab runs at once).

### StatusPill · `chip`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/ui/StatusPill.tsx
- **משטח-אב:** /operator page header
- **ויזואלית:** Uses the .fresh-chip CSS family (globals.css:1603): 10px uppercase mono pill, band-colored text on an 18%-alpha band tint (live=green w/ pulsing dot, aging=orange, stale=red); unknown/loading = glass-edge border + ink-secondary. Shows «תקין · 85%» with bdi-isolated LTR percent. HelpTooltip exposes freshness % + errors_1h.
- **פרימיטיבים:** HelpTooltip, cn, .fresh-chip token classes; SWR 15s via operatorFetch
- **חוב:** Band-colored text on same-hue 18% tint at 10px is borderline contrast (matches FreshnessBadge convention but is the smallest text on the page). Health pill colors (band-*) are a separate vocabulary from the status-* tokens used by every panel below it.

### OperatorRefreshButton · `primitive`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/app/operator/OperatorRefreshButton.tsx
- **משטח-אב:** /operator page header
- **ויזואלית:** Ghost sm Button, RotateCw 14px icon + «רענון»; icon spins while the global mutate(() => true) promise is in flight; disabled meanwhile.
- **פרימיטיבים:** Button, lucide RotateCw, useSWRConfig
- **חוב:** Clean. Only nit: revalidates literally every SWR key in the app cache, including non-operator ones (acknowledged in comments).

### OperatorSecretBanner · `form`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/operator/OperatorSecretBanner.tsx
- **משטח-אב:** /operator above the tabs (always rendered)
- **ויזואלית:** State A (no secret): orange alert card (border-status-orange bg-status-orangeBg) with KeyRound icon title, xs explainer with orange inline <code>, password Input (max-w-xs) with absolutely-positioned eye-toggle Button inside, orange «שמור» button. State B (stored): quiet glass strip (border-glass-edge bg-glass-1) with green check + «החלף secret»/«נקה» link-buttons, expanding to an inline h-7 password input.
- **פרימיטיבים:** Button, Input, lucide KeyRound/CheckCircle2/Eye/EyeOff
- **חוב:** Eye-toggle is a hand-positioned absolute Button inside the Input (bespoke; no shared password-input primitive). Save button is variant=ghost re-skinned with bg-status-orangeBtn + text-accent-fg className override instead of a semantic variant. Two visually different save affordances (solid button vs link) between the two states.

### HealthTab (container + TikTok disclaimer strip) · `nav`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/app/operator/HealthTab.tsx
- **משטח-אב:** בריאות tab
- **ויזואלית:** space-y-8 stack of 5 sections, each headed by Heading level=hero + an inline text-xs ink-secondary parenthetical explainer span. Includes an inline orange disclaimer section (rounded-md border-status-orange/30 bg-status-orange/8) of pure Hebrew prose with <code> slugs — not a component.
- **פרימיטיבים:** Heading; children panels
- **חוב:** Every section title is level=hero → flat hierarchy wall. The parenthetical-subtitle-inside-the-Heading pattern is bespoke (repeated in ActivityTab/DangerTab/AttributionDiagTab) instead of a SectionIntro-style primitive. The disclaimer strip uses one-off opacity-modified token classes (border-status-orange/30, bg-status-orange/8) seen nowhere else.

### TokenFailuresTable · `table`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/operator/TokenFailuresTable.tsx
- **משטח-אב:** בריאות tab › בעיות טוקן section
- **ויזואלית:** Unresolved failures: red-framed (border-status-red) overflow-x box, TableBase minWidth=640, thead bg-status-redBg; rows clickable (hover:bg-status-redBg) with XCircle icon, mono operation, relative Hebrew times, tabular counts, and a tiny green «סמן כתוקן» pill-button per row; expanding a row reveals a full-width red cell with LTR mono <pre> error + advice + first-seen line. Resolved rows live in a collapsed <details> with a header-less xs table. States: orange AlertCircle refresh-error line, «טוען...» text, green-check «הכל ירוק» empty line. 2xs auto-refresh footer.
- **פרימיטיבים:** TableBase, Button, HelpTooltip, lucide CheckCircle2/AlertCircle/XCircle; SWR 15s via operatorFetch
- **חוב:** handleResolve uses native browser alert() for failures — the only native alert in the console. Resolve Button is variant=ghost re-skinned with bg-status-greenBg/h-auto/px-2 overrides. thead uses raw <th> + bg-status-redBg (one of 4 different thead treatments on this page). HelpTooltip wraps <td> elements directly (tooltip component between <tr> children — fragile table markup). Resolved table has no header row. Loading state is a bare text line — no skeleton.

### MetaBucPanel · `card`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/operator/MetaBucPanel.tsx
- **משטח-אב:** בריאות tab › תקציב Meta BUC section
- **ויזואלית:** Stack of per-(store, ad_account) cards: hand-rolled border-glass-edge rounded-md p-4 div with bold store id, mono act_ id, «עודכן לפני N דק׳». Inside: 2-col grid of BucBlocks (mono title + red ETA text when throttled) each with 3 ProgressBars — xs mono label/percent row above a 1.5px-tall track (bg --surface-sunken) with a solid fill colored ≥80 red / ≥60 orange / else green. Empty + loading = single ink-secondary sm lines.
- **פרימיטיבים:** SWR via operatorFetch only — NO shared primitives (no Card, no Money)
- **חוב:** Card is hand-rolled div, not the Card primitive. Progress track uses arbitrary-value class bg-[color:var(--surface-sunken)]. grid-cols-2 is NOT mobile-first — the two BucBlocks squeeze side-by-side on phones. Percent text is raw, no <Metric>. ageMinutes computed at render (no live tick). Fetcher doesn't throw on !res.ok → an auth failure renders as the 'no BUC data yet' empty state (false-calm), unlike TokenFailuresTable's hardened fetcher.

### FreshnessPanel · `table`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/operator/FreshnessPanel.tsx
- **משטח-אב:** בריאות tab › טריות נתונים section
- **ויזואלית:** overflow-x TableBase, 9 columns; thead = xs uppercase tracking-wider on bg-glass-3. Rows: bold store, mono platform/scope/table, status cell = icon (green check / orange alert / red x) + mono English status label + optional 2xs budget_skip sub-chip, tabular lag minutes, relative Hebrew times via HelpTooltip-wrapped cells, truncated mono error notes (max-w-xs). Loading/empty = sm text lines.
- **פרימיטיבים:** TableBase, HelpTooltip, lucide status icons; SWR 15s via operatorFetch
- **חוב:** 9-column table with NO minWidth — columns crush on phones (TokenFailures got the minWidth fix; this didn't). Error notes use `truncate` with no expand affordance (info hidden). Status text is raw English mono enum values inside a Hebrew console. HelpTooltip wraps <td>s (same fragile pattern). Raw <th> markup not TableHeaderCell. Fetcher swallows !ok (false-empty risk). No row coloring/sort affordance despite 'stale floats up' being the whole point.

### ReconcilePanel · `table`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/operator/ReconcilePanel.tsx
- **משטח-אב:** בריאות tab › התאמת מקורות section
- **ויזואלית:** All-clear state: green semibold line with a soft animate-ping pulse dot (motion-safe) + «✓ הכל תואם». Violations: warning-Fg semibold verdict line «⚠️ N אי-התאמות מהותיות» + a 6-column TableBase (בדיקה mono / חנות·פלטפורמה / date bdi / expected / actual / delta) using proper TableHead/TableRow/TableHeaderCell/TableCell, numeric cells via <Money prefix=none>, delta in text-status-warningFg, soft rows tagged with a gray «מוסבר» mini-chip; explained gaps collapse into a <details>.
- **פרימיטיבים:** TableBase+TableHead+TableRow+TableHeaderCell+TableCell, Money, fetchJsonOrNull SWR 15s
- **חוב:** Highest-polish panel in the tab (full primitive table + Money). Remaining debt: emoji glyphs (✓ ⚠️) as status iconography instead of lucide like every sibling panel; «מוסבר» chip is bespoke inline markup (rounded bg-status-grayBg text-[10px]) not the Badge primitive; fetch soft-fails to the green state by design (pending == all-clear) which is a deliberate but debatable honesty trade.

### TikTokCoveragePanel · `card`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/operator/TikTokCoveragePanel.tsx
- **משטח-אב:** בריאות tab › כיסוי מיפוי TikTok section
- **ויזואלית:** Card containing: a dashed-border sunken disclaimer paragraph (border-dashed border-glass-edge bg-[--surface-sunken], xs leading-relaxed); a 2→4-col StatCell grid (rounded-card border glass-edge bg-glass-2, Heading level=label caption + text-xl extrabold value, Money or tabular count); and a compact TableBase of unmapped campaigns (mono LTR bdi ids + Money spend).
- **פרימיטיבים:** Card, Heading, Money, TableBase family; SWR 15s fetchJsonOrNull; localStorage campaignStoreMap listener
- **חוב:** StatCell is a local one-off stat-tile (similar tiles exist in AttributionDiagPanel's CoverageStat and Home metric cards — three near-identical bespoke implementations). Disclaimer uses the arbitrary-value bg-[color:var(--surface-sunken)] class. Coverage derives from localStorage client-side — fine functionally but means the panel renders different truths per browser.

### SyncTab (container) · `nav`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/app/operator/SyncTab.tsx
- **משטח-אב:** סנכרון tab
- **ויזואלית:** space-y-8, three Heading level=hero sections (סנכרון עכשיו / Backfill טווח תאריכים / החלפות הוצאה ידניות).
- **פרימיטיבים:** Heading
- **חוב:** Same flat all-hero heading wall; mixed Hebrew/English heading («Backfill טווח תאריכים»).

### SyncNowButtons · `form`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/operator/SyncNowButtons.tsx
- **משטח-אב:** סנכרון tab › סנכרון עכשיו
- **ויזואלית:** flex-wrap row: one primary sm Button «Sync now (כל החנויות)» + one button per store; whichever is pending swaps its RefreshCw icon for a spinning Loader2; ALL buttons disable while any is in flight. Below: green role=status confirmation line, red role=alert error line, xs footnote about Inngest exec cost.
- **פרימיטיבים:** Button, Input(none), lucide RefreshCw/Loader2, useStores
- **חוב:** Per-store buttons are variant=ghost force-painted into primary look via className 'bg-accent hover:opacity-90 text-accent-fg' — a ghost that isn't a ghost; should be a real variant. Mixed-language button copy. Success/error feedback are plain text lines (no toast/banner primitive), inconsistent with StoresTab's boxed actionError alert.

### BackfillPicker · `form`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/operator/BackfillPicker.tsx
- **משטח-אב:** סנכרון tab › Backfill
- **ויזואלית:** flex-wrap items-end row: two labelled native date Inputs (dir=ltr, min-gated to 2026-05-01), a store-checkbox group (Input type=checkbox + name labels), and a sm submit Button with CalendarDays/Loader2 icon swap («הפעל Backfill»/«מפעיל…»). Green status / red alert lines + xs cost-footnote with LTR boundary date.
- **פרימיטיבים:** Button, Input, lucide CalendarDays/Loader2, useStores
- **חוב:** Checkboxes are raw Input type=checkbox — no Checkbox primitive exists, so default browser checkboxes sit beside the themed Inputs. The items-end flex-wrap row collapses awkwardly on phones (labels stack at varying heights). Disable-rule feedback is silent: button just grays with no inline hint WHY (empty stores / inverted range).

### ManualOverridesCrud · `form`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/operator/ManualOverridesCrud.tsx
- **משטח-אב:** סנכרון tab › החלפות הוצאה ידניות
- **ויזואלית:** Three stacked zones: (1) inline add-row strip on bg-glass-2 rounded — 6 labelled xs fields (date Input, store/platform/currency NativeSelects, w-24 number Input, flex-1 notes Input) + «הוסף» Button; (2) TableBase with bare uppercase xs thead (no bg), 7 columns, LTR cells for date/amount/currency, per-row ghost icon-Button trash in redFg, empty-state row «אין רשומות»; (3) hand-rolled DELETE-CONFIRM MODAL — fixed inset-0 z-50 bg-scrim flex, bg-glass-1 panel (full-screen on mobile, max-w-md centered on sm+), Heading hero title, X close, sticky footer with secondary ביטול + destructive מחק (44px touch targets on mobile). Plus loading/red-error/amber-soft-fail single lines and two xs footnotes.
- **פרימיטיבים:** Button, Input, NativeSelect, TableBase, Heading; SWR 15s via operatorFetch
- **חוב:** The delete-confirm modal is a HAND-ROLLED fixed-overlay div with manual role=dialog/aria-modal — no focus trap, no Esc handling, and it violates the project's own 'modal must be Radix Sheet' rule (the StoresTab DeleteConfirmModal does it right; ResetData copies this wrong pattern — 3 modal paradigms on one console). Spend renders as Number(r.spend).toFixed(2) raw text, not <Money> (breaks the numbers-never-clip primitive rule). thead is the bare-uppercase variant (4th table-header style on the page). PATCH/inline-edit unexposed → delete-then-re-add workflow. Add-strip is cramped at <400px widths.

### ActivityTab (container) · `nav`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/app/operator/ActivityTab.tsx
- **משטח-אב:** פעילות tab
- **ויזואלית:** space-y-8, three hero-Heading sections (סטטוס אירועים / סנפשוטים של cron ticks / ריצות אחרונות) with xs parenthetical explainers.
- **פרימיטיבים:** Heading
- **חוב:** DOUBLE-HEADING bug-shape: the first two children (StatusEventsFeed, CronTickSnapshotsViewer) render their OWN bordered section + Heading inside the parent's headed section → title appears twice in different sizes for the same panel.

### StatusEventsFeed · `feed`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/operator/StatusEventsFeed.tsx
- **משטח-אב:** פעילות tab › סטטוס אירועים
- **ויזואלית:** Self-carded section (border-glass-edge rounded-lg p-4) with its own Heading level=section «שינויי סטטוס אחרונים (50 אחרונים)». List rows: kind icon (Pause orange / Play green / Sparkles blue / Archive gray / Eye / MousePointerClick / red AlertCircle fallback), fixed w-24 relative-time span, xs ink-secondary store·platform·entity, mono entity_id, from→to status with bold target. Loading + empty states reuse the same card with text.
- **פרימיטיבים:** Heading, lucide icon set; SWR 15s via operatorFetch
- **חוב:** Owns its own card + heading under ActivityTab's heading (duplicate titles). Row is a rigid flex of shrink-0 spans with a hard w-24 timestamp column — long mono entity ids force the status fragment to wrap badly and the row has no mobile layout or overflow handling. Plain <ul>, no hover/zebra, visually thinner than Home's ActivityFeed which shares the same endpoint. Fetcher swallows !ok → false-empty.

### CronTickSnapshotsViewer · `table`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/operator/CronTickSnapshotsViewer.tsx
- **משטח-אב:** פעילות tab › cron ticks
- **ויזואלית:** Self-carded section (border rounded-lg p-4) + Heading level=section «Cron-tick snapshots (N ticks אחרונים)». overflow-x TableBase: xs ink-secondary thead (border-b only, no bg), tbody font-mono text-xs; columns tick_id / fan_out / completed (greenFg) / skipped (orangeFg) / failed (redFg) / duration; rows separated by half-opacity glass-edge borders (border-glass-edge/40).
- **פרימיטיבים:** TableBase, Heading; SWR 15s via operatorFetch
- **חוב:** English heading on a Hebrew console. Color-only encoding of completed/skipped/failed columns (no icons/labels — violates the never-color-only rule StoreRow documents). Up to 144 rows render with no pagination/virtualization or sticky header. Bare <th> thead, 4th header style. Counts are raw mono text, not Metric. Duplicate-heading nesting same as StatusEventsFeed.

### JobsTable · `table`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/operator/JobsTable.tsx
- **משטח-אב:** פעילות tab › ריצות אחרונות
- **ויזואלית:** overflow-x TableBase, thead xs uppercase on bg-glass-3; rows: mono function_id, StatusBadge chip (paired Bg/Fg/border status tokens, Loader2 spins for Running, icons CheckCircle2/XCircle/Clock), relative-time cell wrapped in HelpTooltip, LTR duration, and a link-variant «הצג/הסתר» toggle. Expanded detail = ONE LTR JSON <pre> (bg-glass-2 rounded) rendered AFTER the whole table. Footer «עודכן … רענון אוטומטי כל 15 שנ׳». States: loading text, red hard-error line, amber AlertCircle soft-fail line, empty 'אין ריצות אחרונות' + heartbeat line.
- **פרימיטיבים:** TableBase, Button, HelpTooltip, lucide icons; SWR 15s via operatorFetch
- **חוב:** Expanded run output renders BELOW the entire table, not under its row — clicking הצג on row 3 dumps JSON 40 rows away (contradicts the file's own 'inline row-expand' rationale; only one expansion at a time despite the comment promising side-by-side). HelpTooltip wraps a <td>. English status labels in the badge. Raw English 'running…' duration string. No minWidth on a 5-col table.

### DangerTab (container) · `nav`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/app/operator/DangerTab.tsx
- **משטח-אב:** מסוכן tab
- **ויזואלית:** Two hero-headed sections separated by an <hr class=border-glass-edge>: WhatsApp test buttons with a long Hebrew explainer paragraph, then ניקוי וריסט (destructive) with its own explainer.
- **פרימיטיבים:** Heading
- **חוב:** The 'danger zone' has no danger visual identity — same neutral chrome as every other tab; only an hr separates routine WhatsApp testing from a 7-table data wipe. A red-tinted danger Card (GitHub-style) would carry the semantics tokens already support.

### WhatsappTestButtons · `form`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/operator/WhatsappTestButtons.tsx
- **משטח-אב:** מסוכן tab › התראות WhatsApp
- **ויזואלית:** Three flex-wrap buttons (noon/evening/eod). Idle: solid green (bg-status-greenBtn, accent-fg text, Send icon). First click ARMS: button flips to solid orange + ring-2 ring-status-warning glow + AlertTriangle + «לחץ שוב לאישור — …» for 3s, then silently disarms. Pending swaps to Loader2 spinner; all disable while one is in flight. Green/red feedback lines + a long xs footnote explaining the arm-to-confirm pattern.
- **פרימיטיבים:** Button, Input(none), lucide Send/Loader2/AlertTriangle
- **חוב:** Both visual states are variant=ghost Buttons fully repainted via className (bg-status-greenBtn / bg-status-orangeBtn + text-accent-fg + ring) — the arm/confirm pattern is bespoke per-component instead of a shared 'ArmedButton' primitive (ring-offset hardcodes ring-offset-[color:var(--canvas-1)] arbitrary value). The 3s arm window has no visible countdown.

### ResetData · `modal`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/operator/ResetData.tsx
- **משטח-אב:** מסוכן tab › ניקוי וריסט
- **ויזואלית:** Two solid destructive buttons (full reset = bg-status-redBtn, partial = bg-status-orangeBtn; AlertTriangle icons). Confirm modal: hand-rolled fixed inset-0 z-50 bg-scrim overlay, bg-glass-1 panel (full-screen mobile / max-w-md desktop), red AlertTriangle hero title, warning paragraph, red <code> list of tables-to-delete vs green <code> protected tables with Hebrew side-notes, the required token shown in an orange <code> block, LTR Input typed-token gate (confirm disabled until exact match), sticky footer ביטול/אשר-ומחק with Loader2. After success: green result card (border-status-green bg-status-greenBg) with per-table deleted counts (LTR list) and an orange partial-failure note.
- **פרימיטיבים:** Button, Input, Heading, mutate (SWR), lucide AlertTriangle/Loader2/X
- **חוב:** Second hand-rolled fixed-overlay modal (copies ManualOverridesCrud's pattern by explicit design 'D-D4 consistency' — but both now diverge from the Radix Sheet modal standard StoresTab uses; no focus trap/Esc). Trigger buttons are ghost-variant repaints via bg-status-*Btn classNames instead of the existing variant=destructive. Dense bilingual modal body with dir flips per <li> — readable but visually busy; deleted-count list is raw mono text, not a table.

### AdStateTab (container) · `nav`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/app/operator/AdStateTab.tsx
- **משטח-אב:** מצב פרסום tab
- **ויזואלית:** space-y-3: optional red error line («טעינת מצב הפרסום נכשלה…» / «שמירת השינוי נכשלה.») above AdStatePanel. Optimistic toggle + reconcile-on-save.
- **פרימיטיבים:** AdStatePanel; operatorFetch
- **חוב:** Error is a bare redFg text line, inconsistent with StoresTab's boxed role=alert strip. No loading state at all — the matrix renders empty-then-pops when the fetch lands.

### AdStatePanel · `table`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/operator/AdStatePanel.tsx
- **משטח-אב:** מצב פרסום tab
- **ויזואלית:** Hero Heading «מצב פרסום» + explainer, then overflow-x TableBase matrix: thead xs uppercase ink-muted (no bg), one row per store (bold name), 3 centered platform cells. Applicable cell = Switch + xs «דלוק/כבוי» label (fixed w-8). Unconnected cell = stacked ink-subtle «לא מחובר» + link-variant «חבר» Button (jumps to חנויות tab) or static hint.
- **פרימיטיבים:** Switch, Button, Heading, TableBase
- **חוב:** Renders its OWN hero Heading inside the tab (the only panel that self-titles at hero level — duplicates the tab's role). Matrix has no mobile strategy beyond overflow-x scroll; the w-8 state label truncates nothing but wastes the cell. Switch has no visual on/off color beyond the primitive default — no green/red status reinforcement despite this being an on/off business control. 5th thead style (uppercase ink-muted, no bg).

### StoresTab (container) · `nav`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/app/operator/StoresTab.tsx
- **משטח-אב:** חנויות tab
- **ויזואלית:** List view: flex-wrap header (hero Heading «חנויות» + muted subtitle vs primary «+ הוסף חנות» Button), redFg loadError line, boxed actionError alert (rounded-lg border-status-red bg-status-redBg), «טוען חנויות…» status line, then StoreList + RemovedStores. Wizard view REPLACES the list: ghost «→ חזרה לרשימה» + AddStoreWizard inline (no overlay, by design).
- **פרימיטיבים:** Button, Heading, Text, lucide Plus; operatorFetch
- **חוב:** Most state-honest container in the console (split load/action errors, P1-27b) — its boxed-alert + inline patterns should be the slice standard but no other tab matches it. Loading is still a bare text line (no skeleton list).

### StoreList · `card`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/operator/StoreList.tsx
- **משטח-אב:** חנויות tab › list view
- **ויזואלית:** aria-labelled section, hero Heading «חנויות פעילות», ul space-y-2 of StoreRows. Empty state: flat Card (border-glass-edge bg-glass-2 p-6 text-center) with bold + muted two-line Hebrew copy.
- **פרימיטיבים:** Card, Heading, Text, StoreRow
- **חוב:** Another hero Heading nested under the tab's hero Heading (חנויות → חנויות פעילות, same size). Otherwise clean and to standard.

### StoreRow + CredCell · `card`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/operator/StoreRow.tsx
- **משטח-אב:** חנויות tab › active store list
- **ויזואלית:** Flat Card (rounded-lg border-glass-edge bg-glass-2 p-3): header row (mobile-stacked) with 8×8 token-driven brand swatch (style background: var(--store-*) CSS var, glass fallback), truncating bold name + LTR 2xs slug, green «פעילה» Badge, LTR tabular #displayOrder, ghost «העבר לארכיון» Button with Archive icon. Below: 1→2→3-col grid of 5 CredCells — each a bordered bg-glass-1 pill-row with PlatformBadge (or ShoppingBag + «פיד זמן-אמת» for webhook), green/warning Badge with Check/AlertTriangle icon + Hebrew status, and a חבר/החלף/הפעל Button (secondary when missing, ghost when connected).
- **פרימיטיבים:** Card, Button, Badge, PlatformBadge, Text, lucide Check/AlertTriangle/ShoppingBag/Archive
- **חוב:** This is the slice's GOLD STANDARD (token-only, never color-only, mobile-first, all shared primitives) — the explicit contract in its header comment is what the rest of the console should be held to. Only nit: inline style={} for the swatch background (necessary for dynamic CSS var, acceptable).

### RemovedStores + RemovedStoreRow · `card`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/operator/RemovedStores.tsx
- **משטח-אב:** חנויות tab › below active list
- **ויזואלית:** Section «חנויות שהוסרו» (hero Heading in ink-secondary + muted xs explainer); renders nothing when no archived stores. Rows: muted flat Cards (bg-glass-1 opacity-90, swatch at opacity-70, name in ink-secondary) with gray «הוסרה» Badge, secondary «שחזר» and destructive «מחק לצמיתות» Buttons.
- **פרימיטיבים:** Card, Button, Badge, Heading, Text, Sheet family, Input
- **חוב:** De-emphasis via opacity-90/opacity-70 utility stacking rather than a tokenized 'archived' surface treatment — close to but not identical to the freshness-fade vocabulary used on Home. Otherwise to standard.

### DeleteConfirmModal (in RemovedStores) · `modal`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/operator/RemovedStores.tsx
- **משטח-אב:** חנויות tab › removed-area (overlay)
- **ויזואלית:** Radix Sheet variant=modal (sm:max-w-md, dir=rtl): SheetHeader with red AlertTriangle + red SheetTitle «מחיקת חנות לצמיתות» + SheetDescription listing what's wiped; SheetBody with bold-name warning sentence, typed-name Input gated label (LTR name shown), red role=alert error; SheetFooter ביטול / destructive «מחק לצמיתות» with Loader2, confirm disabled until exact name match; close blocked mid-flight.
- **פרימיטיבים:** Sheet/SheetContent/SheetHeader/SheetBody/SheetFooter/SheetTitle/SheetDescription, Button, Input, Text, lucide
- **חוב:** This is the CORRECT modal implementation (focus-trapped Radix, per the modal-over-Sheet rule) — the debt is that ManualOverridesCrud and ResetData don't use it; three confirm-destroy paradigms coexist.

### AddStoreWizard (StepDots / Step1 / Step2 / PlatformCredBlock / Step3 / CodeBlock) · `form`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/operator/AddStoreWizard.tsx
- **משטח-אב:** חנויות tab › wizard view (inline, replaces list)
- **ויזואלית:** Card max-w-3xl. StepDots: 3 numbered 6×6 circles (accent active / greenBg+check done / glass idle) + xs labels פרטים/טוקנים/סיום. Step1: stacked labelled Fields (Input slug/name/domain with inline error prop, headless Switch, brand-color NativeSelect with «· בשימוש» markers + aria-hidden swatch strip of 5×5 squares ring-accent on selected & opacity-40 taken, displayOrder, PlatformToggle pill-labels with embedded Switch, advanced customer-journey Switch in a glass box). Step2 (a <form>): per-platform PlatformCredBlock Cards (flat bg-glass-2, panel Heading + secondary «בדוק» verify button, password Inputs, ✓ greenFg / ✗ redFg result line role=status/alert; accent border+ring-2+scrollIntoView when focusPlatform targets it), webhook-secret field with מוגדר/לא-מוגדר status, save-anyway checkbox, submit/back. Step3: green check «החנות נוצרה ב-DB», LTR mono masked-secrets list, CodeBlocks (max-h-64 LTR pre bg-glass-1 + ghost copy-button with הועתק feedback), disc-list Shopify checklist, «סיום». Edit mode: prefill spinner + red prefill error, locked-ON platform toggles with honest hint.
- **פרימיטיבים:** Card, Button, Input, NativeSelect, Switch, Heading, Text, lucide Check/X/Copy/Loader2
- **חוב:** Built to the locked standard (token-only, primitives, both themes) and the deepest flow in the console — debt is mostly structural: 1100-line single file with 6 in-file sub-components (Field/StepDots/PlatformToggle/PlatformCredBlock/CodeBlock are reusable-shaped but private); the brand-color picker's NativeSelect+separate swatch strip is a clunky two-control pattern vs a proper swatch radio-group; save-anyway uses raw Input type=checkbox (accent-accent class); step transitions have no motion despite the tab-level fade convention.

### AttributionDiagTab (container) · `nav`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/app/operator/AttributionDiagTab.tsx
- **משטח-אב:** אבחון סיווג tab
- **ויזואלית:** Hero Heading «אבחון סיווג» with a long xs parenthetical explainer, then the panel.
- **פרימיטיבים:** Heading
- **חוב:** Same hero-with-parenthetical pattern; the explainer span is a full sentence crammed into the heading line.

### AttributionDiagPanel (+ CoverageStat / DistributionTable / BucketTable) · `card`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/operator/AttributionDiagPanel.tsx
- **משטח-אב:** אבחון סיווג tab
- **ויזואלית:** space-y-6: header row with tabular LTR range «from → to» + ghost «הרץ מחדש» RotateCw button (spins while mutating); red boxed role=alert error strip; coverage Card with panel Heading + 1→2-col grid of CoverageStats (bordered bg-glass-1 tiles, 2xl semibold tabular % + xs (withFt/total)); 1→2-col grid of DistributionTable Cards (panel Heading + (N סה״כ) + muted hint, primitive-composed 3-col table: Hebrew source label + mono LTR raw-source bdi, fmtCount, pct); hero-headed «פירוק דליים עמומים» with 1→3-col grid of BucketTable Cards (mono key column + count). Loading/empty = text lines. On-demand fetch only (refreshInterval 0).
- **פרימיטיבים:** Card, Button, Heading, Text, TableBase+TableHead+TableRow+TableHeaderCell+TableCell, fmtCount, lucide RotateCw; SWR via operatorFetch
- **חוב:** Second-highest polish panel (full primitive tables, tabular nums, mobile grids). Debt: CoverageStat is yet another bespoke stat-tile (vs TikTokCoveragePanel.StatCell — near-twins, neither shared); English bucket titles (other-paid/other-referral/direct) as Card headings on a Hebrew console; pct rendered as raw string not a Metric primitive; no date-range picker despite '30 days default' implying one was intended.

---

# גרפים + פרימיטיבים (charts-primitives) — 32 קומפוננטות

## עץ-המשטח

```
CHART INSTANCES (by host surface)
	Home tab (Dashboard.tsx)
		CommandCenterHero (banded hero strip)
			NetSparkline — featured Net-Profit card spark (hand SVG, band-hue stroke + --plot-bg casing)
			MiniSparkline ×5 — revenue / spend / cpm / orders / roas secondary-card sparks (hand SVG)
		PerStoreRow (vivid band cards)
			Sparkline (bandInk mode) — mobile-only ROAS trend spark + store-delta-chip
			CPM platform tiles (.cpm-row-cells, white-alpha sub-surface, brand dot + <Money>)
		RoasTargetChart — hero ROAS-vs-target section (hand SVG: two-tone area, smooth line, crosshair, today pulse, min/max labels, KPI strip, pins)
			RoasChartDateRangePicker (range pills, URL-persisted)
			ChartAnnotationPins (shared overlay primitive)
		StoreDetailModal (Sheet modal) — header Sparkline (bandInk, 200×38)
	Trends tab (AnalysisTrendsTab.tsx)
		RoasChart — Recharts LineChart, per-store lines + target ReferenceLine + refund-day rings
			ChartAnnotationPins (showGuides ON)
	Campaigns tab
		CampaignsTable — expandable CPM LineChart panel (CPM + dashed prev-period + ROAS dual-axis)
		CampaignsTableRow — inline ROAS-trend Sparkline cell (tone=blue 64×20)
		DetailTable — inline Sparkline cell (tone=blue 64×20)
	Campaign modal (campaign-drawer/)
		CampaignDrawerDaily — AreaChart (spend↔value) + LineChart (CPM/prev/ROAS) + analysis tone box
		CampaignDrawerOverview → MetaShopifyReconciliation — ComposedChart, 5 platform lines (Shopify dashed truth-line)
	לקוחות tab (CustomerValueTab.tsx)
		CustomerValueCurve — hand-SVG zones LTV curve (accent gradient, payback pill, amber/green zones, crosshair tooltip)
		CohortGridAdvanced — retention heatmap (color-mix green cells, year <details> accordions, striped future cells)
	פעילות tab (ActivityTab → ActivityStatsTab)
		Donut — CSS conic-gradient source split + legend
		Stacked source bars — per-product horizontal share bars
	Chart-adjacent: GoalTracker progress bars, PnLBreakdown gradient header+bar
PRIMITIVE LAYER (src/components/ui + src/lib)
	globals.css — 2017-line dual-mode token sheet (:root=dark, [data-theme=light]) + .glass/band/freshness/chip CSS
	ChartContainer / ChartTooltip(+Label/Row/Value) — Recharts wrappers
	Card (+band/bandStrength/freshness/onDrill) · Button · Badge · Stat · TableBase · Tabs · Switch · Sheet (drawer|modal)
	Money → MoneyAnimated → useCountUp · CountUp · .metric-num CSS contract
	HelpTooltip (mode matrix) → TooltipContent / RichPopover / Toggletip / RichSheet · phrasing.ts · useTouchTooltipMode
	Sparkline + sparklineGeometry.ts · FreshnessBadge + useStaleness · useRoasBandGradient + BAND_TAG_LABEL
	chartColors.ts (chart↔band bridge) · storeColors.ts · drawerStack.ts (Esc coordination)
GUARD LAYER (hermetic)
	vitest static guards: designColorGuard (token ratchet) · contrastGuard (band-surface WCAG) · themeParity · chartTokens/glassTokens · colorCollisions (ΔH≥13°) · moneyPrimitiveGuard · roasBandConsistency · tokenSweep
	eslint-rules/: no-cross-palette-import · no-hex-color · no-dark-variant · no-native-title-tooltip · no-raw-button/input/table · no-physical-direction · no-legacy-tailwind-class · no-emoji-in-jsx
	Playwright (chromium-dark + chromium-light, 1440×900): pages.spec (per-tab snapshots) · states.spec (/dev/primitives) · contrast.axe.spec · overflow.spec (200% reflow) · tooltips.spec (behavioral)
```

## חוב-עיצובי בפרוסה (הגרוע קודם)

- DUPLICATED CPM TREND CHART: CampaignsTable.tsx:1783–1913 and campaign-drawer/CampaignDrawerDaily.tsx:303–433 are near-identical Recharts blocks (CPM line + dashed prev-period + ROAS dual-axis + tooltip + toggle + legend). Extract one <CpmTrendChart> before redesign or the two WILL diverge (margins/heights already differ).
- THREE SPARKLINE ENGINES: ui/Sparkline.tsx (shared, scrim/casing-aware, geometry in lib/sparklineGeometry.ts) vs hand-inline NetSparkline + MiniSparkline in home/CommandCenterHero.tsx (own geometry, duplicated degenerate-flat fix, Math.random gradient ids, aria-hidden vs aria-label='טרנד'). Unify on the primitive + geometry lib.
- TWO CHART ENGINES WITH DIVERGENT TOKEN FAMILIES: Recharts charts read --chart-grid/--chart-axis (and ChartContainer REMAPS --chart-axis to --text-muted while globals.css :root defines a different --chart-axis consumed via CHART_AXIS_COLOR) vs hand-rolled SVGs (RoasTargetChart, CustomerValueCurve) reading --chart-grid-line/--text-subtle. Same-purpose ink resolves through 2–3 different tokens; consolidate into one chart-ink token set.
- TOOLTIP CHROME REBUILT 5×: ChartTooltip (Recharts), RoasTargetChart inline crosshair card, ChartAnnotationPins bubble, CustomerValueCurve hover card, RichPopover/Toggletip/RichSheet each restate the bg-glass-1 + border-glass-edge + shadow-overlay + rounded-card recipe (with radius drift: rounded-lg vs rounded-card vs rounded-chip). Plus a dead .recharts-default-tooltip !important block in globals.css.
- globals.css IS A 2017-LINE PATCH-ON-PATCH MONOLITH: archaeological round-3/5/6→mesh→deepened-bands comment layers, dead-but-kept rules (hidden band ::before 'roof' bar, superseded muted-band ladder flattened by later overrides), !important text overrides (.platform-name/.store-name/fresh-chip), repeated raw rgba(0,0,0,.22) scrim literals, legacy '--glass-*'/'.glass' naming for opaque mesh surfaces. The per-store band visual system lives almost entirely in CSS selector ladders, so component-level redesign requires CSS-block surgery with specificity wars.
- THREE CHIP SYSTEMS: ui/Badge (status palette, rounded, text-2xs) vs .band-chip/.chip-* (band palette, mono uppercase, 4px radius, CSS-only) vs .band-tag/.store-delta-chip/.fresh-chip (per-store CSS pills on dark scrim). No single Chip primitive; typography/radius/casing differ per system.
- LOCKED EXCEPTIONS A REDESIGN MUST NOT 'FIX': operator-locked white-on-#EF9331 orange (2.36:1, below AA, codified in contrastGuard); ROAS thresholds 2/2.7/3 + BAND_TAG_LABEL wording (roasBandConsistency guard); brand-mirrored chart palette + ΔH≥13° collision matrix; Money's native title= overflow affordance; emoji pin glyphs.
- FRAGILE GEOMETRY COUPLINGS: RoasChart's annotation-pin overlay depends on hand-mirrored Recharts inset constants (MARGIN_LEFT+Y_AXIS_WIDTH=40px); RoasTargetChart's preserveAspectRatio='none' forces HTML overlays for any text and distorts the dash draw-in; magic tooltip offsets (top:-84, top:-64).
- SEGMENTED-CONTROL PATTERN HAND-ROLLED 3×: ghost-Button pill groups in CampaignDrawerDaily, CampaignsTable CPM panel, and ActivityStatsTab toggles (plus Filters range pills) — no shared SegmentedControl primitive; call-sites fight Button with px-2 py-0.5 h-auto text-[10px] overrides.
- INCONSISTENT EMPTY/LOADING STATES ACROSS CHARTS: RoasChart returns null (section vanishes), drawer charts conditionally omit whole sections, CampaignsTableRow renders an em-dash, RoasTargetChart renders an axes-only frame, ActivityStats donut falls back to a gray conic. No shared chart-empty-state pattern; .skeleton shimmer exists but charts don't use it.
- GUARDS ARE TEXT-COUPLED TO globals.css CONVENTIONS: contrastGuard/themeParity/chartTokens parse the stylesheet with regexes that require hex-literal tokens, no literal braces in comments, and :root/light block ordering — any token-sheet refactor must port the guards first or CI breaks/under-covers silently; themeParity also forces theme-invariant tokens to be duplicated verbatim in the light block (declaration noise).
- MINOR: dead QUADRANT_PALETTE export (QuadrantScatter replaced by CampaignsTopList); FALLBACK_PALETTE raw hexes bypass theming for unknown stores; CohortGridAdvanced heatmap tints with the operational --status-green instead of a data-viz ramp and floors 0% cells at 8% tint; MetaShopifyReconciliation 9px axis ticks under the 10–11px chart-ink floor; comment drift (TikTok 'slate-700', CPM 'status-orange', Card 'glass gradient + blur').

## קומפוננטות

### RoasTargetChart · `chart`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/home/RoasTargetChart.tsx
- **משטח-אב:** Home tab (between PerStoreRow and bottom 2-up row)
- **ויזואלית:** Neutral glass Card hosting a hand-rolled 1000×220 SVG (preserveAspectRatio=none, height 200px). Catmull-Rom smoothed daily-ROAS line (--chart-roas-line: near-white dark / near-ink light) with draw-in dash animation (.roas-line-draw, 1100ms), two-tone area gradient split EXACTLY at the 3.0 target y (green --chart-area-up-* above, red --chart-area-dn-* below), dashed green target line, integer gridlines with dynamic yMax (floor 4, grows to fit max — 2026-06-10 fix for silent clamping), min/max dots + Hebrew שיא/שפל mono labels, violet/teal --chart-today dashed marker + pulsing dot + HTML 'היום' pill, pointer-driven crosshair + rich HTML tooltip (bg-glass-1/border-glass-edge/shadow-overlay, date·ROAS·target·delta rows, ▲/▼ tinted --up/--dn), header with mono eyebrow + Hebrew TL;DR sentence (band-tinted anchor number via synthesizeRoasChart), 5-up KPI strip (gap-px tiles on bg-glass-2, only the ROAS tile banded with band-chip + BAND_TAG_LABEL), pin-count amber chip, footer prev-period/cumulative/days strip. Empty-ish series → TL;DR falls back to neutral 'אין מספיק נתונים' sentence; missing CPM renders '—'.
- **פרימיטיבים:** Card (freshness prop → desaturation), FreshnessBadge, ChartAnnotationPins, Heading, RoasChartDateRangePicker, useRoasBandGradient + BAND_TAG_LABEL, useStaleness, cn/formatCurrency/formatNumber/formatDate; CSS classes roas-line-draw/roas-area-rise/roas-crosshair/roas-today-pulse in globals.css
- **חוב:** 1200-line single file mixing geometry, synthesis rendering and KPI tiles; KpiTile is a bespoke inline tile (not Stat); crosshair tooltip chrome hand-rebuilds the RichPopover recipe inline (top:-84 magic offset); duplicate leftPctForIndex math in renderablePins and the callback; preserveAspectRatio=none forces HTML overlay labels (SVG text would distort) and stretches the dash animation; uses --chart-grid-line while Recharts charts use --chart-grid (two grid token families); pin-count chip is bespoke (bg-status-warningBg) not Badge.

### RoasChart (Trends) · `chart`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/RoasChart.tsx
- **משטח-אב:** Trends tab (AnalysisTrendsTab, bare mode inside a glass section) 
- **ויזואלית:** Recharts LineChart h-64/sm:h-80: one monotone line per store (storeColor token, brand_color override for self-serve stores; primary uzoshop cyan gets 2.75px vs 2px), dashed CartesianGrid (2 4, opacity .55, no verticals), frameless axes (11px tabular ticks, --chart-axis), green dashed ReferenceLine at 3.0, connectNulls=false (gaps are honest signal), heavy-refund days get a filled dot + CHART_WARNING_COLOR orange ring, custom RTL-aware legend (color dashes + 'יעד 3.0' dashed swatch), custom tooltip via ChartTooltip primitives with 'ROAS '-prefixed values + orange refund footer line. ResizeObserver-measured wrapper feeds ChartAnnotationPins overlay (showGuides ON). Returns null when data is empty (whole chart vanishes).
- **פרימיטיבים:** ChartContainer, ChartTooltip/Label/Row/Value, ChartAnnotationPins, Heading, storeColor/STORE_COLORS, CHART_WARNING_COLOR (chartColors bridge), annotations lib + annotationsToPins adapter
- **חוב:** Pin-overlay x-positioning depends on hardcoded MARGIN_LEFT/Y_AXIS_WIDTH constants that must manually mirror Recharts internals — fragile coupling; empty state is a silent null (no empty-card affordance, inconsistent with em-dash/skeleton patterns elsewhere); custom legend is bespoke per-chart (no shared Legend primitive); listens to a window CustomEvent ('roas-annotations-changed') for pin refresh.

### ChartAnnotationPins · `primitive`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/ui/ChartAnnotationPins.tsx
- **משטח-אב:** Overlay primitive — mounted by RoasTargetChart (Home) and RoasChart (Trends)
- **ויזואלית:** Absolute inset-0 dir=ltr pointer-events-none layer; each pin = emoji glyph (default 💰) as a ghost Button with orange text-shadow halo (oklch from --chart-pin-line), optional dashed vertical guide (border-s dashed, --chart-pin-line, opacity .5), hover-AND-click tooltip bubble (bg-glass-1, border-status-warning amber accent, shadow-overlay, rounded-card, animate-in fade+slide, dir=rtl Hebrew label + mono date · ROAS context line). Tap-outside pointerdown dismiss; never always-visible per home-visual-rules.
- **פרימיטיבים:** Button (ghost), cn, formatDate; consumer supplies leftPctForIndex/valueForDate
- **חוב:** Tooltip top:-64 magic offset; emoji glyphs as data-ink (guard no-emoji-in-jsx presumably exempts); duplicate tooltip chrome vs RichPopover/ChartTooltip recipes; hover sets state with no intent delay (vs RichPopover's 180ms) — inconsistent open models across tooltip surfaces.

### ChartContainer · `primitive`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/ui/chart/ChartContainer.tsx
- **משטח-אב:** Wrapper for every Recharts chart (RoasChart, CampaignDrawerDaily, CampaignsTable CPM panel, MetaShopifyReconciliation)
- **ויזואלית:** shadcn-style div wrapping ResponsiveContainer; injects per-instance CSS vars --chart-grid→var(--glass-edge), --chart-axis→var(--text-muted), --chart-cursor→var(--glass-edge-hot), --chart-target→CHART_TARGET_COLOR(=--band-green). Defaults dir=ltr so chronological axes don't mirror under page RTL.
- **פרימיטיבים:** recharts ResponsiveContainer, CHART_TARGET_COLOR from chartColors.ts
- **חוב:** Remaps --chart-axis to --text-muted, but globals.css ALSO defines a different :root --chart-axis (oklch 60%) consumed via CHART_AXIS_COLOR by the same charts — two competing definitions of the same token name depending on whether the value is read via CSS cascade or the wrapper's inline override; hand-rolled SVG charts use a third family (--chart-grid-line). A redesign consolidating chart ink MUST reconcile these.

### ChartTooltip + Label/Row/Value · `primitive`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/ui/chart/ChartTooltip.tsx
- **משטח-אב:** Recharts custom tooltip content (all 4 Recharts charts)
- **ויזואלית:** dir=rtl card: rounded-lg bg-glass-1 border-glass-edge shadow-overlay px-3 py-2 text-xs min-w-[160px]; Label = 10px text-ink-muted; Row = 2px color swatch dot + text-ink-secondary label + ms-auto value; Value = <bdi dir=ltr> font-mono font-semibold text-ink.
- **פרימיטיבים:** cn only — pure presentational
- **חוב:** globals.css still carries a .recharts-default-tooltip !important override block (glass-2, blur) that no chart uses anymore (all tooltips are custom content=) — dead CSS that could mislead a redesign; rounded-lg here vs rounded-card on the other tooltip surfaces (radius inconsistency).

### Sparkline (shared primitive) · `chart`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/ui/Sparkline.tsx
- **משטח-אב:** PerStoreRow (mobile, bandInk), StoreDetailModal header (bandInk), CampaignsTableRow roasTrend cell (tone=blue), DetailTable (tone=blue)
- **ויזואלית:** Pure-SVG polyline (no Recharts), default 60×16. Three modes: plain tone stroke (--status-{green,red,orange,blue,gray}, 1.25px); onBand = neutral --plot-bg scrim rect (rx 3) + 3px --plot-bg casing under the tone line (for sparks on neutral cards); bandInk = NO scrim, 3.5px dark casing (--spark-band-casing rgba(0,0,0,.30)) + opaque white 1.75px line (--spark-band-ink) + preserveAspectRatio=none w-full stretch — for sparks sitting directly on vivid band gradients. Flat series centers vertically via computeSparklineGeometry (2026-06-10 fix: constant ROAS no longer reads as 'crashed to zero'). aria-label=טרנד.
- **פרימיטיבים:** computeSparklineGeometry (lib/sparklineGeometry.ts), status tokens
- **חוב:** Strokes from the STATUS palette (operational) not the band/chart palettes — a tone='blue' campaign trend uses --status-blue while everything ROAS-graded uses --band-blue; table call-sites hardcode tone='blue' regardless of trend direction (no semantic mapping); hardcoded Hebrew aria-label not overridable.

### NetSparkline + MiniSparkline (hero inline sparks) · `chart`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/home/CommandCenterHero.tsx (lines 361–561)
- **משטח-אב:** Home tab → CommandCenterHero featured Net-Profit card (NetSparkline) + 5 secondary KPI cards (MiniSparkline: revenue=--up, spend=--dn, cpm/orders neutral, roas)
- **ויזואלית:** Hand-inline SVGs (600×38 / 600×30, preserveAspectRatio=none). NetSparkline: band-hued line (BAND_STROKE map → --band-* tokens) over a band-tinted area gradient, with a 4px --plot-bg casing under-stroke and deliberately NO scrim so the card's band gradient shows through. MiniSparkline: 1.5px semantic stroke + 35%→0 area gradient, area painted UNDER the stroke (2026-06-10 fix), flat-series renders at vertical midline. Both return null under 2 points; gradient ids via Math.random-keyed useMemo. aria-hidden (decorative).
- **פרימיטיבים:** None shared — own geometry, BAND_STROKE/NEUTRAL_SPARK_STROKE local consts
- **חוב:** THIRD sparkline implementation alongside ui/Sparkline + sparklineGeometry — degenerate-flat-series logic is duplicated by hand here (and NetSparkline appears to still lack the midline branch its sibling got); Math.random ids instead of useId; aria-hidden while the shared Sparkline announces 'טרנד' (inconsistent a11y); 'lives inline by design' comment blocks extraction that a redesign will want.

### CampaignDrawerDaily (2 drawer trend charts) · `chart`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/campaign-drawer/CampaignDrawerDaily.tsx
- **משטח-אב:** Campaign centered modal (Sheet variant=modal) → 'Daily' sub-tab
- **ויזואלית:** Chart 1: Recharts AreaChart (spend ↔ conversion value), two monotone 1.5px lines with 35%→0 vertical gradient fills (CHART_COLORS.spend=--dn red, .value=--up green), frameless 10px axes, C$ tickFormatter, ChartTooltip rows; legend = two colored dots; section hidden entirely under 2 points. Chart 2: Recharts LineChart CPM (CHART_COLORS.cpm=--band-blue, dots r2.5) + optional dashed amber prev-period line (--chart-cpm-prev, connectNulls=false) + optional dashed green ROAS overlay on a right yAxis; chart frame = rounded-xl bg-glass-2/40 border-glass-edge min-h-[200px]; mode toggle (חצי-חצי vs תקופה קודמת) as ghost-Button segmented pill; analysis verdict box tinted by tone (status greenBg/warningBg/redBg/glass-2); warning strip when prev-period has too few days; activeDots stroked with --surface-elevated-1.
- **פרימיטיבים:** ChartContainer, ChartTooltip family, Button, Input (checkbox), Heading, CHART_COLORS/CHART_AXIS_COLOR, analyzeCpmVsRoas
- **חוב:** The ENTIRE CPM chart block (axes/tooltip/3 lines/legend/toggle) is near-duplicated in CampaignsTable.tsx:1783–1913 — two copies to keep in sync (the table copy even has zero-anchor axis comments the drawer copy lacks: drawer chart 2 yAxis is 0-anchored, but verify both on any change); checkbox-as-Input for the ROAS overlay vs Switch primitive elsewhere; legend swatches hand-built per chart.

### CampaignsTable inline CPM chart panel · `chart`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/CampaignsTable.tsx (lines ~1700–1925)
- **משטח-אב:** Campaigns tab → expandable CPM analysis panel above/inside the table
- **ויזואלית:** Same Recharts LineChart pattern as CampaignDrawerDaily chart 2: CPM line (--band-blue), dashed prev-period (--chart-cpm-prev), dashed ROAS overlay (right axis, --band-green), 0-anchored Y domains (c/CR-02 honest-axis fix), ChartTooltip with prev-delta % tinted greenFg/redFg, h-40/sm:h-48, segmented mode toggle + 'הוסף ROAS לגרף' checkbox + X close ghost Button, post-chart legend strip.
- **פרימיטיבים:** ChartContainer, ChartTooltip family, Button, Input, CHART_COLORS/CHART_AXIS_COLOR, cn
- **חוב:** Primary duplication target: byte-near-identical to the drawer Daily CPM chart — extract one <CpmTrendChart> before any visual redesign or the two will diverge (they already differ subtly in margins/height); lives inside a 2840-line component file.

### MetaShopifyReconciliation chart · `chart`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/MetaShopifyReconciliation.tsx (chart at 639–743)
- **משטח-אב:** Campaign modal → Overview sub-tab (CampaignDrawerOverview)
- **ויזואלית:** Compact h-32 Recharts ComposedChart: 4 solid 1.5px platform lines at opacity .85 (CHART_COLORS meta blue / google amber / tiktok pink / organic teal, no dots) vs the Shopify truth line — 2.5px DASHED (6 3) green with filled r2.5 dots (operator-requested distinction). Frameless 9px axes; magnitude-aware C$ tick + tooltip precision (≥100 integer, else 2dp — c/HI-02 + c/HI-06 fixes); 5-row ChartTooltip; amber lag-detected warning strip above; 5-entry centered legend below with inline-style swatches.
- **פרימיטיבים:** ChartContainer, ChartTooltip family, CHART_COLORS/CHART_AXIS_COLOR
- **חוב:** 858-line file mixing reconciliation math (buildReconciliation) with presentation; 9px axis ticks are below the project's 10–11px chart-ink floor; tooltip lists all 5 series even when several are 0 every day (noise); stale comment claims TikTok swatch is 'slate-700' while the token is pink — comment drift.

### CustomerValueCurve (zones LTV curve) · `chart`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/CustomerValueCurve.tsx
- **משטח-אב:** לקוחות tab (CustomerValueTab)
- **ויזואלית:** Hand-rolled 720×320 SVG: Catmull-Rom cumulative-value curve M0..M11 stroked with an --accent gradient (violet dark / teal light) + soft glow filter, gradient area fill below, two background zones split at the payback month (amber --status-warning-bg 'still paying back' left, green --status-green-bg 'profit' right, with -fg zone labels), dashed nCAC break-even line (--status-warning), pulsing payback callout pill (white on deepened --accent-btn, AA-safe), green wedge fill above break-even, hover crosshair + dot + HTML tooltip (% positioned), gridlines --chart-grid-line, axis text --chart-axis. Entire animation set in globals.css cv-* namespace (draw-line 1.5s, fade zones, pop mark, pulse ring) with full prefers-reduced-motion collapse; dash length seeded post-mount via getTotalLength (jsdom-guarded). Touch tap-outside dismisses hover.
- **פרימיטיבים:** Money, fmtMoneyCompact; cv-* CSS classes in globals.css
- **חוב:** 540-line bespoke chart — second hand-rolled SVG engine with its own smoothPath copy (identical Catmull-Rom code duplicated in RoasTargetChart); pill width/height magic numbers (122×38); its hover tooltip chrome is a fourth hand-built tooltip variant; geometry constants differ from every other chart (PAD l52/r18 vs RoasTargetChart 40/0).

### CohortGridAdvanced (retention heatmap) · `chart`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/CohortGridAdvanced.tsx
- **משטח-אב:** לקוחות tab → collapsed analyst <details> section
- **ויזואלית:** Year-grouped <details> accordions (rounded-card border-glass-edge bg-glass-2/40, rotating ChevronDown, newest year open) each holding a TableBase (border-spacing 3px) heatmap: M0..M11 columns, cells h-7 min-w-[42px] rounded-md, background = color-mix(in srgb, var(--status-green) N%, var(--glass-2)) with sqrt-eased N capped at 55% so text-ink keeps AA at every intensity; future cells = striped repeating-linear-gradient placeholder at opacity-40; in-progress current month dimmed to 60% + aria-label '(חלקי)' (native title banned).
- **פרימיטיבים:** TableBase, cn, lucide ChevronDown
- **חוב:** Heatmap tint uses the STATUS green (operational palette) rather than a dedicated data-viz ramp token — couples analytics shading to ops-status color; tintPercent floors at 8% so a 0%-retention cell still reads faintly green; no hover detail (value only as cell text) — fine at 11px but dense.

### ActivityStatsTab Donut + stacked source bars · `chart`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/activity/ActivityStatsTab.tsx
- **משטח-אב:** פעילות tab → stats sub-tab
- **ויזואלית:** Donut = pure-CSS 140×140 conic-gradient div (BUCKET_COLOR_VAR map: meta/google/tiktok brand tokens, email=organic teal, referral=--accent, other-paid=--status-orange, direct=--text-muted) with bg-glass-2 inner hole + centered count/label stack; legend list with 2.5px square swatches, Money values, % column — chart is never color-only. Per-product stacked horizontal bar: h-3.5 rounded-pill border-glass-edge flex of % -width segments with sr-only labels; orders/revenue + purchases/ATC segmented toggles (rounded-pill ghost-Button group with aria-checked).
- **פרימיטיבים:** Card, Heading, Money, Button, TableBase, cn; BUCKET_COLOR_VAR token map
- **חוב:** No hover tooltips on donut/bars (legend-only) — a different interaction grammar from every Recharts chart; conic-gradient donut can't desaturate with freshness system; segmented toggle is a third hand-rolled pill-toggle pattern (also in CampaignDrawerDaily and CampaignsTable) — no shared SegmentedControl primitive.

### PerStoreRow band spark + CPM tiles · `card`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/home/PerStoreRow.tsx
- **משטח-אב:** Home tab per-store vivid band cards
- **ויזואלית:** On the deep band gradient: mobile-only (md:hidden) Sparkline bandInk 132×34 (white line, dark casing) + store-delta-chip (▲/▼ % white on rgba(0,0,0,.22) scrim); CPM zone = dashed-top-border section, mono uppercase label (--on-band-gray-muted via .cpm-row-label rule), grid of platform tiles — base styling .cpm-row-cells .cell (brand-tinted bg per data-platform) overridden on band cards to white-alpha rgba(255,255,255,.13) fill + .20 hairline radius 11px, PlatformBadge brand dot with white contrast ring (globals.css !important), white <Money> CPM value 20/22px + compact spend caption. ROAS hero 50/60px .v.banded white CountUp number.
- **פרימיטיבים:** Card, Sparkline (bandInk), Money, CountUp, FreshnessBadge, PlatformBadge, Heading, BAND_TAG_LABEL, useRoasBandGradient
- **חוב:** The tile/chip styling lives almost entirely in globals.css selector ladders (.per-store-card.glass[data-band] …) with several !important text overrides — component markup is class-hook-only, so visual changes require editing a 500-line CSS block with specificity wars; repeated rgba(0,0,0,.22) scrim literal (band-tag, fresh-chip, store-delta-chip) instead of one token; '!p-6 md:!p-7' padding override on Card.

### GoalTracker / PnLBreakdown progress bars · `chart`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/GoalTracker.tsx (528, 669) + /Users/dorperetz/script-roas/dashboard-web/src/components/PnLBreakdown.tsx (553)
- **משטח-אב:** P&L tab (GoalTracker global goal panel) + PnL breakdown rows
- **ויזואלית:** Token-driven h-2.5 rounded-full track (bg-glass-2) with width-% fill animated over duration-slow; GoalTracker fill = bg-status-green when met else bg-status-red; PnLBreakdown bar width clamped 2–100%, header card uses from-accent-bg gradient wash.
- **פרימיטיבים:** cn, status tokens, semantic motion utilities
- **חוב:** Hand-rolled meters (no shared Progress primitive); green/red binary skips the orange band vocabulary used everywhere else for 'close to target'.

### globals.css token system (dual-mode mesh) · `primitive`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/app/globals.css
- **משטח-אב:** App shell — every surface
- **ויזואלית:** 2017 lines. :root IS dark; [data-theme=light] re-declares all ~89 tokens (source-order override). Families: --chart-platform-* (brand-mirrored, theme-independent), --store-uzo/usm/3 + spare store-4..8 OKLCH ramp, --accent/-deep/-btn/-btnHover/-soft/-bg/-link (violet dark / TEAL light), --band-* bright glow stops + --card-band-*(-2) deepened theme-INDEPENDENT band-card gradient stops (red-alarm crimson included) + --on-band-*(-muted) all-white on-colors, --band-scrim/-ink + --plot-bg + --spark-band-ink/-casing scrim system, --cell-fail pink-on-navy failure cell, semantic --space/--motion/--ease/--radius scales, --canvas-1/2 + --bg-glow radial wash, --glass-1/2/3/edge/edge-hot opaque mesh surfaces, --surface-sunken, 4-stop ink stack --text/-2/-muted/-subtle (AA re-based vs worst real surfaces), --blur-glass/sheet, 3-token shadow ladder + --shadow-soft, --scrim, --up/--dn mockup delta colors, --status-* triplets (+-btn deepened text-bearing variants, operator-locked --status-orange-solid #EF9331+white sub-AA), --chart-* SVG tokens (roas-line/target/pin/dot-max/dot-min/grid-line/area-up/dn/crosshair/today/hover-ring), --annotation-* 8-hue pin palette. Plus behavioral CSS: .glass base + [data-band] vivid gradient ladder (strong/muted, hidden ::before 'roof' bar), .v.banded/.v.neutral number treatments, .band-chip/.chip-*, freshness desaturation ([data-freshness] saturate .96/.88 + chip rules), .fresh-chip/.live-dot, per-store semantic emphasis (.cell.spend/.revenue/.aov-*), .metric-num overflow contract, roas-* and cv-* chart animations, sticky TableBase header, focus-visible ring, skeleton shimmer, full prefers-reduced-motion sweep, focus-mode dimming, view-transition tuning.
- **פרימיטיבים:** Consumed via tailwind.config.ts CSS-var color strategy by every component
- **חוב:** Monolith with archaeological layers (round 3→5→6 comments, glass+neon→mesh rename deferred: '--glass-*' and '.glass' are legacy names for opaque surfaces); dead-but-kept rules (hidden band ::before bar 'for easy revert', superseded muted-band ladder flattened by later override rules); several !important overrides (.platform-name, .store-name, fresh-chip ::before opacity); repeated raw rgba scrim literals; --chart-axis defined here AND remapped differently by ChartContainer; theme-invariant tokens duplicated verbatim in the light block purely to satisfy themeParity (noise). Any redesign should split into token sheet + band system + chart anim + component CSS.

### Card (+ CardHeader/Title/Description/Body/Footer) · `primitive`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/ui/Card.tsx
- **משטח-אב:** Every tab — canonical surface primitive
- **ויזואלית:** cva default 'glass rounded-card p-5 text-ink card-hover hover:-translate-y-0.5 duration-snap'; variants default/elevated(no-op alias)/flat (strips surface). Props: band → data-band (V4 vivid gradient incl. red-alarm), bandStrength strong|muted (muted = flattened neutral per mockup-alignment), freshness → data-freshness desaturation, onDrill → role=button + Enter/Space + accent focus ring. Banded cards mount with double-RAF data-mounted flip → 300ms fade+scale entrance (reduced-motion-safe). Card.isBlockTrigger=true for the touch tooltip path.
- **פרימיטיבים:** cva, cn; CSS contract in globals.css
- **חוב:** Doc comment still describes the dead glass+neon treatment (gradient + blur) — drifted from the mesh reality; 'elevated' alias and the hidden roof-bar comments add confusion; subcomponents are barely used (most cards hand-compose headers); hover lift applies to ALL cards including non-interactive ones.

### Button · `primitive`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/ui/Button.tsx
- **משטח-אב:** Everywhere (raw <button> banned by eslint no-raw-button-in-components)
- **ויזואלית:** cva: primary (bg-accent-btn AA-deepened violet/teal + white), secondary (glass-2 + edge border), ghost, destructive (status-redBtn + color-mix hover), link; sizes sm/md/lg/icon; per-variant contrast-correct focus rings with canvas offset; asChild via Radix Slot.
- **פרימיטיבים:** Radix Slot, cva, cn
- **חוב:** destructive hover uses an inline color-mix arbitrary class (the only non-token-name color expression in the file — allowed but inconsistent); many call-sites pile overrides ('px-2 py-0.5 h-auto text-[10px]', '!p-0') to fake chip/segment sizes the primitive doesn't offer — evidence a 'segmented'/'chip' variant is missing.

### Money / MoneyAnimated / .metric-num contract · `primitive`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/ui/Money.tsx + MoneyAnimated.tsx + globals.css .metric-num
- **משטח-אב:** Every money cell (enforced by moneyPrimitiveGuard ratchet)
- **ויזואלית:** <bdi dir=ltr class=metric-num> — tabular-nums + nowrap; formatMetricValue compacts above threshold to ≤8-char '$X.XM' with the EXACT value preserved in native title (sanctioned exception to the title ban) + sr-only span. countUp prop delegates to MoneyAnimated which formats every rAF frame in the FINAL value's compaction mode so the cell never reflows mid-climb; .metric-reserve opt-in 8ch width, .metric-cell container-type wrapper.
- **פרימיטיבים:** formatMetricValue (lib/metricFormat), useCountUp
- **חוב:** There is no <Metric> component despite the project vocabulary referencing 'Money/Metric' — non-money numbers go through CountUp or raw spans with manual tabular-nums (e.g. PerStoreRow orders), so the overflow guarantee is convention-only outside money; base .metric-num is size-agnostic so call-sites must own font-size (intentional but scatters sizes like text-[20px]/[22px] everywhere).

### CountUp + useCountUp · `primitive`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/ui/CountUp.tsx + /Users/dorperetz/script-roas/dashboard-web/src/lib/hooks/useCountUp.ts
- **משטח-אב:** Hero/per-store/store-modal marquee numbers (non-money: ROAS x.xx, counts)
- **ויזואלית:** 900ms ease-out-cubic rAF climb from 0 on FIRST reveal only; all subsequent value changes snap instantly (2026-06-05 anti-flicker fix); null/NaN → em-dash; prefers-reduced-motion + SSR render final value immediately.
- **פרימיטיבים:** none (raw hook)
- **חוב:** Animate-once semantics are per-mount, so tab switches that remount the hero replay the climb; format callback runs every frame (fine at 900ms, but no frame-skip).

### HelpTooltip mode-matrix (Tooltip.tsx) + TooltipContent · `primitive`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/ui/Tooltip.tsx
- **משטח-אב:** All help affordances app-wide (native title= banned)
- **ויזואלית:** Single public primitive auto-selecting 4 modes by pointer-capability × content-shape: desktop simple → Radix Tooltip (glass-2 bubble, rounded-chip, arrow, animate-in); desktop rich → RichPopover; touch simple/short-rich → ⓘ Toggletip; touch long-rich → ⓘ → bottom Sheet. null/''/undefined content returns child untouched. Esc marks itself consumed via markEscHandledByInnerLayer so drawers underneath survive (one Esc = one dismissal). variant/richTouch/touchTrigger/withinDrawer knobs; block-vs-inline content heuristic (INLINE_TAGS set).
- **פרימיטיבים:** RadixTooltip, RichPopover, Toggletip, RichSheet, useTouchTooltipMode, phrasing.ts, drawerStack
- **חוב:** Mode selection heuristics (isBlockContent + isNonPhrasingChild + title-presence) are clever but opaque — a redesign touching tooltip chrome must update 4 separate surfaces (TooltipContent, RichPopover, Toggletip, RichSheet) that each restate the glass chrome string.

### Toggletip / RichPopover / RichSheet + phrasing.ts · `primitive`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/ui/tooltip/{Toggletip,RichPopover,RichSheet}.tsx + phrasing.ts + useTouchTooltipMode.ts
- **משטח-אב:** Touch + rich help paths of HelpTooltip
- **ויזואלית:** Toggletip (mode C): solid accent-circle ⓘ button (24px glyph, ::after inset to ≥44px hit area), tap-toggles a Radix Popover (opaque bg-glass-1, border-glass-edge, rounded-card, shadow-overlay), role=status live region, no focusable content. RichPopover (mode B): role=dialog with hover-intent open (180ms) + close grace (150ms), title text-sm semibold, body text-xs ink-secondary whitespace-pre-line, fill-glass-1 arrow. RichSheet (mode D): ⓘ → SheetContent variant=drawer side=bottom (glass gradient + blur, slide-in-from-bottom) with visible ✕, focus trap. phrasing.ts: NON_PHRASING_TAGS set + isBlockTrigger static flag decide whether the child itself becomes the asChild tap trigger (prevents invalid <span><tr/></span> wrapping). useTouchTooltipMode: (hover:none)/(pointer:coarse) matchMedia, width fallback.
- **פרימיטיבים:** Radix Popover/Dialog, Sheet, drawerStack markEscHandledByInnerLayer, lucide Info/X
- **חוב:** Three files restate the same chrome class string; ⓘ glyph styling was the source of the 2.56.3 hotfix (Button px-4 stretching) — the trigger remains a styled Button rather than a dedicated InfoGlyph primitive; sibling-ⓘ vs child-trigger duality means dense tables silently change interaction model.

### Sheet (drawer | modal) · `primitive`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/ui/Sheet.tsx
- **משטח-אב:** Campaign modal, AdsDrawer, StoreDetailModal, RichSheet bottom sheets, ProductPickerModal (must be Radix per memory)
- **ויזואלית:** cva: drawer = edge-anchored glass gradient (glass-3→glass-2) + --blur-sheet + violet edge-hot highlight on opening edge (RTL-aware compoundVariants per side), slide-in entrance at duration-base; modal = centered w-[min(92vw,920px)] max-h-[88vh] flat bg-glass-1 rounded-hero zoom-in-95 fade-in, full-screen square-corner on max-sm. Overlay: modal → bg-scrim, drawer → frosted bg-glass-3; overlayClassName lets nested drawers lift to z-[60] (AdsDrawer over Campaign modal). Sticky Header/Footer (bg-glass-2/95 + blur) + scrollable Body; default ✕ at z-20 above sticky headers.
- **פרימיטיבים:** Radix Dialog, cva, lucide X
- **חוב:** Nested-layer z choreography is manual (z-50 vs z-[60] string constants at call-sites); drawer height for top/bottom is fixed h-1/3 which RichSheet bottom sheets inherit regardless of content; doc header still says 'glass+neon treatment'.

### Switch / Tabs / TableBase / Badge / Stat · `primitive`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/ui/{Switch,Tabs,TableBase,Badge,Stat}.tsx
- **משטח-אב:** Operator panels, settings, all tables, chips, KPI tiles
- **ויזואלית:** Switch: Radix, 5×9 pill glass-2 → checked bg-accent, RTL-aware thumb translate (2026-06-10 fix). Tabs: Radix with dir defaulting to rtl (fixes Radix ltr stamp), pill variant (glass-2 bar, active glass-1 chip + shadow-glass) and underline variant (border-b accent), overflow-x scroll with hidden scrollbar, content fade-in at duration-snap. TableBase: the ONLY legal <table> (lint-enforced); minWidth/density/stickyHeader props; sticky thead = glass-3 + blur via [data-sticky-header] CSS; TableHead glass-2, TableRow hover glass-1/40, numeric cells text-end tabular-nums. Badge: status-tone bg/fg pairs (red/orange/green/blue/gray/warning), text-2xs. Stat: cva tone/density/accent/active stat-block consolidating 5 prior forks; glass-2 + shadow-glass; interactive becomes <button aria-pressed>.
- **פרימיטיבים:** Radix Switch/Tabs, cva, cn
- **חוב:** Badge (status palette) vs .band-chip/.chip-* (band palette CSS classes) vs .band-tag (per-store CSS) — three chip systems with different radii/typography; Stat exists but hero KpiTile + drawer tiles still hand-roll their own tiles; Tabs pill active state lacks the accent identity the underline variant has (two unrelated active treatments).

### useRoasBandGradient + BAND_TAG_LABEL · `primitive`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/lib/format/useRoasBandGradient.ts
- **משטח-אב:** Every ROAS-graded surface (hero, per-store, RoasTargetChart KPI, StoreDetailModal)
- **ויזואלית:** Pure function (use-prefixed by convention): zeroSalesWithSpend → red-alarm (wins over null), <2 red, 2–2.7 orange, ≤3.0 green (3.0 = at-target, 2026-06-09 fix), >3 blue, null/NaN gray; returns {band, desaturate}. BAND_TAG_LABEL canonical Hebrew wording (דורש בחינה / 0 מכירות / סביר / טוב / מעולה / אין נתונים) shared across pills + chart chip; locked in lock-step with analytics.ts roasLabel by roasBandConsistency.guard.
- **פרימיטיבים:** none
- **חוב:** 'use' prefix on a non-hook invites lint confusion (documented as intentional); thresholds memo says 2x/2.7x/3x — LOCKED, redesign must not re-anchor.

### FreshnessBadge + useStaleness (desaturation system) · `primitive`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/components/ui/FreshnessBadge.tsx + /Users/dorperetz/script-roas/dashboard-web/src/lib/freshness/useStaleness.ts
- **משטח-אב:** Card headers (hero, per-store, RoasTargetChart) + Card freshness prop
- **ויזואלית:** computeStaleness: <15min fresh / <30 aging / ≥30 stale; labels 'LIVE · 4m' / 'AGING · 22min' / 'STALE · 1h 47min'; per-platform record returns WORST platform ('TikTok stuck · 1h 47min'). useStaleness re-renders every 60s. Badge = .fresh-chip mono uppercase pill (green/orange/red tint on neutral surfaces; forced dark-scrim rgba(0,0,0,.22) + white + colored state dot on band cards), LIVE gets animated pulse dot; <bdi dir=ltr> content. Card-level: [data-freshness] saturate(.96)/.88 + opacity whisper-fade with 600ms transition, platform CPM cells counter-saturate (1.04/1.14) to keep brand dots vivid.
- **פרימיטיבים:** useStaleness; CSS in globals.css
- **חוב:** Memory says locked thresholds were 'aggressive 30%/30min fade' but the shipped fade is barely-there (.96/.88) per mockup-alignment — the chip is the real signal; chip text is English-mono in a Hebrew UI (intentional but worth flagging); badge + Card freshness must be threaded TOGETHER manually or chip/surface disagree (documented foot-gun in file comment).

### drawerStack (Esc coordination) · `primitive`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/lib/drawerStack.ts
- **משטח-אב:** All stacked drawers/modals + tooltip layers
- **ויזואלית:** Module-level getter stack + single window keydown listener; only topmost open drawer responds to Esc; Symbol.for expando marker (markEscHandledByInnerLayer) lets tooltip layers consume an Esc so the drawer beneath survives; useDrawerEsc(open, onClose) keyed on [open] with ref-refreshed callback (CC-02 fix).
- **פרימיטיבים:** none
- **חוב:** Registered drawers must remember to preventDefault Radix's own Esc and delegate here — convention enforced only by comments; redesigns adding new layered surfaces must wire both halves.

### chartColors.ts + storeColors.ts (palette bridges) · `primitive`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/lib/chartColors.ts + /Users/dorperetz/script-roas/dashboard-web/src/lib/storeColors.ts
- **משטח-אב:** All chart files (the ONE legal band→chart cross-palette bridge) + store badges/lines
- **ויזואלית:** chartColors: PLATFORM_TOKENS (brand vars, shopify dashed 6 3 @2.5px), CHART_COLORS (cpm/cac=--band-blue, roas=--band-green, value=--up, spend=--dn), CHART_AXIS/CURSOR/GRID/TARGET/WARNING consts, QUADRANT_PALETTE (legacy). storeColors: STORE_COLORS name→var map, brand_color override resolution (self-serve Phase 6a, byte-identical backfill for known 3), FALLBACK_PALETTE raw hexes for unknown stores, storeBadge color-mix tint.
- **פרימיטיבים:** eslint local/no-cross-palette-import disabled per-line here only
- **חוב:** QUADRANT_PALETTE survives though QuadrantScatter was replaced by CampaignsTopList 'Winners and Losers' — dead export; FALLBACK_PALETTE raw hexes bypass theming (documented edge case); CHART_COLORS.cpm comment in CampaignsTable legend claims '--status-orange' while the token is --band-blue (comment drift).

### sparklineGeometry.ts · `primitive`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/lib/sparklineGeometry.ts
- **משטח-אב:** ui/Sparkline only
- **ויזואלית:** Pure point mapper with first-class degenerate (flat-series → vertical center) branch — the c/HI-05 fix.
- **פרימיטיבים:** none
- **חוב:** Not used by NetSparkline/MiniSparkline (CommandCenterHero) — the hero sparks reimplement the same math by hand; unify.

### Hermetic design guards (vitest static) · `primitive`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/src/lib/__tests__/{designColorGuard,contrastGuard,themeParity,chartTokens,glassTokens,colorCollisions,moneyPrimitiveGuard,roasBandConsistency.guard,tokenSweep}.test.ts
- **משטח-אב:** CI — gate every visual change
- **ויזואלית:** designColorGuard: green-ratchet scan of src/components/** banning white/black literals, raw Tailwind palette names, inline hex/rgb/hsl/oklch, and /NN alpha on flat tokens; MIGRATION_ALLOWLIST currently EMPTY and shrink-only (stale entries fail). contrastGuard: parses globals.css hexes, computes WCAG ratios of --on-band-* white vs the real deepened --card-band-* gradient stops (both themes), status -fg vs white AND own -bg, accent-btn whites, spark-band ink vs every band — with the documented operator exception (white on #EF9331 = 2.36:1). themeParity: every :root token must have a [data-theme=light] counterpart (brace-walker, comment conventions matter). chartTokens/glassTokens: token existence + TikTok hue ≥13° from band-red. colorCollisions: ΔH ≥ 13° matrix across annotation pins vs platform/store/band hues (launch↔band-green pair skipped by design). moneyPrimitiveGuard: ratchet banning hand-built money strings outside <Money>. roasBandConsistency: useRoasBandGradient ↔ analytics roasLabel threshold+wording lock-step. tokenSweep: bans legacy deleted Tailwind classes that now silently resolve to nothing.
- **פרימיטיבים:** vitest + raw fs/regex over globals.css and components
- **חוב:** Guards rely on globals.css textual conventions (no literal braces in comments, hex-literal tokens) — fragile against an aggressive CSS refactor; a redesign MUST keep tokens as parseable literals or port the guards first. These guards are the contract the redesign must pass, not bypass.

### eslint local rules (component-layer bans) · `primitive`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/eslint-rules/{no-cross-palette-import,no-hex-color-in-components,no-dark-variant-in-components,no-native-title-tooltip,no-raw-button-in-components,no-raw-input-in-components,no-raw-table-in-components,no-physical-direction-in-components,no-legacy-tailwind-class,no-emoji-in-jsx}.js
- **משטח-אב:** Lint gate on src/components/**
- **ויזואלית:** Enforce: chart files cannot consume --band-*/--status-* directly (only via chartColors bridge); no raw hex in components; no dark: variants (tokens flip themes, not classes); native title= banned (HelpTooltip only; Money overflow-title is the per-line exception); raw <button>/<input>/<table> banned (Button/Input/TableBase only); logical-direction classes only (RTL safety); legacy class names banned; emoji-in-JSX banned.
- **פרימיטיבים:** —
- **חוב:** ChartAnnotationPins' emoji pin glyphs and Money's title= each carry per-line disables — sanctioned exceptions that a redesign should preserve knowingly, not multiply.

### Playwright visual + a11y suite · `primitive`

- **קובץ:** /Users/dorperetz/script-roas/dashboard-web/playwright.config.ts + /Users/dorperetz/script-roas/dashboard-web/tests/visual/{pages,states,contrast.axe,overflow,tooltips}.spec.ts
- **משטח-אב:** CI — both themes (chromium-dark + chromium-light projects, 1440×900)
- **ויזואלית:** pages.spec: full-page snapshots per top-level ?tab= URL + /operator sub-tabs. states.spec: scoped snapshots of band/freshness/AOV states on the deterministic /dev/primitives route + sidebar/chart-pin states on Home. contrast.axe.spec: axe color-contrast per tab per theme — owns SOLID surfaces; gradient band cards are explicitly delegated to the static contrastGuard (documented division of labor) with the platform-brand label baseline accepted. overflow.spec: WCAG 1.4.4 — no .metric-num clips at 720px (real reflow, not zoom). tooltips.spec: behavioral keyboard/touch/mode-matrix gate for HelpTooltip in both themes.
- **פרימיטיבים:** @playwright/test, axe-core
- **חוב:** Snapshot stability depends on seeded/no-data env shape (documented caveat); data-dependent pages mean baselines drift with fixtures; /dev/primitives must be extended whenever a new band/freshness visual state is added or the gate silently under-covers it.
