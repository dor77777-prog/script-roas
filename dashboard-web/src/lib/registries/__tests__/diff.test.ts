import { describe, expect, it } from 'vitest';
import { classifyChange, diffAgainstRegistry } from '@/lib/registries/diff';
import type { CampaignRegistryRow } from '@/lib/registries/types';

const NOW = '2026-05-29T14:30:42.000Z';

function row(over: Partial<CampaignRegistryRow>): CampaignRegistryRow {
  return {
    store_id: 'uzoshop',
    platform: 'meta',
    campaign_id: 'C1',
    name: 'Hair Serum',
    configured_status: 'ACTIVE',
    effective_status: 'ACTIVE',
    delivery_status: 'DELIVERING',
    is_enabled: true,
    is_serving: true,
    first_seen_at: '2026-05-29T10:00:00.000Z',
    last_seen_at: '2026-05-29T14:20:00.000Z',
    platform_updated_at: '2026-05-29T14:10:00.000Z',
    status_changed_at: '2026-05-29T10:00:00.000Z',
    last_metrics_success_at: null,
    last_status_success_at: '2026-05-29T14:20:00.000Z',
    raw_status_payload: null,
    missed_seen_count: 0,
    is_removed: false,
    ...over,
  };
}

describe('classifyChange()', () => {
  it('null prior → first_seen', () => {
    expect(classifyChange(null, row({}))).toBe('first_seen');
  });

  it('ACTIVE → PAUSED on configured_status → paused', () => {
    const prior = row({ configured_status: 'ACTIVE' });
    const next = row({ configured_status: 'PAUSED' });
    expect(classifyChange(prior, next)).toBe('paused');
  });

  it('PAUSED → ACTIVE on configured_status → enabled', () => {
    const prior = row({ configured_status: 'PAUSED' });
    const next = row({ configured_status: 'ACTIVE' });
    expect(classifyChange(prior, next)).toBe('enabled');
  });

  it('configured_status moves to ARCHIVED → archived', () => {
    const prior = row({ configured_status: 'ACTIVE' });
    const next = row({ configured_status: 'ARCHIVED' });
    expect(classifyChange(prior, next)).toBe('archived');
  });

  it('only effective_status changes (e.g. PENDING_REVIEW → ACTIVE) → effective_only', () => {
    const prior = row({ configured_status: 'ACTIVE', effective_status: 'PENDING_REVIEW' });
    const next = row({ configured_status: 'ACTIVE', effective_status: 'ACTIVE' });
    expect(classifyChange(prior, next)).toBe('effective_only');
  });

  it('only delivery_status changes (e.g. DELIVERING → LIMITED) → delivery_only', () => {
    const prior = row({ delivery_status: 'DELIVERING' });
    const next = row({ delivery_status: 'LIMITED' });
    expect(classifyChange(prior, next)).toBe('delivery_only');
  });

  it('only name changed → null (no event)', () => {
    const prior = row({ name: 'Old' });
    const next = row({ name: 'New' });
    expect(classifyChange(prior, next)).toBeNull();
  });
});

describe('diffAgainstRegistry()', () => {
  it('emits one StatusEventInsert per changed entity, none for unchanged', () => {
    const prior = new Map<string, CampaignRegistryRow>([
      ['C1', row({ campaign_id: 'C1', configured_status: 'ACTIVE' })],
      ['C2', row({ campaign_id: 'C2', configured_status: 'ACTIVE' })],
    ]);
    const fresh = [
      row({ campaign_id: 'C1', configured_status: 'PAUSED' }),
      row({ campaign_id: 'C2', configured_status: 'ACTIVE' }),
      row({ campaign_id: 'C3', configured_status: 'ACTIVE' }),
    ];
    const events = diffAgainstRegistry({
      entityType: 'campaign',
      prior,
      fresh,
      occurredAt: NOW,
    });
    expect(events).toHaveLength(2);
    expect(events.find(e => e.entity_id === 'C1')?.change_kind).toBe('paused');
    expect(events.find(e => e.entity_id === 'C3')?.change_kind).toBe('first_seen');
  });

  it('event payload carries from_status, to_status, raw_event', () => {
    const prior = new Map<string, CampaignRegistryRow>();
    const fresh = [row({ campaign_id: 'C1', configured_status: 'ACTIVE', effective_status: 'PENDING_REVIEW' })];
    const events = diffAgainstRegistry({ entityType: 'campaign', prior, fresh, occurredAt: NOW });
    expect(events[0].from_status).toBeNull();
    expect(events[0].to_status).toBe('ACTIVE');
    expect(events[0].raw_event).toMatchObject({ effective_status: 'PENDING_REVIEW' });
    expect(events[0].occurred_at).toBe(NOW);
  });
});
