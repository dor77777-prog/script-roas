import { describe, expect, it, vi } from 'vitest';
import {
  buildRegistryUpsertRow,
  insertStatusEventsBatch,
  upsertRegistryBatch,
} from '@/lib/registries/upsert';
import type { CampaignRegistryRow, StatusEventInsert } from '@/lib/registries/types';

const NOW = '2026-05-29T14:30:42.000Z';

function makeFresh(over: Partial<CampaignRegistryRow> = {}): CampaignRegistryRow {
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
    first_seen_at: '__will_be_set__',
    last_seen_at: '__will_be_set__',
    platform_updated_at: '2026-05-29T14:10:00.000Z',
    status_changed_at: null,
    last_metrics_success_at: null,
    last_status_success_at: null,
    raw_status_payload: { id: 'C1', name: 'Hair Serum' },
    missed_seen_count: 0,
    is_removed: false,
    ...over,
  };
}

describe('buildRegistryUpsertRow()', () => {
  it('new entity: first_seen_at = now, last_seen_at = now, status_changed_at = now', () => {
    const out = buildRegistryUpsertRow({ prior: null, fresh: makeFresh({}), nowIso: NOW });
    expect(out.first_seen_at).toBe(NOW);
    expect(out.last_seen_at).toBe(NOW);
    expect(out.status_changed_at).toBe(NOW);
    expect(out.last_status_success_at).toBe(NOW);
    expect(out.missed_seen_count).toBe(0);
  });

  it('existing entity, status unchanged: first_seen_at + status_changed_at preserved; last_seen_at bumped', () => {
    const prior = makeFresh({
      first_seen_at: '2026-05-29T10:00:00.000Z',
      last_seen_at: '2026-05-29T14:20:00.000Z',
      status_changed_at: '2026-05-29T10:00:00.000Z',
      missed_seen_count: 0,
    });
    const fresh = makeFresh({});
    const out = buildRegistryUpsertRow({ prior, fresh, nowIso: NOW });
    expect(out.first_seen_at).toBe('2026-05-29T10:00:00.000Z');
    expect(out.status_changed_at).toBe('2026-05-29T10:00:00.000Z');
    expect(out.last_seen_at).toBe(NOW);
    expect(out.last_status_success_at).toBe(NOW);
  });

  it('existing entity, configured_status changed: status_changed_at = now', () => {
    const prior = makeFresh({ configured_status: 'ACTIVE', status_changed_at: '2026-05-29T10:00:00.000Z' });
    const fresh = makeFresh({ configured_status: 'PAUSED' });
    const out = buildRegistryUpsertRow({ prior, fresh, nowIso: NOW });
    expect(out.status_changed_at).toBe(NOW);
  });

  it('existing entity, only name changed: status_changed_at preserved (cosmetic edit)', () => {
    const prior = makeFresh({ name: 'Old', status_changed_at: '2026-05-29T10:00:00.000Z' });
    const fresh = makeFresh({ name: 'New' });
    const out = buildRegistryUpsertRow({ prior, fresh, nowIso: NOW });
    expect(out.status_changed_at).toBe('2026-05-29T10:00:00.000Z');
    expect(out.name).toBe('New');
  });

  it('missed_seen_count resets to 0 when fresh data arrives', () => {
    const prior = makeFresh({ missed_seen_count: 2 });
    const fresh = makeFresh({});
    const out = buildRegistryUpsertRow({ prior, fresh, nowIso: NOW });
    expect(out.missed_seen_count).toBe(0);
  });
});

describe('upsertRegistryBatch()', () => {
  it('calls supabase.upsert with the registries[] payload (table name parameterized)', async () => {
    const upsert = vi.fn().mockResolvedValue({ error: null });
    const from = vi.fn().mockReturnValue({ upsert });
    const admin = { from } as unknown as Parameters<typeof upsertRegistryBatch>[0]['admin'];
    const rows: CampaignRegistryRow[] = [makeFresh({})];
    await upsertRegistryBatch({ admin, table: 'campaign_registry', rows });
    expect(from).toHaveBeenCalledWith('campaign_registry');
    expect(upsert).toHaveBeenCalledWith(rows, { onConflict: 'store_id,platform,campaign_id' });
  });
});

describe('insertStatusEventsBatch()', () => {
  function makeEvent(entityId: string): StatusEventInsert {
    return {
      store_id: 'uzoshop',
      platform: 'meta',
      entity_type: 'campaign',
      entity_id: entityId,
      occurred_at: NOW,
      from_status: null,
      to_status: 'ACTIVE',
      change_kind: 'first_seen',
      raw_event: {},
    };
  }

  // P1-32 (2026-06-10): must be a TRUE per-row ON CONFLICT (dedupe_key)
  // DO NOTHING. The previous plain .insert() (treating 23505 as benign)
  // aborted the WHOLE multi-row INSERT on one duplicate — a mixed dup+new
  // batch silently dropped the NEW transitions feeding the operator panel
  // and the campaign-died/fatigue detectors.
  it('upserts events with onConflict=dedupe_key + ignoreDuplicates: true (per-row DO NOTHING)', async () => {
    const upsert = vi.fn().mockResolvedValue({ error: null });
    const from = vi.fn().mockReturnValue({ upsert });
    const admin = { from } as unknown as Parameters<typeof insertStatusEventsBatch>[0]['admin'];
    const events: StatusEventInsert[] = [makeEvent('C1'), makeEvent('C2')];
    await insertStatusEventsBatch({ admin, events });
    expect(from).toHaveBeenCalledWith('campaign_status_events');
    expect(upsert).toHaveBeenCalledWith(events, {
      onConflict: 'dedupe_key',
      ignoreDuplicates: true,
    });
  });

  it('throws with table context when PostgREST returns an error (no silent 23505 carve-out anymore)', async () => {
    const upsert = vi.fn().mockResolvedValue({ error: { code: '23505', message: 'duplicate key value' } });
    const from = vi.fn().mockReturnValue({ upsert });
    const admin = { from } as unknown as Parameters<typeof insertStatusEventsBatch>[0]['admin'];
    // With ignoreDuplicates the DB never raises 23505 for dedupe_key dupes;
    // any error that DOES surface is a real failure and must be loud.
    await expect(
      insertStatusEventsBatch({ admin, events: [makeEvent('C1')] }),
    ).rejects.toThrow(/campaign_status_events.*duplicate key value/);
  });

  it('no-ops on an empty events array (no DB call)', async () => {
    const upsert = vi.fn();
    const from = vi.fn().mockReturnValue({ upsert });
    const admin = { from } as unknown as Parameters<typeof insertStatusEventsBatch>[0]['admin'];
    await insertStatusEventsBatch({ admin, events: [] });
    expect(from).not.toHaveBeenCalled();
  });
});
