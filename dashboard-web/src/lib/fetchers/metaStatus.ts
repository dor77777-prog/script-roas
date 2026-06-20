// dashboard-web/src/lib/fetchers/metaStatus.ts
//
// Phase B — single-batch Meta Graph API call that fetches campaigns +
// adsets + ads status for one ad account, parses the
// x-business-use-case-usage header, and converts adset budgets to CAD.
//
// Why batch:
//   - 1 HTTPS round-trip vs 3
//   - Header parsing happens once
//   - The Graph API charges the same BUC whether you batch or not, but
//     batching reduces TCP / TLS overhead.
//
// Why fetcher injection:
//   - Vitest unit tests can pass `vi.fn()` instead of stubbing global
//     fetch, mirroring the rest of the fetcher modules.

import type {
  AdRegistryRow,
  AdsetRegistryRow,
  CampaignRegistryRow,
  StoreId,
} from '@/lib/registries/types';

const GRAPH_VERSION = 'v22.0';
const CAMPAIGN_FIELDS = 'id,name,configured_status,effective_status,updated_time';
const ADSET_FIELDS = 'id,campaign_id,name,configured_status,effective_status,daily_budget,lifetime_budget,updated_time';
const AD_FIELDS = 'id,adset_id,campaign_id,name,configured_status,effective_status,updated_time';

export type MetaStatusFetchInput = {
  storeId: StoreId;
  adAccountId: string;
  accessToken: string;
  fetcher?: typeof fetch;
  /**
   * P1-11 (2026-06-10) — FX doctrine: the adapter returns `null` on FX
   * failure. Budget rows already type the CAD columns `number | null`, so a
   * null conversion lands as a null budget (the registry upsert preserves
   * nothing here — budgets are point-in-time config, not cumulative spend).
   */
  getFxCadFor: (amount: number, currency: 'USD' | 'CAD' | 'ILS') => Promise<number | null>;
};

export type MetaStatusResult = {
  campaigns: CampaignRegistryRow[];
  adsets: AdsetRegistryRow[];
  ads: AdRegistryRow[];
  bucUsage: {
    ads_insights_call_pct: number;
    ads_insights_cputime_pct: number;
    ads_insights_time_pct: number;
    ads_insights_eta_minutes: number;
    ads_management_call_pct: number;
    ads_management_cputime_pct: number;
    ads_management_time_pct: number;
    ads_management_eta_minutes: number;
  };
};

const ZERO_BUC: MetaStatusResult['bucUsage'] = {
  ads_insights_call_pct: 0,
  ads_insights_cputime_pct: 0,
  ads_insights_time_pct: 0,
  ads_insights_eta_minutes: 0,
  ads_management_call_pct: 0,
  ads_management_cputime_pct: 0,
  ads_management_time_pct: 0,
  ads_management_eta_minutes: 0,
};

export async function fetchMetaStatusForStore(input: MetaStatusFetchInput): Promise<MetaStatusResult> {
  const { storeId, accessToken, fetcher = fetch } = input;
  const adAccountId = input.adAccountId.startsWith('act_')
    ? input.adAccountId
    : `act_${input.adAccountId}`;
  const account = adAccountId.replace(/^act_/, '');

  const batch = [
    { method: 'GET', relative_url: `${adAccountId}/campaigns?fields=${CAMPAIGN_FIELDS}&limit=500` },
    { method: 'GET', relative_url: `${adAccountId}/adsets?fields=${ADSET_FIELDS}&limit=1000` },
    { method: 'GET', relative_url: `${adAccountId}/ads?fields=${AD_FIELDS}&limit=2000` },
  ];

  const body = new URLSearchParams();
  body.set('access_token', accessToken);
  body.set('batch', JSON.stringify(batch));

  const res = await fetcher(`https://graph.facebook.com/${GRAPH_VERSION}/`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) {
    throw new Error(`Meta batch ${res.status}: ${await res.text()}`);
  }

  const parts = (await res.json()) as Array<{ code: number; body: string }>;
  const [campaignsPart, adsetsPart, adsPart] = parts;

  const bucUsage = parseBucHeader(res.headers.get('x-business-use-case-usage'), account);

  const campaigns = await Promise.all(
    asArray(campaignsPart).map(async (c) => toCampaignRow(storeId, c)),
  );
  const adsets = await Promise.all(
    asArray(adsetsPart).map(async (a) => toAdsetRow(storeId, a, input.getFxCadFor)),
  );
  const ads = asArray(adsPart).map((a) => toAdRow(storeId, a));

  return { campaigns, adsets, ads, bucUsage };
}

// P1-12 (2026-06-10): an inner batch part with code !== 200 (per-call
// throttling, transient 500 inside the envelope — a NORMAL Meta failure mode)
// must THROW, not silently return []. Returning [] made the worker upsert
// nothing and record freshness='success' (metaWorker then marked all 3 status
// scopes green) — exactly the false-green the Phase A freshness contract
// exists to prevent. Throwing routes through the worker's status-branch
// try/catch → transient_error row → Inngest retry.
function asArray(part: { code: number; body: string } | null | undefined): Array<Record<string, unknown>> {
  if (!part) {
    throw new Error('Meta status batch part missing/null in envelope response');
  }
  if (part.code !== 200) {
    throw new Error(`Meta status batch part failed (code=${part.code}): ${part.body}`);
  }
  try {
    const parsed = JSON.parse(part.body) as { data?: unknown };
    return Array.isArray(parsed.data) ? (parsed.data as Array<Record<string, unknown>>) : [];
  } catch {
    // #17 (2026-06-20): a corrupt-but-200 part body that fails JSON.parse must
    // THROW, not return [] — returning [] made the worker upsert zero rows yet
    // record freshness='success' (status scopes green), so newly-active adsets
    // silently vanished. Throwing routes through the worker try/catch →
    // transient_error → Inngest retry.
    throw new Error('Meta status batch part body unparseable (code=200): ' + part.body.slice(0, 200));
  }
}

const NULL_PLACEHOLDER = '__will_be_overwritten_by_upsert_layer__';

function toCampaignRow(storeId: StoreId, c: Record<string, unknown>): CampaignRegistryRow {
  return {
    store_id: storeId,
    platform: 'meta',
    campaign_id: String(c.id),
    name: c.name as string ?? null,
    configured_status: c.configured_status as string ?? null,
    effective_status: c.effective_status as string ?? null,
    delivery_status: deriveDeliveryStatus(c.effective_status as string | undefined),
    is_enabled: c.configured_status === 'ACTIVE',
    is_serving: c.effective_status === 'ACTIVE',
    first_seen_at: NULL_PLACEHOLDER,
    last_seen_at: NULL_PLACEHOLDER,
    platform_updated_at: c.updated_time ? new Date(c.updated_time as string).toISOString() : null,
    status_changed_at: null,
    last_metrics_success_at: null,
    last_status_success_at: null,
    raw_status_payload: c,
    missed_seen_count: 0,
    is_removed: false,
  };
}

async function toAdsetRow(
  storeId: StoreId,
  a: Record<string, unknown>,
  getFx: MetaStatusFetchInput['getFxCadFor'],
): Promise<AdsetRegistryRow> {
  const dailyMinor = a.daily_budget ? Number(a.daily_budget) : null;
  const lifetimeMinor = a.lifetime_budget ? Number(a.lifetime_budget) : null;
  const dailyCad = dailyMinor != null ? await getFx(dailyMinor / 100, 'CAD') : null;
  const lifetimeCad = lifetimeMinor != null ? await getFx(lifetimeMinor / 100, 'CAD') : null;

  return {
    ...toCampaignRow(storeId, { ...a, id: a.campaign_id }),
    campaign_id: String(a.campaign_id),
    adset_id: String(a.id),
    daily_budget_cad: dailyCad,
    lifetime_budget_cad: lifetimeCad,
  };
}

function toAdRow(storeId: StoreId, a: Record<string, unknown>): AdRegistryRow {
  return {
    ...toCampaignRow(storeId, { ...a, id: a.campaign_id }),
    campaign_id: String(a.campaign_id),
    adset_id: String(a.adset_id),
    ad_id: String(a.id),
  };
}

function deriveDeliveryStatus(effective: string | undefined): string | null {
  if (!effective) return null;
  if (effective === 'ACTIVE') return 'DELIVERING';
  if (effective === 'PENDING_REVIEW') return 'PENDING_REVIEW';
  if (effective === 'IN_REVIEW') return 'PENDING_REVIEW';
  if (effective === 'REJECTED' || effective === 'DISAPPROVED') return 'REJECTED';
  if (effective === 'PAUSED' || effective === 'CAMPAIGN_PAUSED') return 'NOT_DELIVERING';
  return 'UNKNOWN';
}

function parseBucHeader(raw: string | null, account: string): MetaStatusResult['bucUsage'] {
  if (!raw) return ZERO_BUC;
  try {
    const parsed = JSON.parse(raw) as Record<string, Array<Record<string, unknown>>>;
    const list = parsed[account] ?? [];
    let insights: Record<string, unknown> | undefined;
    let management: Record<string, unknown> | undefined;
    for (const item of list) {
      const t = item.type as string;
      if (t === 'ads_insights') insights = item;
      if (t === 'ads_management') management = item;
    }
    return {
      ads_insights_call_pct: Number(insights?.call_count ?? 0),
      ads_insights_cputime_pct: Number(insights?.total_cputime ?? 0),
      ads_insights_time_pct: Number(insights?.total_time ?? 0),
      ads_insights_eta_minutes: Number(insights?.estimated_time_to_regain_access ?? 0),
      ads_management_call_pct: Number(management?.call_count ?? 0),
      ads_management_cputime_pct: Number(management?.total_cputime ?? 0),
      ads_management_time_pct: Number(management?.total_time ?? 0),
      ads_management_eta_minutes: Number(management?.estimated_time_to_regain_access ?? 0),
    };
  } catch {
    return ZERO_BUC;
  }
}
