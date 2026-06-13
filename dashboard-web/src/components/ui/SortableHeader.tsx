'use client';

import type { ReactNode } from 'react';
import { ArrowUp, ArrowDown, ArrowUpDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';

/**
 * Shared sortable column-header — the single source of truth consumed by
 * AdsDrawer's ad table and AdSetTable's ad-set table (W4.4). It consolidates
 * the two byte-identical local clones (`AdSortHeader` + `AdSetSortHeader`) that
 * previously lived in those files.
 *
 * Contract (preserved exactly from the clones the aria-sort guards pin):
 *  - Renders a header `<th>` carrying `aria-sort` — `ascending` / `descending`
 *    when this column is the active sort, else `none`. The attribute sits on
 *    the <th> (valid ARIA — it is only defined for header cells), NEVER on the
 *    inner sort <Button> (the 2026-06-11 adversarial-review relocation).
 *  - The clickable inner ghost <Button> fires `onSort(sortKey)`; the PARENT
 *    owns the flip-on-active / default-dir-on-new toggle (unchanged) so the
 *    sort semantics are identical.
 *  - For `align="end"` (numeric) columns the sort arrow renders BEFORE the
 *    label so under RTL + justify-end the label stays flush with the text-end
 *    numeric body cells (BUG #1 fix preserved). The inactive ArrowUpDown is
 *    invisible (`opacity-0`) but still occupies layout.
 *
 * Generic over the column-key type `K` so each table keeps its own narrow
 * SortKey union (no `string` widening at the call site).
 */
export function SortableHeader<K extends string>({
  label,
  sortKey,
  activeSortKey,
  sortDir,
  onSort,
  align = 'center',
  className,
}: {
  /** Visible column label. ReactNode so callers can stack a sub-caption. */
  label: ReactNode;
  /** The column key this header sorts by. */
  sortKey: K;
  /** The table's currently-active sort key. */
  activeSortKey: K;
  /** The table's current sort direction. */
  sortDir: 'asc' | 'desc';
  /** Called with this header's key on click — parent owns the toggle. */
  onSort: (key: K) => void;
  /** Cell + content alignment. Defaults to center. */
  align?: 'start' | 'center' | 'end';
  /** Extra classes merged onto the <th>. */
  className?: string;
}) {
  const isActive = sortKey === activeSortKey;
  const justify =
    align === 'start' ? 'justify-start' : align === 'end' ? 'justify-end' : 'justify-center';
  const textAlign =
    align === 'start' ? 'text-start' : align === 'end' ? 'text-end' : 'text-center';
  // For end-aligned (numeric) columns render the sort arrow BEFORE the label so
  // under RTL + justify-end the label is flush with the text-end numeric body
  // cells. (The invisible inactive ArrowUpDown still occupies layout.)
  const sortArrow = isActive ? (
    sortDir === 'asc' ? (
      <ArrowUp size={12} className="text-accent" />
    ) : (
      <ArrowDown size={12} className="text-accent" />
    )
  ) : (
    <ArrowUpDown size={12} className="opacity-0 group-hover:opacity-60 transition-opacity" />
  );
  return (
    <th
      className={cn('font-medium px-3 py-2', textAlign, className)}
      // aria-sort lives on the <th> (valid ARIA — header-cell only), never on
      // the inner button. Pinned by adsDrawerAriaSort + rowKeyboardAriaSort.
      aria-sort={isActive ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <Button
        type="button"
        variant="ghost"
        onClick={() => onSort(sortKey)}
        className={cn(
          'gap-1 select-none cursor-pointer w-full h-auto p-0',
          justify,
          isActive ? 'text-accent font-semibold' : 'text-ink-secondary hover:text-ink',
        )}
      >
        {align === 'end' ? (
          <>
            {sortArrow}
            <span>{label}</span>
          </>
        ) : (
          <>
            <span>{label}</span>
            {sortArrow}
          </>
        )}
      </Button>
    </th>
  );
}
