# Tooltip System Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`). Implement task-by-task with spec-review + quality-review after each.

**Goal:** Turn the dashboard's tooltips into ONE professional, mobile-friendly system — one primitive (`HelpTooltip`, unchanged signature) that auto-selects four render modes (simple/rich × desktop/touch), all in the existing mesh/glass graphic language, WCAG-AA in both themes, with a hermetic CI guard so the standard can't regress.

**Architecture:** Keep `HelpTooltip` as the single entry point + null-passthrough contract (so ~32 files upgrade for free). Internally branch on *pointer type × content shape*: simple/desktop → Radix **Tooltip** (`role=tooltip`); rich/desktop → Radix **Popover** (`role=dialog`, hover-intent); simple/touch → **toggletip** (ⓘ button → tap-open Popover, `role=status`); rich/touch → **Sheet side="bottom"** for long content, tap-open Popover for short. Harden the `no-native-title` lint + add a "no focusable element inside role=tooltip" guard FIRST. Land everything in one deploy.

**Tech Stack:** Next.js + TS, `@radix-ui/react-tooltip` + `@radix-ui/react-popover` (add) + existing `Sheet` (Radix Dialog), Tailwind + CSS-var tokens, Vitest (node + dom), Playwright (`tests/visual`), `useIsMobile(767)`.

**Operator-locked decisions (§6.5 of the spec):** hover-intent on desktop rich; bottom-sheet on touch ONLY for long rich content (>~40% vh) else tap-Popover; ⓘ everywhere; remove `RoasTargetChart` dot `<title>`; `delayDuration=200` / `skipDelayDuration=300`; optimize-toggles → `aria-label`-only where redundant.

**Hard rules:** existing tokens only (no new CSS vars / no hardcoded colors); RTL logical classes (`text-end`, `ms/me`, never `text-right`); numbers via `<Money>`/`<Metric>` in `<bdi dir="ltr">`; light+dark both first-class; pass existing guards (`contrastGuard.test.ts`, `designColorGuard.test.ts`, `no-physical-direction`, overflow); **no-drip-deploy** — verify every tab both themes + mobile emulation locally, then ONE push.

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `src/components/ui/Tooltip.tsx` | the single primitive — 4 modes, auto-select | **rewrite** (keep exports + signature) |
| `src/components/ui/tooltip/SimpleTooltip.tsx` | mode A (desktop simple, Radix Tooltip) | create (or keep inline if small) |
| `src/components/ui/tooltip/RichPopover.tsx` | mode B (desktop rich, Radix Popover) | create |
| `src/components/ui/tooltip/Toggletip.tsx` | mode C (touch simple) | create |
| `src/components/ui/tooltip/RichSheet.tsx` | mode D (touch rich long) | create |
| `src/components/ui/__tests__/Tooltip.dom.test.tsx` | mode selection + a11y + null-passthrough | create |
| `eslint-rules/no-native-title-tooltip.js` | close the `<Button>` PascalCase bypass | extend |
| `eslint-rules/__tests__/no-native-title-tooltip.test.js` | rule fixtures (if exists, extend) | extend/create |
| `src/lib/__tests__/tooltipFocusableGuard.test.ts` | "no focusable inside role=tooltip" CI guard | create |
| `src/app/layout.tsx:89` | `delayDuration=200` / `skipDelayDuration=300` | edit |
| Phase-2 consumers (native `title=`) | wrap in HelpTooltip / drop to aria-label | edit |
| Phase-3 bespoke popovers | fold into primitive rich mode | edit |
| Phase-4 chart-anchored | retrofit shared chrome + mobile + ARIA + `<Money>` | edit |
| `tests/visual/tooltips.spec.ts` | Playwright touch + keyboard + both-theme | create |
| `docs/ROAS-Dashboard-User-Manual.md` | UM bump (tooltip behavior, esp. mobile ⓘ) | edit |
| `docs/ARCHITECTURE.md` | §tooltip system note | edit |

The four mode components are split out so each is small + independently testable; `Tooltip.tsx` stays the thin selector + public API.

---

## Phase 0 — Harden the guard (FIRST, so all later code is enforced)

### Task 0.1: Close the `<Button>`/prop-forwarding `title=` bypass

**Files:** Modify `eslint-rules/no-native-title-tooltip.js`; Test `eslint-rules/__tests__/no-native-title-tooltip.test.js`.

- [ ] **Step 1: Write/extend the failing rule test** — add a fixture that MUST now error:
```js
// invalid: title= on a prop-forwarding primitive (spreads {...props} to a host element)
{ code: `<Button title="פתח">x</Button>`, errors: [{ messageId: undefined }] }, // expect 1 error
// still valid: title= on a genuine component prop that is NOT prop-forwarding
{ code: `<Chart title="rev" />`, errors: [] }, // allowlisted component
// valid: SVG <title> content element
{ code: `<title>label</title>`, errors: [] },
```
- [ ] **Step 2: Run — verify the `<Button>` case currently passes (bug)** — `cd dashboard-web && npx eslint --rulesdir eslint-rules ...` or the rule's vitest. Expected: the `<Button>` case does NOT error yet.
- [ ] **Step 3: Implement** — replace the blanket `if (tag[0] === tag[0].toUpperCase()) return;` PascalCase early-return with a **prop-forwarding allowlist**: maintain `const FORWARDING = new Set(['Button','IconButton','Chip','Badge'])` (primitives in `components/ui` that spread `{...props}` onto a host element — confirm each by grep `{...props}` in its source). If `FORWARDING.has(tag)` → REPORT (the title leaks to the DOM). Other PascalCase components → still skip (genuine props). Keep the `<title>` SVG exemption.
- [ ] **Step 4: Run — all rule fixtures pass.**
- [ ] **Step 5: Commit** — `git commit -m "fix(lint): no-native-title flags title= on prop-forwarding primitives (Button bypass)"`

### Task 0.2: "No focusable element inside role=tooltip" CI guard

**Files:** Create `src/lib/__tests__/tooltipFocusableGuard.test.ts`.

- [ ] **Step 1: Write the failing test** — a DOM test that renders the primitive with focusable rich content and asserts it is NOT a `role="tooltip"`:
```tsx
it('rich content with a focusable element never renders inside role=tooltip', () => {
  render(<HelpTooltip variant="rich" content={<a href="#x">link</a>}>{<button>t</button>}</HelpTooltip>);
  // open it (desktop simple path would be a tooltip; rich must be a dialog)
  // assert: no element with role="tooltip" contains an <a>/<button>/<input>/[tabindex]
  const tips = document.querySelectorAll('[role="tooltip"]');
  tips.forEach(t => expect(t.querySelector('a,button,input,select,textarea,[tabindex]')).toBeNull());
});
```
- [ ] **Step 2: Run — verify it fails** against the CURRENT primitive (rich JSX renders inside role=tooltip today).
- [ ] **Step 3:** (left RED until Phase 1 makes rich → Popover.) Mark this test as the Phase-1 acceptance gate; do NOT skip it.
- [ ] **Step 4: Commit the test** — `git commit -m "test(a11y): guard — no focusable element inside role=tooltip (RED until primitive split)"`

---

## Phase 1 — Upgrade the one primitive

### Task 1.1: Add `@radix-ui/react-popover` + the simple/rich desktop split

**Files:** Modify `src/components/ui/Tooltip.tsx`; create `tooltip/RichPopover.tsx`; Test `src/components/ui/__tests__/Tooltip.dom.test.tsx`.

- [ ] **Step 1: Add the dep** — `cd dashboard-web && npm i @radix-ui/react-popover` (peer of the installed Radix; confirm version aligns).
- [ ] **Step 2: Write failing DOM tests** (mode selection + a11y + contract):
```tsx
// null-passthrough preserved
it('returns child untouched when content is null/empty', () => {
  const { container } = render(<HelpTooltip content={null}><b id="c">x</b></HelpTooltip>);
  expect(container.querySelector('#c')).toBeInTheDocument();
});
// simple desktop → role=tooltip
it('string content on desktop opens a role=tooltip on focus', async () => {
  render(<HelpTooltip content="עזרה"><button>t</button></HelpTooltip>);
  fireEvent.focus(screen.getByRole('button'));
  expect(await screen.findByRole('tooltip')).toHaveTextContent('עזרה');
});
// rich desktop → role=dialog, never role=tooltip
it('rich content on desktop opens a role=dialog (Popover), not a tooltip', async () => {
  render(<HelpTooltip variant="rich" title="כותרת" content={<p>גוף</p>}><button>t</button></HelpTooltip>);
  fireEvent.click(screen.getByRole('button'));
  expect(await screen.findByRole('dialog')).toBeInTheDocument();
  expect(screen.queryByRole('tooltip')).toBeNull();
});
// Esc closes
it('Esc closes the tooltip', async () => { /* open, press Escape, assert gone */ });
```
- [ ] **Step 3: Run — verify fail.**
- [ ] **Step 4: Implement** — rewrite `Tooltip.tsx`:
  - Keep `TooltipProvider/Tooltip/TooltipTrigger/TooltipContent` exports unchanged (back-compat) but bump `TooltipContent` chrome to `rounded-chip text-xs` + **add `<RadixTooltip.Arrow className="fill-glass-2" width={10} height={5} />`** + `collisionPadding={8}`.
  - `useIsMobile()` is called UNCONDITIONALLY at the top of `HelpTooltip` (before the null early-return — hooks rule).
  - `isRich = variant === 'rich' || title != null || (variant === 'auto' && typeof content !== 'string' && typeof content !== 'number')`.
  - Desktop (`!isMobile`): `!isRich` → existing Radix Tooltip path (mode A); `isRich` → `<RichPopover>` (mode B): Radix Popover, `role="dialog"`, hover-intent (open on `onPointerEnter` after ~180ms + on click; `onPointerLeave` close after ~150ms; keep open while popover hovered), `max-w-sm rounded-card bg-glass-1/95 backdrop-blur-sm shadow-overlay`, Arrow `fill-glass-1`, optional `title` as `text-sm font-semibold text-ink`, body `text-xs text-ink-secondary whitespace-pre-line`, `onEscapeKeyDown` + click-outside (Radix default).
  - Touch path stubbed in 1.2.
  - New optional props: `variant?: 'auto'|'text'|'rich'`, `title?: ReactNode`, `withinDrawer?: boolean` (lift content to `z-[60]` when true).
- [ ] **Step 5: Run tests + tsc + lint** — `npx vitest run --config vitest.config.dom.ts src/components/ui/__tests__/Tooltip.dom.test.tsx && npx tsc --noEmit && npx eslint src/components/ui/Tooltip.tsx src/components/ui/tooltip/*.tsx`. Expected PASS; the Phase-0.2 focusable guard now GREEN (rich → dialog).
- [ ] **Step 6: Commit** — `git commit -m "feat(tooltip): desktop simple/rich split — Radix Tooltip + Popover, arrow, collisionPadding, text-xs"`

### Task 1.2: Touch modes — toggletip (C) + bottom-sheet (D)

**Files:** Modify `Tooltip.tsx`; create `tooltip/Toggletip.tsx`, `tooltip/RichSheet.tsx`; extend the DOM test.

- [ ] **Step 1: Write failing tests** (force coarse pointer via `useIsMobile` mock → true):
```tsx
vi.mock('@/lib/hooks/useIsMobile', () => ({ useIsMobile: () => true }));
it('touch + simple renders an ⓘ button that tap-opens a popover', async () => {
  render(<HelpTooltip content="עזרה"><span>ROAS</span></HelpTooltip>);
  const info = screen.getByRole('button', { name: /הסבר|מידע|help/i });
  expect(info).toBeInTheDocument();
  fireEvent.click(info);
  expect(await screen.findByRole('dialog')).toHaveTextContent('עזרה'); // or status live region
});
it('touch + long rich escalates to a bottom Sheet with a visible close', async () => { /* tap ⓘ → Sheet (role=dialog) + סגור button */ });
```
- [ ] **Step 2: Run — verify fail.**
- [ ] **Step 3: Implement** —
  - `Toggletip` (mode C): render the child, then a paired **ⓘ `<button aria-label>`** (24px glyph, `::after` inset to ≥44px hit area, `text-ink-muted` → `text-accent` on hover/focus). Tap toggles a Radix Popover with the content; announce via a `role="status"` live region; tap-outside/Esc close (Radix). No focusable content inside.
  - `RichSheet` (mode D): long rich → `<Sheet open onOpenChange><SheetContent variant="modal" side="bottom"...>` (or a dedicated bottom variant) with `SheetHeader` (title + visible `✕` close) + body (content, numbers via `<Money>`). **Length heuristic:** treat as "long" when `variant==='rich'` AND (a `title` is present OR content is a block/array) — i.e. LTV/attribution/column-paragraphs; SHORT rich (refund 2-liner, cohort verdict) stays the tap-Popover (mode C-rich). Expose `richTouch?: 'auto'|'sheet'|'popover'` internal knob; default `auto` per the heuristic. (Operator decision 2.)
  - Touch branch in `HelpTooltip`: `isRich && isLong` → `RichSheet`; else `Toggletip` (carrying the rich body in the popover for short-rich).
- [ ] **Step 4: Run tests + tsc + lint.** Expected PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(tooltip): touch modes — ⓘ toggletip + bottom-sheet for long rich"`

### Task 1.3: Tune delays + provider

**Files:** Modify `src/app/layout.tsx` (line ~89), `Tooltip.tsx` default `delayDuration`.

- [ ] **Step 1:** Set app-root `<TooltipProvider delayDuration={200} skipDelayDuration={300}>`; `HelpTooltip` default `delayDuration = 200`.
- [ ] **Step 2: Run tsc + the tooltip DOM suite.** Commit — `git commit -m "feat(tooltip): tune delays — 200ms open / 300ms skip-group"`

### Task 1.4: Audit existing non-string `HelpTooltip` call-sites (over-promotion safety)

**Files:** read-only sweep; targeted edits where needed.

- [ ] **Step 1:** `grep -rn "HelpTooltip" src --include=*.tsx` → list call-sites whose `content=` is non-string JSX. For each, decide: genuinely rich (leave → Popover) OR simple emphasis that should stay a tooltip (add `variant="text"`). Record the list in the PR description.
- [ ] **Step 2:** Apply `variant="text"` where a JSX content is actually simple (avoid surprise Popover). Run dom suite. Commit — `git commit -m "fix(tooltip): pin simple JSX call-sites to variant=text (no surprise popover)"`

### Task 1.5: Playwright touch + keyboard + both-theme

**Files:** Create `tests/visual/tooltips.spec.ts`.

- [ ] **Step 1:** Add a Playwright spec: (a) **keyboard** — focus a help trigger → tooltip appears → Esc → gone, focus unchanged; (b) **touch emulation** (`hasTouch`, coarse pointer) — tap ⓘ → popover/sheet opens → tap scrim/✕ closes, underlying action NOT fired; (c) run in light + dark. Use an existing harness page or a tiny story route if the suite has one; else assert against the live dashboard (`/`) help chips.
- [ ] **Step 2:** `npm run test:visual -- tooltips` green. Commit — `git commit -m "test(visual): tooltip keyboard + touch + both-theme Playwright"`

---

## Phase 2 — Convert native `title=` leftovers

**Files (each a step):** `GoalTracker:231/244/400/523`, `HealthScoreBadge:83`, `TabFreshnessHeader:74`, `InsightsBoard:418/617/627/647`, `AdSetTable:174`, `CampaignsTableRow:262`, `RoasTargetChart:778` (SVG `<title>` on dots).

- [ ] **Step 1: Write a guard test** — extend `tooltipFocusableGuard` or add a source-scan test asserting these files contain no `title=` on host/forwarding elements (will fail until converted).
- [ ] **Step 2: Convert** — wrap each in `<HelpTooltip content="…">`. For optimize-toggles whose `title=` merely repeats the `aria-label` (`AdSetTable`/`CampaignsTableRow`) → **drop the `title`, keep `aria-label` only** (operator decision 6). Remove the `RoasTargetChart:778` dot `<title>` (decision 4 — crosshair covers it).
- [ ] **Step 3: Run** — `npx eslint src/... && npx vitest run --config vitest.config.dom.ts && npx tsc --noEmit`. The hardened lint (0.1) now passes clean.
- [ ] **Step 4: Commit** — `git commit -m "refactor(tooltip): migrate native title= leftovers → HelpTooltip / aria-label"`

---

## Phase 3 — Fold the 4 bespoke hover-popovers into the primitive

- [ ] **Task 3.1 — `RefundIndicator`** → `<HelpTooltip variant="rich" title="פירוט החזרים" content={…}>`; delete its hand-rolled portal/flip/`isTouchDevice` logic (the primitive now owns touch). Test the 2-line breakdown renders + numbers via `<Money>`.
- [ ] **Task 3.2 — `ProductCentricView`** `HoverTooltip`×1 + `ColHelp`×9 → `HelpTooltip variant="rich"` (fixes the not-portalled clipping in `overflow-auto`). One commit; verify the 9 column helps open + flip.
- [ ] **Task 3.3 — `CampaignsTable`** `ColumnHeaderTh`×4 → `HelpTooltip variant="rich"` (closes the `:2616` "TODO mobile-fix: clipped by overflow-auto"). Verify in a horizontally-scrolled table.
- Each task: TDD where a DOM test is meaningful, else a render smoke + the focusable guard; tsc + lint + dom; commit per task.

---

## Phase 4 — Chart-anchored tooltips (keep bespoke positioning)

- [ ] **Task 4.1 — `RoasTargetChart`** pins + crosshair → keep SVG/pointer anchoring; swap the bubble chrome for the shared rich-card classes (`bg-glass-1/95 backdrop-blur-sm border-glass-edge rounded-card shadow-overlay`), add `role` ARIA, mobile tap/dismiss, numbers via `<Money>`. (SVG `<title>` on dots already removed in Phase 2.)
- [ ] **Task 4.2 — `CustomerValueCurve`** LTV hover → same retrofit (shared chrome + tap/dismiss + ARIA + `<Money>`).
- [ ] **Leave `ChartTooltip` (Recharts) untouched** — it's the skin reference. Verify visually it still matches.
- Each task: visual smoke (Playwright) + tsc + lint; commit per task.

---

## Final

- [ ] **Full gates:** `cd dashboard-web && npx tsc --noEmit && npm test && npx vitest run --config vitest.config.dom.ts && npm run lint && npm run test:visual` (+ contrast/overflow axe specs). All green; the hardened `no-native-title` + focusable guard + contrast guard pass.
- [ ] **Manual visual sweep (chrome-devtools, no-drip):** every tab (Home, Campaigns, Customers, Products, Operator, the CampaignDrawer tabs) in **light AND dark**, plus **mobile emulation** (tap ⓘ → popover/sheet → dismiss). Confirm: no clipped tooltips in scroll tables, arrows re-anchor on flip, numbers never clip, AA contrast, no surprise Popovers on simple call-sites.
- [ ] **Tune** `delayDuration`/`skipDelayDuration` final feel during the sweep (operator decision 5).
- [ ] **Docs:** UM bump (new "טולטיפים" section — desktop hover/focus, mobile ⓘ tap + bottom-sheet, Esc/tap-out) + ARCHITECTURE §tooltip note. (docs-currency gate.)
- [ ] **ONE** `git push origin main`. Verify on prod: hover + keyboard on desktop, tap ⓘ + bottom-sheet on a phone, both themes.

## Self-review checklist
- Spec coverage: §2 best-practices → modes A–D (1.1/1.2); §4 graphic language → 1.1 chrome + tokens; §4.4 mobile → 1.2; §6.5 decisions → 1.2 (sheet threshold), 1.3 (delays), 2 (aria-label + dot title), 1.1 (hover-intent); §6 migration → Phases 2/3/4; guard → Phase 0 + 1.5. ✓
- Types consistent: `variant`, `title`, `withinDrawer`, `richTouch` defined in 1.1/1.2 and used downstream. ✓
- No placeholders: each task has files, test code, command, commit. ✓
