import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TableBase, TableHead, TableHeaderCell, TableRow, TableCell } from '@/components/ui/TableBase';

describe('TableBase primitives', () => {
  it('renders the chain of head + row + cell with correct semantic roles', () => {
    render(
      <TableBase>
        <TableHead>
          <TableRow>
            <TableHeaderCell>שם</TableHeaderCell>
            <TableHeaderCell numeric>הוצאה</TableHeaderCell>
          </TableRow>
        </TableHead>
        <tbody>
          <TableRow>
            <TableCell>Meta</TableCell>
            <TableCell numeric>$100</TableCell>
          </TableRow>
        </tbody>
      </TableBase>,
    );
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByText('שם')).toBeInTheDocument();
    expect(screen.getByText('$100')).toHaveClass('tabular-nums');
  });

  it('sortable header cell shows aria-sort and triggers callback', () => {
    let clicked = false;
    render(
      <TableBase>
        <TableHead>
          <TableRow>
            <TableHeaderCell sortable sortDir="asc" onSort={() => { clicked = true; }}>
              ROAS
            </TableHeaderCell>
          </TableRow>
        </TableHead>
      </TableBase>,
    );
    const cell = screen.getByText('ROAS');
    expect(cell.getAttribute('aria-sort')).toBe('ascending');
    cell.click();
    expect(clicked).toBe(true);
  });
});
