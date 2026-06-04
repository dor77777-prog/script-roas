import { Badge } from './Badge';
import { HelpTooltip } from './Tooltip';

/**
 * Wave 3 · Data-Trust — DQ-3 · OverrideFlag.
 *
 * A "● ידני" (manual) chip surfaced next to a number whose value comes from a
 * manual override (e.g. ad-spend during an account outage). It tells the
 * operator "don't fully trust this as a live/source-pulled figure — a human
 * pinned it". Matches docs/superpowers/mockups/2026-06-04-data-trust/
 * data-trust.html (the `.badge.warning` "● ידני" chip on the Hero/P&L spend
 * cell + its hover note).
 *
 * Pure presentational: it ALWAYS renders. The PARENT decides whether to mount
 * it (i.e. only when an override actually exists in range). Built from the
 * shared primitives only — Badge (tone="warning" → paired on-color tokens,
 * AA in both themes) wrapped in HelpTooltip (native `title=` is BANNED).
 *
 * The tooltip body is the override note, plus — when present — a "· עודכן
 * <lastEditedAt>" suffix (e.g. «השבתת-חשבון 1-8/5 · עודכן 12/5 14:30»). When
 * neither is supplied the HelpTooltip's null/'' passthrough leaves the badge
 * tooltip-less rather than opening an empty surface.
 */
export function OverrideFlag({
  note,
  lastEditedAt,
}: {
  note?: string;
  lastEditedAt?: string;
}) {
  // Compose the tooltip body text. `note` carries the human reason;
  // `lastEditedAt` (when present) appends the "· עודכן <ts>" suffix. An empty
  // result (both omitted) means there's nothing to explain.
  const editedSuffix = lastEditedAt ? `· עודכן ${lastEditedAt}` : '';
  const text =
    note && editedSuffix ? `${note} ${editedSuffix}` : note || editedSuffix;

  // Wrap the text in a <span> ReactNode so the help surfaces as a tap/click
  // affordance (HelpTooltip auto-promotes non-string content), which works on
  // a non-focusable Badge span in both pointer modes. When there's no text,
  // pass null so HelpTooltip's passthrough leaves the badge tooltip-less.
  const content = text ? <span>{text}</span> : null;

  return (
    <HelpTooltip content={content}>
      <Badge tone="warning">● ידני</Badge>
    </HelpTooltip>
  );
}
