# Dashboard UX/UI Overhaul — Plan 06: `/operator` route (chrome migration)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax. Tasks 1-5 are worktree-parallel candidates (5 different file sets, no overlap).

**Goal:** Chrome-only design token migration of every file on the `/operator` route. After this plan the operator console:

- Renders correctly in **both light and dark themes** (currently dark-only via raw `bg-black/30` form bg + `border-white/10` borders, which only "looks right" against a dark page).
- Uses semantic tokens (`accent`, `status-*`, `ink-*`, `line-*`, surface stack) instead of the raw Tailwind palette (blue-600, emerald-700, amber-500, red-600, gray-600, etc.) and instead of Plan 2 legacy tokens (`bg-background`, `text-text-primary`).
- Stays **functionally byte-for-byte**: no API contracts, no Inngest wiring, no Supabase logic, no auth middleware, no operatorFetch helper, no token-verification logic. Pure className edits.

10 files, ~320 legacy/raw tokens, 2,237 lines.

**Architecture:** Pure className edits across 10 files. No new components, no new dependencies, no structural HTML changes (no `<div>` → `<section>`, no JSX restructuring). The **Extended migration map** below adds raw Tailwind palette → semantic mappings that Plan 2 SSOT did not cover — the dashboard tabs used legacy *named* tokens (`bg-surface`, `text-primary`) and were already on the migration path, while the operator console pre-dates that effort and uses raw Tailwind color utilities (`bg-blue-600`, `bg-amber-500/10`).

**Tech Stack:** No new deps.

**Branch:** Continue on `dashboard-ux-overhaul-2026-05-28` from tag `plan-05b-pnl-tab-done` (HEAD `e237418`).

---

## Scope

| File | Lines | Legacy tokens | Tier | Notes |
|------|-------|---------------|------|-------|
| `dashboard-web/src/components/operator/ManualOverridesCrud.tsx` | 417 | 77 | Heavy | Forms (date / select / number) + table + delete-confirm modal |
| `dashboard-web/src/components/operator/ResetData.tsx` | 384 | 55 | Heavy | 2 destructive buttons + token-confirm modal + success box + pre-block |
| `dashboard-web/src/components/operator/TokenFailuresTable.tsx` | 305 | 51 + 9 arbitrary `text-[10px]`/`[11px]` | Heavy | Table + status badges + expand-row + resolve button |
| `dashboard-web/src/components/operator/OperatorSecretBanner.tsx` | 183 | 36 | Heavy | Amber warning banner + password-style input + save / clear / cancel |
| `dashboard-web/src/components/operator/JobsTable.tsx` | 247 | 29 | Medium | Cron / sync jobs table + status badges + JSON pre-block |
| `dashboard-web/src/components/operator/BackfillPicker.tsx` | 237 | 25 | Medium | Date-range inputs + per-store checkboxes + run button |
| `dashboard-web/src/components/operator/SyncNowButtons.tsx` | 182 | 17 | Medium | 4-button grid (per-store + all-stores) |
| `dashboard-web/src/components/operator/WhatsappTestButtons.tsx` | 99 | 11 | Medium | 3-button row (emerald success palette) |
| `dashboard-web/src/app/operator/page.tsx` | 154 | 17 | Medium | Container + section titles + descriptive copy |
| `dashboard-web/src/app/operator/layout.tsx` | 29 | **2 (recon undercounted)** | Light | `bg-background text-text-primary` → `bg-canvas text-ink` |

**Total: 2,237 lines · ~320 legacy/raw tokens · 10 files.**

**OUT of scope (deferred to Plan 7):**

- No structural HTML changes (e.g., consolidating the two modal patterns in `ManualOverridesCrud` + `ResetData` into a shared `<Dialog>` primitive — deferred to Plan 7 polish).
- No new tests (operator UI has no existing test coverage; adding Storybook / VRT baselines is a Plan 7 candidate).
- No middleware / API / auth changes (explicitly forbidden per spec: "Operator-secret middleware stays in place").
- No font-stack changes inside operator (Heebo+Rubik+Geist Mono already applied via root layout).

---

## Parallelism plan

```
                  ┌─ Worktree A: Task 1 ManualOverridesCrud (77 tokens) ──┐
                  │                                                       │
                  ├─ Worktree B: Task 2 ResetData (55 tokens) ────────────┤
                  │                                                       │
PARALLEL ─────────┤  Worktree C: Task 3 TokenFailuresTable (51 + 9 micro)┤
                  │                                                       │
                  ├─ Worktree D: Task 4 OperatorSecretBanner (36) ───────┤
                  │                                                       │
                  └─ Worktree E: Task 5 Medium batch (6 files, 99) ──────┘
                                                                          ▼
                                                            Task 6 (audit + tag)
```

5 worktree-parallel candidates — **all touch DIFFERENT files**, zero overlap. Each implementer commits inside its own worktree branch (`dispatch/plan-06-task-N`), then auto-merges back to `dashboard-ux-overhaul-2026-05-28` on success. Task 6 runs sequentially on the main worktree after all 5 land.

**Why worktree isolation:** Plan 4 a+c demonstrated that parallel agents on the same worktree produce commit interleaving (e.g., Plan 4a's tag at `a111b16` included Plan 4c's QuadrantScatter commit). For Plan 6 with 5 simultaneous file-migration agents, interleaving would scramble commit history significantly. Isolated worktrees keep each task's commits contiguous.

---

## Migration map (Plan 2 SSOT recap)

Identical to Plans 2, 4a-c, 5a-c. Apply first when a class matches:

| Legacy class | New class |
|--------------|-----------|
| `bg-background` | `bg-canvas` |
| `bg-surface` | `bg-elevated` |
| `bg-surfaceMuted` | `bg-elevated2` |
| `bg-surfaceSubtle` | `bg-elevated2` |
| `bg-surfaceSunken` | `bg-canvas` |
| `border-border` | `border-line` |
| `border-borderSubtle` | `border-line-subtle` |
| `border-borderStrong` | `border-line-strong` |
| `text-text-primary` | `text-ink` |
| `text-text-secondary` | `text-ink-secondary` |
| `text-text-muted` | `text-ink-muted` |
| `text-text-subtle` | `text-ink-subtle` |
| `text-primary` (and `-dark`/`-light`) | `text-accent` |
| `bg-primary` (and `-dark`/`-light`) | `bg-accent` |
| `bg-roas-redBg` etc. | `bg-status-redBg` etc. |
| `text-roas-red` etc. | `text-status-red` etc. |
| `border-roas-*` | `border-status-*` |
| `shadow-card` | `shadow-sm` |
| `shadow-cardHover` | KEEP (`md` not defined custom — see Plan 5 shadow learning) |
| `shadow-elevated` | KEEP (`lg` not defined custom) |

Substring traps (longer match always wins):

- `bg-surfaceMuted` before `bg-surface`
- `border-borderSubtle` / `border-borderStrong` before `border-border`
- `text-text-primary` before `text-primary`
- `primary-dark` / `primary-light` before `primary`

---

## Extended migration map (Plan 6 NEW — raw Tailwind palette → semantic tokens)

The operator console uses raw Tailwind utility classes (`bg-blue-600`, `bg-amber-500/10`) that Plan 2 SSOT did not enumerate (since the dashboard tabs used Plan 2's legacy named tokens). **Apply Plan 2 SSOT first, then this extension table.**

### Buttons (primary / destructive / success / warning / secondary)

| Raw Tailwind | Semantic | Use case |
|--------------|----------|----------|
| `bg-blue-600 hover:bg-blue-500` | `bg-accent hover:bg-accent/90` | Primary save / submit |
| `bg-blue-700/70` | `bg-accent/70` | Pressed / active variant |
| `bg-red-600 hover:bg-red-500` | `bg-status-red hover:bg-status-red/90` | Destructive (delete, reset) |
| `bg-red-800` | `bg-status-red/40` | Pre-disable red state |
| `bg-orange-600 hover:bg-orange-500` | `bg-status-orange hover:bg-status-orange/90` | Partial-destructive (e.g. reset window) |
| `bg-emerald-700 hover:bg-emerald-600` | `bg-status-green hover:bg-status-green/90` | Success action (WhatsApp test) |
| `bg-emerald-600 hover:bg-emerald-500` | `bg-status-green hover:bg-status-green/90` | Same (lighter shade variant) |
| `bg-amber-600 hover:bg-amber-500` | `bg-status-orange hover:bg-status-orange/90` | Warning save (OperatorSecretBanner) |
| `bg-gray-600 hover:bg-gray-500` | `bg-elevated2 hover:bg-elevated2/90 text-ink` | Cancel / secondary |
| `disabled:bg-gray-600 disabled:cursor-not-allowed` | `disabled:bg-elevated2 disabled:text-ink-muted disabled:cursor-not-allowed` | Disabled state |

### Form inputs (modal-internal + page-level)

| Raw | Semantic | Notes |
|-----|----------|-------|
| `bg-black/30` (input bg inside modal/banner) | `bg-canvas` | Solid surface, theme-aware |
| `bg-black/40` (pre-block bg) | `bg-canvas` | Same |
| `border-white/10` | `border-line-subtle` | Default input border |
| `border-white/15` | `border-line` | Stronger input border |
| `focus:border-blue-500` | `focus:border-accent` | Focus state |

### Modal overlay + chrome

| Raw | Semantic | Notes |
|-----|----------|-------|
| `bg-black/60` (modal overlay) | **KEEP** | Backdrop already works in both themes (60% black over any bg). Intentional UX choice. |
| `bg-background border border-white/10` (modal card) | `bg-elevated border border-line` | Theme-aware modal surface |

### Text variants

| Raw | Semantic | Use case |
|-----|----------|----------|
| `text-amber-300` / `text-amber-400` / `text-amber-500` | `text-status-orange` | Warning text |
| `text-blue-300` / `text-blue-400` / `text-blue-500` | `text-status-blue` | Info text |
| `text-red-300` / `text-red-400` / `text-red-500` | `text-status-red` | Error text |
| `text-green-300` / `text-green-400` / `text-green-500` | `text-status-green` | Success text |
| `text-gray-300` / `text-gray-400` | `text-ink-secondary` | Secondary text |
| `text-gray-500` | `text-ink-muted` | Muted text |
| `text-foreground` | `text-ink` | **Dead class today** — not defined in `tailwind.config.ts` or `globals.css`. Currently a no-op (Tailwind JIT silently ignores). 12 occurrences across 4 files (see Special Cases below). Migrating clears the dead classes. |
| `text-white` (on colored buttons) | **KEEP** | Correct on accent / status-* in both themes |

### Status badge backgrounds (TokenFailuresTable, JobsTable)

| Raw pattern | Semantic pattern |
|-------------|------------------|
| `bg-red-500/10 text-red-400 border border-red-500/30` | `bg-status-redBg text-status-red border border-status-red/30` |
| `bg-green-500/10 text-green-400 border border-green-500/30` | `bg-status-greenBg text-status-green border border-status-green/30` |
| `bg-blue-500/10 text-blue-400 border border-blue-500/30` | `bg-status-blueBg text-status-blue border border-status-blue/30` |
| `bg-gray-500/10 text-gray-400 border border-gray-500/30` | `bg-status-grayBg text-status-gray border border-status-gray/30` |

### Banner palette (OperatorSecretBanner amber warning)

| Raw | Semantic |
|-----|----------|
| `border-amber-500/30 bg-amber-500/10 text-amber-300` | `border-status-orange/30 bg-status-orangeBg text-status-orange` |

The amber → orange mapping is intentional — `status-orange` is the semantic warning color in our system; `amber` is the raw Tailwind hue.

### Arbitrary font sizes (TokenFailuresTable)

| Raw | Semantic | Notes |
|-----|----------|-------|
| `text-[11px]` | `text-2xs` | Exact match (`2xs` = 0.6875rem = 11px) |
| `text-[10px]` | `text-2xs` | Nearest defined token (gains 1px to enforce min legible size) |

Both occurrences in lines 205, 232, 250, 264, 273, 276, 291, 303 of TokenFailuresTable.tsx. The 1px upsize from 10→11 is intentional — the design system enforces minimum legible sizes. If visual review in Task 6 surfaces a layout break (e.g., truncated badge), revert that specific occurrence to `text-[10px]` and note in Plan 7 carryover.

### Dead-class sweep (`text-foreground`) — pre-flight 2026-05-29

Pre-flight verification surfaced 12 occurrences of `text-foreground` across 4 files. This class is **not defined** in `tailwind.config.ts` or `globals.css` — Tailwind JIT silently ignores it, so text falls back to the parent's inherited color. Migrating clears the dead class AND makes the inherited intent explicit:

| Task | File | Occurrences | Approx. lines |
|------|------|-------------|---------------|
| Task 1 | `ManualOverridesCrud.tsx` | 6 | ~224, 233, 247, 263, 273, 288 |
| Task 2 | `ResetData.tsx` | 1 | ~338 |
| Task 4 | `OperatorSecretBanner.tsx` | 3 | ~79, 86, 129 (pre-flight listed 4 line refs; verify one is in a comment) |
| Task 5 (BackfillPicker step) | `BackfillPicker.tsx` | 2 | ~171, 182 |

**Migration:** `text-foreground` → `text-ink` in all 4 files. Tasks 1, 2, 4, and 5 (BackfillPicker substep) must apply this sweep alongside their other token migrations.

### NOT migrated (intentional — keep as-is)

- `text-white` on colored buttons (semantic-correct in both themes)
- `dir="ltr"` overrides on date / number inputs (RTL handling, not token issue)
- Layout utility classes (`px-4`, `py-6`, `grid-cols-2`, `gap-3`, etc.)
- Border-radius classes (`rounded`, `rounded-md`, `rounded-lg` — already use token scale from config)
- `bg-black/60` modal overlay (intentional backdrop, theme-agnostic)
- `font-mono` on pre-blocks (Geist Mono is the JSON / output font)

---

## Worktree dispatch protocol (Tasks 1-5)

Each Task 1-5 runs in an **isolated git worktree** to prevent commit interleaving (Plan 4 a+c learning). The implementer agent:

1. Receives `isolation: "worktree"` and branches off the base tip (`e237418`).
2. Runs its task's Steps inside the worktree.
3. Commits with the task's commit message.
4. Reports the worktree path + branch name back. The orchestrator merges the branch into `dashboard-ux-overhaul-2026-05-28` (fast-forward when possible, otherwise a clean merge commit).
5. After all 5 merge, Task 6 runs sequentially on the main worktree.

**Important — base SHA pinning:** All 5 worktrees branch from `e237418` (the `plan-05b-pnl-tab-done` tag), NOT from the live HEAD of `dashboard-ux-overhaul-2026-05-28`. This ensures parallel agents share a frozen base and don't race on HEAD.

---

## Task 1: ManualOverridesCrud token migration (Worktree A, parallel)

**File:** `dashboard-web/src/components/operator/ManualOverridesCrud.tsx` (417 lines, 77 tokens).

Forms + table + delete-confirm modal. Heaviest single file in Plan 6.

- [ ] **Step 1: Worktree setup** — branch `dispatch/plan-06-task-1-manual-overrides` off `e237418`.

- [ ] **Step 2: Pre-scan**
  ```bash
  cd /Users/dorperetz/script-roas
  grep -cE "bg-(background|surface|surfaceMuted|surfaceSubtle|surfaceSunken|primary[-]?(dark|light)?|roas-|blue-|red-|green-|emerald-|amber-|orange-|gray-|black/|white/)|border-(border\b|borderSubtle|borderStrong|roas-|white/|blue-|red-|green-|amber-|gray-)|text-(text-|primary[-]?(dark|light)?|roas-|amber-|blue-|red-|green-|gray-)" dashboard-web/src/components/operator/ManualOverridesCrud.tsx
  ```
  Expected: ~77 (close to recon count; small drift OK).

- [ ] **Step 3: Apply Plan 2 SSOT + Extended migration map.**

  Categorical hot-spots in this file:
  - **Buttons row** (save / cancel / delete): primary blue → `bg-accent`, cancel gray → `bg-elevated2`, delete red → `bg-status-red`.
  - **Form inputs** (date / select / number): `bg-black/30 border-white/10` → `bg-canvas border-line-subtle`. Focus state `focus:border-blue-500` → `focus:border-accent`.
  - **Table chrome**: `border-white/10` separators → `border-line-subtle`. Header row `bg-black/30` → `bg-canvas` (or `bg-elevated2` if it blends — verify visually). Hover row `hover:bg-white/5` → `hover:bg-elevated2/50`.
  - **Delete-confirm modal**: overlay `bg-black/60` KEEP. Card `bg-background border border-white/10` → `bg-elevated border border-line`. Title `text-white` KEEP if on colored bg, else `text-ink`. Buttons same as row above.
  - **Dead-class sweep**: 6 occurrences of `text-foreground` (lines ~224, 233, 247, 263, 273, 288) → `text-ink`. See "Dead-class sweep" subsection in Extended migration map.

- [ ] **Step 4: Verify clean grep + tsc + tests + build**
  ```bash
  cd /Users/dorperetz/script-roas
  # Re-run the pre-scan grep — should drop close to 0 (only KEEP items remain: text-white on buttons, bg-black/60 overlay)
  grep -nE "bg-(background|surface|surfaceMuted|surfaceSubtle|surfaceSunken|primary[-]?(dark|light)?|roas-|blue-6|blue-5|blue-7|red-[3-9]|green-[3-9]|emerald-[3-9]|amber-[3-9]|orange-[3-9]|gray-[3-9]|black/30|black/40|white/1)|border-(border\b|borderSubtle|borderStrong|roas-|white/1|blue-5|red-[3-9]|green-[3-9]|amber-[3-9]|gray-[3-9])|text-(text-|primary[-]?(dark|light)?|roas-|amber-[3-9]|blue-[3-9]|red-[3-9]|green-[3-9]|gray-[3-9]|foreground)" dashboard-web/src/components/operator/ManualOverridesCrud.tsx || echo "(clean)"
  cd dashboard-web
  npx tsc --noEmit ; echo "tsc=$?"
  npm run test 2>&1 | tail -3
  npm run build 2>&1 | tail -5
  ```

- [ ] **Step 5: Commit**
  ```bash
  cd /Users/dorperetz/script-roas
  git add dashboard-web/src/components/operator/ManualOverridesCrud.tsx
  git commit -m "refactor(operator): ManualOverridesCrud token migration + text-foreground sweep"
  ```

---

## Task 2: ResetData token migration (Worktree B, parallel)

**File:** `dashboard-web/src/components/operator/ResetData.tsx` (384 lines, 55 tokens).

2 destructive action buttons + token-confirm modal + success feedback box + JSON pre-block.

- [ ] **Step 1: Worktree setup** — branch `dispatch/plan-06-task-2-reset-data` off `e237418`.

- [ ] **Step 2: Pre-scan** — confirm ~55 matches with same grep pattern as Task 1.

- [ ] **Step 3: Apply Plan 2 SSOT + Extended migration map.**

  Categorical hot-spots:
  - **Two destructive buttons** (full reset, window reset): full reset `bg-red-600 hover:bg-red-500` → `bg-status-red hover:bg-status-red/90`. Window reset `bg-orange-600 hover:bg-orange-500` → `bg-status-orange hover:bg-status-orange/90`. Disabled `disabled:bg-red-800` → `disabled:bg-status-red/40`.
  - **Token-confirm modal**: overlay `bg-black/60` KEEP. Card `bg-background border border-white/10` → `bg-elevated border border-line`. Token input `bg-black/30 border-white/10` → `bg-canvas border-line-subtle`. Cancel button `bg-gray-600` → `bg-elevated2`.
  - **Success box**: `bg-green-500/10 border border-green-500/30 text-green-300` → `bg-status-greenBg border border-status-green/30 text-status-green`.
  - **Pre-block** (JSON output): `bg-black/40 border border-white/10 text-gray-300` → `bg-canvas border border-line-subtle text-ink-secondary`.
  - **Dead-class sweep**: 1 occurrence of `text-foreground` (line ~338) → `text-ink`.

- [ ] **Step 4: Verify clean grep + tsc + tests + build** (same commands as Task 1, swap filename + include `|foreground` in the text- alternation).

- [ ] **Step 5: Commit**
  ```bash
  cd /Users/dorperetz/script-roas
  git add dashboard-web/src/components/operator/ResetData.tsx
  git commit -m "refactor(operator): ResetData token migration + text-foreground sweep"
  ```

---

## Task 3: TokenFailuresTable token migration + micro-text resolution (Worktree C, parallel)

**File:** `dashboard-web/src/components/operator/TokenFailuresTable.tsx` (305 lines, 51 tokens + 9 arbitrary `text-[10px]`/`[11px]`).

Table + status badges (red / green / blue / gray) + expand-row + resolve button.

- [ ] **Step 1: Worktree setup** — branch `dispatch/plan-06-task-3-token-failures` off `e237418`.

- [ ] **Step 2: Pre-scan** — confirm ~51 matches.

  Also verify the arbitrary text size count:
  ```bash
  grep -nE "text-\[10px\]|text-\[11px\]" dashboard-web/src/components/operator/TokenFailuresTable.tsx | wc -l
  ```
  Expected: 9.

- [ ] **Step 3: Apply Plan 2 SSOT + Extended migration map + arbitrary-text resolution.**

  Categorical hot-spots:
  - **Table header / rows**: `bg-black/30` header → `bg-canvas`. Row separators `border-white/10` → `border-line-subtle`. Hover `hover:bg-white/5` → `hover:bg-elevated2/50`.
  - **Status badges** (the four-color set from the badges section above): all four → semantic `bg-status-*Bg text-status-* border border-status-*/30`. Use the four-row mapping table verbatim.
  - **Expand-row chrome**: nested pre-block `bg-black/40` → `bg-canvas`. Detail labels `text-gray-400` → `text-ink-secondary`.
  - **Resolve button**: primary `bg-blue-600 hover:bg-blue-500` → `bg-accent hover:bg-accent/90`. Disabled `disabled:bg-gray-600` → `disabled:bg-elevated2 disabled:text-ink-muted disabled:cursor-not-allowed`.
  - **Arbitrary text sizes**: all 9 occurrences of `text-[10px]` and `text-[11px]` → `text-2xs`. Verify no visual layout break (no truncation in status-badge tail).

- [ ] **Step 4: Verify clean grep + tsc + tests + build** (same commands as Task 1).

  Additional post-migration check:
  ```bash
  # No arbitrary text sizes left
  grep -nE "text-\[1[01]px\]" dashboard-web/src/components/operator/TokenFailuresTable.tsx || echo "(clean — no arbitrary 10/11px)"
  ```
  Expected: `(clean — no arbitrary 10/11px)`.

- [ ] **Step 5: Commit**
  ```bash
  cd /Users/dorperetz/script-roas
  git add dashboard-web/src/components/operator/TokenFailuresTable.tsx
  git commit -m "refactor(operator): TokenFailuresTable token migration (51 → 0) + text-2xs for 9 micro-text"
  ```

---

## Task 4: OperatorSecretBanner token migration (Worktree D, parallel)

**File:** `dashboard-web/src/components/operator/OperatorSecretBanner.tsx` (183 lines, 36 tokens).

Amber warning banner + password-style input + save / clear / cancel buttons.

- [ ] **Step 1: Worktree setup** — branch `dispatch/plan-06-task-4-secret-banner` off `e237418`.

- [ ] **Step 2: Pre-scan** — confirm ~36 matches.

- [ ] **Step 3: Apply Plan 2 SSOT + Extended migration map.**

  Categorical hot-spots:
  - **Banner card** ("secret not set" warning): `border border-amber-500/30 bg-amber-500/10 text-amber-300` → `border border-status-orange/30 bg-status-orangeBg text-status-orange`. Amber → orange is intentional (semantic warning color).
  - **Password-style input**: `bg-black/30 border border-white/10` → `bg-canvas border border-line-subtle`. Focus state same as Task 1.
  - **Eye-icon toggle button** (show/hide secret): if button has its own bg, treat as secondary `bg-elevated2`. If transparent with text-only, just migrate text color.
  - **Save button**: `bg-amber-600 hover:bg-amber-500` → `bg-status-orange hover:bg-status-orange/90`.
  - **Clear button**: `bg-red-600 hover:bg-red-500` → `bg-status-red hover:bg-status-red/90` (destructive — clears the saved secret).
  - **Cancel button**: `bg-gray-600 hover:bg-gray-500` → `bg-elevated2 hover:bg-elevated2/90 text-ink`.
  - **Helper text** (`text-amber-400`, `text-red-400`, `text-gray-400`): → `text-status-orange`, `text-status-red`, `text-ink-secondary`.
  - **Dead-class sweep**: 3 occurrences of `text-foreground` (lines ~79, 86, 129; pre-flight listed 4 line refs — one may be in a comment, verify) → `text-ink`.

- [ ] **Step 4: Verify clean grep + tsc + tests + build** (same commands as Task 1, with `|foreground` in the text- alternation).

- [ ] **Step 5: Commit**
  ```bash
  cd /Users/dorperetz/script-roas
  git add dashboard-web/src/components/operator/OperatorSecretBanner.tsx
  git commit -m "refactor(operator): OperatorSecretBanner token migration + text-foreground sweep"
  ```

---

## Task 5: Medium batch — JobsTable + BackfillPicker + SyncNowButtons + WhatsappTestButtons + page.tsx + layout.tsx (Worktree E, parallel)

**Files** (6 files, ~99 tokens total):

| File | Lines | Tokens |
|------|-------|--------|
| `dashboard-web/src/components/operator/JobsTable.tsx` | 247 | 29 |
| `dashboard-web/src/components/operator/BackfillPicker.tsx` | 237 | 25 |
| `dashboard-web/src/components/operator/SyncNowButtons.tsx` | 182 | 17 |
| `dashboard-web/src/components/operator/WhatsappTestButtons.tsx` | 99 | 11 |
| `dashboard-web/src/app/operator/page.tsx` | 154 | 17 |
| `dashboard-web/src/app/operator/layout.tsx` | 29 | 2 |

Run sequentially within Worktree E — one commit per file, in order.

- [ ] **Step 1: Worktree setup** — branch `dispatch/plan-06-task-5-medium-batch` off `e237418`.

- [ ] **Step 2: Migrate JobsTable.tsx**

  Hot-spots:
  - Table chrome: `bg-black/30` header → `bg-canvas`. Separators `border-white/10` → `border-line-subtle`.
  - **Status badges** (running blue / success green / fail red / cancelled gray): apply the four-color status-badge mapping from the Extended map.
  - **Loading / error messages**: `text-blue-400` → `text-status-blue`, `text-red-400` → `text-status-red`.
  - **JSON pre-block**: `bg-black/40 text-gray-300` → `bg-canvas text-ink-secondary`.

  Pre-scan + commit:
  ```bash
  cd /Users/dorperetz/script-roas
  # ... apply edits ...
  git add dashboard-web/src/components/operator/JobsTable.tsx
  git commit -m "refactor(operator): JobsTable token migration (29 → 0 legacy tokens)"
  ```

- [ ] **Step 3: Migrate BackfillPicker.tsx**

  Hot-spots:
  - **Date inputs**: same as Task 1 form-input pattern.
  - **Per-store checkboxes**: native `<input type="checkbox">` — `accent-blue-500` → `accent-accent` (cosmetic). Container labels: `text-gray-300` → `text-ink-secondary`.
  - **Run button**: `bg-blue-600 hover:bg-blue-500 disabled:bg-gray-600` → `bg-accent hover:bg-accent/90 disabled:bg-elevated2 disabled:text-ink-muted disabled:cursor-not-allowed`.
  - **Success / error feedback**: same as Task 2 pattern.
  - **Dead-class sweep**: 2 occurrences of `text-foreground` (lines ~171, 182) → `text-ink`.

  Commit:
  ```bash
  git add dashboard-web/src/components/operator/BackfillPicker.tsx
  git commit -m "refactor(operator): BackfillPicker token migration + text-foreground sweep"
  ```

- [ ] **Step 4: Migrate SyncNowButtons.tsx**

  Hot-spots:
  - **4-button grid** (per-store + all-stores): all blue → `bg-accent hover:bg-accent/90`. Active variant `bg-blue-700/70` → `bg-accent/70`.
  - **Disabled** state: same as BackfillPicker.
  - **Success / error / footer text**: same color text mapping.

  Commit:
  ```bash
  git add dashboard-web/src/components/operator/SyncNowButtons.tsx
  git commit -m "refactor(operator): SyncNowButtons token migration (17 → 0 legacy tokens)"
  ```

- [ ] **Step 5: Migrate WhatsappTestButtons.tsx**

  Hot-spots:
  - **3-button row** (test success palette): `bg-emerald-700 hover:bg-emerald-600` → `bg-status-green hover:bg-status-green/90`. Disabled same pattern. Cancel `bg-gray-600` → `bg-elevated2`.
  - **Messages + footer text**: standard text-color mapping.

  Commit:
  ```bash
  git add dashboard-web/src/components/operator/WhatsappTestButtons.tsx
  git commit -m "refactor(operator): WhatsappTestButtons token migration (11 → 0 legacy tokens)"
  ```

- [ ] **Step 6: Migrate page.tsx (operator entry)**

  Hot-spots:
  - Container: any `bg-background` → `bg-canvas`. Section titles `text-text-primary` → `text-ink`. Descriptive copy `text-text-secondary` / `text-gray-400` → `text-ink-secondary`.
  - Typography utility classes (`text-lg`, `text-sm`, `text-2xl`) stay as-is (already in token scale).

  Commit:
  ```bash
  git add dashboard-web/src/app/operator/page.tsx
  git commit -m "refactor(operator): page.tsx container/typography token migration (17 → 0)"
  ```

- [ ] **Step 7: Migrate layout.tsx (operator RTL wrapper)**

  The 2-token migration the recon missed:
  ```diff
  - <div dir="rtl" className="min-h-screen bg-background text-text-primary">
  + <div dir="rtl" className="min-h-screen bg-canvas text-ink">
  ```

  Also update the inline comment block (lines 12-13) for accuracy:
  ```diff
  - // Visual style matches the existing dashboard per D-D4: same `bg-background`
  - // + `text-foreground` tokens, no new design primitives.
  + // Visual style matches the existing dashboard per D-D4: same `bg-canvas`
  + // + `text-ink` tokens (Plan 6 token migration), no new design primitives.
  ```

  Commit:
  ```bash
  git add dashboard-web/src/app/operator/layout.tsx
  git commit -m "refactor(operator): layout.tsx bg-background/text-text-primary → bg-canvas/text-ink"
  ```

- [ ] **Step 8: Worktree-level verify**
  ```bash
  cd /Users/dorperetz/script-roas/dashboard-web
  npx tsc --noEmit ; echo "tsc=$?"
  npm run test 2>&1 | tail -3
  npm run build 2>&1 | tail -5
  ```

---

## Task 6: Wrap-up audit + tag (sequential, main worktree)

Runs AFTER all 5 worktrees have merged back to `dashboard-ux-overhaul-2026-05-28`.

- [ ] **Step 1: Merge all worktree branches**

  For each `dispatch/plan-06-task-N-*` branch:
  ```bash
  cd /Users/dorperetz/script-roas
  git checkout dashboard-ux-overhaul-2026-05-28
  git merge --no-ff dispatch/plan-06-task-1-manual-overrides -m "merge(plan-06): Task 1 ManualOverridesCrud worktree"
  # repeat for Tasks 2, 3, 4, 5
  ```

  Use `--no-ff` so each task is a clearly demarcated merge in `git log --graph`.

- [ ] **Step 2: Global grep — every Plan 6 file clean**
  ```bash
  cd /Users/dorperetz/script-roas
  for f in \
    dashboard-web/src/components/operator/ManualOverridesCrud.tsx \
    dashboard-web/src/components/operator/ResetData.tsx \
    dashboard-web/src/components/operator/TokenFailuresTable.tsx \
    dashboard-web/src/components/operator/OperatorSecretBanner.tsx \
    dashboard-web/src/components/operator/JobsTable.tsx \
    dashboard-web/src/components/operator/BackfillPicker.tsx \
    dashboard-web/src/components/operator/SyncNowButtons.tsx \
    dashboard-web/src/components/operator/WhatsappTestButtons.tsx \
    dashboard-web/src/app/operator/page.tsx \
    dashboard-web/src/app/operator/layout.tsx; do
      echo "=== $f ==="
      grep -nE "bg-(background|surface|surfaceMuted|surfaceSubtle|surfaceSunken|primary[-]?(dark|light)?|roas-|blue-6|blue-5|blue-7|red-[3-9]|green-[3-9]|emerald-[3-9]|amber-[3-9]|orange-[3-9]|gray-[3-9]|black/30|black/40|white/1)|border-(border\b|borderSubtle|borderStrong|roas-|white/1|blue-5|red-[3-9]|green-[3-9]|amber-[3-9]|gray-[3-9])|text-(text-|primary[-]?(dark|light)?|roas-|amber-[3-9]|blue-[3-9]|red-[3-9]|green-[3-9]|gray-[3-9]|foreground)|text-\[1[01]px\]" "$f" || echo "(clean)"
  done
  ```
  Every file must print `(clean)`. The grep intentionally INCLUDES `bg-black/60` exclusion (it's in `black/30|black/40` only, not `black/60`) — modal overlay stays. `text-white` on buttons stays. `border-white/[2-9]` (if any, larger than /10/15) is also out of scope. `text-foreground` (dead class) is included in the `text-` alternation.

- [ ] **Step 3: Out-of-scope check** (no dashboard / non-operator files touched)
  ```bash
  git diff --name-only plan-05b-pnl-tab-done..HEAD -- \
    dashboard-web/src/components/Dashboard.tsx \
    dashboard-web/src/components/BillingSettings.tsx \
    dashboard-web/src/components/PnLBreakdown.tsx \
    dashboard-web/src/components/MonthlyTables.tsx \
    dashboard-web/src/components/RoasChart.tsx \
    dashboard-web/src/components/DetailTable.tsx \
    dashboard-web/src/components/CampaignsTable.tsx \
    dashboard-web/src/components/CampaignDrawer.tsx \
    dashboard-web/src/components/ProductsTable.tsx \
    dashboard-web/src/components/QuadrantScatter.tsx \
    dashboard-web/src/components/TodayLive.tsx \
    dashboard-web/src/components/HeroOverview.tsx \
    dashboard-web/src/components/GoalTracker.tsx \
    dashboard-web/src/components/InsightsBoard.tsx
  ```
  Expected: empty (no dashboard-tab files touched).

- [ ] **Step 4: Security wiring untouched check**
  ```bash
  git diff --name-only plan-05b-pnl-tab-done..HEAD -- \
    dashboard-web/src/middleware.ts \
    dashboard-web/src/lib/operatorClient.ts \
    dashboard-web/src/lib/operatorReset.ts \
    dashboard-web/src/lib/operatorJobsConcurrentFanout.ts \
    'dashboard-web/src/app/api/operator/**'
  ```
  Expected: empty (no security / API code touched).

- [ ] **Step 5: Full test + build**
  ```bash
  cd /Users/dorperetz/script-roas/dashboard-web
  npx tsc --noEmit ; echo "tsc=$?"
  npm run test:all 2>&1 | tail -5
  npm run build 2>&1 | tail -5
  ```
  Expected: tsc=0, 1,347 tests pass (unchanged — Plan 6 adds no new tests), build clean.

- [ ] **Step 6: Visual smoke check** (manual but encouraged)
  ```bash
  cd /Users/dorperetz/script-roas/dashboard-web
  npm run dev
  # Visit production URL: https://roas.dor.codes/operator
  # NOTE: per [[feedback-no-localhost-checks]], do NOT screenshot localhost
  # Visit production /operator route in both light and dark theme
  # Verify: banners, buttons, tables, modals all render correctly
  ```

  Visual review checklist (operator console specifically):
  - [ ] OperatorSecretBanner: amber warning visible in both themes
  - [ ] SyncNowButtons: 4-button grid; active state distinct
  - [ ] TokenFailuresTable: 4 status badge colors distinguishable
  - [ ] JobsTable: status badges + JSON pre-block readable
  - [ ] BackfillPicker: date inputs + checkboxes + run button styled
  - [ ] ManualOverridesCrud: form + table + delete modal flow
  - [ ] ResetData: 2 destructive buttons + confirm modal
  - [ ] WhatsappTestButtons: 3 green test buttons
  - [ ] page.tsx: section titles + container spacing
  - [ ] layout.tsx: `bg-canvas` page bg in both themes

- [ ] **Step 7: Tag**
  ```bash
  cd /Users/dorperetz/script-roas
  git tag plan-06-operator-done
  ```

- [ ] **Step 8: Update memory** — append Plan 6 status line to `project_dashboard_ux_overhaul_in_progress.md`.

---

## Self-Review

- ✅ All 10 operator files migrated (4 heavy + 5 medium + 1 light)
- ✅ Extended migration map covers raw Tailwind palette (blue / red / emerald / amber / orange / gray) → semantic tokens
- ✅ Plan 2 SSOT map applied to Plan-2-style legacy tokens (`bg-background`, `text-text-primary`)
- ✅ Arbitrary `text-[10px]` / `text-[11px]` resolved to `text-2xs` (9 occurrences)
- ✅ Status badges (4-color set) consolidated to semantic `bg-status-*Bg text-status-* border-status-*/30` pattern
- ✅ Modal overlays (`bg-black/60`) preserved intentionally — theme-agnostic backdrop
- ✅ `text-white` on colored buttons preserved
- ✅ Auth / middleware / API / operatorFetch untouched
- ✅ No structural HTML changes
- ✅ No new dependencies
- ✅ Dashboard-tab files NOT touched
- ✅ Worktree isolation prevents commit interleaving
- ✅ Visual smoke check on production `/operator` (NOT localhost — per memory)
- ✅ Tag `plan-06-operator-done` after audit passes

---

## Plan 7 carryover (add to scope when writing)

- **Operator UI test coverage**: 8 components with zero `.test.tsx` files. Plan 7 should add either Storybook entries (visual baseline) or Vitest + Testing Library snapshot tests for the operator console.
- **Modal consolidation**: ManualOverridesCrud and ResetData both render custom modals with identical chrome (overlay + card + title + buttons). Plan 7 polish candidate: extract a shared `<Dialog>` primitive in `components/ui/dialog.tsx`.
- **Button consolidation**: 5 button color variants (accent / status-red / status-green / status-orange / elevated2-secondary) repeat across 8 files. Plan 7 candidate: extract a `<Button variant="...">` primitive.
- **`text-[10px]` micro-text reverts**: if Task 6 visual smoke check shows badge truncation after the 10→11px upsize, list specific revert sites here.
- **`bg-overlay` adoption**: modal overlays currently use `bg-black/60`. If we decide `bg-overlay/80` (defined token) is preferable, Plan 7 sweeps.
- **OperatorSecretBanner eye-icon button**: if its styling was simplified during Task 4 migration, Plan 7 audits for parity with prior visual.
