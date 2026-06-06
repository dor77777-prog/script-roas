// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AdStatePanel } from '@/components/operator/AdStatePanel';

const meta = [
  { storeId: 'uzoshop', storeName: 'uzoshop', metaAdAccountId: '1', googleAdsCustomerId: '2', tiktokAdvertiserId: null, planDisplayName: '', shopifyPlus: false, partnerDevelopment: false, updatedAt: null, lastError: null },
  { storeId: 'zolplus', storeName: 'Zol Plus', metaAdAccountId: '1', googleAdsCustomerId: null, tiktokAdvertiserId: null, planDisplayName: '', shopifyPlus: false, partnerDevelopment: false, updatedAt: null, lastError: null },
];

describe('AdStatePanel', () => {
  it('renders a row per store + "לא רלוונטי" for non-applicable cells', () => {
    render(<AdStatePanel storeMeta={meta as never} map={{ 'zolplus:meta': false }} tiktokStores={new Set(['uzoshop'])} onToggle={() => {}} />);
    expect(screen.getByText('uzoshop')).toBeTruthy();
    expect(screen.getByText('Zol Plus')).toBeTruthy();
    // Zol Plus has no google + no tiktok → 2 "לא רלוונטי" cells.
    expect(screen.getAllByText('לא רלוונטי').length).toBe(2);
  });
  it('calls onToggle when an applicable toggle is flipped', () => {
    const onToggle = vi.fn();
    render(<AdStatePanel storeMeta={meta as never} map={{}} tiktokStores={new Set(['uzoshop'])} onToggle={onToggle} />);
    fireEvent.click(screen.getByTestId('toggle-zolplus-meta'));
    expect(onToggle).toHaveBeenCalledWith('zolplus', 'meta', false); // was ON → flipping sends OFF
  });
});
