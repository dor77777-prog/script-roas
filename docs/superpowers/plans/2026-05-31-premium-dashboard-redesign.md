# Premium 2026 Dashboard Redesign — Implementation Plan v2

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Take the dashboard from "good engineering, decent design" to premium 2026 command-center tier in the **glass+neon (Vision UI flagship) aesthetic** the user locked during the 2026-05-31 visual mockup pass. Delete the legacy palette, add the glass surface system + V4 band signal + 3-stage freshness desaturation + per-store semantic emphasis + ROAS-vs-target chart section, enforce primitive adoption, recompose Home around the new section order, split the 1619-line `CampaignDrawer`, sweep RTL gaps, and gate everything with a Playwright visual-regression CI.

**Architecture:** Six implementation waves. Wave 1 establishes the new token foundation — chart palette + violet accent + glass surface tokens + band signal + freshness CSS + semantic emphasis classes + canvas + motion + radius. Wave 2 forces primitive adoption via codemod + ESLint, applying the new glass treatment. Wave 3 recomposes Home around the mockup-04-final structure + ships the new `RoasTargetChart`, `PerStoreRow`, `CommandCenterHero`, `InsightsBoard`, `ActivityFeed`. Wave 4 sweeps RTL/bidi P0 bugs. Wave 5 polishes per-page + the slim sidebar + splits `CampaignDrawer`. Wave 6 adds motion vocabulary + Playwright visual-regression CI. Single mega-PR.

**Tech Stack:** Next.js 14 App Router, Tailwind, OKLCH CSS variables, shadcn-style primitives, vitest+jsdom for unit + DOM tests, ESLint custom rules, Playwright + `@playwright/test` image snapshots.

**Source-of-truth references** (read before touching tokens or component visuals):
- `docs/superpowers/specs/2026-05-31-premium-dashboard-redesign-audit.md` — audit + DIRECTION REVISED preamble.
- `docs/superpowers/mockups/2026-05-31-visual-direction/README.md` — mockup index.
- Memory: `project_phase1_audit_decisions_2026_05_31.md`, `project_visual_direction_flip_2026_05_31.md`, `feedback_roas_state_gradient.md`, `feedback_home_visual_rules.md`, `feedback_freshness_desaturation_thresholds.md`.

---

## Wave 1 — Token, Color & Surface System (foundation)

> Wave 1 is the substrate for everything else. Visual-regression baseline is generated in Wave 6 after the surface stabilises — do not ship Wave 1 to main until Task 6.3 lands.

### Task 1.1: Add chart palette, violet accent, glass surface tokens, canvas + animated bg

**Visual reference:** `mockup-04-final.html` lines 10–52 (`:root` block + `body` background + `body::before` conic-gradient).

**Files:**
- Modify: `dashboard-web/src/app/globals.css` (`:root` block + remove `[data-theme="dark"]` blocks — dark is the only mode now)
- Modify: `dashboard-web/src/app/layout.tsx` (force `data-theme="dark"` on `<html>`)
- Test: `dashboard-web/src/lib/__tests__/chartTokens.test.ts` (new)
- Test: `dashboard-web/src/lib/__tests__/glassTokens.test.ts` (new)

**Steps:**

- [ ] **Step 1: Write failing tests.**
  - `chartTokens.test.ts`: asserts `--chart-platform-meta|google|tiktok|organic|shopify`, `--accent`, `--band-{red,orange,green,blue,gray}`, `--store-{uzo,usm,s3}` all exist; TikTok hue ≥ 13° from `--band-red` hue.
  - `glassTokens.test.ts`: asserts `--glass-1|2|3`, `--glass-edge`, `--glass-edge-hot`, `--canvas-1`, `--canvas-2`, `--blur-glass`, `--blur-sheet` all exist.

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Rewrite `:root` block** in `globals.css`. Source values from `mockup-04-final.html:10–52`. Required additions:

  ```css
  :root {
    /* Chart — platform-brand-mirrored (Q1 locked). */
    --chart-platform-meta:    oklch(70% 0.18 257);
    --chart-platform-google:  oklch(80% 0.15 90);
    --chart-platform-tiktok:  oklch(72% 0.24 12);
    --chart-platform-organic: oklch(75% 0.14 175);
    --chart-platform-shopify: oklch(70% 0.16 165);

    /* Stores. */
    --store-uzo: oklch(72% 0.16 210);
    --store-usm: oklch(72% 0.18 330);
    --store-3:   oklch(70% 0.16 100);

    /* Brand accent (Q2 violet). */
    --accent:      oklch(72% 0.20 280);
    --accent-deep: oklch(58% 0.22 285);
    --accent-fg:   oklch(99% 0 0);

    /* V4 band signal — see Task 1.3. */
    --band-red:    oklch(64% 0.22 22);
    --band-orange: oklch(78% 0.16 75);
    --band-green:  oklch(70% 0.18 145);
    --band-blue:   oklch(68% 0.16 240);
    --band-gray:   oklch(60% 0.012 250);

    /* Canvas — deep blue-violet. */
    --canvas-1: oklch(13% 0.020 270);
    --canvas-2: oklch(11% 0.025 280);

    /* Glass layers. */
    --glass-1: oklch(100% 0 0 / 0.04);
    --glass-2: oklch(100% 0 0 / 0.06);
    --glass-3: oklch(100% 0 0 / 0.08);
    --glass-edge:     oklch(100% 0 0 / 0.12);
    --glass-edge-hot: oklch(72% 0.20 280 / 0.40);

    /* Foreground stack (4 stops — see Task 1.6). */
    --text:        oklch(98% 0.008 80);
    --text-2:      oklch(82% 0.012 250);
    --text-muted:  oklch(64% 0.018 250);
    --text-subtle: oklch(48% 0.020 250);

    /* Blur + shadow tokens (see Task 1.7). */
    --blur-glass: blur(20px) saturate(140%);
    --blur-sheet: blur(36px) saturate(160%);

    /* Up/down deltas (mirrors band-green / band-red). */
    --up: var(--band-green);
    --dn: var(--band-red);
  }
  ```

- [ ] **Step 4: Add the animated page background** at the top of `globals.css` (under the existing reset):

  ```css
  html, body { background-color: var(--canvas-1); }
  body {
    color: var(--text);
    background:
      radial-gradient(ellipse at 0% 0%,   oklch(45% 0.22 280 / 0.35) 0%, transparent 50%),
      radial-gradient(ellipse at 100% 0%, oklch(40% 0.20 257 / 0.30) 0%, transparent 50%),
      radial-gradient(ellipse at 50% 100%, oklch(40% 0.22 320 / 0.25) 0%, transparent 60%),
      linear-gradient(180deg, var(--canvas-1) 0%, var(--canvas-2) 100%);
    background-attachment: fixed;
    min-height: 100vh;
    overflow-x: hidden;
  }
  body::before {
    content: '';
    position: fixed; inset: -40% -10%; height: 180%;
    background: conic-gradient(from 30deg at 50% 50%,
      oklch(72% 0.18 280 / 0.04),
      oklch(70% 0.18 257 / 0.04),
      oklch(72% 0.24 12 / 0.03),
      oklch(75% 0.14 175 / 0.03),
      oklch(72% 0.18 280 / 0.04));
    animation: spin 60s linear infinite;
    pointer-events: none; z-index: 0; opacity: 0.6; filter: blur(40px);
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) {
    body::before { animation: none; }
  }
  ```

- [ ] **Step 5: Force dark mode** in `layout.tsx` — add `data-theme="dark"` and `dir="rtl"` to `<html>`. Delete every `[data-theme="dark"]` block in `globals.css` (single-mode only). Delete every `dark:` Tailwind variant from primitives (Wave 2 codemod sweep covers consumer files).

- [ ] **Step 6: Run tests until green.**

- [ ] **Step 7: Commit.**
  ```sh
  git commit -m "$(cat <<'EOF'
  feat(ui-ux): glass+neon foundation — chart palette, violet accent, canvas, glass, conic-gradient bg

  Adds platform-brand-mirrored chart tokens (Q1), violet accent at hue 280 (Q2),
  deep blue-violet canvas, 3-layer glass + edge tokens, V4 band signal tokens,
  store hues, blur tokens, animated conic-gradient body background (60s, paused
  under prefers-reduced-motion). Single-mode (dark only) per the post-mockup
  direction flip — dark overrides removed from :root.

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

### Task 1.2: Delete the legacy hex palette block + lint guard

**Files:**
- Modify: `dashboard-web/tailwind.config.ts` (delete legacy palette ~lines 67-114; replace `colors:` with canvas/text/glass/band/chart/store/accent/status only)
- Modify (consumers): `dashboard-web/src/components/BillingSettings.tsx:86-87`, `PnLBreakdown.tsx:58-59`, `CampaignsTableRow.tsx:303`, `layout.tsx:47`, OAuth callbacks
- Create: `dashboard-web/eslint-rules/no-legacy-tailwind-class.js`
- Modify: `dashboard-web/eslint.config.js` (register the rule + `local/no-cross-palette-import`)
- Test: `dashboard-web/src/lib/__tests__/tokenSweep.test.ts` (new)

**Steps:**

- [ ] **Step 1: Inventory consumers.** `grep -rEn '\b(bg-primary|text-text|bg-background|bg-surface(Muted|Subtle|Sunken)?|bg-roas|text-roas|bg-border|text-primary-)\b' dashboard-web/src --include="*.tsx" --include="*.ts" > /tmp/legacy.txt` and capture the file list.

- [ ] **Step 2: Write a failing sweep test** that scans `dashboard-web/src/` and fails if any of the legacy class patterns above appear outside `__tests__`.

- [ ] **Step 3: Codemod the consumers.** Class translation table:
  - `bg-background` → `bg-canvas`
  - `bg-surface(Muted|Subtle|Sunken)?` → `bg-glass-1` / `bg-glass-2` / `bg-glass-3` per current density (Wave 2 normalises further per consumer)
  - `bg-primary*` → `bg-accent`
  - `text-text-*` → `text-ink` / `text-ink-secondary` / `text-ink-muted` / `text-ink-subtle` (Wave 1 Task 1.6 wires these as Tailwind aliases for `--text` / `--text-2` / `--text-muted` / `--text-subtle`)
  - `bg-roas-{red|orange|green|blue}` → `bg-band-{red|orange|green|blue}/[0.05]` + add `data-band="..."` (Task 1.3 will own this)
  - `text-roas-*` → `text-band-*`
  - `border-border*` → `border-glass-edge`

- [ ] **Step 4: Delete the legacy block** in `tailwind.config.ts:67-114`. Tailwind `colors:` block now contains only `canvas`, `glass`, `band`, `chart`, `store`, `accent`, `status`, `ink`.

- [ ] **Step 5: Author `no-legacy-tailwind-class.js`** matching the existing `no-raw-button-in-components.js` shape — block any literal/template containing the legacy regex above.

- [ ] **Step 6: Author `no-cross-palette-import.js`** — chart files (`/chart|RoasChart|HeroOverview|QuadrantScatter/`) cannot consume `--band-*` or `--status-*`; status/health files cannot consume `--chart-platform-*`.

- [ ] **Step 7: Register both rules** in `eslint.config.js` at `'error'`. Run `npm run typecheck && npm test && npm run lint && npm run test:components`.

- [ ] **Step 8: Commit.**
  ```sh
  git commit -m "$(cat <<'EOF'
  refactor(ui-ux): delete legacy hex palette + 2 lint rules

  ~10 consumers migrated to the canvas/glass/band/chart/store token palette.
  no-legacy-tailwind-class + no-cross-palette-import prevent regression. P0-1
  closed; cross-palette guarantee (Q1) enforced at lint time.

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

### Task 1.3: Band signal tokens, utility class, and `useRoasBandGradient` helper

**Visual reference:** `mockup-04f-v4-final.html` lines 50–110 (V4 signal CSS) and `mockup-04-final.html` lines 91–138 (`.glass[data-band]` + `.v.banded`).

**Files:**
- Modify: `dashboard-web/src/app/globals.css` (append the band rules)
- Create: `dashboard-web/src/lib/format/useRoasBandGradient.ts`
- Create: `dashboard-web/src/lib/__tests__/useRoasBandGradient.test.ts`

**Steps:**

- [ ] **Step 1: Write failing test** for `useRoasBandGradient`:
  - `roas < 2.0` → `{ band: 'red' }`
  - `2.0 ≤ roas < 2.7` → `{ band: 'orange' }`
  - `2.7 ≤ roas < 3.0` → `{ band: 'green' }`
  - `roas ≥ 3.0` → `{ band: 'blue' }`
  - `roas == null` → `{ band: 'gray' }`
  - `isStale === true` → returns same band but with `{ desaturate: true }` flag for downstream CSS.

- [ ] **Step 2: Implement the helper** in `lib/format/useRoasBandGradient.ts`:

  ```ts
  export type RoasBand = 'red' | 'orange' | 'green' | 'blue' | 'gray';
  export interface BandResult { band: RoasBand; desaturate: boolean; }
  export function useRoasBandGradient(roas: number | null | undefined, isStale = false): BandResult {
    if (roas == null || Number.isNaN(roas)) return { band: 'gray', desaturate: isStale };
    if (roas < 2.0) return { band: 'red', desaturate: isStale };
    if (roas < 2.7) return { band: 'orange', desaturate: isStale };
    if (roas < 3.0) return { band: 'green', desaturate: isStale };
    return { band: 'blue', desaturate: isStale };
  }
  ```

- [ ] **Step 3: Append band CSS** to `globals.css` (copy verbatim from `mockup-04-final.html:91-113`):

  ```css
  .glass[data-band]::before {
    content: ''; position: absolute; inset-block-start: 0; inset-inline: 0;
    height: 3px;
    border-start-start-radius: var(--radius-card);
    border-start-end-radius:   var(--radius-card);
    pointer-events: none;
    transition: opacity 600ms ease-out, filter 600ms ease-out;
  }
  .glass[data-band="red"]    { background: oklch(64% 0.22 22  / 0.05); }
  .glass[data-band="red"]::before    { background: var(--band-red);    box-shadow: 0 0 14px oklch(64% 0.22 22  / 0.5); }
  .glass[data-band="orange"] { background: oklch(78% 0.16 75  / 0.05); }
  .glass[data-band="orange"]::before { background: var(--band-orange); box-shadow: 0 0 14px oklch(78% 0.16 75  / 0.45); }
  .glass[data-band="green"]  { background: oklch(70% 0.18 145 / 0.05); }
  .glass[data-band="green"]::before  { background: var(--band-green);  box-shadow: 0 0 14px oklch(70% 0.18 145 / 0.5); }
  .glass[data-band="blue"]   { background: oklch(68% 0.16 240 / 0.05); }
  .glass[data-band="blue"]::before   { background: var(--band-blue);   box-shadow: 0 0 14px oklch(68% 0.16 240 / 0.5); }
  .glass[data-band="gray"]   { background: oklch(60% 0.012 250 / 0.04); }
  .glass[data-band="gray"]::before   { background: var(--band-gray);   box-shadow: 0 0 8px  oklch(60% 0.012 250 / 0.3); }

  .glass[data-band="red"]    .v.banded { color: var(--band-red);    -webkit-text-fill-color: var(--band-red);    background: none; }
  .glass[data-band="orange"] .v.banded { color: var(--band-orange); -webkit-text-fill-color: var(--band-orange); background: none; }
  .glass[data-band="green"]  .v.banded { color: var(--band-green);  -webkit-text-fill-color: var(--band-green);  background: none; }
  .glass[data-band="blue"]   .v.banded { color: var(--band-blue);   -webkit-text-fill-color: var(--band-blue);   background: none; }
  .glass[data-band="gray"]   .v.banded { color: var(--band-gray);   -webkit-text-fill-color: var(--band-gray);   background: none; }
  ```

  Plus the chip classes (verbatim from mockup):

  ```css
  .band-chip { display: inline-flex; align-items: center; gap: 4px; font-size: 10px; font-weight: 700; padding: 2px 7px; border-radius: 4px; text-transform: uppercase; letter-spacing: 0.06em; font-family: 'Geist Mono'; }
  .chip-red    { background: oklch(64% 0.22 22  / 0.18); color: var(--band-red); }
  .chip-orange { background: oklch(78% 0.16 75  / 0.18); color: var(--band-orange); }
  .chip-green  { background: oklch(70% 0.18 145 / 0.18); color: var(--band-green); }
  .chip-blue   { background: oklch(68% 0.16 240 / 0.18); color: var(--band-blue); }
  .chip-gray   { background: oklch(60% 0.012 250 / 0.12); color: var(--text-muted); }
  ```

- [ ] **Step 4: Run tests → PASS. Commit.**
  ```sh
  git commit -m "$(cat <<'EOF'
  feat(ui-ux): V4 band signal — tokens, .glass[data-band] CSS, useRoasBandGradient helper

  Each state-bearing card gets data-band="red|orange|green|blue|gray" → 3px top-edge
  bar with glow, ~5% chroma tint, `.v.banded` element renders in band color, chip
  restates the band. Hue separation: red h22, orange h75 (53° apart). Helper
  centralises threshold logic. Consumed by CommandCenterHero (Task 3.1) and
  PerStoreRow (Task 3.3).

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

### Task 1.4: Freshness desaturation CSS + `useStaleness` hook

**Visual reference:** `mockup-05-freshness-desaturation.html` lines 75–113 (transitions + 3-stage filter) and lines 119–132 (chip).

**Files:**
- Modify: `dashboard-web/src/app/globals.css` (append `[data-freshness]` rules + `--motion-freshness` token)
- Create: `dashboard-web/src/lib/freshness/useStaleness.ts`
- Create: `dashboard-web/src/lib/__tests__/useStaleness.test.ts`

**Steps:**

- [ ] **Step 1: Write failing test** for `computeStaleness(updatedAt, now)`:
  - `age < 15min` → `{ stage: 'fresh', label: 'LIVE · {age}s/m' }`
  - `15min ≤ age < 30min` → `{ stage: 'aging', label: 'AGING · {age}min' }`
  - `age ≥ 30min` → `{ stage: 'stale', label: 'STALE · {age}min' }`
  - `updatedAt == null` → `{ stage: 'stale', label: '—' }`
  - Per-platform worst-stage path: `computeStaleness({ meta: t1, google: t2, tiktok: t3 }, now)` → returns worst stage + `{ worstPlatform: 'TikTok', worstLabel: 'TikTok stuck · 1h 47m' }`.

- [ ] **Step 2: Implement** `lib/freshness/useStaleness.ts`:

  ```ts
  export type FreshnessStage = 'fresh' | 'aging' | 'stale';
  export interface StalenessResult {
    stage: FreshnessStage;
    minutesOld: number;
    label: string;
    worstPlatform?: string;
    worstLabel?: string;
  }
  export function computeStaleness(
    input: string | null | undefined | Record<string, string | null | undefined>,
    now: number = Date.now(),
  ): StalenessResult { /* ... per spec above */ }

  import { useEffect, useState } from 'react';
  export function useStaleness(input: Parameters<typeof computeStaleness>[0]): StalenessResult {
    const [t, setT] = useState(() => Date.now());
    useEffect(() => { const id = setInterval(() => setT(Date.now()), 60_000); return () => clearInterval(id); }, []);
    return computeStaleness(input, t);
  }
  ```

- [ ] **Step 3: Append CSS** to `globals.css` (verbatim from mockup-05 lines 100–113 + the chip block):

  ```css
  :root { --motion-freshness: 600ms ease-out; }
  .glass { transition: filter var(--motion-freshness), opacity var(--motion-freshness); }
  .glass[data-freshness="fresh"] { filter: none; opacity: 1; }
  .glass[data-freshness="aging"] { filter: saturate(0.60); opacity: 0.92; }
  .glass[data-freshness="aging"]::before { opacity: 0.6 !important; filter: saturate(0.60); }
  .glass[data-freshness="stale"] { filter: saturate(0.30) brightness(0.95); opacity: 0.80; }
  .glass[data-freshness="stale"]::before { opacity: 0.3 !important; filter: saturate(0.30); }

  .fresh-chip { display: inline-flex; align-items: center; gap: 5px; font-size: 10px; font-weight: 600; padding: 2px 7px; border-radius: 4px; font-family: 'Geist Mono'; text-transform: uppercase; letter-spacing: 0.06em; }
  .fresh-chip .pulse { width: 6px; height: 6px; border-radius: 50%; background: currentColor; box-shadow: 0 0 6px currentColor; }
  .fresh-chip.live  { background: oklch(70% 0.18 145 / 0.18); color: var(--band-green); }
  .fresh-chip.aging { background: oklch(78% 0.16 75  / 0.18); color: var(--band-orange); }
  .fresh-chip.stale { background: oklch(64% 0.22 22  / 0.18); color: var(--band-red); }
  .fresh-chip.live .pulse { animation: pulse 2s ease-out infinite; }
  @keyframes pulse { 0%,100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.5; transform: scale(0.85); } }
  @media (prefers-reduced-motion: reduce) {
    .fresh-chip.live .pulse { animation: none; }
    .glass { transition: none; }
  }
  ```

- [ ] **Step 4: Run + commit.**
  ```sh
  git commit -m "$(cat <<'EOF'
  feat(ui-ux): 3-stage freshness desaturation — useStaleness + CSS contract

  data-freshness="fresh|aging|stale" applies saturate(1.0|0.60|0.30) + opacity
  (1.0|0.92|0.80) with 600ms ease-out transition. Thresholds 15min/30min per
  [[freshness-desaturation-thresholds]]. Hook reports worst-platform stage +
  label for per-card "TikTok stuck · 1h 47m" surfacing. Pulse + transition
  honor prefers-reduced-motion.

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

### Task 1.5: Semantic numeric emphasis classes + `aovEmphasis` helper

**Visual reference:** `mockup-04i-store-emphasis.html` lines 117–155 (`.cell.spend`, `.cell.revenue`, `.cell.aov-good|bad|mid`).

**Files:**
- Modify: `dashboard-web/src/app/globals.css`
- Create: `dashboard-web/src/lib/format/aovEmphasis.ts`
- Create: `dashboard-web/src/lib/__tests__/aovEmphasis.test.ts`

**Steps:**

- [ ] **Step 1: Write failing test:**
  - `aovEmphasis(80)` → `'aov-good'`
  - `aovEmphasis(45)` → `'aov-bad'`
  - `aovEmphasis(60)` → `'aov-mid'`
  - `aovEmphasis(null)` → `null` (no class applied)

- [ ] **Step 2: Implement** `lib/format/aovEmphasis.ts` (thresholds in CAD per [[ad-account-currencies]]):

  ```ts
  export type AovClass = 'aov-good' | 'aov-bad' | 'aov-mid';
  export function aovEmphasis(aovCAD: number | null | undefined): AovClass | null {
    if (aovCAD == null || Number.isNaN(aovCAD)) return null;
    if (aovCAD > 70) return 'aov-good';
    if (aovCAD < 50) return 'aov-bad';
    return 'aov-mid';
  }
  ```

- [ ] **Step 3: Append CSS** to `globals.css` (verbatim mockup-04i:117–155 + the matching label glyph injections):

  ```css
  .cell.spend   .sv { color: var(--band-red); }
  .cell.spend   .sl::before { content: '↓ '; color: var(--band-red);   opacity: 0.7; margin-inline-end: 2px; }
  .cell.revenue .sv { color: var(--band-green); }
  .cell.revenue .sl::before { content: '↑ '; color: var(--band-green); opacity: 0.7; margin-inline-end: 2px; }
  .cell.aov-good .sv { color: var(--band-green); }
  .cell.aov-good .sl::after { content: ' ▴'; color: var(--band-green); opacity: 0.8; }
  .cell.aov-bad  .sv { color: var(--band-red); }
  .cell.aov-bad  .sl::after { content: ' ▾'; color: var(--band-red);   opacity: 0.8; }
  .cell.aov-mid  .sv { color: var(--text); }
  /* CPM cells take NO emphasis class — always white. */
  ```

- [ ] **Step 4: Run + commit.**
  ```sh
  git commit -m "$(cat <<'EOF'
  feat(ui-ux): per-store semantic emphasis — spend/revenue/AOV classes + aovEmphasis()

  .cell.spend → red sv + ↓ label glyph. .cell.revenue → green + ↑.
  .cell.aov-good/.aov-bad/.aov-mid via aovEmphasis(cad) — thresholds $70/$50 CAD.
  CPM cells receive NO emphasis class — always white per [[home-visual-rules]].
  Consumed by PerStoreRow (Task 3.3).

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

### Task 1.6: Foreground stack as `text-ink*` Tailwind aliases (LCH scoped to text only)

The Phase 1 audit proposed a 3-variable LCH theme for surfaces too — that's relaxed for the glass aesthetic because surface layering now comes from `oklch(100% 0 0 / N%)` glass stops, not from LCH-derived dark overrides. The remaining LCH-style benefit is the **foreground stack** — keep `--text`, `--text-2`, `--text-muted`, `--text-subtle` as a single hue-rotated scale.

**Files:**
- Modify: `dashboard-web/tailwind.config.ts` (add `colors.ink.{primary,secondary,muted,subtle}` mapping to those 4 vars)
- Test: extend `glassTokens.test.ts` with the 4 text vars + assert Tailwind aliases compile (run `npx tailwindcss -i src/app/globals.css -o /tmp/out.css` and grep for `--text`).

**Steps:**

- [ ] **Step 1: Add aliases** to `tailwind.config.ts`:
  ```ts
  ink: {
    DEFAULT:   'var(--text)',
    secondary: 'var(--text-2)',
    muted:     'var(--text-muted)',
    subtle:    'var(--text-subtle)',
  },
  ```

- [ ] **Step 2: Verify** every consumer of `text-text-*` (still present after Task 1.2 codemod) reads through `text-ink-*`.

- [ ] **Step 3: Commit.**
  ```sh
  git commit -m "$(cat <<'EOF'
  feat(ui-ux): text-ink-{primary,secondary,muted,subtle} aliases for the foreground stack

  Single OKLCH ramp (h 80→250) for all text. Replaces the v1 plan's full
  3-variable LCH theming (relaxed because surface layering now uses translucent
  glass stops, not LCH-derived dark overrides).

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

### Task 1.7: Blur + shadow token additions for glass / sheet / overlay

**Visual reference:** `mockup-04-final.html:91-98` (`.glass` shadow stack) and `mockup-03-primitives-glass.html` `.sheet-panel` for the `--blur-sheet` value.

**Files:**
- Modify: `dashboard-web/src/app/globals.css` (already added `--blur-glass` + `--blur-sheet` in Task 1.1; this task adds the shadow stack tokens)
- Modify: `dashboard-web/tailwind.config.ts` (replace `boxShadow` scale with 3 blessed shadows)

**Steps:**

- [ ] **Step 1: Add tokens to `:root`** in `globals.css`:

  ```css
  --shadow-glass: 0 1px 0 0 oklch(100% 0 0 / 0.07) inset, 0 12px 24px -10px oklch(0% 0 0 / 0.35);
  --shadow-overlay: 0 8px 20px -6px oklch(0% 0 0 / 0.5);
  --shadow-sheet:   0 24px 48px -16px oklch(0% 0 0 / 0.6), 0 1px 0 0 oklch(100% 0 0 / 0.06) inset;
  ```

- [ ] **Step 2: Replace** `tailwind.config.ts` boxShadow scale with:
  ```ts
  boxShadow: { glass: 'var(--shadow-glass)', overlay: 'var(--shadow-overlay)', sheet: 'var(--shadow-sheet)' }
  ```

- [ ] **Step 3: Codemod consumers** — `shadow-sm` / `shadow-card` / `shadow-elevated` / `shadow-md` → `shadow-glass`. Tooltips/popovers → `shadow-overlay`. Sheet/Dialog → `shadow-sheet`. Sweep ~18 sites; run `npm run lint && npm test`.

- [ ] **Step 4: Commit.**
  ```sh
  git commit -m "$(cat <<'EOF'
  feat(ui-ux): glass/overlay/sheet shadow tokens; collapse shadow scale to 3

  --shadow-glass stacks an inset highlight + soft drop for cards. --shadow-overlay
  for tooltips/popovers. --shadow-sheet for drawers + dialogs. ~18 shadow-sm /
  shadow-card / shadow-elevated sites migrate.

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

### Task 1.8: Spacing, motion, radius scales

**Files:**
- Modify: `dashboard-web/src/app/globals.css`
- Modify: `dashboard-web/tailwind.config.ts`

**Steps:**

- [ ] **Step 1: Add tokens** to `:root`:

  ```css
  --space-1: 0.25rem; --space-2: 0.5rem; --space-3: 0.75rem;
  --space-4: 1rem;    --space-5: 1.25rem; --space-6: 1.5rem;
  --space-8: 2rem;    --space-10: 2.5rem; --space-12: 3rem;

  --motion-snap: 120ms;
  --motion-fast: 180ms;
  --motion-base: 240ms;
  --motion-slow: 320ms;
  --motion-large: 480ms;
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);

  --radius-control: 0.5rem;
  --radius-chip:    0.375rem;
  --radius-card:    0.875rem;   /* 14px to match mockup glass radius */
  --radius-hero:    1rem;
  --radius-pill:    9999px;
  ```

- [ ] **Step 2: Wire** `transitionDuration`, `transitionTimingFunction`, `borderRadius` blocks in `tailwind.config.ts` to consume the vars.

- [ ] **Step 3: Commit.**
  ```sh
  git commit -m "$(cat <<'EOF'
  feat(ui-ux): semantic spacing/motion/radius token scales

  --space-1..12, --motion-snap/fast/base/slow/large + --ease-out, --radius
  -control/chip/card/hero/pill. card radius = 14px matches mockup glass
  `border-radius` for ::before bar alignment.

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

### Task 1.9: `PageScope` primitive

**Files:**
- Create: `dashboard-web/src/components/ui/PageScope.tsx`
- Create: `dashboard-web/src/components/ui/__tests__/PageScope.test.tsx`

**Steps:**

- [ ] **Step 1: Write failing DOM test** asserting `<PageScope store="uzoshop" platform="Meta" rangeLabel="30 ימים" currency="CAD" />` renders 4 `[data-scope-item]` children in RTL read order (store first), store wrapped in `<bdi dir="ltr">`.

- [ ] **Step 2: Implement** the primitive:

  ```tsx
  export function PageScope({ store, platform, rangeLabel, currency = 'CAD', extra, className }: PageScopeProps) {
    return (
      <div className={cn('mt-1 flex items-center gap-2 text-xs text-ink-muted tabular-nums', className)} role="status" aria-label="scope">
        <span data-scope-item><bdi dir="ltr">{store}</bdi></span>
        {platform && (<><span aria-hidden>•</span><span data-scope-item><bdi dir="ltr">{platform}</bdi></span></>)}
        <span aria-hidden>•</span>
        <span data-scope-item>{rangeLabel}</span>
        <span aria-hidden>•</span>
        <span data-scope-item><bdi dir="ltr">{currency}</bdi></span>
        {extra && (<><span aria-hidden>•</span>{extra}</>)}
      </div>
    );
  }
  ```

- [ ] **Step 3: Commit.** The chart-section date-range picker (Task 3.X) is its own component — NOT PageScope. PageScope is consumed by every top-level page header in Wave 5 Task 5.9.

  ```sh
  git commit -m "$(cat <<'EOF'
  feat(ui-ux): PageScope primitive — scope line under every page H1

  Store / platform / range / currency in RTL read order. store name wrapped in
  <bdi>. Consumed in Wave 5 Task 5.9. Date-range picker on the ROAS chart is a
  separate component (RoasTargetChart in Task 3.X).

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

### Task 1.10: Resolve 7 platform/status color collisions (tests)

**Files:**
- Modify: `dashboard-web/src/app/globals.css` (annotation tokens — collisions 4-6)
- Test: `dashboard-web/src/lib/__tests__/colorCollisions.test.ts`

**Steps:**

- [ ] **Step 1: Write failing test** enumerating the 7 pairs from §2.1, asserting ΔH ≥ 13° at matched L for each pair using the new tokens.

- [ ] **Step 2: Resolve collisions** — collisions 1-3 already resolved by Task 1.1 (TikTok=12 / Google=90 / Shopify-as-category). Collisions 4-6 require annotation re-hue: `--annotation-sale: oklch(72% 0.20 320)`, `--annotation-creative: oklch(75% 0.14 180)`, `--annotation-launch: oklch(70% 0.18 145)`; rotate `--store-usm` from 330 → if it collides with sale, accept (different surface — store name vs. chart pin). Collision 7 resolved by accent hue 280 ≠ status-info 240.

- [ ] **Step 3: Run + commit.**
  ```sh
  git commit -m "$(cat <<'EOF'
  fix(ui-ux): 7 platform/status color collisions resolved + regression test (P0-2)

  Annotation hues rotated to clear platform + store hues. Test enforces ΔH ≥
  13° per pair so future token tweaks cannot regress. Six of seven resolved by
  Tasks 1.1+1.2; collisions 4-6 fixed here.

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

### Task 1.11: Consolidate store-color maps (4 sources → 1)

**Files:**
- Modify: `dashboard-web/src/lib/storeColors.ts` (single source — reads from `--store-uzo/usm/s3` tokens)
- Modify: `dashboard-web/src/lib/format.ts` (delete `STORE_HUES`, `storeBadgeHex`, `STORE_HEX_LIGHT`; re-export from `storeColors`)
- Modify (consumers): `grep -rn "STORE_HUES\|storeBadgeHex\|STORE_HEX_LIGHT" dashboard-web/src/`
- Test: `dashboard-web/src/lib/__tests__/storeColors.test.ts`

**Steps:**

- [ ] **Step 1: Inventory + write failing test** asserting `format.ts` no longer exports `STORE_HUES` / `storeBadgeHex` and that `storeColors.storeColor('uzoshop')` returns `var(--store-uzo)`.
- [ ] **Step 2: Extend `storeColors.ts`** to expose `storeColor(slug)`, `storeBadge(slug)`. Delete duplicates from `format.ts`. Update consumers.
- [ ] **Step 3: Run + commit** with conventional message + Co-Authored-By trailer.

---

## Wave 2 — Primitive Enforcement

> Wave 2 codemod targets the same files v1 listed. Visual treatment uses the new glass + neon tokens.

### Task 2.1: Sweep raw `<button>` survivors

**Steps:** `grep -rn "eslint-disable.*no-raw-button" dashboard-web/src/` → for each disabled site, replace with `<Button>` + remove the disable line. Run lint → green. Commit.

### Task 2.2: `TableBase` migration + lint rule

**Visual reference:** `mockup-03-primitives-glass.html` `.table` block — sticky `thead` with `background: var(--glass-3); backdrop-filter: blur(20px);`.

**Files (9 sites):** `CohortComparisonPanel.tsx`, `ProductsTable.tsx`, `ProductCentricView.tsx`, `AdSetTable.tsx`, `MetaShopifyReconciliation.tsx`, `CampaignsTable.tsx`, `DetailTable.tsx`, `MonthlyTables.tsx` (2), `PnLBreakdown.tsx`, `AdsDrawer.tsx`, `operator/CronTickSnapshotsViewer.tsx`, `operator/JobsTable.tsx`.

**Steps:**

- [ ] **Step 1: Extend `TableBase`** with `minWidth`, `density`, `stickyHeader` props (per v1 plan). Sticky-header CSS in `globals.css`:
  ```css
  table[data-sticky-header] thead th {
    position: sticky; top: 0; z-index: 5;
    background: var(--glass-3); backdrop-filter: var(--blur-glass);
  }
  ```
  This fixes the documented `CampaignsTable:2027` missing-sticky bug.

- [ ] **Step 2: Codemod** all 9 sites — `<table className="...min-w-[N]...">` → `<TableBase minWidth={N} stickyHeader>`. Preserve `thead`/`tbody`.

- [ ] **Step 3: Add ESLint rule** `no-raw-table-in-components.js`. Register at `'error'`.

- [ ] **Step 4: Run + commit.**

### Task 2.3: Unify `Stat` (3 forks → primitive)

Extend `Stat` CVA with `density: 'compact'|'regular'|'hero'`, `prefix`, `chip`, `active`, `delta` per v1 plan. Apply glass treatment (`bg: var(--glass-2)`, `border: 1px solid var(--glass-edge)`, `box-shadow: var(--shadow-glass)`). Migrate `CampaignsTable.tsx:2490`, `AdsDrawer.tsx:543`, `CampaignDrawer.tsx:1575,1581` (`DrawerStat`), `ProductsTable.tsx:897`, `HeroOverview.tsx:650-707` (`FloatingKpi` → `Stat density="hero"`). Run + commit.

### Task 2.4: Migrate 9 hand-rolled cards → `Card` (glass)

**Visual reference:** `mockup-04-final.html:91-98` glass card stack.

`Card` primitive default class string: `'glass rounded-card p-5'`. `Card` accepts `band?: 'red'|'orange'|'green'|'blue'|'gray'` and `freshness?: 'fresh'|'aging'|'stale'` props that forward to `data-band` / `data-freshness` attributes — so any Card consumer can opt into V4 band + freshness desaturation via two props.

Codemod sweep: `InsightsBoard.tsx:222`, `KpiCards.tsx:280-285`, `GoalTracker.tsx` (3), `PerStoreCards.tsx`, `HealthScorePanel.tsx`, `CommandPalette.tsx:514`, `TodayLive.tsx:103-120`, `Filters.tsx:70`. Run + commit.

### Task 2.5: `Sheet`/`Dialog` migration + close-X z-index + glass+neon treatment

**Visual reference:** `mockup-03-primitives-glass.html` `.sheet-panel` — `background: linear-gradient(180deg, var(--glass-3) 0%, var(--glass-2) 100%); backdrop-filter: var(--blur-sheet); box-shadow: var(--shadow-sheet);` plus a glass-edge highlight on the opening edge.

Add `Sheet.Header`/`Sheet.Body`/`Sheet.Footer` compound exports. Bump `SheetClose` z-index from auto → `z-20` (fixes the close-X-hidden-behind-sticky-header bug P0-12). Migrate `CampaignDrawer.tsx:800`, `AdsDrawer.tsx:341-350`, `BillingSettings.tsx`. Run + commit.

### Task 2.6: Mount `TooltipProvider` + 53 `title=` → `<Tooltip>` + lint rule

Per v1 plan. Provider wraps app in `layout.tsx` (`delayDuration={300} skipDelayDuration={150}`). Codemod 53 `title=` sites. Add `no-native-title-tooltip.js`. Run + commit.

### Task 2.7: Raw `<input>`/`<select>`/`<textarea>` → primitives + lint rule

Per v1 plan. `Input` primitive extends with `prefix`, `suffix`, `error`; `dir="auto"` default for type=text/search/textarea (carried over from v1 Task 4.7). Add `no-raw-input-in-components.js`. Sweep BillingSettings, Filters, MonthSelector, YearSelector, operator forms. Run + commit.

### Task 2.8: `Typography` primitive — `Heading` + `Text`

Per v1 plan (CVA shape unchanged). 5+ H2 patterns collapse to `Heading level={display|hero|section|panel|label}`. Sweep ~14 files. Run + commit.

### Task 2.9: `PlatformBadge` primitive

Per v1 plan. Consumes `--chart-platform-{meta|google|tiktok|organic|shopify}`. Replaces 6 inline `PlatformChip` definitions. Run + commit.

### Task 2.10: Lint enforcement consolidation + `no-restricted-imports` for Radix

Promote all 8 enforcement rules to `'error'`: `no-raw-button-in-components`, `no-raw-table-in-components`, `no-raw-input-in-components`, `no-native-title-tooltip`, `no-legacy-tailwind-class`, `no-cross-palette-import`, `no-physical-direction-in-components` (added Wave 4), `no-emoji-in-jsx` (added Wave 5). Add `no-restricted-imports` blocking `@radix-ui/react-*` outside `components/ui/`. Run + commit.

### Task 2.11: `Button` focus-ring fix + sweep 14 `focus:outline-none` sites

Per v1 plan. Primary/destructive variants get contrast ring (accent-fg outer, accent inner). 14 sweep sites append `focus-visible:ring-2 focus-visible:ring-accent`. The violet `--accent` (h 280) already matches the new aesthetic — no further changes. Run + commit.

---

## Wave 3 — Home Recompose + Synthesis Layer

> Wave 3 ships the new Home structure (mockup-04-final) + the `RoasTargetChart` + per-store semantic emphasis + the per-page TL;DR sentence.

### Task 3.1: Home recompose — full structure per mockup-04-final

**Visual reference:** `mockup-04-final.html` — read the whole file before starting.

**Locked section order** (per [[home-visual-rules]]):
1. Header: crumb + live pill + H1 + range tabs + scope line.
2. Hero strip — 2 rows × 3 cards: row 1 = `CommandCenterHero` Net Profit (featured, banded) + Spend + Revenue; row 2 = ROAS (banded) + Orders + CPM.
3. **Per-store row** (3 stores · ROAS · semantic emphasis · per-platform CPM) — `<PerStoreRow>`.
4. **ROAS-vs-target chart section** — `<RoasTargetChart>` (full-width glass card with section header containing scope text + pin count chip + date-range picker on the right).
5. Insights board (`<InsightsBoard>` — promoted to first-class section) + activity feed (`<ActivityFeed>`) in a 2-up bottom row.

**Files:**
- Modify: `dashboard-web/src/components/Dashboard.tsx` (Home page composer ~lines 389-436)
- Create: `dashboard-web/src/components/home/CommandCenterHero.tsx` (replaces `HeroOverview` + `HomeLiveBand` + `HomeSummaryBand` + `KpiCards` hero tiles)
- Create: `dashboard-web/src/components/home/PerStoreRow.tsx` (replaces `HomePerStoreBand`/`PerStoreCards` for the Home placement)
- Create: `dashboard-web/src/components/home/RoasTargetChart.tsx` (NEW — see Task 3.2)
- Create: `dashboard-web/src/components/home/ActivityFeed.tsx` (extract from existing `StatusEventsFeed` etc.)
- Modify: `dashboard-web/src/components/InsightsBoard.tsx` (consumes new `Card` glass treatment)
- Delete: `HomeLiveBand.tsx`, `HomeSummaryBand.tsx`, `KpiCards.tsx` (their data flows merge into CommandCenterHero per the metric-map table in v1 plan Task 3.1)

**Metric-mapping table** (per [[no-info-loss-across-tabs]] — every prior metric still surfaces):

| Metric | OLD location(s) | NEW location |
|---|---|---|
| ROAS (period) | TodayLive, HeroOverview, KpiCards | `CommandCenterHero` row 2 (banded, hero size) |
| Net Profit (period) | KpiCards, HeroOverview | `CommandCenterHero` row 1 (featured + banded) |
| Revenue (period) | TodayLive, HeroOverview, KpiCards | `CommandCenterHero` row 1 secondary |
| Spend (period) | TodayLive, HeroOverview, KpiCards | `CommandCenterHero` row 1 secondary |
| Gross Profit | TodayLive, KpiCards | `RoasTargetChart` KPI strip (Revenue/ROAS/Spend/Net/CPM) — Gross folds under Net's tooltip |
| COGS | KpiCards | P&L page only (no info loss — present on P&L) |
| CPM | TodayLive, HeroOverview | `CommandCenterHero` row 2 + per-store row per-platform |
| Orders | TodayLive | `CommandCenterHero` row 2 |
| Goal % | GoalTracker (P&L) | **STAYS on P&L** per Q8 |

**Steps:**

- [ ] **Step 1: Build `<CommandCenterHero>`.** Two-row glass card grid. Net Profit card uses `<Card band={netBand} ...>` where `netBand = useRoasBandGradient(roas)`. Featured card has `.v.banded` ROAS number; secondary cards use neutral white `.v.neutral`. Per-card freshness via `<Card band="..." freshness={fresh}><Card.Header><FreshnessBadge .../></Card.Header>...</Card>`.

- [ ] **Step 2: Build `<PerStoreRow>`** — see Task 3.3.

- [ ] **Step 3: Build `<RoasTargetChart>`** — see Task 3.2.

- [ ] **Step 4: Build `<ActivityFeed>`** — extract `StatusEventsFeed` from operator into a generic Home consumer + filter to "events affecting current scope".

- [ ] **Step 5: Rewire `Dashboard.tsx` Home section** to:
  ```tsx
  <section>
    <Heading level="hero">בית</Heading>
    <PageScope store={...} platform={...} rangeLabel={...} />
  </section>
  <CommandCenterHero filters={filters} />
  <PerStoreRow filters={filters} />
  <RoasTargetChart filters={filters} />
  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
    <InsightsBoard ... />
    <ActivityFeed ... />
  </div>
  ```

- [ ] **Step 6: Run `npm test && npm run test:components`. Commit.**

### Task 3.2: `<RoasTargetChart>` component

**Visual reference:** `mockup-04h-roas-chart-section.html` end-to-end + `mockup-04-final.html` lines 141–198 (chart SVG + pin + tooltip + footer).

Full-width glass card placed between `PerStoreRow` and the 2-up bottom row. Composition:

1. **Section header** — left side: TL;DR sentence (authoritative Hebrew, accent-coloured number per band), eyebrow subtitle "מטרה 3.0 · 30 ימים אחרונים". Right side: scope text (mono, uppercase) + pin-count chip ("3 ציוני דרך") + **date-range picker** (presets `7 / 30 / 90 / MTD / QTD / YTD / custom`; custom opens shadcn DatePicker primitive; URL query param `?chartRange=30` persistence; default 30 days; INDEPENDENT of page-level range tabs).
2. **5-up KPI strip** inside the card: Revenue / ROAS / Spend / Net / CPM. ROAS tile is the only one tinted (band colour).
3. **Chart** — SVG, height 200px. Dashed target line at 3.0 (`stroke: var(--band-green); stroke-dasharray: 4 4; opacity: 0.7`). Daily ROAS line (white stroke, 2px). Min/max dots (max=green, min=red). Annotation pins (💰) anchored to date — visible always but tooltips **hover-only and click-only** (mouse-leave / click-elsewhere dismiss; touch tap-to-open, tap-elsewhere-to-dismiss). Hovering a data point shows a small tooltip with ROAS + date.
4. **Footer strip** — prev-period comparison (e.g., "תקופה קודמת: ROAS 2.84 · −5%"), cumulative revenue, days active.

**Files:**
- Create: `dashboard-web/src/components/home/RoasTargetChart.tsx`
- Create: `dashboard-web/src/components/home/RoasChartDateRangePicker.tsx` (uses shadcn `DatePicker` primitive for custom; preset buttons for 7/30/90/MTD/QTD/YTD)
- Create: `dashboard-web/src/lib/synthesis/roasChart.ts` (TL;DR generator for the chart's range)
- Create: `dashboard-web/src/components/home/__tests__/RoasTargetChart.dom.test.tsx`

**Steps:**

- [ ] **Step 1: Write failing DOM tests.** (a) renders TL;DR sentence; (b) renders 5 KPI tiles; (c) default range 30 days; (d) clicking 7-day preset updates `?chartRange=7` query param and triggers re-render with new data; (e) clicking a pin opens its tooltip; (f) clicking elsewhere closes the tooltip; (g) hover-only state — tooltip not visible on initial render; (h) custom-range option opens DatePicker.

- [ ] **Step 2: Implement `RoasChartDateRangePicker`.** Preset buttons + custom (DatePicker). Reads + writes `?chartRange` URL param via existing `lib/urlState`.

- [ ] **Step 3: Implement `synthesizeRoasChart({ points, range, target })`** returning `{ text, anchorMetric, confidence }`. Authoritative Hebrew per Q6: "ROAS ירד 8% השבוע. עיקר הירידה ב-Meta של uzoshop." Sanity-guard: skip if <3 points; clamp to 1 decimal.

- [ ] **Step 4: Implement `<RoasTargetChart>`** — use the SVG structure verbatim from `mockup-04-final.html:141-198` (grid lines, target, line, dots, pins). Hover and click handlers managed via `useState({ openPin: id | null })`. Card wrapped in `<Card>` (no band on this card — it's neutral; the inner ROAS KPI tile has its own band).

- [ ] **Step 5: Run + commit.**
  ```sh
  git commit -m "$(cat <<'EOF'
  feat(ui-ux): RoasTargetChart — TL;DR + 5-up KPI strip + chart with pins + date picker

  Full-width glass card between PerStoreRow and bottom 2-up. TL;DR uses authoritative
  Hebrew (Q6). Pin tooltips hover-only and click-only per [[home-visual-rules]].
  Date-range picker (7/30/90/MTD/QTD/YTD/custom) is independent of page-level
  range tabs; persists via ?chartRange URL param; default 30 days.

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

### Task 3.3: `<PerStoreRow>` — semantic emphasis bindings + per-platform CPM

**Visual reference:** `mockup-04i-store-emphasis.html` end-to-end + `mockup-04-final.html` per-store row.

Per-store grid (3 stores). Each store card uses `<Card band={useRoasBandGradient(store.roas)}>`. Inside each card, the 4-up metric grid `[הוצאה, הכנסה, הזמנות, AOV]` and a per-platform CPM row.

**Per-cell class binding:**
- Spend cell: `className="cell spend"`.
- Revenue cell: `className="cell revenue"`.
- Orders cell: `className="cell"` (neutral; no emphasis class).
- AOV cell: `className={cn('cell', aovEmphasis(aovCAD))}` — pulls from the helper in Task 1.5.
- Per-platform CPM cells: `className="cell"` (neutral always, no emphasis — explicitly **never** colored by value).

**Files:**
- Create: `dashboard-web/src/components/home/PerStoreRow.tsx`
- Create: `dashboard-web/src/components/home/__tests__/PerStoreRow.dom.test.tsx`

**Steps:**

- [ ] **Step 1: Write failing DOM tests.** Render with 3 mock stores. Assert: (a) Spend cell has class `cell spend`; (b) Revenue cell has `cell revenue`; (c) AOV cell with $80 → `cell aov-good`; (d) AOV cell with $45 → `cell aov-bad`; (e) AOV cell with $60 → `cell aov-mid`; (f) CPM cells have only `cell` (no emphasis classes); (g) Card carries `data-band` matching `useRoasBandGradient(store.roas).band`.

- [ ] **Step 2: Implement** `PerStoreRow.tsx`. Wires `useRoasBandGradient` per store + `aovEmphasis` for AOV cell + neutral CPM. Click on the card → drill to Campaigns tab pre-filtered by store (via `urlState`).

- [ ] **Step 3: Run + commit.**

### Task 3.4: Wire Home cards as drill-down entry points

Carry over from v1 plan Task 3.4 — `onDrill` prop on `<Card>` opens Campaigns tab via `urlState` with the store / platform pre-applied. Keyboard `Enter` triggers the same drill. Apply to CommandCenterHero secondary tiles + PerStoreRow cards. Commit.

### Task 3.5: Per-page TL;DR synthesis layer

Per v1 plan (`lib/synthesis/{trends,archive,detail,pnl}.ts` + `synthesizeRoasChart` already lives at `lib/synthesis/roasChart.ts` from Task 3.2). New `<PageSynthesis>` UI primitive renders sentence in `<Heading level="section">` style; hidden when `text === ''`; dimmed at `confidence === 'low'`. Wire into Trends/Archive/Detail/P&L page headers under the H1 (the Home TL;DR lives inside `RoasTargetChart`; never duplicate). Run + commit.

### Task 3.6: `FreshnessBadge` consumer wiring (the hook + CSS already exist in Task 1.4)

**Files:**
- Create: `dashboard-web/src/components/ui/FreshnessBadge.tsx`
- Modify: `Card` primitive to accept `freshness?: 'fresh'|'aging'|'stale'` prop, forward as `data-freshness`
- Modify: every Card consumer in Wave 2 Task 2.4 → pass `freshness` from `useStaleness(data.updatedAt)`
- Modify: per-card pipe — CommandCenterHero, PerStoreRow, RoasTargetChart all read `data_freshness` (already in Supabase per `[[freshness-phase-a-shipped]]`)

**Steps:**

- [ ] **Step 1: Implement `<FreshnessBadge updatedAt={...} platformBreakdown={?}>`** — renders `<span class="fresh-chip {stage}"><span class="pulse" />{label}</span>` where `label` = "LIVE · 8s" / "AGING · 22min" / "STALE · 47min" or "TikTok stuck · 1h 47m" if `worstLabel` present.

- [ ] **Step 2: Wire `freshness` prop** through `Card` to `data-freshness` attribute on the rendered `<div class="glass">`. The CSS rules from Task 1.4 do the rest.

- [ ] **Step 3: Plumb freshness data** from existing per-card data fetches into the new `freshness` prop. Reuse the `data_freshness` lookup helper from `[[freshness-phase-a-shipped]]`.

- [ ] **Step 4: DOM test** asserts the badge stage matches the hook output + card carries `data-freshness="..."`.

- [ ] **Step 5: Commit.**

---

## Wave 4 — RTL Sweep & Bidi P0 Fixes

(Unchanged from v1 — the codemods only touch class strings and JSX text. Primitive APIs are stable from Wave 2.)

### Task 4.1: Fix `→` arrows in `CampaignsTopList:81-89` verdicts → Lucide `ArrowLeft`. Test + commit.

### Task 4.2: `<bdi>`-wrap mixed Hebrew/English interpolations — `CommandPalette:273,322`, `AdsDrawer:336,459`, `CampaignsTopList:54,104`. Extend `bidi.dom.test.tsx`. Commit.

### Task 4.3: 12-site hand-built `CAD ${n}` → `fmtMoney` (ReactElement) / `fmtMoneyString` (string) split

Carries over from v1 plan Task 4.3 — full file list intact. Reconciles `lib/utils.ts` vs `lib/format.ts` bifurcation. Commit.

### Task 4.4: Codemod 47 physical-direction Tailwind classes → logical

Run `dashboard-web/scripts/codemod-physical-to-logical.mjs` per v1 plan. Replacement table (ml→ms, mr→me, pl→ps, pr→pe, left→start, right→end, border-l/r→border-s/e, rounded-l/r→rounded-s/e, text-right/left→text-end/start) unchanged. Commit.

### Task 4.5: ESLint `no-physical-direction-in-components` rule. Register at `'error'`. Commit.

### Task 4.6: `ChartContainer` defaults `dir="ltr"`; remove explicit overrides. Commit.

### Task 4.7: `Input` primitive defaults `dir="auto"` for text/search/textarea. Commit. (Folded into Wave 2 Task 2.7 — verify done there; this step is the cross-check.)

### Task 4.8: Sidebar collapse chevron — `PanelRightOpen`/`PanelRightClose` (logical, replaces `ChevronsLeft`/`ChevronsRight`). Commit.

### Task 4.9: Extend `bidi.dom.test.tsx` regression coverage to 6 swept components. Commit.

---

## Wave 5 — Per-Page Polish + CampaignDrawer Split + Slim Sidebar

### Task 5.1: Operator default Health tab + `StatusPill` (per v1). Commit.

### Task 5.2: Unify Operator refresh paradigms — 15s SWR across 4 sub-tabs + manual Refresh button (per v1). Commit.

### Task 5.3: Fix `AnalysisArchiveTab` silently ignoring global store filter (per v1 P0-15). Commit.

### Task 5.4: Migrate 4 hand-rolled `<details>` to `CollapsibleSection` (per v1 P1-8). Commit.

### Task 5.5: Split `CampaignDrawer` into 6 sub-tabs — single hard cut + glass+neon Sheet treatment

**Visual reference:** `mockup-03-primitives-glass.html` `.sheet-panel` for the glass treatment; v1 Task 5.5 for the 6 sub-tab decomposition.

Per v1 plan Task 5.5 (Overview / Daily / AdSets / Ads / Status / History). Apply the new `Sheet.Header` (sticky, glass) from Wave 2 Task 2.5. Manual test checklist for Q10 hard cut intact. Per-campaign drawer hero binds to `useRoasBandGradient(campaign.roas)` per [[roas-state-gradient]] — drawer header card carries `data-band`. Commit.

### Task 5.6: `InsightActions` — drawer-default + Ads Manager deep-link (per v1 Q7, 6 panels). Commit.

### Task 5.7: Fix `AdsDrawer` silent error swallowing — throw on `!r.ok` + render error state (per v1 P0-9). Commit.

### Task 5.8: Slim 72px icon-rail sidebar — hover-to-expand + pin + `⌘\\` shortcut

**Visual reference:** `mockup-06-sidebar.html` end-to-end.

**Files:**
- Modify: `dashboard-web/src/components/Sidebar.tsx`
- Create: `dashboard-web/src/lib/hooks/useSidebarPin.ts`
- Modify: `dashboard-web/src/components/__tests__/sidebarHoverState.dom.test.tsx`

**Steps:**

- [ ] **Step 1: Default collapsed = 72px.** Reads `sidebar:pinned` from localStorage; if `true`, render in 220px pinned-expanded state.

- [ ] **Step 2: Hover-to-expand.** `onMouseEnter` after 200ms delay → temporarily expand to 220px. `onMouseLeave` → collapse (unless pinned). Width transitions at `transition: width 200ms ease-out`.

- [ ] **Step 3: Pin button** in sidebar footer (Lucide `Pin`/`PinOff` icons). Toggle writes `sidebar:pinned` localStorage. Pinned state is the sticky preference; hover is ephemeral.

- [ ] **Step 4: `⌘\\` keyboard shortcut** — registered globally via existing keyboard helpers (or `useEffect` + `keydown` listener on `document`). Toggles `pinned`. Cmd+\\ on macOS, Ctrl+\\ on Windows/Linux.

- [ ] **Step 5: Collapsed-state tooltip** — `<Tooltip>` on each rail icon shows the label + shortcut text (e.g., `<bdi dir="ltr">⌘1</bdi>`).

- [ ] **Step 6: DOM tests** — assert collapsed default; hover expands after 200ms; click on Pin persists `sidebar:pinned=true`; `⌘\\` triggers toggle; collapsed-state hover shows tooltip with label + shortcut.

- [ ] **Step 7: Commit.**

### Task 5.9: Apply `<PageScope>` to every top-level page header (per v1). Commit.

### Task 5.10: Kill emoji + Lucide mix + lint rule (per v1 P1-14). Commit.

### Task 5.11: Regression test — GoalTracker stays on P&L (per v1 Q8). Commit.

### Task 5.12: Confirm gate on `WhatsappTestButtons` (per v1 P0-17). Commit.

---

## Wave 6 — Motion Vocabulary + Visual Regression CI

### Task 6.1: Motion vocabulary applied across primitives + new glass-aesthetic animations

**Files:** `tailwind.config.ts`, `Sheet.tsx`, `globals.css`, `Card` hover styles, `RoasTargetChart` pin tooltip transition.

**Steps:**

- [ ] **Step 1: Codify Tailwind utilities** — `duration-{snap|fast|base|slow|large}` (already done in Task 1.8).

- [ ] **Step 2: Apply per-component:**
  - **Page background conic-gradient** — 60s linear rotation (already in Task 1.1).
  - **V4 band signal entrance** — when a card enters the viewport for the first time, fade-in + scale `0.98 → 1.0` over 300ms ease-out. Implement via `[data-band]:not([data-mounted])` initial state + a `useLayoutEffect` that flips `data-mounted` on next frame.
  - **Freshness `filter` transition** — already 600ms ease-out via the `.glass` transition in Task 1.4.
  - **Sidebar width** — 200ms ease-out (already in Task 5.8).
  - **Card hover** — `transform: translateY(-2px)` over 120ms ease-out.
  - **Pin tooltip** — opacity 120ms + 4px Y translate (matches `mockup-04-final.html:179-191`).
  - **Sheet entrance** — `--motion-base` (240ms).
  - **Tab content swap** — `--motion-snap` (120ms).
  - **Drawer fullscreen toggle** — `--motion-large` (480ms).

- [ ] **Step 3: Commit.**

### Task 6.2: Honor `prefers-reduced-motion: reduce`

Already covered piecemeal (conic-gradient in Task 1.1, freshness in Task 1.4, freshness pulse in Task 1.4). Extend the global `@media (prefers-reduced-motion: reduce)` block in `globals.css` to also kill: card-hover translate, pin-tooltip transitions, sheet entrance keyframes, V4 entrance scale. Commit.

### Task 6.3: Playwright + image-snapshot visual-regression CI

**Files:** `dashboard-web/package.json`, `dashboard-web/playwright.config.ts`, `dashboard-web/tests/visual/pages.spec.ts`, `dashboard-web/tests/visual/states.spec.ts`, `.github/workflows/visual.yml`.

**Setup** per v1 plan — `@playwright/test` install, scripts, config (dark colorScheme only — single-mode app), webServer block.

**Required snapshot list** (must all be present in baseline):

| Snapshot | Coverage |
|---|---|
| `home.png` | Full Home page (CommandCenterHero + PerStoreRow + RoasTargetChart + InsightsBoard + ActivityFeed) |
| `home-pnls-tab.png` | P&L page (GoalTracker still present) |
| `home-trends.png` | Trends page (with PageSynthesis) |
| `home-archive.png` | Archive page |
| `home-detail.png` | Detail page |
| `home-campaigns.png` | Campaigns page (sticky table header visible) |
| `home-products.png` | Products page |
| `operator-{sync,health,activity,danger}.png` | All 4 sub-tabs |
| **States subfolder:** | |
| `freshness-fresh.png` | Card with `data-freshness="fresh"` |
| `freshness-aging.png` | Card with `data-freshness="aging"` |
| `freshness-stale.png` | Card with `data-freshness="stale"` |
| `freshness-missing.png` | Card with `data-band="gray"` (no data) |
| `band-red.png` / `band-orange.png` / `band-green.png` / `band-blue.png` | All 4 band states |
| `perstore-aov-good.png` / `perstore-aov-bad.png` / `perstore-aov-mid.png` | All 3 AOV states |
| `sidebar-collapsed.png` / `sidebar-expanded.png` | Both sidebar states |
| `roas-chart-pin-hover.png` | Chart with a pin tooltip visible (hover state) |
| `roas-chart-datepicker-open.png` | Chart with the custom date picker open |
| `primitives.png` | `/dev/primitives` canvas showing every primitive in every state |

Snapshots generated on a clean post-Wave-5 worktree via `npm run test:visual:update`. Commit `__snapshots__/` directory. CI workflow runs on every PR; failure uploads HTML report.

Run + commit.

### Task 6.4: User Manual 2.5.0

Per v1 plan. Add: new section order (CommandCenterHero / PerStoreRow / RoasTargetChart / 2-up); RoasTargetChart with annotation pins (hover-only + click-only); date-range picker on the chart; per-store semantic emphasis (Spend red↓ / Revenue green↑ / AOV conditional / CPM white); 3-stage freshness (LIVE/AGING/STALE); slim sidebar with hover + pin + `⌘\\`; brand-mirrored chart palette; GoalTracker stays on P&L (no change). Commit.

### Task 6.5: ARCHITECTURE.md §27

Per v1 plan. Add: glass+neon token system (canvas, glass layers, V4 band data-attribute contract, freshness data-attribute contract, semantic emphasis classes, motion vocab); 8 ESLint enforcement rules + `no-restricted-imports`; `lib/synthesis/` module; `useStaleness` + `FreshnessBadge` + `useRoasBandGradient` + `aovEmphasis` helpers; Playwright visual-regression CI gate; sidebar pin state contract. Commit.

---

## Rollout Notes

### Wave dependencies

- **Wave 1 blocks all others** — tokens, glass system, band signal, freshness CSS, semantic classes, accent + chart palette are the substrate. **Do not ship Wave 1 to main until Task 6.3 (visual regression baseline) is in place** — the band + freshness + semantic emphasis are the most visually load-bearing changes and need a snapshot floor.
- **Wave 2 blocks Wave 3 + 5** — Card/Sheet/Stat/Tooltip/Typography/PlatformBadge are consumed by Home recompose (Wave 3) and CampaignDrawer split (Wave 5).
- **Wave 4 (RTL) is parallel-safe with Wave 3 + 5** after Wave 2 finishes.
- **Wave 6 lands last** — visual baseline can only be generated once surfaces stabilise.

### Single mega-PR

One PR named `ui-ux: Premium 2026 dashboard redesign — glass+neon (Waves 1-6)`. Each task above produces exactly one well-scoped commit; reviewer reads the PR commit-by-commit.

### Pre-merge checklist (run on the worktree, not a local dev server)

- [ ] `cd dashboard-web && npm run typecheck` → 0 errors
- [ ] `npm test` → all green (token tests + useRoasBandGradient + useStaleness + aovEmphasis + colorCollisions + synthesis + bidi)
- [ ] `npm run test:components` → all green (PageScope + PerStoreRow + RoasTargetChart + FreshnessBadge + drawer-subtabs + sidebar pin)
- [ ] `npm run lint` → 0 errors with 8 new rules at `'error'`
- [ ] `npm run test:visual` → all snapshots match (dark mode only, every state from the snapshot list)
- [ ] **Dark-mode manual review** — single visual mode; walk every page; verify glass blur reads correctly on real text; band/freshness/AOV/CPM rules apply as locked.
- [ ] **Glass-blur FPS check** — open Chrome DevTools Performance tab, record while opening Home, scrolling, opening RoasTargetChart pin tooltips, opening CampaignDrawer. FPS should hold ≥ 55 on a 5-year-old laptop (M1 / Intel i5 baseline). If lower, evaluate reducing `--blur-glass` strength or scoping the conic-gradient to fewer layers.
- [ ] **Hebrew RTL manual review** — every new component (`CommandCenterHero`, `PerStoreRow`, `RoasTargetChart`, `RoasChartDateRangePicker`, `FreshnessBadge`, `Sidebar` collapsed + expanded + hover + pinned, sub-tab `CampaignDrawer`) reads right-to-left correctly; sticky table headers stick to the correct top + correct horizontal edge; tooltip arrows point toward the trigger; date picker calendar reads RTL.
- [ ] **Mixed Hebrew + English** — CommandPalette query "uzo Summer", AdsDrawer with Hebrew + English ad names, CAD prefix attached to numbers in all 12 fixed sites.
- [ ] **Keyboard pass** — Tab through Home, every interactive element has visible focus ring on the violet accent. `⌘\\` toggles sidebar pin.
- [ ] **Memory updates after merge** — see "Memory updates" subsection below.

### Memory updates after ship

- Update `[[ui-ux-overhaul-plan-ready]]` → mark superseded by this v2 plan.
- Create `[[premium-2026-redesign-shipped]]` → ship date + 8 ESLint rules + visual-regression CI gate + GoalTracker-on-P&L (Q8 binding) + glass+neon direction (replaces the v1 hairline-flat target).
- Keep `[[freshness-phase-a-shipped]]` + cross-reference `FreshnessBadge` + `useStaleness` consumption.
- Keep `[[monthly-goal-is-global]]` binding.
- Keep `[[no-info-loss-across-tabs]]` binding (Task 3.1 metric-mapping table proves compliance).
- Update `[[visual-direction-flip-glass-neon-2026-05-31]]` to note: revision applied; v2 plan landed.

---

## Self-Review

### Spec coverage — P0/P1 → task pointer

| Spec item | Task |
|---|---|
| P0-1 delete legacy palette | Task 1.2 |
| P0-2 brand-mirrored chart palette + collision fixes | Task 1.1 + 1.10 |
| P0-3 PageScope | Task 1.9 + 5.9 |
| P0-4 dark-mode regressions | **Folded** — single-mode dark only (Task 1.1 forces `data-theme="dark"`, deletes `[data-theme="dark"]` overrides). Hero gradient, scrollbar, skeleton, selection, focus-ring all derive from canvas + glass tokens. |
| P0-5 Typography primitive | Task 2.8 |
| P0-6 unified Stat | Task 2.3 |
| P0-7 Home recompose | Task 3.1 + 3.2 + 3.3 |
| P0-8 hairline-only elevation | **Superseded** — glass + neon replaces hairline-flat. Elevation now via glass layers + neon edges (Task 1.1 + 1.7). |
| P0-9 silent-error swallowing | Task 5.7 |
| P0-10 TooltipProvider + 53 native title | Task 2.6 |
| P0-11 Button focus ring | Task 2.11 |
| P0-12 drawer close-X z-index | Task 2.5 |
| P0-13 border-line-subtle → border-line | **Dropped** — glass aesthetic uses `var(--glass-edge)` for all separators; no decorative vs. structural distinction. |
| P0-14 6 Hebrew bidi P0 bugs | Task 4.1 + 4.2 + 4.3 |
| P0-15 Archive global filter | Task 5.3 |
| P0-16 shadow-overlay/shadow-modal tokens | Task 1.7 (`--shadow-glass`, `--shadow-overlay`, `--shadow-sheet`) |
| P0-17 WhatsappTestButtons confirm | Task 5.12 |
| P1-1 FreshnessBadge + desaturation | Task 1.4 + 3.6 |
| P1-2 3-variable LCH theming | **Scope-reduced** — Task 1.6 limits LCH to the foreground stack only. Surface layering now uses translucent glass stops (Task 1.1). |
| P1-3 PlatformBadge | Task 2.9 |
| P1-4 Card sweep (9 sites) | Task 2.4 |
| P1-5 unified sort headers | Task 2.2 (TableHeaderCell sortable folded into TableBase extension) |
| P1-6 physical-direction lint + sweep | Task 4.4 + 4.5 |
| P1-7 `<Num>`/`<BiDi>` (CAD migration) | Task 4.3 (fmtMoney/fmtMoneyString split) |
| P1-8 CollapsibleSection migration | Task 5.4 |
| P1-9 Skeleton primitive | Folded into Task 6.1 + Task 5.7 (error states) |
| P1-10 actionable insights | Task 5.6 |
| P1-11 clickable per-store + per-platform | Task 3.4 |
| P1-12 per-platform rollup | Covered by RoasTargetChart 5-up KPI strip (Task 3.2) + PerStoreRow per-platform CPM (Task 3.3) |
| P1-13 per-page synthesis | Task 3.5 (Trends/Archive/Detail/P&L) + Task 3.2 (Home's TL;DR lives inside RoasTargetChart) |
| P1-14 emoji → Lucide | Task 5.10 |
| P1-15 spacing/motion/radius tokens | Task 1.8 |
| P1-16 ChartContainer dir=ltr default | Task 4.6 |
| P1-17 CampaignDrawer sub-tabs | Task 5.5 |
| P1-18 Products sub-tab URL state | Folded into Task 5.3 wrapper-cleanup |
| P1-19 icon size scale | Deferred — single-rule follow-up; not in scope to avoid creep |
| P1-20 override-badge on in-table filter toolbars | Folded into Task 3.4 (per-card drill shares global filter context) |
| P1-21 Operator status pill + default Health | Task 5.1 |
| P1-22 inline BillingSettings into PnL | Folded into Task 5.4 (CollapsibleSection in PnLBreakdown) |
| P1-23 slim sidebar | Task 5.8 (hover-to-expand + pin + ⌘\\ from mockup-06) |

**Open gaps acknowledged:** P1-19 (icon size literal lint) deferred to a follow-up; no spec gap otherwise.

### Q1-Q10 + 5 mockup-pass decisions honored

| Decision | Task |
|---|---|
| Q1 brand-mirrored chart | Task 1.1 |
| Q2 confident violet accent | Task 1.1 |
| Q3 Shopify as category | Task 1.1 (Shopify token comment + cart-icon prefix handled in PlatformBadge Task 2.9) |
| Q4 not in decision list — see Q10 |
| Q5 aggressive stale (30% after 30 min) | Task 1.4 + 3.6 |
| Q6 authoritative Hebrew TL;DR | Task 3.2 (`synthesizeRoasChart`) + Task 3.5 (other pages) |
| Q7 insight action = both | Task 5.6 |
| Q8 GoalTracker stays on P&L | Task 5.11 (regression test) |
| Q9 dark-mode visual regression CI | Task 6.3 |
| Q10 CampaignDrawer hard cut + slim sidebar | Task 5.5 + 5.8 |
| Mockup: visual flip glass+neon | Task 1.1 (canvas + glass + conic-gradient bg) |
| Mockup: V4 band signal | Task 1.3 + Card `band` prop in Task 2.4 |
| Mockup: per-store semantic emphasis | Task 1.5 (classes + `aovEmphasis`) + Task 3.3 (PerStoreRow) |
| Mockup: ROAS-vs-target chart with pins + date picker | Task 3.2 |
| Mockup: 3-stage freshness | Task 1.4 + 3.6 |
| Mockup: slim 72px sidebar + hover/pin/⌘\\ | Task 5.8 |
| Mockup: Home section order (per-store BEFORE chart) | Task 3.1 (section order verbatim) |
| Mockup: pin tooltips hover-only & click-only | Task 3.2 |
| Mockup: CPM cells always white | Task 1.5 (no `.cell.cpm.*` class) + Task 3.3 (binding contract) |

### Name consistency

`PageScope` (1.9, 5.9, 5.5), `Heading`/`Text` (2.8), `PlatformBadge` (2.9, Wave 5), `Stat` density/active/prefix (2.3, 3.1), `Card` with `band`/`freshness`/`onDrill` props (2.4, 3.1, 3.3, 3.4, 3.6), `Sheet.Header` (2.5, 5.5), `CommandCenterHero` (3.1), `PerStoreRow` (3.1, 3.3), `RoasTargetChart` (3.1, 3.2), `InsightsBoard` (3.1), `ActivityFeed` (3.1), `RoasChartDateRangePicker` (3.2), `useStaleness`/`computeStaleness` (1.4, 3.6), `FreshnessBadge` (3.6), `useRoasBandGradient` (1.3, 3.1, 3.3, 5.5), `aovEmphasis` (1.5, 3.3), `synthesizeRoasChart` (3.2), `PageSynthesis` (3.5).

### No placeholders

Searched final plan output for: `TBD`, `TODO`, `fill in`, `similar to`, `appropriate`, `handle edge cases` → none in implementation steps. (Strings appear in this self-review prose only.)

### Mockup file references — sanity check

Every `**Visual reference:**` line points to a file that exists in `docs/superpowers/mockups/2026-05-31-visual-direction/`:
- Task 1.1 → `mockup-04-final.html`
- Task 1.3 → `mockup-04f-v4-final.html` + `mockup-04-final.html`
- Task 1.4 → `mockup-05-freshness-desaturation.html`
- Task 1.5 → `mockup-04i-store-emphasis.html`
- Task 1.7 → `mockup-04-final.html` + `mockup-03-primitives-glass.html`
- Task 2.2 → `mockup-03-primitives-glass.html`
- Task 2.5 → `mockup-03-primitives-glass.html`
- Task 3.1 → `mockup-04-final.html`
- Task 3.2 → `mockup-04h-roas-chart-section.html` + `mockup-04-final.html`
- Task 3.3 → `mockup-04i-store-emphasis.html` + `mockup-04-final.html`
- Task 5.5 → `mockup-03-primitives-glass.html`
- Task 5.8 → `mockup-06-sidebar.html`

All present (verified in mockup README).
