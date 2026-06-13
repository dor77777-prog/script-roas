// eslint-rules/no-cross-palette-import.js
//
// Wave-1 Task 1.2 — enforces the Q1 cross-palette guarantee.
//
//   Chart files  (RoasChart, QuadrantScatter, HeroOverview, any /chart/)
//     CANNOT consume `var(--band-*)` or `var(--status-*)`.
//     Charts are analytic surfaces — they consume the chart-platform
//     palette ONLY. ROAS-grading semantics belong to `data-band="..."`
//     attributes on parent cells, not chart fills.
//
//   Status/health files (HealthScore, SyncIndicator, FreshnessChip,
//                        FreshnessBadge, any /status/, any /health/)
//     CANNOT consume `var(--chart-platform-*)`.
//     Status is an operational surface — bleeding a brand-color from
//     the chart palette into a status pill misrepresents the signal.
//
// The rule inspects string literals + template-elements + JSX attribute
// values (including `style={{...}}` objects' string children) for the
// forbidden substrings. Mirrors the AST traversal shape of
// no-raw-button-in-components.js.

const CHART_FILE_RX =
  /(?:chart|RoasChart|HeroOverview|QuadrantScatter)/i;
const STATUS_FILE_RX =
  /(?:status|health|HealthScore|SyncIndicator|FreshnessChip|FreshnessBadge)/i;

// ── Allowlist (Horizon re-skin spec §3.2.2, operator-approved 2026-06-12) ──
// The ROAS target chart's LINE STROKE + AREA FILL are INTENTIONALLY the ROAS
// *band* colour (red/orange/green/blue/gray of the period-average ROAS). This
// supersedes the v2-plan Q1 chart↔band palette separation for this ONE surface:
// here the chart-line IS the grading signal, by operator decision. The single
// source of the `var(--band-*)` literals for that line is roasChartBand.ts (the
// pure band→stroke-var mapping module), so it is exempt from the cross-palette
// guard. Every OTHER chart file stays guarded — they may only reach band tokens
// via this allowlisted module's exported constant, never via a raw literal.
const BAND_LINE_EXEMPT_FILES = [
  '/components/home/roasChartBand.',
];

const BAND_RX = /var\(\s*--band-[a-z]+\b/;
const STATUS_RX = /var\(\s*--status-[a-z-]+\b/;
const CHART_PLATFORM_RX = /var\(\s*--chart-platform-[a-z]+\b/;

function isChartFile(filename) {
  // Match against basename, not full path — `/components/Dashboard.tsx`
  // would otherwise false-trigger on a containing "chart" directory.
  const base = filename.split('/').pop() || '';
  return CHART_FILE_RX.test(base);
}

function isStatusFile(filename) {
  const base = filename.split('/').pop() || '';
  return STATUS_FILE_RX.test(base);
}

function report(context, node, raw, forbidden, target) {
  const m = raw.match(forbidden);
  if (!m) return;
  // Strip `var(` prefix and any whitespace; re-add `var(` for the snippet.
  const tokenName = m[0].replace(/^var\(\s*/, '');
  context.report({
    node,
    message: `Cross-palette violation: ${target} file cannot consume "var(${tokenName})" — that token belongs to a different palette family. See Q1 in the v2 plan.`,
  });
}

export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Forbid cross-palette CSS-var imports. Charts cannot consume --band-* / --status-*; status/health surfaces cannot consume --chart-platform-*.',
    },
  },
  create(context) {
    const filename = context.getFilename();
    const isTest =
      filename.includes('.test.') || filename.includes('__tests__');
    if (isTest) return {};

    // Spec §3.2.2: the band-coloured ROAS chart-line mapping module is exempt —
    // its `var(--band-*)` literals are the operator-locked grading-as-line hue.
    const isBandLineExempt = BAND_LINE_EXEMPT_FILES.some(p =>
      filename.includes(p),
    );
    if (isBandLineExempt) return {};

    const inChart = isChartFile(filename);
    const inStatus = isStatusFile(filename);

    // A file is either chart, status, or neither. The two regexes are not
    // mutually exclusive on every basename, but in practice chart files
    // never satisfy the status regex and vice-versa.
    if (!inChart && !inStatus) return {};

    const visitText = (node, raw) => {
      if (typeof raw !== 'string') return;
      if (inChart) {
        report(context, node, raw, BAND_RX, 'chart');
        report(context, node, raw, STATUS_RX, 'chart');
      }
      if (inStatus) {
        report(context, node, raw, CHART_PLATFORM_RX, 'status/health');
      }
    };

    return {
      Literal(node) {
        visitText(node, node.value);
      },
      TemplateElement(node) {
        const raw = node.value && (node.value.cooked ?? node.value.raw);
        visitText(node, raw);
      },
    };
  },
};
