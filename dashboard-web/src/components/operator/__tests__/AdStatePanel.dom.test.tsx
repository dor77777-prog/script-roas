// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AdStatePanel } from '@/components/operator/AdStatePanel';

const meta = [
  { storeId: 'uzoshop', storeName: 'uzoshop', metaAdAccountId: '1', googleAdsCustomerId: '2', tiktokAdvertiserId: null, planDisplayName: '', shopifyPlus: false, partnerDevelopment: false, updatedAt: null, lastError: null },
  { storeId: 'zolplus', storeName: 'Zol Plus', metaAdAccountId: '1', googleAdsCustomerId: null, tiktokAdvertiserId: null, planDisplayName: '', shopifyPlus: false, partnerDevelopment: false, updatedAt: null, lastError: null },
];

describe('AdStatePanel', () => {
  it('renders a row per store + "לא מחובר" for non-applicable cells', () => {
    render(<AdStatePanel storeMeta={meta as never} map={{ 'zolplus:meta': false }} tiktokStores={new Set(['uzoshop'])} onToggle={() => {}} />);
    expect(screen.getByText('uzoshop')).toBeTruthy();
    expect(screen.getByText('Zol Plus')).toBeTruthy();
    // Zol Plus has no google + no tiktok → 2 "לא מחובר" cells (was "לא רלוונטי").
    expect(screen.getAllByText('לא מחובר').length).toBe(2);
    // The old confusing label must be gone.
    expect(screen.queryByText('לא רלוונטי')).toBeNull();
  });

  it('calls onToggle when an applicable toggle is flipped', () => {
    const onToggle = vi.fn();
    render(<AdStatePanel storeMeta={meta as never} map={{}} tiktokStores={new Set(['uzoshop'])} onToggle={onToggle} />);
    fireEvent.click(screen.getByTestId('toggle-zolplus-meta'));
    expect(onToggle).toHaveBeenCalledWith('zolplus', 'meta', false); // was ON → flipping sends OFF
  });

  it('shows a "חבר" action on non-applicable cells when onConnect is provided, with an accessible name', () => {
    const onConnect = vi.fn();
    render(
      <AdStatePanel
        storeMeta={meta as never}
        map={{}}
        tiktokStores={new Set(['uzoshop'])}
        onToggle={() => {}}
        onConnect={onConnect}
      />,
    );
    // Zol Plus has no google + no tiktok → 2 connect actions.
    const connectActions = screen.getAllByRole('button', { name: /חבר/ });
    expect(connectActions.length).toBe(2);
  });

  it('fires onConnect(storeId, platform) when the "חבר" action is clicked', () => {
    const onConnect = vi.fn();
    render(
      <AdStatePanel
        storeMeta={meta as never}
        map={{}}
        tiktokStores={new Set(['uzoshop'])}
        onToggle={() => {}}
        onConnect={onConnect}
      />,
    );
    fireEvent.click(screen.getByTestId('connect-zolplus-google'));
    expect(onConnect).toHaveBeenCalledWith('zolplus', 'google');
  });

  it('falls back to a hint pointing at the חנויות tab when onConnect is omitted', () => {
    render(<AdStatePanel storeMeta={meta as never} map={{}} tiktokStores={new Set(['uzoshop'])} onToggle={() => {}} />);
    // No clickable connect action when no handler is wired.
    expect(screen.queryByRole('button', { name: /חבר/ })).toBeNull();
    // Still tells the operator where to connect.
    expect(screen.getAllByText('לא מחובר').length).toBe(2);
  });
});
