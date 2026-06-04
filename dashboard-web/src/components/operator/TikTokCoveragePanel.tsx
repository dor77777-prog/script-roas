'use client';

// dashboard-web/src/components/operator/TikTokCoveragePanel.tsx
//
// DQ-7 — TikTok mapping-coverage panel (operator).
//
// TikTok runs a single shared ad account; per-store attribution is done via
// the campaign-store-map (default store 'uzoshop', remappable per campaign —
// ARCHITECTURE §A.5). This panel keeps the existing STATIC disclaimer above
// and adds a LIVE coverage panel below it:
//   • קמפיינים לא-ממופים  — unmappedCampaignIds.length
//   • הוצאה לא-מיוחסת     — unattributedSpendCad   (account total − Σ campaign)
//   • הוצאה ממופה         — mappedSpendCad
//   • a table of the unmapped campaigns (Campaign ID · Advertiser · הוצאה)
//
// Coverage is computed CLIENT-SIDE from the raw account total + per-campaign
// rows (self-fetched via SWR) crossed with the campaign-store-map read from
// localStorage — mirroring how CampaignsTable resolves effective stores
// (CampaignsTable.tsx:419).
//
// NOTE on the default store: the rollup pipeline applies a 'uzoshop' default
// (resolveStoreForCampaign's `?? defaultStoreId`) so no spend is ever
// silently dropped. This panel's JOB, however, is to surface campaigns that
// are missing an EXPLICIT mapping (the operator-actionable signal — DQ-7 «no
// store-map entry»). So we intentionally call `tiktokCoverage` WITHOUT a
// `defaultStoreId`: a campaign counts as "unmapped" exactly when it has no
// explicit store-map entry, and `mappedSpendCad` is the spend covered by
// explicit mappings.
//
// Self-fetches via SWR @ 15 s (fetchJsonOrNull — stay-rendered-on-error).
// Token-driven, RTL/logical classes only, AA in both themes via paired -Fg
// tokens through the shared primitives.

import { useEffect, useState } from 'react';
import useSWR from 'swr';
import { fetchJsonOrNull } from '@/lib/fetchJson';
import { tiktokCoverage } from '@/lib/home/tiktokCoverage';
import {
  readCampaignStoreMap,
  type CampaignStoreMap,
} from '@/lib/campaignStoreMap';
import { Card } from '@/components/ui/Card';
import { Heading } from '@/components/ui/Typography';
import { Money } from '@/components/ui/Money';
import {
  TableBase,
  TableHead,
  TableRow,
  TableHeaderCell,
  TableCell,
} from '@/components/ui/TableBase';

const ENDPOINT = '/api/operator/tiktok-coverage';

export interface TikTokCoverageResp {
  /** Account-level total spend (CAD) for the period — data_daily TikTok. */
  accountTotalCad: number;
  /** Per-campaign rows pulled from campaigns_daily (TikTok). */
  campaigns: Array<{ campaignId: string; advertiserId: string; spendCad: number }>;
  error?: string;
}

export function TikTokCoveragePanel() {
  const { data } = useSWR<TikTokCoverageResp | null>(ENDPOINT, fetchJsonOrNull, {
    refreshInterval: 15_000,
    revalidateOnFocus: false,
  });

  // Read the campaign-store-map client-side (localStorage), and re-read it
  // when the operator remaps a campaign — same pattern as CampaignsTable:419.
  const [storeMap, setStoreMap] = useState<CampaignStoreMap>(() =>
    readCampaignStoreMap(),
  );
  useEffect(() => {
    const refresh = () => setStoreMap(readCampaignStoreMap());
    window.addEventListener('roas-campaign-store-map-changed', refresh);
    return () =>
      window.removeEventListener('roas-campaign-store-map-changed', refresh);
  }, []);

  const campaigns = data?.campaigns ?? [];
  const { unmappedCampaignIds, mappedSpendCad, unattributedSpendCad } =
    tiktokCoverage({
      accountTotalCad: data?.accountTotalCad ?? 0,
      campaigns,
      storeMap,
      // No defaultStoreId — surface campaigns missing an EXPLICIT mapping.
    });

  const unmappedSet = new Set(unmappedCampaignIds);
  const unmappedRows = campaigns.filter((c) => unmappedSet.has(c.campaignId));

  return (
    <Card className="space-y-4">
      {/* STATIC disclaimer — kept ABOVE the live panel. */}
      <p className="rounded-card border border-dashed border-glass-edge bg-[color:var(--surface-sunken)] px-3 py-2.5 text-xs leading-relaxed text-ink-secondary">
        TikTok הוא חשבון-פרסום <b className="text-ink">אחד משותף</b> לכל החנויות;
        ייחוס פר-חנות נעשה לפי מיפוי-קמפיין-לחנות (ברירת-מחדל{' '}
        <bdi dir="ltr">uzoshop</bdi>, ניתן למיפוי מחדש). הפאנל החי למטה מראה כמה
        מההוצאה ממופה בפועל.
      </p>

      {/* LIVE panel. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCell label="קמפיינים לא-ממופים">
          <span className="tabular-nums">{unmappedCampaignIds.length}</span>
        </StatCell>
        <StatCell label="הוצאה לא-מיוחסת">
          <Money value={unattributedSpendCad} prefix="CAD" />
        </StatCell>
        <StatCell label="הוצאה ממופה">
          <Money value={mappedSpendCad} prefix="CAD" />
        </StatCell>
      </div>

      {unmappedRows.length > 0 && (
        <div className="overflow-x-auto">
          <TableBase density="compact">
            <TableHead>
              <TableRow>
                <TableHeaderCell>Campaign ID</TableHeaderCell>
                <TableHeaderCell>Advertiser</TableHeaderCell>
                <TableHeaderCell numeric>הוצאה</TableHeaderCell>
              </TableRow>
            </TableHead>
            <tbody>
              {unmappedRows.map((c) => (
                <TableRow key={`${c.advertiserId}::${c.campaignId}`}>
                  <TableCell>
                    <bdi dir="ltr" className="font-mono text-xs">
                      {c.campaignId}
                    </bdi>
                  </TableCell>
                  <TableCell>
                    <bdi dir="ltr" className="font-mono text-xs">
                      {c.advertiserId}
                    </bdi>
                  </TableCell>
                  <TableCell numeric>
                    <Money value={c.spendCad} prefix="CAD" />
                  </TableCell>
                </TableRow>
              ))}
            </tbody>
          </TableBase>
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatCell({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-card border border-glass-edge bg-glass-2 px-3 py-2.5">
      <Heading level="label" className="mb-1 normal-case tracking-normal">
        {label}
      </Heading>
      <div className="text-xl font-extrabold text-ink">{children}</div>
    </div>
  );
}
