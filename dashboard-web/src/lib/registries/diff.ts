// dashboard-web/src/lib/registries/diff.ts
//
// Phase B — diff logic that compares the fresh status payload against
// the prior registry snapshot and emits one StatusEventInsert per
// genuine status transition. Cosmetic edits (name, budget, creative)
// do NOT produce events — `status_changed_at` is the high-fidelity
// "real change" signal that Phase C's hot-set relies on.

import type {
  CampaignRegistryRow,
  ChangeKind,
  EntityType,
  StatusEventInsert,
  StoreId,
  Platform,
} from './types';

const ARCHIVE_STATUSES = new Set(['ARCHIVED', 'DELETED']);

export function classifyChange(
  prior: CampaignRegistryRow | null,
  next: CampaignRegistryRow,
): ChangeKind | null {
  if (prior === null) return 'first_seen';

  // Soft-delete (missed for N ticks) → 'removed' is emitted by the upsert
  // layer when it bumps missed_seen_count past the threshold, not here.

  const configuredChanged = (prior.configured_status ?? null) !== (next.configured_status ?? null);
  const effectiveChanged = (prior.effective_status ?? null) !== (next.effective_status ?? null);
  const deliveryChanged = (prior.delivery_status ?? null) !== (next.delivery_status ?? null);

  if (configuredChanged) {
    const nx = next.configured_status ?? '';
    if (ARCHIVE_STATUSES.has(nx)) return 'archived';
    if (nx === 'PAUSED') return 'paused';
    if (nx === 'ACTIVE') return 'enabled';
    // Unknown configured_status transition — fall through to effective_only.
  }
  if (effectiveChanged) return 'effective_only';
  if (deliveryChanged) return 'delivery_only';

  return null;
}

export function diffAgainstRegistry(input: {
  entityType: EntityType;
  prior: Map<string, CampaignRegistryRow>;
  fresh: CampaignRegistryRow[];
  occurredAt: string;
}): StatusEventInsert[] {
  const { entityType, prior, fresh, occurredAt } = input;
  const out: StatusEventInsert[] = [];
  for (const row of fresh) {
    const entityId = pickEntityId(entityType, row);
    const priorRow = prior.get(entityId) ?? null;
    const kind = classifyChange(priorRow, row);
    if (kind === null) continue;
    out.push({
      store_id: row.store_id as StoreId,
      platform: row.platform as Platform,
      entity_type: entityType,
      entity_id: entityId,
      occurred_at: occurredAt,
      from_status: priorRow ? (priorRow.configured_status ?? null) : null,
      to_status: row.configured_status ?? row.effective_status ?? row.delivery_status ?? '',
      change_kind: kind,
      raw_event: {
        configured_status: row.configured_status,
        effective_status: row.effective_status,
        delivery_status: row.delivery_status,
      },
    });
  }
  return out;
}

function pickEntityId(entityType: EntityType, row: CampaignRegistryRow): string {
  if (entityType === 'campaign') return row.campaign_id;
  if (entityType === 'adset') return (row as unknown as { adset_id: string }).adset_id;
  return (row as unknown as { ad_id: string }).ad_id;
}
