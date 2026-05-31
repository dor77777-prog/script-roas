// dashboard-web/src/components/operator/__tests__/OperatorRefreshButton.dom.test.tsx
//
// Task 5.2 (UI/UX overhaul) — DOM test for the header "Refresh" button.
//
// Test file lives under components/operator/__tests__ so it matches the
// vitest.config.dom.ts include glob; the component itself lives next to
// page.tsx at src/app/operator/OperatorRefreshButton.tsx.
//
// We mock `swr` so we can capture the call to `mutate(predicate, ..., opts)`
// and assert that the predicate returns true for every key (i.e. the button
// revalidates the full operator SWR surface).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const mutateMock = vi.fn();

vi.mock('swr', () => ({
  useSWRConfig: () => ({ mutate: mutateMock }),
}));

import { OperatorRefreshButton } from '@/app/operator/OperatorRefreshButton';

describe('<OperatorRefreshButton>', () => {
  beforeEach(() => {
    mutateMock.mockReset();
    mutateMock.mockResolvedValue(undefined);
  });

  it('renders a button with the Hebrew "רענון" label', () => {
    render(<OperatorRefreshButton />);
    const btn = screen.getByTestId('operator-refresh-button');
    expect(btn.textContent).toContain('רענון');
    expect(btn.tagName).toBe('BUTTON');
  });

  it('calls SWR mutate with a "match all keys" predicate when clicked', async () => {
    render(<OperatorRefreshButton />);
    const btn = screen.getByTestId('operator-refresh-button');
    fireEvent.click(btn);

    expect(mutateMock).toHaveBeenCalledTimes(1);
    const [predicate, payload, opts] = mutateMock.mock.calls[0];
    expect(typeof predicate).toBe('function');
    // Predicate is supposed to match every key — sample a few.
    expect((predicate as (k: string) => boolean)('/api/operator/freshness')).toBe(true);
    expect((predicate as (k: string) => boolean)('/api/operator/jobs?limit=50')).toBe(true);
    expect((predicate as (k: string) => boolean)('anything')).toBe(true);
    expect(payload).toBeUndefined();
    expect(opts).toEqual({ revalidate: true });
  });

  it('uses the lucide RotateCw icon as the affordance', () => {
    const { container } = render(<OperatorRefreshButton />);
    // lucide-react renders an <svg>; assert one is present inside the button.
    const svg = container.querySelector('button svg');
    expect(svg).not.toBeNull();
  });
});
