/**
 * Design-color GREEN-RATCHET guard (Wave-2 Task 2.1).
 *
 * The mesh re-skin defines a closed token vocabulary (canvas / glass / surface /
 * accent / status / ink / band / chart / sidebar — all dual-mode CSS vars wired
 * through tailwind.config.ts). Components MUST source every colour from those
 * tokens so the whole UI re-skins (and light/dark flips) by changing vars.
 *
 * This guard scans every component under `src/components/**` (excluding test /
 * stories files) for the FORBIDDEN escape hatches that break theming:
 *
 *   1. white / black literals      — bg|text|border|fill|divide|ring-white|black
 *   2. white/NN  black/NN          — slash-alpha on the white/black keywords
 *   3. raw Tailwind named palette   — (gray|slate|…|fuchsia)-NN on any utility
 *   4. inline colour literals       — #hex / rgb() / hsl() / oklch() in a
 *                                     className or style string
 *   5. slash-alpha on FLAT tokens   — (bg|text|border|ring)-(accent|canvas|ink|
 *                                     status-x)/NN. The flat tokens bind to a
 *                                     bare `var(--…)` with NO <alpha-value>
 *                                     channel (verified in tailwind.config.ts),
 *                                     so `/NN` silently DROPS its alpha — a
 *                                     visually-invisible footgun.
 *
 * EXPLICITLY ALLOWED (never flagged):
 *   • var(--…), color-mix(… var(--…) …), oklch(from var(--…) …)
 *   • arbitrary value classes [color:var(--…)]
 *   • the alpha-safe tint tokens bg-accent-bg / bg-accent-soft / text-accent-fg
 *     and the status *Bg / *Fg foreground/background tints (used WITHOUT /NN)
 *   • token utilities like bg-status-green / text-accent-fg / bg-glass-2 — the
 *     named-palette regex requires a COLOR-NAME-then-NUMBER, so these (no digit
 *     after the colour word) never match.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * RATCHET MECHANICS
 *
 * `MIGRATION_ALLOWLIST` holds the component paths (relative to src/components/)
 * that are NOT yet migrated. The test fails when:
 *
 *   (a) a file NOT on the allowlist has ≥1 violation       → regression guard
 *   (b) a file ON the allowlist has 0 violations           → stale entry; the
 *       file was fixed and MUST be removed from the list so the ratchet only
 *       ever shrinks.
 *
 * So: every time a component is migrated, delete its line here. The list can
 * never silently grow, and a fixed file can never silently stay on it.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const COMPONENTS_DIR = path.resolve(__dirname, '..', '..', 'components');

// ---------------------------------------------------------------------------
// MIGRATION ALLOWLIST — paths relative to src/components/.
// Files here are KNOWN to still carry ≥1 design-colour violation. As each is
// migrated to tokens, remove its line. A fixed file left on the list FAILS the
// test (forces the ratchet to shrink).
// ---------------------------------------------------------------------------
const MIGRATION_ALLOWLIST: string[] = [
  'AdSetTable.tsx',
  'AdsDrawer.tsx',
  'AiReportButton.tsx',
  'AnnotationsPanel.tsx',
  'AttributionAnalysisPanel.tsx',
  'BillingCsvImport.tsx',
  'BillingSettings.tsx',
  'CampaignDrawerStatusSection.tsx',
  'CampaignFreshnessChip.tsx',
  'CampaignsColumnsMenu.tsx',
  'CampaignsTable.tsx',
  'CampaignsTableRow.tsx',
  'CohortComparisonPanel.tsx',
  'CommandPalette.tsx',
  'Dashboard.tsx',
  'Filters.tsx',
  'FreshnessChip.tsx',
  'GoalTracker.tsx',
  'HealthScoreBadge.tsx',
  'HealthScorePanel.tsx',
  'InsightsBoard.tsx',
  'MetaShopifyReconciliation.tsx',
  'MonthlyTables.tsx',
  'PnLBreakdown.tsx',
  'ProductCentricView.tsx',
  'ProductChannelBreakdown.tsx',
  'ProductPickerModal.tsx',
  'ProductsTable.tsx',
  'RoasChart.tsx',
  'SectionIntro.tsx',
  'Sidebar.tsx',
  'SyncIndicator.tsx',
  'TabFreshnessHeader.tsx',
  'campaign-drawer/CampaignDrawerAdSets.tsx',
  'campaign-drawer/CampaignDrawerDaily.tsx',
  'campaign-drawer/CampaignDrawerOverview.tsx',
  'campaign-drawer/index.tsx',
  'home/ActivityFeed.tsx',
  'home/PerStoreRow.tsx',
  'home/RoasChartDateRangePicker.tsx',
  'home/RoasTargetChart.tsx',
  'operator/JobsTable.tsx',
  'operator/ManualOverridesCrud.tsx',
  'operator/OperatorSecretBanner.tsx',
  'operator/ResetData.tsx',
  'operator/StatusEventsFeed.tsx',
  'operator/SyncNowButtons.tsx',
  'operator/TokenFailuresTable.tsx',
  'operator/WhatsappTestButtons.tsx',
  'ui/AiInsightPill.tsx',
  'ui/Button.tsx',
  'ui/Card.tsx',
  // ui/InsightCard.tsx — MIGRATED in Wave-2 Task 2.2 (removed from allowlist)
  // ui/Stat.tsx        — MIGRATED in Wave-2 Task 2.2 (removed from allowlist)
];

// ---------------------------------------------------------------------------
// Forbidden-pattern detectors.
//
// Patterns are assembled from runtime-concatenated fragments so THIS test file
// never contains a literal forbidden class string (it lives outside the scanned
// dir anyway, but this keeps the intent self-documenting and copy-paste-safe).
//
// Each detector returns true if `line` carries that violation family.
// ---------------------------------------------------------------------------

const UTILITY = '(?:bg|text|border|fill|divide|ring|stroke|from|via|to|placeholder|caret|accent|outline|decoration|shadow)';

// 1 + 2 — white / black keyword literals, with or without /NN slash-alpha.
//   bg-white  text-white/65  border-white  bg-black/60  fill-white  divide-white
const WHITE_BLACK = new RegExp(
  '\\b' + UTILITY + '-' + '(?:white|black)' + '(?:/[0-9.]+)?\\b',
);

// 3 — raw Tailwind named palette: COLOR-NAME immediately followed by a NUMBER.
//   green-300  blue-700  text-emerald-500  bg-rose-100/40
// The trailing `-\\d{2,3}` is what protects token utilities (bg-status-green,
// text-accent-fg, bg-glass-2 → no colour-word-then-number, never matches).
const NAMED_COLORS =
  'gray|slate|zinc|neutral|stone|emerald|rose|amber|red|blue|green|teal|' +
  'violet|indigo|purple|pink|orange|yellow|cyan|sky|lime|fuchsia';
const NAMED_PALETTE = new RegExp(
  '\\b' + UTILITY + '-(?:' + NAMED_COLORS + ')-\\d{2,3}\\b',
);

// 4 — inline colour literals inside a class/style string.
//   #fff  #1a2b3c  rgb( / rgba(  hsl( / hsla(  oklch(  oklab(  lab(  lch(
// oklch(/color-mix( that read FROM a var are allowed (see ALLOW_INLINE below).
const HEX_LITERAL = /#[0-9a-fA-F]{3,8}\b/;
const FN_LITERAL = /\b(?:rgba?|hsla?|oklch|oklab|lab|lch|hwb)\s*\(/;

// 5 — slash-alpha on FLAT (no <alpha-value> channel) tokens.
//   bg-accent/10  border-ink/20  text-ink-muted/60  bg-status-greenBg/40
//   ring-status-red/30  text-accent/80  bg-canvas-1/50
// Matches the flat-token family followed by `/NN`. The alpha-SAFE tint tokens
// (bg-accent-bg / bg-accent-soft / text-accent-fg) are only allowed WITHOUT a
// trailing `/NN`, so they never reach this pattern.
const FLAT_TOKEN_ALPHA = new RegExp(
  // Use the SAME broad utility list as WHITE_BLACK/NAMED_PALETTE so gradient
  // stops (from-/via-/to-accent/[0.06]) are caught too, not just bg-/text-/etc.
  '\\b' + UTILITY + '-' +
    '(?:accent(?:-deep)?|canvas(?:-[12])?|ink(?:-[a-z]+)?|status-[a-zA-Z]+)' +
    // alpha can be a bare digit (`/10`) OR Tailwind's arbitrary bracketed
    // form (`/[0.04]`) — both silently drop on a flat (no <alpha-value>) token.
    '/(?:\\[[0-9.]+\\]|[0-9.]+)',
);

interface Detector {
  name: string;
  test: (line: string) => boolean;
}

const DETECTORS: Detector[] = [
  { name: 'white/black literal', test: (l) => WHITE_BLACK.test(l) },
  { name: 'raw named palette', test: (l) => NAMED_PALETTE.test(l) },
  { name: 'inline colour literal', test: (l) => inlineColorViolation(l) },
  { name: 'slash-alpha on flat token', test: (l) => FLAT_TOKEN_ALPHA.test(l) },
];

/**
 * Inline #hex / rgb()/hsl()/oklch() literals are forbidden, BUT:
 *   • oklch(from var(--…) …) and color-mix(… var(--…) …) are allowed — they
 *     derive from a token, they don't hardcode a colour.
 *   • a hex inside an svg path / data string isn't a colour literal either, but
 *     in practice component class/style strings don't carry those, and a stray
 *     hex IS a violation. We only suppress the var-derived function forms.
 */
function inlineColorViolation(line: string): boolean {
  if (HEX_LITERAL.test(line)) return true;
  if (FN_LITERAL.test(line)) {
    // Allow oklch(from var(--…) …) / color-mix(… var(--…) …) — the function
    // exists only to transform a token, so it's token-driven.
    const derivesFromVar = /\b(?:oklch|color-mix|rgba?|hsla?|oklab|lab|lch|hwb)\s*\([^)]*var\(--/.test(
      line,
    );
    if (derivesFromVar) return false;
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// File walk — every *.tsx under components/, excluding *.test.tsx / *.stories.tsx.
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

interface Violation {
  rel: string; // path relative to src/components/
  line: number;
  detector: string;
  snippet: string;
}

/** Scan one file and return every violation (line + detector + snippet). */
function scanFile(absPath: string): Violation[] {
  const rel = path.relative(COMPONENTS_DIR, absPath);
  const text = fs.readFileSync(absPath, 'utf8');
  const lines = text.split(/\r?\n/);
  const violations: Violation[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const d of DETECTORS) {
      if (d.test(line)) {
        violations.push({
          rel,
          line: i + 1,
          detector: d.name,
          snippet: line.trim().slice(0, 120),
        });
      }
    }
  }
  return violations;
}

// ---------------------------------------------------------------------------
// Run the scan ONCE; index violations by relative path.
// ---------------------------------------------------------------------------
const files = walk(COMPONENTS_DIR);
const violationsByFile = new Map<string, Violation[]>();
for (const abs of files) {
  const v = scanFile(abs);
  if (v.length > 0) {
    violationsByFile.set(path.relative(COMPONENTS_DIR, abs), v);
  }
}
const allowSet = new Set(MIGRATION_ALLOWLIST);

// ---------------------------------------------------------------------------
// Suite 1 — parser sanity. A structural accident that zeroes-out the scan
// (wrong dir, glob breaks) must not let the guard pass vacuously.
// ---------------------------------------------------------------------------
describe('design-color guard — parser sanity', () => {
  it('scans a non-trivial component inventory', () => {
    expect(
      files.length,
      `only ${files.length} component .tsx files found — walk() likely pointed at the wrong dir`,
    ).toBeGreaterThan(50);
  });
});

// ---------------------------------------------------------------------------
// Suite 2 — REGRESSION guard. Any file NOT on the allowlist with ≥1 violation
// fails. New code (and migrated files) can never introduce a forbidden colour.
// ---------------------------------------------------------------------------
describe('design-color guard — regression (off-allowlist files must be clean)', () => {
  it('no off-allowlist component carries a forbidden colour', () => {
    const offenders: string[] = [];
    for (const [rel, vs] of violationsByFile) {
      if (allowSet.has(rel)) continue;
      for (const v of vs) {
        offenders.push(`${v.rel}:${v.line} [${v.detector}]  ${v.snippet}`);
      }
    }
    if (offenders.length > 0) {
      throw new Error(
        `${offenders.length} forbidden design-colour usage(s) in NON-allowlisted ` +
          `component(s).\nEither fix them (use tokens) or — only if mid-migration — ` +
          `add the file to MIGRATION_ALLOWLIST:\n  ${offenders
            .slice(0, 60)
            .join('\n  ')}${offenders.length > 60 ? `\n  … +${offenders.length - 60} more` : ''}`,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Suite 3 — RATCHET. Every allowlisted file must STILL be dirty. A clean file
// on the list means it was migrated and the entry is stale — remove it.
// ---------------------------------------------------------------------------
describe('design-color guard — ratchet (allowlist may only shrink)', () => {
  it('every MIGRATION_ALLOWLIST entry still has ≥1 violation', () => {
    const stale = MIGRATION_ALLOWLIST.filter((rel) => !violationsByFile.has(rel));
    expect(
      stale,
      `These files are on MIGRATION_ALLOWLIST but now have ZERO violations — ` +
        `remove them so the ratchet shrinks:\n  ${stale.join('\n  ')}`,
    ).toHaveLength(0);
  });

  it('every MIGRATION_ALLOWLIST entry points at a real component file', () => {
    const missing = MIGRATION_ALLOWLIST.filter(
      (rel) => !fs.existsSync(path.join(COMPONENTS_DIR, rel)),
    );
    expect(
      missing,
      `MIGRATION_ALLOWLIST references nonexistent file(s):\n  ${missing.join('\n  ')}`,
    ).toHaveLength(0);
  });
});
