export type DailyRow = {
  date: string;        // YYYY-MM-DD
  storeId: string;
  storeName: string;
  fbSpend: number;
  gaSpend: number;
  totalSpend: number;
  revenue: number;
  roas: number;
  grossProfit: number;
  cogs: number;        // 0 when scope is missing or no orders
  netProfit: number;   // revenue - spend - cogs
  hasCogs: boolean;    // true if COGS column was populated (non-empty)
};

export type DashboardData = {
  rows: DailyRow[];
  stores: string[];    // unique store names
  lastUpdated: string; // ISO timestamp
  fxIlsToCad: number | null; // current FX rate (ECB via Frankfurter). null on failure.
};

export type DateRange = {
  from: string;  // YYYY-MM-DD
  to: string;    // YYYY-MM-DD
};

export type PresetKey =
  | 'yesterday'
  | 'this_month'
  | 'this_week'
  | 'last_7_days'
  | 'last_month'
  | 'last_30_days'
  | 'custom';

export type Filters = {
  preset: PresetKey;
  range: DateRange;
  store: string;   // 'All' or store name
};
