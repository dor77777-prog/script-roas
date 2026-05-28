# Health Score — Pure Function of Data Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `computeCampaignHealth` a pure function of campaign data by removing the `optimized` (+15) and `isCurrentlyOff` (−30) operator flags from the score. Both stay as visual annotations on rows.

**Architecture:** Drop two input fields + drop the `applyOperatorAdjustment` helper + drop the `operatorAdjustment` component field + drop downstream rendering in 4 consumer files. Cohort adjustment (`applyCohortAdjustmentOnce`) stays untouched — it's data-derived, not operator metadata.

**Tech Stack:** TypeScript, vitest ^2.1, React (no rendering tests beyond source-string locks). All changes localised to existing files; no new files.

**Branch:** `health-score-pure-2026-05-28` (already created; spec committed at `da0664d`).

**Spec:** `docs/superpowers/specs/2026-05-28-health-score-pure-design.md`

---

## File structure

**Modified (8):**
- `dashboard-web/src/lib/campaignHealthScore.ts` — drop two input fields, delete `applyOperatorAdjustment`, drop `operatorAdjustment` from `HealthScoreComponents`, simplify `computeCampaignHealth` (use weighted subtotal directly, no operator delta).
- `dashboard-web/src/lib/__tests__/campaignHealthScore.test.ts` — update helper signature, drop tests that assert +15/−30 behaviour, drop the `operatorAdjustment` matcher field.
- `dashboard-web/src/components/CampaignsTable.tsx` — drop `optimized: isOpt` and `isCurrentlyOff: isOff` from the `computeCampaignHealth({ ... })` call. Keep `isOpt` / `isOff` derivations (they still drive the row's badges).
- `dashboard-web/src/components/HealthScorePanel.tsx` — drop the operatorAdjustment header block (≈lines 120-123) and the operatorAdjustment line in the breakdown (≈line 212).
- `dashboard-web/src/components/HealthScoreBadge.tsx` — drop the operatorAdjustment line in the popover (≈line 192).
- `dashboard-web/src/lib/aiReport.ts` — drop the operatorAdjustment label in the AI report assembly (≈lines 1327-1329).
- `dashboard-web/src/lib/__tests__/aiReportTikTokStatus.test.ts` — update any assertion that pins the operator-adjusted score.
- `docs/ARCHITECTURE.md` — add a short note that Health Score is data-pure (operator marks no longer affect the score; they remain row badges).
- `docs/ROAS-Dashboard-User-Manual.md` — add a short note that "סמן כאופטימיזציה" / "כבוי" change the badges only, not the score.

**Not touched (intentional):**
- `dashboard-web/src/lib/multiMappingCohort.ts` — cohort logic unchanged.
- `applyCohortAdjustmentOnce` — unchanged. The cohort delta still applies after `computeCampaignHealth`.
- `optimized: Set<string>` state + cloud-sync helpers (`toggleOptimized`, `readOptimized`, `clearAllOptimized`) — kept, drive row badges.
- `isCampaignOff(...)` helper — kept, drives the "off" chip on rows.

---

## Task 1: Core algorithm — `campaignHealthScore.ts` + its tests

This task is one logical change but the algorithm and its tests must move together (the tests assert removed behaviour). Bundling them keeps the tree green.

**Files:**
- Modify: `dashboard-web/src/lib/campaignHealthScore.ts`
- Modify: `dashboard-web/src/lib/__tests__/campaignHealthScore.test.ts`

- [ ] **Step 1: Update `HealthScoreInputs` type (remove 2 fields)**

In `campaignHealthScore.ts` around line 86, change:

```ts
export type HealthScoreInputs = {
  aggregated: Aggregated;
  trueRevenueInfo: TrueRevenueInfo | undefined;
  cpmRoasAnalysis: CpmRoasAnalysis | undefined;
  optimized: boolean;
  isCurrentlyOff: boolean;
};
```

to:

```ts
export type HealthScoreInputs = {
  aggregated: Aggregated;
  trueRevenueInfo: TrueRevenueInfo | undefined;
  cpmRoasAnalysis: CpmRoasAnalysis | undefined;
};
```

- [ ] **Step 2: Update `HealthScoreComponents` type (remove `operatorAdjustment` field + its JSDoc)**

Around line 50-57, remove the entire JSDoc block + field:

```ts
  /** Net operator adjustment applied after the weighted sum: +15 if
   *  optimized, −30 if currently off (can stack). NOT a 0..100 score. */
  operatorAdjustment: number;
```

`HealthScoreComponents` should now have exactly 5 numeric fields: `profitability`, `volume`, `trajectory`, `attributionClarity`, `cohortAdjustment`.

- [ ] **Step 3: Delete `applyOperatorAdjustment` function**

Around lines 352-371, delete this entire function:

```ts
function applyOperatorAdjustment(
  optimized: boolean,
  isCurrentlyOff: boolean,
): { delta: number; reasons: string[] } {
  let delta = 0;
  const reasons: string[] = [];
  if (optimized) {
    delta += 15;
    reasons.push('+15 — מסומן כאופטימיזציה פעילה (האופרטור ערב לקמפיין)');
  }
  if (isCurrentlyOff) {
    delta -= 30;
    reasons.push('−30 — קמפיין כבוי כעת (הנתונים היסטוריים בלבד)');
  }
  return { delta, reasons };
}
```

- [ ] **Step 4: Simplify `computeCampaignHealth`**

Around line 401, the function currently destructures the two flags and applies the operator delta. Replace the function body with the data-pure version:

```ts
export function computeCampaignHealth(inputs: HealthScoreInputs): CampaignHealth {
  const { aggregated, trueRevenueInfo, cpmRoasAnalysis } = inputs;

  if (isInsufficient(aggregated)) {
    return {
      score: 0,
      grade: 'unknown',
      components: {
        profitability: 0,
        volume: 0,
        trajectory: 0,
        attributionClarity: 0,
        cohortAdjustment: 0,
      },
      reasons: [
        `הוצאה $${aggregated.spend.toFixed(0)} CAD ${
          aggregated.conversions === 0 ? '+ 0 המרות' : ''
        } — מדגם קטן מדי לציון אמין. חכה שיצטברו נתונים.`,
      ],
      insufficient: true,
    };
  }

  const profitability = scoreProfitability(aggregated, trueRevenueInfo);
  const volume = scoreVolume(aggregated.spend);
  const trajectory = scoreTrajectory(cpmRoasAnalysis);
  const attribution = scoreAttributionClarity(trueRevenueInfo);

  // Renormalize weights when trajectory has no data (Audit fix 2026-05-23
  // HR-03) — kept as-is.
  const hasTrajectoryData = !!(cpmRoasAnalysis && cpmRoasAnalysis.hasData);
  let weightedSubtotal: number;
  if (hasTrajectoryData) {
    weightedSubtotal =
      profitability.score * WEIGHTS.profitability +
      volume.score * WEIGHTS.volume +
      trajectory.score * WEIGHTS.trajectory +
      attribution.score * WEIGHTS.attributionClarity;
  } else {
    const knownWeightSum =
      WEIGHTS.profitability + WEIGHTS.volume + WEIGHTS.attributionClarity;
    const scaleFactor = 1.0 / knownWeightSum;
    weightedSubtotal =
      profitability.score * WEIGHTS.profitability * scaleFactor +
      volume.score * WEIGHTS.volume * scaleFactor +
      attribution.score * WEIGHTS.attributionClarity * scaleFactor;
  }

  // Phase 14 — operator flags (optimized / isCurrentlyOff) no longer affect
  // the score. They remain row badges. Score = pure weighted sum of
  // data-derived components; cohort adjustment may still apply via
  // applyCohortAdjustmentOnce downstream of this function.
  const finalScore = Math.round(Math.max(0, Math.min(100, weightedSubtotal)));

  return {
    score: finalScore,
    grade: gradeFor(finalScore),
    components: {
      profitability: profitability.score,
      volume: volume.score,
      trajectory: trajectory.score,
      attributionClarity: attribution.score,
      cohortAdjustment: 0,
    },
    reasons: [profitability.reason, volume.reason, trajectory.reason, attribution.reason],
    insufficient: false,
  };
}
```

Key changes vs. the current code:
- Destructure drops `optimized, isCurrentlyOff`.
- The insufficient short-circuit's `components` no longer carries `operatorAdjustment: 0`.
- The post-weighted-sum no longer adds `op.delta`.
- The final return's `components` drops `operatorAdjustment`.
- `reasons` drops `...op.reasons`.

- [ ] **Step 5: Update the test helper + drop operator-effect tests**

In `dashboard-web/src/lib/__tests__/campaignHealthScore.test.ts`:

**5a.** Around lines 100-110, the `buildInputs` helper currently sets `optimized: patch.optimized ?? false` and `isCurrentlyOff: patch.isCurrentlyOff ?? false`. Remove both of those defaults — the helper should no longer pass them through:

```ts
function buildInputs(patch: Partial<{
  aggregated: Aggregated;
  trueRevenueInfo: TrueRevenueInfo;
  cpmRoasAnalysis: CpmRoasAnalysis;
}> = {}): HealthScoreInputs {
  return {
    aggregated: patch.aggregated ?? defaultAggregated,
    trueRevenueInfo: patch.trueRevenueInfo ?? defaultTrueRevenue,
    cpmRoasAnalysis: patch.cpmRoasAnalysis,
  };
}
```

(Adjust naming to match the existing file — keep its `defaultAggregated` / `defaultTrueRevenue` identifiers if present. If the helper's Partial type has different existing fields, prune ONLY the two operator fields.)

**5b.** Around line 124, the components matcher includes `operatorAdjustment: expect.any(Number)`. Remove that line — the matcher should now have only 5 component fields (no operatorAdjustment).

**5c.** Around line 543-571, DELETE the entire `describe('operator adjustment', ...)` block (or whatever the surrounding describe is called) — these tests assert the +15/−30 behaviour that we just removed:

```ts
  it('+15 when optimized=true', () => {
    const boosted = computeCampaignHealth(buildInputs({ optimized: true }));
    // ... asserts boosted.components.operatorAdjustment === 15
  });

  it('−30 when isCurrentlyOff=true', () => { ... });
  it('+15 − 30 = −15 when both flags set', () => { ... });
```

Find the `describe(...)` block that owns the three operator-related `it()` blocks at lines 543, 551, 558 and delete the whole describe.

**5d.** Around lines 679, 690 — additional callers of `optimized: ... isCurrentlyOff: ...` in non-operator-focused tests. For each, drop the two flags from the `buildInputs(...)` arg or the `computeCampaignHealth({ ... })` arg. If the test's intent depended on the operator effect, delete the test entirely (rare; most likely they were testing other paths and the flags were just defaults).

**5e.** Around line 725, the `components` matcher in another test asserts `operatorAdjustment: 0`. Remove that line.

**5f.** Search the file ONE more time for `operatorAdjustment`, `optimized:`, `isCurrentlyOff:` — every remaining hit must be removed or the test will fail.

- [ ] **Step 6: Run the test file, confirm green**

```bash
cd /Users/dorperetz/script-roas/dashboard-web && npx vitest run src/lib/__tests__/campaignHealthScore.test.ts
```
Expected: all remaining tests pass. Net count will DROP by ~3-5 tests (the deleted operator-effect ones) — that's correct; we removed the behaviour they tested.

- [ ] **Step 7: tsc — the source-file changes break downstream callers (CampaignsTable + 3 components + aiReport)**

```bash
cd /Users/dorperetz/script-roas/dashboard-web && npx tsc --noEmit 2>&1 | tail -20
```
Expected: tsc errors in `CampaignsTable.tsx`, `HealthScorePanel.tsx`, `HealthScoreBadge.tsx`, `aiReport.ts` because they reference removed properties. Those are addressed in Tasks 2-4. DO NOT commit yet — staged changes here will be combined with a working commit only after the downstream files compile too.

- [ ] **Step 8: Hold this work uncommitted; move to Task 2**

The tests pass for `campaignHealthScore.ts` but the project as a whole doesn't tsc. Task 2 fixes that immediately. Once Task 4 lands, the tree is green again and we can commit Tasks 1-4 together OR as separate commits if the implementer prefers.

For subagent-driven execution: the implementer for Task 1 commits the source + test changes anyway with the explicit message about the downstream breakage; downstream tasks resolve. This is one of the few cases where breaking tsc mid-chain is intentional and signalled.

```bash
cd /Users/dorperetz/script-roas && git add dashboard-web/src/lib/campaignHealthScore.ts dashboard-web/src/lib/__tests__/campaignHealthScore.test.ts && git commit -m "refactor(health-score): make computeCampaignHealth a pure function of data — drop operator flags

Removes HealthScoreInputs.optimized/isCurrentlyOff, drops applyOperatorAdjustment,
drops HealthScoreComponents.operatorAdjustment. Downstream callers break by design
(CampaignsTable + HealthScorePanel + HealthScoreBadge + aiReport) — fixed in
follow-up commits in this branch."
```

---

## Task 2: `CampaignsTable.tsx` call site

**Files:**
- Modify: `dashboard-web/src/components/CampaignsTable.tsx`

- [ ] **Step 1: Drop the two flag inputs from the `computeCampaignHealth` call**

Around lines 770-778, the current code reads:

```tsx
      const isOff = isCampaignOff(a.effectiveStatus, a.platform, a.lastActiveDate, today);
      const isOpt = optimized.has(a.key);
      const base = computeCampaignHealth({
        aggregated: a,
        trueRevenueInfo: info,
        cpmRoasAnalysis: trajectory,
        optimized: isOpt,
        isCurrentlyOff: isOff,
      });
```

Keep `isOff` and `isOpt` derivations (they still drive UI badges elsewhere in this file), but drop both flags from the call:

```tsx
      const isOff = isCampaignOff(a.effectiveStatus, a.platform, a.lastActiveDate, today);
      const isOpt = optimized.has(a.key);
      const base = computeCampaignHealth({
        aggregated: a,
        trueRevenueInfo: info,
        cpmRoasAnalysis: trajectory,
      });
```

If `isOff` or `isOpt` end up unused in this scope after the edit (i.e. they aren't referenced for anything besides the call we just shrank), check the rest of the function — they likely ARE consumed downstream as badge inputs. If not, remove them.

- [ ] **Step 2: tsc on this file**

```bash
cd /Users/dorperetz/script-roas/dashboard-web && npx tsc --noEmit 2>&1 | grep -E "CampaignsTable\.tsx" | head -5
```
Expected: no errors in CampaignsTable.tsx (other components may still fail until Task 3-4).

- [ ] **Step 3: Commit**

```bash
cd /Users/dorperetz/script-roas && git add dashboard-web/src/components/CampaignsTable.tsx && git commit -m "refactor(health-score): CampaignsTable — drop optimized/isOff inputs from computeCampaignHealth call"
```

---

## Task 3: `HealthScorePanel.tsx` + `HealthScoreBadge.tsx` — drop operatorAdjustment rendering

**Files:**
- Modify: `dashboard-web/src/components/HealthScorePanel.tsx`
- Modify: `dashboard-web/src/components/HealthScoreBadge.tsx`

- [ ] **Step 1: HealthScorePanel.tsx — drop the operatorAdjustment header block**

Around line 120-123:

```ts
  if (components.operatorAdjustment > 0) {
    // ...
  }
  if (components.operatorAdjustment < 0) {
    // ...
  }
```

Delete both `if (components.operatorAdjustment ...)` blocks. Read the actual code to determine the exact extent (likely 4-8 lines each, building a header string or array of badges).

- [ ] **Step 2: HealthScorePanel.tsx — drop the operatorAdjustment row from the breakdown**

Around line 212:

```tsx
          {health.components.operatorAdjustment !== 0 && (
            // ... row JSX
          )}
```

Delete the entire `{health.components.operatorAdjustment !== 0 && (...)}` block. Likely a `<div>` row inside the breakdown list showing "התאמת אופרטור" with the +15 / −30 value. Read to confirm and delete the full conditional.

- [ ] **Step 3: HealthScoreBadge.tsx — same removal in the popover**

Around line 192:

```tsx
              {health.components.operatorAdjustment !== 0 && (
                // ... row JSX
              )}
```

Delete the conditional block.

- [ ] **Step 4: tsc both files**

```bash
cd /Users/dorperetz/script-roas/dashboard-web && npx tsc --noEmit 2>&1 | grep -E "HealthScorePanel\.tsx|HealthScoreBadge\.tsx" | head -5
```
Expected: no errors in either.

- [ ] **Step 5: Commit**

```bash
cd /Users/dorperetz/script-roas && git add dashboard-web/src/components/HealthScorePanel.tsx dashboard-web/src/components/HealthScoreBadge.tsx && git commit -m "refactor(health-score): drop operatorAdjustment rendering from Panel + Badge"
```

---

## Task 4: `aiReport.ts` + its test — drop operatorAdjustment reference

**Files:**
- Modify: `dashboard-web/src/lib/aiReport.ts`
- Modify: `dashboard-web/src/lib/__tests__/aiReportTikTokStatus.test.ts` (only if it asserts the operator-adjusted score)

- [ ] **Step 1: aiReport.ts — drop the operatorAdjustment label**

Around lines 1327-1329:

```ts
        comp.operatorAdjustment === 0
          ? '0'
          : (comp.operatorAdjustment > 0 ? '+' : '') + comp.operatorAdjustment;
```

Read the surrounding context (likely a switch / object literal building per-component label strings). Find the entry / case for `operatorAdjustment` and DELETE it entirely. The AI report's component-list assembly will then have 4-5 components instead of 6 — verify the surrounding code's loop / object iteration handles the smaller component set automatically (it likely iterates `Object.entries(comp)` or similar, in which case no further change is needed).

If the surrounding code has a HARD-CODED list of components (e.g. an array `['profitability', 'volume', 'trajectory', 'attribution', 'operator', 'cohort']`), drop `'operator'` from that list too.

- [ ] **Step 2: aiReportTikTokStatus.test.ts — update only if it asserts operator behaviour**

```bash
grep -nE "operatorAdjustment|optimized:|isCurrentlyOff:" dashboard-web/src/lib/__tests__/aiReportTikTokStatus.test.ts
```

For each hit:
- If the test asserts that the AI report mentions operator-adjusted scores, update or delete the assertion (the AI report no longer includes that label).
- If the test passes `optimized` / `isCurrentlyOff` as part of constructing test inputs for some path that ultimately calls into the health score, the inputs should no longer be needed — drop them or leave the test if it still passes with default behaviour.

- [ ] **Step 3: Full type check + targeted tests**

```bash
cd /Users/dorperetz/script-roas/dashboard-web && npx tsc --noEmit 2>&1 | tail -5 && npx vitest run src/lib/__tests__/campaignHealthScore.test.ts src/lib/__tests__/aiReportTikTokStatus.test.ts 2>&1 | tail -5
```
Expected: tsc clean; both test files green.

- [ ] **Step 4: Full suite**

```bash
cd /Users/dorperetz/script-roas/dashboard-web && npm test 2>&1 | tail -5
```
Expected: all tests pass. Net count should drop by the ~3-5 deleted operator tests; everything else green.

- [ ] **Step 5: Commit**

```bash
cd /Users/dorperetz/script-roas && git add dashboard-web/src/lib/aiReport.ts dashboard-web/src/lib/__tests__/aiReportTikTokStatus.test.ts && git commit -m "refactor(health-score): aiReport — drop operatorAdjustment label + update test"
```

---

## Task 5: Docs + merge + live verify

**Files:**
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/ROAS-Dashboard-User-Manual.md`

- [ ] **Step 1: ARCHITECTURE.md update**

Find the existing Health Score section (search for "Health Score" or "computeCampaignHealth"). Append:

```markdown
### Score purity — Phase 14 (2026-05-28)

`computeCampaignHealth` is a pure function of campaign data. Two flags that
previously biased the score were removed:
- `optimized=true` previously added +15 — REMOVED.
- `isCurrentlyOff=true` previously subtracted 30 — REMOVED.

Both flags survive as visual annotations on each `CampaignsTable` row (the
"סמן כאופטימיזציה" checkbox + cloud-sync via `roas-campaign-optimized-changed`
event, and the off-chip from `isCampaignOff(...)`). They no longer feed into
`HealthScoreInputs` or `HealthScoreComponents`; ticking the operator mark is
now a passive annotation that does not move the score number.

The cohort adjustment (`applyCohortAdjustmentOnce`) is data-derived
(rank, cannibalization risk) and continues to apply downstream of
`computeCampaignHealth` exactly as before.
```

- [ ] **Step 2: User Manual update**

Append near other operator-facing Health Score documentation:

```markdown
### סימון "אופטימיזציה" כבר לא משפיע על הציון

ה-checkbox "סמן כאופטימיזציה" (סימון אופטימיזציה פעילה על קמפיין) הוא **annotation בלבד** — הוא נשאר badge על השורה ומסונכרן ב-cloud בין הדפדפנים שלך, **אבל אינו משנה את ציון הבריאות**. אותו דבר לגבי קמפיין מושהה כרגע — ה-chip "כבוי" עדיין מופיע, אבל הציון לא יורד אוטומטית בגללו. הציון מבוסס רק על נתוני הקמפיין (ROAS, נפח, מגמת CPM↔ROAS, איכות שיוך, ועל הקשר ה-cohort אם רלוונטי).
```

- [ ] **Step 3: Commit docs**

```bash
cd /Users/dorperetz/script-roas && git add docs/ARCHITECTURE.md docs/ROAS-Dashboard-User-Manual.md && git commit -m "docs(health-score): ARCHITECTURE + User Manual — score is now data-pure"
```

- [ ] **Step 4: Final pre-merge verify**

```bash
cd /Users/dorperetz/script-roas/dashboard-web && npx tsc --noEmit && npm test 2>&1 | tail -5
```
Expected: tsc clean, full suite green (count drops by ~3-5 vs baseline due to deleted operator tests).

- [ ] **Step 5: Merge + push**

```bash
cd /Users/dorperetz/script-roas && git checkout main && git merge --no-ff health-score-pure-2026-05-28 -m "merge: Health Score — pure function of data (remove operator flags)" && git push origin main
```

Pre-push gates: tsc + vitest + lint + docs-currency (docs updated in Step 1-2 above).

- [ ] **Step 6: Wait for Vercel deploy + live verify**

```bash
echo "polling for deploy..."
for i in $(seq 1 12); do
  if curl -s --max-time 15 "https://roas-dashboard-smoky.vercel.app/" -o /tmp/idx.html; then
    chunk=$(grep -oE '/_next/static/chunks/app/page-[a-f0-9]+\.js' /tmp/idx.html | head -1)
    if [ -n "$chunk" ] && curl -s --max-time 15 "https://roas-dashboard-smoky.vercel.app${chunk}" | grep -qv "מסומן כאופטימיזציה פעילה"; then
      # The reason string is gone from the new bundle.
      echo "DEPLOY LIVE @ ~$((i*15))s: operator-adjustment reason string removed from bundle"; break
    fi
  fi
  if [ "$i" = "12" ]; then echo "still detecting old string after 3min"; fi
  sleep 15
done
```

Manual verification:
1. Open `/campaigns` in browser.
2. Pick any campaign and tick its "סמן כאופטימיזציה" checkbox.
3. Confirm: the row's "אופטימיזציה" badge appears, BUT the Health Score number does NOT change. Untick → badge disappears, score still unchanged.
4. For a campaign showing the "כבוי" chip: confirm its Health Score is no longer artificially low because of that chip.

---

## Self-review

**1. Spec coverage:**
- Spec § Removed from the score → Task 1 covers all 5 removals (input fields, function, component field, downstream destructure, downstream uses).
- Spec § Kept → no task needs to ADD anything for the kept items; verified the call site + helpers stay.
- Spec § Files affected → 8 files: Task 1 (1+1 test), Task 2 (1), Task 3 (2), Task 4 (1+1 test), Task 5 (2 docs) = 9 files total (includes both docs). The spec listed 7 code files + 1 ARCHITECTURE; this plan adds the User Manual for the operator-facing note. Acceptable expansion.
- Spec § Anti-misleading guarantees → no math change in cohort adjustment (Task 1 leaves `applyCohortAdjustmentOnce` untouched); `optimized` Set + cloud sync still drive badges (Task 2 explicitly KEEPS `isOpt`/`isOff` derivations).
- Spec § Out of scope → no weight rebalancing, no cohort logic touched, no rename, no removal of badges/sync.

**2. Placeholder scan:** No "TBD", no "Add appropriate error handling", no "similar to Task N". Each task contains complete code blocks for the changes. Step instructions naming "around line X" are paired with the literal current code shown verbatim so the implementer pattern-matches rather than guessing.

**3. Type consistency:** `HealthScoreInputs` (3 fields after Task 1), `HealthScoreComponents` (5 fields after Task 1 — `profitability, volume, trajectory, attributionClarity, cohortAdjustment`), `CampaignHealth.components` reflects the 5-field shape, `aiReport.ts` consumes `comp` which is `HealthScoreComponents` — uses the same shape Task 1 defines.

**4. Task ordering:** Task 1 deliberately leaves tsc broken until Task 4. This is signposted in Task 1 Step 7 + commit message. The subagent flow is robust to this — the implementer reads the plan top-down, commits Task 1, runs subsequent tasks, tree fixes by Task 4.
