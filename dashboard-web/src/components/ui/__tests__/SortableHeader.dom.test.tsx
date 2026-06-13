// @vitest-environment jsdom
//
// W4.4 — shared SortableHeader (consolidates AdsDrawer's AdSortHeader +
// AdSetTable's AdSetSortHeader). Pins the contract both consumers depend on:
//   - aria-sort sits on the <th>, NEVER on the inner button
//   - active column announces ascending/descending; inactive announces "none"
//   - clicking fires onSort with this header's key (parent owns the toggle)
//   - end-aligned (numeric) columns render the arrow before the label (RTL flush)

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, fireEvent, cleanup, within } from '@testing-library/react';
import { SortableHeader } from '@/components/ui/SortableHeader';

afterEach(cleanup);

type K = 'name' | 'spend' | 'roas';

function renderHeaders(activeSortKey: K, sortDir: 'asc' | 'desc', onSort = vi.fn()) {
  render(
    <table>
      <thead>
        <tr>
          <SortableHeader<K>
            label="שם"
            sortKey="name"
            activeSortKey={activeSortKey}
            sortDir={sortDir}
            onSort={onSort}
            align="start"
          />
          <SortableHeader<K>
            label="הוצאה"
            sortKey="spend"
            activeSortKey={activeSortKey}
            sortDir={sortDir}
            onSort={onSort}
            align="end"
          />
          <SortableHeader<K>
            label="ROAS"
            sortKey="roas"
            activeSortKey={activeSortKey}
            sortDir={sortDir}
            onSort={onSort}
            align="center"
          />
        </tr>
      </thead>
    </table>,
  );
  return onSort;
}

describe('SortableHeader', () => {
  it('puts aria-sort on the <th> (active = descending) and on NO button', () => {
    renderHeaders('spend', 'desc');
    const spendTh = Array.from(document.querySelectorAll('th[aria-sort]')).find((th) =>
      th.textContent?.includes('הוצאה'),
    );
    expect(spendTh?.getAttribute('aria-sort')).toBe('descending');
    expect(document.querySelector('button[aria-sort]')).toBeNull();
  });

  it('active ascending announces "ascending"; inactive columns announce "none"', () => {
    renderHeaders('name', 'asc');
    const ths = Array.from(document.querySelectorAll('th[aria-sort]'));
    const nameTh = ths.find((th) => th.textContent?.includes('שם'));
    const roasTh = ths.find((th) => th.textContent?.includes('ROAS'));
    expect(nameTh?.getAttribute('aria-sort')).toBe('ascending');
    expect(roasTh?.getAttribute('aria-sort')).toBe('none');
  });

  it('every rendered header carries aria-sort on its <th> (3 columns)', () => {
    renderHeaders('spend', 'desc');
    expect(document.querySelectorAll('th[aria-sort]').length).toBe(3);
  });

  it('clicking the header fires onSort with this header key', () => {
    const onSort = renderHeaders('spend', 'desc');
    const roasTh = Array.from(document.querySelectorAll('th[aria-sort]')).find((th) =>
      th.textContent?.includes('ROAS'),
    ) as HTMLElement;
    fireEvent.click(within(roasTh).getByRole('button'));
    expect(onSort).toHaveBeenCalledTimes(1);
    expect(onSort).toHaveBeenCalledWith('roas');
  });

  it('end-aligned numeric column renders the sort arrow before the label (RTL flush)', () => {
    renderHeaders('spend', 'desc');
    const spendTh = Array.from(document.querySelectorAll('th[aria-sort]')).find((th) =>
      th.textContent?.includes('הוצאה'),
    ) as HTMLElement;
    const button = within(spendTh).getByRole('button');
    // Active column → ArrowDown svg renders before the label span in DOM order.
    const svg = button.querySelector('svg');
    const labelSpan = within(button).getByText('הוצאה');
    expect(svg).not.toBeNull();
    // svg precedes the label span (arrow-before-label for end alignment).
    expect(svg!.compareDocumentPosition(labelSpan) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
