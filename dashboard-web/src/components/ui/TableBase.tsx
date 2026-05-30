// dashboard-web/src/components/ui/TableBase.tsx
//
// Phase E1.6.1 UI overhaul — shared table primitives. Absorbs the
// ad-hoc <table> styling in CampaignsTable, AdsDrawer, MonthlyTables,
// ProductsTable. All header text uses --text-secondary; rows use
// --border-subtle separators; numeric cells get tabular-nums.

import { cn } from '@/lib/utils';
import type { ReactNode } from 'react';

export function TableBase({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <table className={cn('w-full text-sm text-ink', className)}>
      {children}
    </table>
  );
}

export function TableHead({ children }: { children: ReactNode }) {
  return (
    <thead className="bg-elevated2 sticky top-0 z-10 border-b border-line-subtle">
      {children}
    </thead>
  );
}

export function TableRow({ children, className, ...rest }: { children: ReactNode; className?: string } & React.HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr {...rest} className={cn('border-b border-line-subtle hover:bg-elevated/40 transition-colors', className)}>
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
