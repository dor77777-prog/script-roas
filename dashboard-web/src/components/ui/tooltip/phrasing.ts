import { isValidElement, type ReactNode, type ReactElement } from 'react';

/**
 * Tooltip-system-redesign — touch-path DOM-validity helper.
 *
 * The touch wrappers (Toggletip, RichSheet) normally pair the trigger child
 * with a sibling ⓘ `<button>` inside an `inline-flex` `<span>`. That is valid
 * when the child is PHRASING content (a `<span>`, `<b>`, a metric chip, …) — it
 * sits inline next to the ⓘ glyph. But when the child is a NON-PHRASING /
 * block-context element — a table row `<tr>`, a list item `<li>`, a table cell
 * `<td>`/`<th>`, a `<div>`/`<section>` — wrapping it in a `<span>` and adding a
 * sibling `<button>` emits invalid HTML (`<span><tr/>…</span>`,
 * `<span><li/>…</span>`) that breaks table/list layout.
 *
 * For those children the affordance is dropped and the child itself BECOMES the
 * tap trigger (via Radix `asChild`) — structurally valid, and consistent with
 * the desktop `asChild` model. The spec's open-Q3 explicitly flagged that ⓘ in
 * dense table cells is a density concern; this is the principled resolution:
 * keep the ⓘ for inline help, let row/list/cell triggers tap themselves.
 *
 * HTML host tags that are NON-PHRASING (cannot legally live inside a <span>,
 * and/or establish their own layout box / table-internal context). Anything not
 * in this set is treated as phrasing (gets the ⓘ-pairing wrapper). A custom
 * PascalCase component is assumed phrasing (it usually renders a span/chip) —
 * UNLESS it opts out by setting `Component.isBlockTrigger = true` (see the
 * `BLOCK_TRIGGER_FLAG` marker below). The hero/store-card call-sites wrap a
 * whole block `<Card>` (renders a `<div>`) in a simple `<HelpTooltip>`; on
 * touch that string content routes to the ⓘ Toggletip, and without the flag the
 * Toggletip would span-wrap the block Card (invalid `<span><div/></span>`) and
 * drop the card's `col-span-2` grid placement. Marking `Card` as a block
 * trigger makes the touch path mirror the desktop `asChild` model: the Card
 * itself becomes the tap trigger, no span wrapper, no sibling ⓘ.
 */
const NON_PHRASING_TAGS = new Set([
  // table internals
  'table',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'td',
  'th',
  'caption',
  'colgroup',
  'col',
  // list internals
  'ul',
  'ol',
  'li',
  'dl',
  'dt',
  'dd',
  // sectioning / flow containers
  'div',
  'section',
  'article',
  'aside',
  'header',
  'footer',
  'main',
  'nav',
  'figure',
  'figcaption',
  'p',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'form',
  'fieldset',
  'blockquote',
  'pre',
  'hr',
]);

/**
 * Static-property marker a custom component sets to declare it renders a
 * NON-PHRASING / block surface (a `<div>`, `<section>`, …). Such a component,
 * passed as a tooltip child, must NOT be span-wrapped on the touch path — it
 * becomes the `asChild` tap trigger instead (mirrors the desktop model). Set it
 * as `Card.isBlockTrigger = true` next to the component definition.
 */
export const BLOCK_TRIGGER_FLAG = 'isBlockTrigger' as const;

type BlockTriggerComponent = { [BLOCK_TRIGGER_FLAG]?: boolean };

/**
 * True when `child` is a single non-phrasing element — i.e. wrapping it in a
 * `<span>` and pairing a sibling `<button>` would produce invalid DOM. Covers
 * (a) non-phrasing HTML host tags (a `<tr>`, `<li>`, `<div>`, …) and (b) custom
 * components that opt in via `Component.isBlockTrigger = true` (e.g. `Card`,
 * which renders a `<div>`). In either case the touch wrappers make the child
 * itself the trigger (asChild) — no span wrapper, no sibling ⓘ.
 */
export function isNonPhrasingChild(child: ReactNode): boolean {
  if (!isValidElement(child)) return false;
  const el = child as ReactElement;
  if (typeof el.type === 'string') return NON_PHRASING_TAGS.has(el.type);
  // Custom component — phrasing by default, unless it declares itself a block
  // trigger via the static `isBlockTrigger` marker.
  if (typeof el.type === 'function' || typeof el.type === 'object') {
    return (el.type as BlockTriggerComponent)[BLOCK_TRIGGER_FLAG] === true;
  }
  return false;
}
