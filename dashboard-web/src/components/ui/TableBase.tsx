// dashboard-web/src/components/ui/TableBase.tsx
//
// Phase E1.6.1 UI overhaul — shared table primitives. Absorbs the
// ad-hoc <table> styling in CampaignsTable, AdsDrawer, MonthlyTables,
// ProductsTable. All header text uses --text-secondary; rows use
// --border-subtle separators; numeric cells get tabular-nums.
//
// Wave-2 Task 2.2 — extended with `minWidth`, `density`, `stickyHeader`
// props. The sticky-header CSS lives in globals.css under
// `table[data-sticky-header]` so every consumer gets the same glass-3
// blur-20 treatment, fixing the documented CampaignsTable:2027
// missing-sticky bug. The lint rule `no-raw-table-in-components`
// blocks raw `<table>` JSX outside of this primitive.

import { cn } from '@/lib/utils';
import type { ReactNode } from 'react';

export type TableDensity = 'compact' | 'comfortable';

export function TableBase({
  children,
  className,
  minWidth,
  density = 'comfortable',
  stickyHeader = false,
}: {
  children: ReactNode;
  className?: string;
  /** Minimum table width in px (matches Tailwind `min-w-[Npx]`). */
  minWidth?: number;
  /** Row spacing — `compact` halves vertical padding via a data attr. */
  density?: TableDensity;
  /** Pins `thead` to the top of the nearest scroll container, with
   *  the canonical glass-3 + backdrop-blur treatment. Implemented via
   *  the `[data-sticky-header]` selector in globals.css. */
  stickyHeader?: boolean;
}) {
  return (
    <table
      className={cn('w-full text-sm text-ink', className)}
      style={minWidth != null ? { minWidth: `${minWidth}px` } : undefined}
      data-density={density}
      data-sticky-header={stickyHeader ? '' : undefined}
    >
      {children}
    </table>
  );
}

export function TableHead({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <thead className={cn('bg-glass-2 border-b border-glass-edge', className)}>
      {children}
    </thead>
  );
}

export function TableRow({ children, className, ...rest }: { children: ReactNode; className?: string } & React.HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr {...rest} className={cn('border-b border-glass-edge hover:bg-glass-1/40 transition-colors', className)}>
      {children}
    </tr>
  );
}

export function TableHeaderCell({
  children, numeric, sortable, sortDir, onSort, className,
}: {
  children: ReactNode;
  numeric?: boolean;
  sortable?: boolean;
  sortDir?: 'asc' | 'desc' | null;
  onSort?: () => void;
  className?: string;
}) {
  const ariaSort = sortable
    ? sortDir === 'asc' ? 'ascending' : sortDir === 'desc' ? 'descending' : 'none'
    : undefined;
  return (
    <th
      className={cn(
        'px-3 py-2 text-xs font-medium text-ink-secondary text-start',
        numeric && 'text-end tabular-nums',
        sortable && 'cursor-pointer hover:text-ink select-none',
        className,
      )}
      aria-sort={ariaSort}
      onClick={sortable && onSort ? onSort : undefined}
    >
      {children}
    </th>
  );
}

export function TableCell({
  children, numeric, className,
}: {
  children: ReactNode;
  numeric?: boolean;
  className?: string;
}) {
  return (
    <td className={cn('px-3 py-2', numeric && 'text-end tabular-nums', className)}>
      {children}
    </td>
  );
}
