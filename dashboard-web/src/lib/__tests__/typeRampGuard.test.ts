/**
 * Type-ramp SUB-10.5px RATCHET guard (Horizon re-skin Wave 1, debt #5).
 *
 * The micro-typography anarchy debt: components scatter arbitrary
 * `text-[Npx]` literals, several of them at 8px / 9px — BELOW the ~10.5px
 * legibility floor. Wave 1 establishes a canonical type ramp in globals.css
 * (--fs-2xs … --fs-2xl, smallest step 0.65625rem = 10.5px) and this guard is
 * the CI ratchet that keeps the floor: no NEW sub-10.5px text literal may
 * enter `src/components`, and the existing baseline may only SHRINK.
 *
 * WHAT IS FLAGGED:
 *   Any `text-[Npx]` arbitrary-value class whose N (px) is < 10.5 — i.e. BELOW
 *   the floor. Note 10px counts (10 < 10.5); only 10.5px+ is legal.
 *   e.g. text-[8px]  text-[9px]  text-[10px]  text-[10.4px]
 *   NOT flagged: text-[10.5px]  text-[11px]  text-[12px]  text-[1.5rem]  …
 *   (rem/em arbitrary sizes are out of scope — the debt is px micro-text.)
 *
 * ──────────────────────────────────────────────────────────────────────────
 * RATCHET MECHANICS (mirrors designColorGuard.test.ts)
 *
 * `BASELINE_ALLOWLIST` maps each component path (relative to src/components/)
 * to the EXACT number of sub-10.5px offenders it currently carries. The test
 * fails when:
 *
 *   (a) a file NOT in the baseline has ≥1 offender            → NEW regression
 *   (b) a file IN the baseline has MORE offenders than listed → list grew
 *   (c) a file IN the baseline has FEWER offenders than listed → it was
 *       (partly) fixed; UPDATE the count down (or delete the line at 0) so
 *       the ratchet can only ever shrink.
 *
 * LATER WAVES drain this allowlist toward EMPTY: as each component migrates
 * its `text-[8px]/[9px]` chips onto the type-ramp tokens (var(--fs-2xs) etc.,
 * which is the smallest LEGAL step), lower or remove its count here. When the
 * map is empty the floor is fully enforced with zero exceptions.
 *
 * NOTE: this guard polices the legibility FLOOR only. Migrating the many
 * already-legal `text-[10px]/[11px]/[12px]` literals onto ramp tokens is a
 * separate follow-on (font-size migration) and is intentionally out of scope.
 *
 * SANCTIONED PATH: the ramp is exposed as the `text-fs-*` Tailwind utilities
 * (text-fs-2xs … text-fs-2xl, wired in tailwind.config.ts → var(--fs-*)).
 * Those are NOT raw px literals so they are never flagged here; the smallest,
 * text-fs-2xs (--fs-2xs = 0.65625rem = 10.5px), sits exactly on the floor.
 * Prefer text-fs-* over bare text-* — the legacy text-* scale has DIFFERENT
 * values (e.g. legacy text-xl = 20px vs ramp --fs-xl = 28px).
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const COMPONENTS_DIR = path.resolve(__dirname, '..', '..', 'components');

/** Legibility floor in px. The smallest ramp step (--fs-2xs) is 0.65625rem = this. */
const FLOOR_PX = 10.5;

// ---------------------------------------------------------------------------
// BASELINE ALLOWLIST — path (relative to src/components/) → offender COUNT.
// These are the sub-10.5px `text-[Npx]` literals that existed when the ramp +
// ratchet were introduced (the debt). Counts may only go DOWN. Drain to {}.
// ---------------------------------------------------------------------------
// The floor is 10.5px, so text-[10px] / text-[9px] / text-[8px] all count;
// only text-[10.5px]+ is legal. Counts captured at HEAD 5961952 (44 files /
// 241 offenders). Most are text-[10px]; the worst legibility cases are the
// 8px/9px chips. Counts may only DECREASE — later waves drain toward {}.
const BASELINE_ALLOWLIST: Record<string, number> = {
  // AdSetTable.tsx — DRAINED to 0 in W4.4 (Horizon ads/adset re-skin: the lone
  // sub-floor trust-chip literal text-[8px] → text-fs-2xs ramp token; removed
  // from allowlist).
  // AdsDrawer.tsx — DRAINED to 0 in W4.4 (Horizon ads-table re-skin: the 6
  // sub-floor literals — header eyebrow, ROAS sub-caption, error mono, trust
  // chip, first-click delta, Esc footer — → text-fs-2xs ramp token; removed
  // from allowlist).
  'AiReportButton.tsx': 1,
  // AnnotationsPanel.tsx — DRAINED to 0 in Wave 3.6 (Horizon event-log re-skin:
  // sub-floor form labels → text-fs-2xs ramp token; removed from allowlist).
  // AttributionAnalysisPanel.tsx — DRAINED to 0 in W4.5 (Horizon deep-analysis
  // re-skin + AA fix: the 6 sub-floor literals — score/ROAS captions, breakdown
  // labels, reasons/footer text — → text-fs-2xs ramp token; removed from allowlist).
  // BillingCsvImport.tsx — DRAINED to 0 in W6.2 (Horizon billing-CSV-import
  // re-skin: the 8 sub-floor literals — store-target/paste labels, date cell,
  // dup-warning, the 2-button micro-toggle wrapper + buttons, source chip —
  // → text-fs-2xs ramp token + the micro-toggle migrated onto SegmentedControl;
  // removed from allowlist).
  // BillingSettings.tsx — DRAINED to 0 in W6.2 (Horizon billing-settings re-skin:
  // all 25 sub-floor literals — header subtitle, tab-count badge, warning/detected
  // panels, source chips, store/notes captions, CAD unit spans, both edit-form
  // label grids + calc-toggle explainer — → text-fs-2xs ramp token; tabs +
  // calc-toggle migrated onto SegmentedControl, money routed through <Money>;
  // removed from allowlist).
  // CampaignDrawerStatusSection.tsx — DRAINED to 0 in Wave 4.3 (Horizon
  // status-section re-skin: the 3 configured/effective/delivery LTR caption
  // literals text-[10px] → text-fs-2xs ramp token; removed from allowlist).
  'CampaignsColumnsMenu.tsx': 3,
  // Wave 4 (debt #6): the CPM-expander chart block (10 sub-floor literals) was
  // extracted to campaigns/CpmTrendChart.tsx (which clears the floor) → 34 → 24.
  // W4.2 (Horizon CampaignsTable + Row + TopList re-skin): the remaining
  // sub-floor literals (summary tiles → Widget, toolbar → SegmentedControl,
  // thead stacked sub-labels, AttributionGapPanel tiles, Row status chips,
  // TopList ROAS caption) all migrated onto the text-fs-* ramp → all three
  // DRAINED to 0; removed from allowlist.
  // CohortComparisonPanel.tsx — DRAINED to 0 in W4.5 (Horizon deep-analysis
  // re-skin: the 13 sub-floor literals — status badge, "את/ה כאן" badge, section
  // subtitle + 8 table-head labels, cannibalization risk badge, educational
  // footer — → text-fs-2xs ramp token; removed from allowlist).
  'CommandPalette.tsx': 7,
  // CustomerValueTab.tsx — DRAINED to 0 in W5.3 (Horizon customers-tab re-skin:
  // the 2 sub-floor literals — the error-strip mono detail (now inside the
  // shared <StateBlock> error chrome) + the curve-explainer ⓘ trigger circle —
  // → text-fs-2xs ramp token; all other arbitrary-px type migrated onto the
  // text-fs-* ramp; removed from allowlist).
  // DetailTable.tsx — DRAINED to 0 in W6.6 (Horizon Trends + Detail re-skin:
  // the lone sub-floor literal — the "מגמת חנות" sparkline-column header
  // text-[10px] — → text-fs-2xs ramp token; root `<section bg-glass-1>` →
  // <Card>, the bare meta inset → bg-pill-track, money cells → <Money>, and the
  // per-store sparkline render deduped; removed from allowlist).
  // FirstClickCoverageChip.tsx — DRAINED to 0 in Wave 4 (Horizon
  // campaign-health re-skin: lone sub-floor coverage-% chip literal
  // text-[10px] → text-fs-2xs ramp token + bg-pill-track inset; removed
  // from allowlist).
  // GoalTracker.tsx — DRAINED to 0 in W6.1 (Horizon P&L-tab re-skin: all 23
  // sub-floor text-[10px] literals — pacing/result captions, status chips,
  // run-rate panel labels, carry-forward tag — → text-fs-2xs ramp token;
  // removed from allowlist).
  // HealthScoreBadge.tsx — DRAINED to 0 in Wave 4 (Horizon campaign-health
  // re-skin: lone sub-floor score-suffix literal text-[10px] → text-fs-2xs
  // ramp token, all popover px literals migrated onto text-fs-*; removed
  // from allowlist).
  // InsightsBoard.tsx — DRAINED to 0 in Wave 3.7 (Horizon insight-surfaces
  // re-skin: sub-floor scope badge + severity pill → text-fs-2xs ramp token;
  // removed from allowlist).
  // MetaShopifyReconciliation.tsx — DRAINED to 0 in W4.5 (Horizon deep-analysis
  // re-skin: the 5 sub-floor literals — Pearson-r eyebrow, r-values row, legend,
  // 2 explainer paragraphs — → text-fs-2xs ramp token; removed from allowlist).
  // MonthlyTables.tsx — DRAINED to 0 in W6.4 (Horizon Archive + monthly-tables
  // re-skin: the lone sub-floor literal — the "{n} חודשים" toolbar counter
  // text-[10px] — → text-fs-2xs ramp token; the mode rail moved onto
  // SegmentedControl; money cells routed through <Money>; removed from allowlist).
  // PaymentMethodsTab.tsx — DRAINED to 0 in W5.4 (Horizon payments-tab re-skin:
  // the lone sub-floor literal — the pm-error mono detail (now inside the shared
  // <StateBlock> error chrome) — → text-fs-2xs ramp token; all remaining text-2xs
  // eyebrows/cells migrated onto the text-fs-* ramp; removed from allowlist).
  // PnLBreakdown.tsx — DRAINED to 0 in W6.1 (Horizon P&L-cascade re-skin: all
  // 10 sub-floor text-[10px] literals — final-profit margin caption + CAD
  // unit spans, by-source thead/footnote, HeroStat CAD/sub captions, PnLLine
  // note/CAD/pct/running labels — → text-fs-2xs ramp token; money cells routed
  // through <Money>; removed from allowlist).
  // ProductCentricView.tsx — DRAINED to 0 in W6.5 (Horizon Products-pivot
  // re-skin: all 14 sub-floor literals — error mono detail, the 🔗 multi-mapped
  // chip, the platform-count chips, the 9 column-header labels, the
  // pixel↔Shopify delta chip, the status chip — → text-fs-2xs ramp token;
  // root `<section bg-glass-1>` → <Card>, insets → bg-pill-track, emoji →
  // lucide (Link2/Medal), money → <Money>; removed from allowlist).
  // ProductPickerModal.tsx — DRAINED to 0 in W4.4 (Horizon product-picker
  // re-skin: the 5 sub-floor literals — header eyebrow, store sub-line, error
  // mono, sales stats, 🔗-chip — → text-fs-2xs ramp token; removed from
  // allowlist).
  // ProductsTable.tsx — DRAINED to 0 in W6.5 (Horizon Products-table re-skin:
  // all 11 sub-floor literals — days counter, live badge, 4 bucket-header
  // metric labels, rank badge, units-per-order sub-line, summary days-count +
  // run-rate caption — → text-fs-2xs / text-fs-xs ramp tokens; period rail →
  // SegmentedControl, insets → bg-pill-track, 🏪 → lucide Store, money →
  // <Money>, breakpoint-hidden ברוטו/נטו unhidden (no-info-loss); removed from
  // allowlist).
  'SectionIntro.tsx': 1,
  // campaign-drawer/CampaignDrawerAds.tsx — DRAINED to 0 in Wave 4.3 (Horizon
  // ads sub-tab re-skin: the lone ad-set spend/conversions caption literal
  // text-[10px] → text-fs-2xs ramp token; removed from allowlist).
  // Wave 4 (debt #6): the CPM section (10 sub-floor literals) was extracted to
  // campaigns/CpmTrendChart.tsx → 11 → 1 (the lone remaining literal is the
  // spend↔value legend, which STAYS in this file).
  'campaign-drawer/CampaignDrawerDaily.tsx': 1,
  // campaign-drawer/CampaignDrawerOverview.tsx — DRAINED to 0 in Wave 4.3
  // (Horizon overview re-skin: the 🔗-chip text-[9px] + cross-campaign warning
  // text-[10px] → text-fs-2xs ramp token; removed from allowlist).
  // campaign-drawer/index.tsx — DRAINED to 0 in Wave 4.3 (Horizon drawer-root
  // re-skin: the unmapped-store hint text-[10px] + Esc-footer text-[10px] →
  // text-fs-2xs ramp token; removed from allowlist).
  // home/ChannelTruthPanel.tsx — DRAINED to 0 in Wave 3.8b (Horizon home-surfaces
  // re-skin: NC-ROAS caption + band-tag pill sub-floor literals → text-fs-2xs /
  // shared band-chip recipe; removed from allowlist).
  'home/RoasChartDateRangePicker.tsx': 2,
  'home/RoasTargetChart.tsx': 4,
  // home/StoreDetailModal.tsx — DRAINED to 0 in Wave 3.8 (Horizon store-detail
  // re-skin: sub-floor KPI label + top-campaign caption → text-fs-2xs ramp
  // token; removed from allowlist).
  // home/UnknownBucketPanel.tsx — DRAINED to 0 in Wave 3.8b (Horizon
  // unknown-bucket re-skin: per-store-row "הזמנות" label → text-fs-2xs ramp
  // token; removed from allowlist).
  // insights/ActionListPanel.tsx — DRAINED to 0 in Wave 3.7 (Horizon
  // insight-surfaces re-skin: sub-floor scope badge → text-fs-2xs; removed).
  // operator/ReconcilePanel.tsx — DRAINED to 0 in Wave 7 (Horizon operator-panel
  // re-skin: the sub-floor «מוסבר» soft-gap chip text-[10px] → the <Badge>
  // primitive, which sits on text-2xs ramp; removed from allowlist).
  'ui/ChartAnnotationPins.tsx': 1,
  'ui/InsightCard.tsx': 1,
  'ui/SourceBadge.tsx': 1,
  'ui/Stat.tsx': 5,
  'ui/chart/ChartTooltip.tsx': 1,
};

// ---------------------------------------------------------------------------
// Detector — arbitrary px text-size literal below the legibility floor.
// Assembled at runtime so this test file carries no literal forbidden class.
// Matches `text-[<number>px]` and extracts the numeric px value.
// ---------------------------------------------------------------------------
const TEXT_PX = new RegExp('\\btext-\\[(' + '\\d+(?:\\.\\d+)?' + ')px\\]', 'g');

interface Offender {
  rel: string; // path relative to src/components/
  line: number;
  px: number;
  snippet: string;
}

// ---------------------------------------------------------------------------
// File walk — every *.tsx under components/, excluding *.test/*.stories.
// ---------------------------------------------------------------------------
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.next') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__') continue;
      out.push(...walk(full));
      continue;
    }
    if (!entry.name.endsWith('.tsx')) continue;
    if (entry.name.endsWith('.test.tsx') || entry.name.endsWith('.stories.tsx')) continue;
    out.push(full);
  }
  return out;
}

/** Scan one file and return every sub-floor px text literal. */
function scanFile(absPath: string): Offender[] {
  const rel = path.relative(COMPONENTS_DIR, absPath);
  const text = fs.readFileSync(absPath, 'utf8');
  const lines = text.split(/\r?\n/);
  const offenders: Offender[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    TEXT_PX.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = TEXT_PX.exec(line)) !== null) {
      const px = parseFloat(m[1]);
      if (px < FLOOR_PX) {
        offenders.push({ rel, line: i + 1, px, snippet: line.trim().slice(0, 120) });
      }
    }
  }
  return offenders;
}

// ---------------------------------------------------------------------------
// Run the scan ONCE; index offenders by relative path.
// ---------------------------------------------------------------------------
const files = walk(COMPONENTS_DIR);
const offendersByFile = new Map<string, Offender[]>();
for (const abs of files) {
  const o = scanFile(abs);
  if (o.length > 0) {
    offendersByFile.set(path.relative(COMPONENTS_DIR, abs), o);
  }
}

// ---------------------------------------------------------------------------
// Suite 1 — parser sanity. A structural accident that zeroes-out the scan
// (wrong dir, glob breaks) must not let the guard pass vacuously.
// ---------------------------------------------------------------------------
describe('type-ramp guard — parser sanity', () => {
  it('scans a non-trivial component inventory', () => {
    expect(
      files.length,
      `only ${files.length} component .tsx files found — walk() likely pointed at the wrong dir`,
    ).toBeGreaterThan(50);
  });

  it('detects the documented baseline (debt is present, regex works)', () => {
    // At least the baseline files must still register offenders — otherwise the
    // detector silently stopped matching and the guard would pass vacuously.
    const totalBaseline = Object.values(BASELINE_ALLOWLIST).reduce((a, b) => a + b, 0);
    const totalFound = [...offendersByFile.values()].reduce((a, o) => a + o.length, 0);
    expect(
      totalFound,
      'sub-10.5px detector found ZERO offenders but a non-empty baseline exists — regex likely broke',
    ).toBeGreaterThanOrEqual(Math.min(1, totalBaseline));
  });
});

// ---------------------------------------------------------------------------
// Suite 2 — REGRESSION guard. Any file NOT in the baseline with ≥1 sub-floor
// literal fails. New code can never introduce sub-10.5px text.
// ---------------------------------------------------------------------------
describe('type-ramp guard — regression (off-baseline files must clear the floor)', () => {
  it('no off-baseline component carries a sub-10.5px text literal', () => {
    const regressions: string[] = [];
    for (const [rel, os] of offendersByFile) {
      if (rel in BASELINE_ALLOWLIST) continue;
      for (const o of os) {
        regressions.push(`${o.rel}:${o.line} text-[${o.px}px]  ${o.snippet}`);
      }
    }
    if (regressions.length > 0) {
      throw new Error(
        `${regressions.length} sub-10.5px text literal(s) in NON-baseline component(s). ` +
          `Sub-10.5px text is below the legibility floor — use a type-ramp token ` +
          `(smallest legal step var(--fs-2xs) = 0.65625rem = 10.5px, via text-fs-2xs) instead:\n  ${regressions
            .slice(0, 60)
            .join('\n  ')}${regressions.length > 60 ? `\n  … +${regressions.length - 60} more` : ''}`,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Suite 3 — RATCHET. Baseline counts may only SHRINK.
//   • a baseline file with MORE offenders than listed → it grew (fail)
//   • a baseline file with FEWER offenders than listed → it was fixed; lower
//     the count (or delete at 0) so the ratchet shrinks (fail until updated)
//   • a baseline entry pointing at a clean / nonexistent file → stale (fail)
// ---------------------------------------------------------------------------
describe('type-ramp guard — ratchet (baseline may only shrink)', () => {
  it('no baseline file exceeds its recorded offender count', () => {
    const grew: string[] = [];
    for (const [rel, expected] of Object.entries(BASELINE_ALLOWLIST)) {
      const actual = offendersByFile.get(rel)?.length ?? 0;
      if (actual > expected) {
        grew.push(`${rel}: baseline ${expected}, now ${actual} (+${actual - expected})`);
      }
    }
    expect(
      grew,
      `These baseline files gained sub-10.5px literals — the ratchet must not grow:\n  ${grew.join('\n  ')}`,
    ).toHaveLength(0);
  });

  it('no baseline file has FEWER offenders than recorded (lower the count when fixed)', () => {
    const shrank: string[] = [];
    for (const [rel, expected] of Object.entries(BASELINE_ALLOWLIST)) {
      const actual = offendersByFile.get(rel)?.length ?? 0;
      if (actual < expected) {
        shrank.push(
          `${rel}: baseline ${expected}, now ${actual} — lower the count to ${actual}` +
            (actual === 0 ? ' (or remove the line)' : ''),
        );
      }
    }
    expect(
      shrank,
      `These baseline files were (partly) fixed — update BASELINE_ALLOWLIST so the ` +
        `ratchet shrinks (later waves drain it toward {}):\n  ${shrank.join('\n  ')}`,
    ).toHaveLength(0);
  });

  it('every BASELINE_ALLOWLIST entry points at a real component file', () => {
    const missing = Object.keys(BASELINE_ALLOWLIST).filter(
      (rel) => !fs.existsSync(path.join(COMPONENTS_DIR, rel)),
    );
    expect(
      missing,
      `BASELINE_ALLOWLIST references nonexistent file(s):\n  ${missing.join('\n  ')}`,
    ).toHaveLength(0);
  });
});
