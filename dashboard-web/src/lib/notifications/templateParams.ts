// Phase 05.7.4 — Build the 5-parameter array for the `roas_daily_summary`
// Meta template. TS port of `Notifications.gs:buildTemplateParameters_`
// at lines 347-386.
//
// Meta is strict about parameter count matching the {{N}} placeholders in
// the approved template. The `roas_daily_summary` template has exactly 5:
//   {{1}} = date + time title (e.g. "12:00, 20/05/2026")
//   {{2}} = store 1 block (or "—" if missing)
//   {{3}} = store 2 block (or "—" if missing)
//   {{4}} = store 3 block (or "—" if missing)
//   {{5}} = grand-totals block (or "אין נתונים זמינים" if no data)
//
// === CRITICAL: NO newlines / tabs / 5+ consecutive spaces inside a param ===
//
// 2026-05-21 first-pass shipped with `\n` separators inside each block (the
// Apps Script version's format from when it was used for freeform Twilio
// messages too). Meta rejected with error 132018:
//
//   "Param text cannot have new-line/tab characters or more than 4
//    consecutive spaces"
//
// Meta's approved template body ALREADY contains the blank lines BETWEEN
// {{N}} placeholders — each individual parameter must be a single-line
// string with inline separators. Format matches the user's original
// approved-template sample exactly:
//
//   🏪 uzoshop: • הוצאה: C$450 • הכנסות: C$1,890 • ROAS: 4.20 • הזמנות: 28  (פייסבוק: 18, גוגל: 6, אחרים: 4)
//
// Bullet separator: ` • ` (space-bullet-space). Order count + source
// breakdown keep the 2-space separator before the paren so the breakdown
// reads as a sub-clause (matches the sample on the approved template).

import type { DaySummary, StoreSummary } from './summary';

function formatRoas(roas: number): string {
  if (!Number.isFinite(roas) || roas === 0) return '—';
  return roas.toFixed(2);
}

function formatCad(amount: number): string {
  if (!Number.isFinite(amount)) return 'C$0';
  return 'C$' + Math.round(amount).toLocaleString('en-CA');
}

/**
 * Phase 05.7.x — CPM is reported with 2 decimals because the typical
 * value range is C$3-C$30 and operators care about sub-dollar moves
 * (a CPM creeping from C$6.40 → C$7.10 is the early-warning signal
 * for creative fatigue). Empty / zero impressions → '—' so the message
 * doesn't read "CPM: C$0" when impressions data is missing.
 */
function formatCpm(cpm: number): string {
  if (!Number.isFinite(cpm) || cpm <= 0) return '—';
  return 'C$' + cpm.toFixed(2);
}

// Phase 05.7.5 (2026-05-22): tiktok-paid orders are tracked as a separate
// bucket in `StoreSummary`, but the approved Meta WhatsApp template still
// has only 3 source slots — פייסבוק / גוגל / אחרים. Phase D will submit
// a new template with a 4th slot for טיקטוק; until then, we COMBINE
// tiktok-paid into "אחרים" so the WhatsApp output stays consistent with
// the prior count (no mysterious shift in "אחרים" once tiktok-paid starts
// classifying orders out of it).
function combinedOther(other: number, tiktok: number): number {
  return other + tiktok;
}

function storeBlock(s: StoreSummary): string {
  // Phase 05.7.x — appended `• CPM: C$X.XX` after ROAS. Position chosen
  // to keep the cost-side metrics (Spend → ROAS → CPM) clustered before
  // the volume-side (orders + breakdown). No Meta template change
  // required — the strings inside {{N}} placeholders are operator-set.
  return (
    '🏪 ' +
    s.storeName +
    ': • הוצאה: ' +
    formatCad(s.totalSpend) +
    ' • הכנסות: ' +
    formatCad(s.revenue) +
    ' • ROAS: ' +
    formatRoas(s.roas) +
    ' • CPM: ' +
    formatCpm(s.cpm) +
    ' • הזמנות: ' +
    s.orders +
    '  (פייסבוק: ' +
    s.facebook +
    ', גוגל: ' +
    s.google +
    ', אחרים: ' +
    combinedOther(s.other, s.tiktok) +
    ')'
  );
}

function totalsBlock(t: DaySummary['totals']): string {
  return (
    '🎯 סה"כ: • הוצאה: ' +
    formatCad(t.spend) +
    ' • הכנסות: ' +
    formatCad(t.revenue) +
    ' • ROAS: ' +
    formatRoas(t.roas) +
    ' • CPM: ' +
    formatCpm(t.cpm) +
    ' • הזמנות: ' +
    t.orders +
    '  (פייסבוק: ' +
    t.facebook +
    ', גוגל: ' +
    t.google +
    ', אחרים: ' +
    combinedOther(t.other, t.tiktok) +
    ')'
  );
}

// ────────────────────────────────────────────────────────────────────────
// V2 template (`roas_daily_summary_v2`) — multi-line, scannable layout.
//
// Meta forbids new-lines INSIDE a parameter value (error 132018), but the
// approved template BODY may contain them. So v2's body holds the static
// scaffold (header, the 💰/💸/🛒 labels, the band legend, separators, all the
// line breaks) while these 17 params fill ONLY the dynamic values — each a
// single line. 17 (not 21): spend+CPM are bundled into one value so Meta's
// variable-to-body-length ratio passes ("too many variables for its length").
// Body placeholder map (see the Meta-submission doc):
//   {{1}}              = subtitle (date/time · descriptor)
//   {{2..5}}           = totals block: header, revenue, spend+cpm, ordersLine
//   {{6..9}} / {{10..13}} / {{14..17}} = the 3 stores, same 4-field shape.
// The body around the value params is e.g. `💰 הכנסות: {{3}}` and
// `💸 הוצאה: {{4}}`, so no two params are ever adjacent.
// ────────────────────────────────────────────────────────────────────────

export const V2_TEMPLATE_NAME = 'roas_daily_summary_v2';

/** ROAS health band → status dot, mirroring the dashboard bands
 *  (<2 red, 2–3 orange, 3+ green; ⚪ when the store had no sales). */
function bandEmoji(roas: number, hasSales: boolean): string {
  if (!hasSales || !Number.isFinite(roas) || roas <= 0) return '⚪';
  if (roas >= 3) return '🟢';
  if (roas >= 2) return '🟠';
  return '🔴';
}

/** Per-source order breakdown, omitting zero buckets. TikTok gets its OWN
 *  slot in v2 (v1 folded it into "אחר"). Empty string when no orders. */
function sourcesStr(fb: number, google: number, tiktok: number, other: number): string {
  const parts: string[] = [];
  if (fb > 0) parts.push(`Meta ${fb}`);
  if (google > 0) parts.push(`Google ${google}`);
  if (tiktok > 0) parts.push(`TikTok ${tiktok}`);
  if (other > 0) parts.push(`אחר ${other}`);
  return parts.join(' · ');
}

/** "🛒"-line value: count (singular הזמנה / plural הזמנות) + source breakdown. */
function ordersLine(orders: number, sources: string): string {
  const word = orders === 1 ? 'הזמנה' : 'הזמנות';
  return sources ? `${orders} ${word} · ${sources}` : `${orders} ${word}`;
}

/** The 4 value-params for one block (totals or a store): header line,
 *  revenue, spend+CPM (bundled — same rendered line, one fewer variable so
 *  Meta's variable-to-length ratio passes), orders-line. */
function blockParamsV2(opts: {
  label: string;
  roas: number;
  revenue: number;
  spend: number;
  cpm: number;
  orders: number;
  fb: number;
  google: number;
  tiktok: number;
  other: number;
}): string[] {
  const hasSales = opts.orders > 0 || opts.revenue > 0;
  const emoji = bandEmoji(opts.roas, hasSales);
  const header = hasSales
    ? `${emoji} *${opts.label} · ROAS ${formatRoas(opts.roas)}*`
    : `⚪ *${opts.label} · ללא מכירות*`;
  return [
    header,
    formatCad(opts.revenue),
    `${formatCad(opts.spend)} · CPM ${formatCpm(opts.cpm)}`,
    ordersLine(opts.orders, sourcesStr(opts.fb, opts.google, opts.tiktok, opts.other)),
  ];
}

/**
 * Build the 17-element parameter array for the `roas_daily_summary_v2`
 * template. Same store ordering + missing-store padding contract as v1
 * (sorted by storeName; missing slots padded so Meta always gets exactly
 * 17 non-empty params). Used for ALL three daily sends — only {{1}} (the
 * title/descriptor) differs between noon / evening / EOD.
 */
export function buildTemplateParametersV2(
  summary: DaySummary | null,
  title: string,
): string[] {
  const params: string[] = [title];

  if (summary && summary.totals) {
    const t = summary.totals;
    params.push(
      ...blockParamsV2({
        label: 'סה״כ',
        roas: t.roas,
        revenue: t.revenue,
        spend: t.spend,
        cpm: t.cpm,
        orders: t.orders,
        fb: t.facebook,
        google: t.google,
        tiktok: t.tiktok,
        other: t.other,
      }),
    );
  } else {
    params.push('⚪ *סה״כ · אין נתונים*', 'C$0', 'C$0 · CPM —', '0 הזמנות');
  }

  const storeIds =
    summary && summary.stores
      ? Object.keys(summary.stores).sort((a, b) =>
          (summary.stores[a]?.storeName ?? a).localeCompare(
            summary.stores[b]?.storeName ?? b,
          ),
        )
      : [];
  for (let i = 0; i < 3; i++) {
    const sid = storeIds[i];
    if (sid && summary) {
      const s = summary.stores[sid];
      params.push(
        ...blockParamsV2({
          label: s.storeName,
          roas: s.roas,
          revenue: s.revenue,
          spend: s.totalSpend,
          cpm: s.cpm,
          orders: s.orders,
          fb: s.facebook,
          google: s.google,
          tiktok: s.tiktok,
          other: s.other,
        }),
      );
    } else {
      // Always-3-stores in practice; pad so Meta gets 17 non-empty params.
      params.push('—', '—', '—', '—');
    }
  }
  return params;
}

/**
 * Build the 5-element parameter array for the approved Meta template.
 *
 * Store order follows the summary.stores insertion order. When fewer than
 * 3 stores have rows for the requested date, the missing slots receive
 * "—" so the template always gets exactly 5 parameters (Meta rejects
 * partial parameter lists).
 */
export function buildTemplateParameters(
  summary: DaySummary | null,
  title: string,
): string[] {
  const params: string[] = [title];
  // Audit fix 2026-05-23 (CR-02 health-and-conclusions): the previous
  // `Object.keys(summary.stores)` returned insertion order from the
  // upstream Supabase query (`summary.ts:99` — no ORDER BY clause).
  // Supabase's planner may pick different physical-storage orders across
  // days (after writes/vacuums), so the same store would land in {2} on
  // Monday and {3} on Tuesday. Operator glancing at the WhatsApp message
  // would mis-attribute spend to the wrong store.
  //
  // Sort by storeName so the position of each store is deterministic and
  // explainable. localeCompare keeps Hebrew/English mixed names sane.
  const storeIds = summary && summary.stores
    ? Object.keys(summary.stores).sort((a, b) =>
        (summary.stores[a]?.storeName ?? a).localeCompare(
          summary.stores[b]?.storeName ?? b,
        ),
      )
    : [];
  for (let i = 0; i < 3; i++) {
    const sid = storeIds[i];
    if (sid && summary) {
      params.push(storeBlock(summary.stores[sid]));
    } else {
      params.push('—');
    }
  }
  if (summary && summary.totals) {
    params.push(totalsBlock(summary.totals));
  } else {
    params.push('אין נתונים זמינים');
  }
  return params;
}
