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
 * PascalCase component is assumed phrasing (it usually renders a span/chip);
 * call-sites passing a block component on touch can still rely on the desktop
 * path, and none do today.
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
 * True when `child` is a single non-phrasing host element — i.e. wrapping it in
 * a `<span>` and pairing a sibling `<button>` would produce invalid DOM. In
 * that case the touch wrappers make the child itself the trigger (asChild).
 */
export function isNonPhrasingChild(child: ReactNode): boolean {
  if (!isValidElement(child)) return false;
  const el = child as ReactElement;
  return typeof el.type === 'string' && NON_PHRASING_TAGS.has(el.type);
}
