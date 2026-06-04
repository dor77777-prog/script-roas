import { Badge } from './Badge';
import { HelpTooltip } from './Tooltip';

/**
 * Wave 3 · Data-Trust — DQ-4 · ProvenanceFlag.
 *
 * A trust chip surfaced next to a Hero / P&L number that tells the operator
 * HOW MUCH to trust it — is the figure a live estimate or a finalized one?
 * Matches docs/superpowers/mockups/2026-06-04-data-trust/data-trust.html
 * (the `.badge.info` "אומדן חי" + `.badge.success` "סופי" chips on the Hero/
 * P&L cells).
 *
 * Three verdicts:
 *   • 'live_estimate' → an info (blue) "אומדן חי" badge. The number is built
 *     from a live tick every ~10 min and is NOT yet final; it locks in
 *     overnight at reconcile. The caveat lives in a HelpTooltip (native
 *     `title=` is BANNED by the lint guard).
 *   • 'finalized'     → a success (green) "סופי" badge. The number is
 *     authoritative — no tooltip, nothing to caveat.
 *   • 'unknown'       → renders nothing (return null). A historical row
 *     WITHOUT a freshness flag must not show a false "אומדן" tag.
 *
 * Pure presentational. Built from the shared primitives only — Badge (tone
 * blue/green → paired on-color tokens, AA in both themes) + HelpTooltip. The
 * mockup's semantic "info"/"success" map to the Badge primitive's `blue`/
 * `green` tones (same status-* tokens the `.badge.info`/`.badge.success`
 * mockup rules mirror).
 */
export function ProvenanceFlag({
  verdict,
}: {
  verdict: 'finalized' | 'live_estimate' | 'unknown';
}) {
  if (verdict === 'unknown') {
    // No flag on a freshness-less (historical) row — never a false estimate.
    return null;
  }

  if (verdict === 'live_estimate') {
    return (
      <HelpTooltip content="מבוסס על tick חי כל ~10 דק׳; ננעל סופית בריקונסיילי הלילה">
        <Badge tone="blue">אומדן חי</Badge>
      </HelpTooltip>
    );
  }

  // 'finalized' — authoritative, no caveat tooltip.
  return <Badge tone="green">סופי</Badge>;
}
