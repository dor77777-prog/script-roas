# CampaignDrawer Overview-tab reorg — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** Reorganize ONLY the `סקירה` (Overview) tab of the campaign drawer so it opens to a clean at-a-glance summary instead of a stacked wall of 8 sections — the deep analyses move into collapsible accordions. ZERO info loss; ZERO restyle.

**Operator constraints (hard):**
- **Stick to the EXISTING graphic language** — reuse the real primitives + tokens already in use (`Card`, `Badge`, `Stat`, `Heading`, `HealthScorePanel`, `CohortComparisonPanel`, `AttributionAnalysisPanel`, `ProductChannelBreakdown`, `MetaShopifyReconciliation`). The collapsible pattern is the **existing styled `<details>`/`<summary>`** used in `PnLBreakdown.tsx` / `CohortGridAdvanced.tsx` / `CustomerValueTab.tsx` — copy that pattern, do NOT invent a new design or tokens.
- **No info loss** — every existing section stays; only collapsed (not deleted).
- **ONLY** `src/components/campaign-drawer/CampaignDrawerOverview.tsx` (+ a small local accordion helper if needed). Home + other tabs untouched. No `netProfit` rename (out of scope).
- Light + dark must both look native (tokens already handle it).
- Approved mockup (layout reference): `docs/superpowers/mockups/2026-06-03-overview-tab/overview-reorg.html`.

**Target structure (faithful to the approved mockup, built from existing components):**
1. **Scorecard — 4 tiles, ALWAYS visible (operator-confirmed: keep ROAS/value here even though they repeat in the KPI grid below — do NOT slim it):**
   - **ROAS** (+ the existing band `Badge`, e.g. "מעולה") · **ערך-המרות** · **אמינות attribution** (the trust score `/100`) · **ציון בריאות** (the grade/early-state).
   - Built from the EXISTING `Stat`/`Badge` primitives (same look as the KPI grid tiles). Surface the two computed signals:
     - **attribution trust score** — reuse the SAME computation `AttributionAnalysisPanel` already does from the attribution data passed into Overview (extract/import the existing helper; do NOT recompute from raw totals).
     - **health grade/state** — from the existing `health` prop / the grade logic `HealthScorePanel` uses.
2. **KPI grid + secondary strip — ALWAYS visible (kept as today):** `Stat` ×4 (ROAS/הוצאה/ערך-המרות/המרות) + `Stat` ×3 (CPA/CPC/CTR). (ROAS/value intentionally repeat the scorecard — operator-approved.)
3. **Collapsible accordions (`<details>`, existing token style; NOTHING deleted — summary→detail, no info loss):**
   - ציון בריאות — the FULL `HealthScorePanel` (explanation + recommendation) — collapsed (the scorecard tile is its summary).
   - 🏷️ מוצרי Shopify משויכים (mapped-products incl. proportional/cohort note) — collapsed.
   - 🏆 השוואת cohort — `CohortComparisonPanel` — collapsed.
   - 📈 ניתוח attribution — `AttributionAnalysisPanel` (full) — **open by default**.
   - פילוח מוצר × ערוץ — `ProductChannelBreakdown` — collapsed.
   - התאמת Meta↔Shopify — `MetaShopifyReconciliation` — collapsed (only when `reconciliation` present, as today).
   - **Optional:** a small `Badge` chip in each accordion `<summary>` (cohort rank, attribution "אמין · 90") if the value is already at hand — skip if it needs new cross-component plumbing.

**Tech:** Next.js+TS, Vitest DOM. Hebrew RTL, token-driven, WCAG-AA both themes, mapping/readability guards stay green.

---

## Task 1: Reorganize the Overview tab into scorecard + accordions

**Files:**
- Modify: `src/components/campaign-drawer/CampaignDrawerOverview.tsx`
- (Optional) a tiny local `OverviewAccordion` helper inside the same file or `campaign-drawer/` if it reduces repetition — using the existing `<details>` token classes (copy from `CustomerValueTab.tsx` / `PnLBreakdown.tsx`).
- Test: `src/components/campaign-drawer/__tests__/CampaignDrawerOverview.dom.test.tsx` (extend existing if present, else create)

- [ ] **Step 1: Read the references** — read `CampaignDrawerOverview.tsx` (current order, lines ~116-276), and the existing `<details>` accordion styling in `CustomerValueTab.tsx` (the `details.acc` pattern) + `PnLBreakdown.tsx`. Match those exact classes/tokens.

- [ ] **Step 2: Write the failing DOM test**

```tsx
// asserts the reorg: deep sections are inside collapsible <details>, summary
// always visible, attribution open by default, and NO section was removed.
it('Overview: deep sections are collapsible <details>; Health + KPIs stay always-visible', () => {
  render(<CampaignDrawerOverview {...overviewProps} />);
  // always-visible: health score + the ROAS KPI
  expect(screen.getByText(/ROAS/)).toBeInTheDocument();
  // deep sections wrapped in <details>
  const details = document.querySelectorAll('details');
  expect(details.length).toBeGreaterThanOrEqual(3); // mapped / cohort / attribution (+ product-channel / reconciliation when present)
  // attribution open by default
  const attr = [...details].find((d) => d.textContent?.includes('attribution') || d.textContent?.includes('ייחוס'));
  expect(attr?.open).toBe(true);
  // no info loss — mapped-products + cohort summaries present (collapsed but in DOM)
  expect(screen.getByText(/משויכים|מיפוי/)).toBeInTheDocument();
});
```
(Use the file's existing test props/fixtures; if no test file exists, mirror a neighboring drawer test's setup. Include a case with `reconciliation` present → its `<details>` renders, and absent → it doesn't.)

- [ ] **Step 3: Run — verify fail** — `npx vitest run --config vitest.config.dom.ts src/components/campaign-drawer/__tests__/CampaignDrawerOverview.dom.test.tsx`

- [ ] **Step 4: Implement the reorg** —
  (a) **Scorecard (4 `Stat`/`Badge` tiles, always visible, top):** ROAS (+ band Badge) · ערך-המרות · אמינות-attribution (trust score `/100`, reuse the existing attribution helper) · ציון-בריאות (grade/early-state from `health`). Same tile look as the KPI grid.
  (b) **KPI grid + CPA/CPC/CTR (always visible):** keep exactly as today (ROAS/value repeat — intended).
  (c) **Accordions:** wrap each of {FULL `HealthScorePanel`, mapped-products block, `CohortComparisonPanel`, `AttributionAnalysisPanel`, `ProductChannelBreakdown`, `MetaShopifyReconciliation`} in a styled `<details>` — copy the EXISTING token classes from `CustomerValueTab`'s `details.acc` (border `border-glass-edge`, rounded, Card-consistent bg, `<summary>` = section title + caret + optional Badge). `<details open>` on attribution; all others closed. Preserve the exact section titles/icons (Package, 🏆, etc.) + ALL inner content. Keep the `reconciliation &&` guard. RTL, token-driven, `text-end`/logical classes, no hardcoded colors.

- [ ] **Step 5: Run tests + tsc + lint** — `npx vitest run --config vitest.config.dom.ts src/components/campaign-drawer/__tests__/CampaignDrawerOverview.dom.test.tsx && npx tsc --noEmit && npx eslint src/components/campaign-drawer/CampaignDrawerOverview.tsx`
  Expected: PASS, tsc 0, lint 0 (use `text-end`/logical classes, no physical-direction).

- [ ] **Step 6: Commit**

```bash
git add src/components/campaign-drawer/CampaignDrawerOverview.tsx src/components/campaign-drawer/__tests__/CampaignDrawerOverview.dom.test.tsx
git commit -m "feat(campaign-drawer): reorganize Overview tab — scorecard + collapsible accordions"
```

---

## Final
- [ ] Full gates: `npx tsc --noEmit`; `npx vitest run`; `npx vitest run --config vitest.config.dom.ts`; eslint; mapping guards.
- [ ] UM bump (components changed → docs-currency gate): note the Overview-tab reorg (Health + KPIs at-a-glance; deep analyses in accordions; zero info loss).
- [ ] ONE `git push origin main`. Verify on prod: open a campaign → Overview opens clean; expanding accordions shows the full sections; light + dark both native.
