// TEST-05 (5.2.2.1): extracted for testability. Pins FIX-03 namespace contract.
import type { CampaignRow } from './campaigns';

export function filterDrillRows(
  rows: CampaignRow[],
  opts: {
    storeId: string;
    platform: string;
    campaignId: string;
    rangeFrom: string;
    rangeTo: string;
  },
): CampaignRow[] {
  return rows.filter(r =>
    r.storeId === opts.storeId &&
    r.platform === opts.platform &&
    r.campaignId === opts.campaignId &&
    r.date >= opts.rangeFrom && r.date <= opts.rangeTo,
  );
}
