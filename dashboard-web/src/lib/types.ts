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
};

export type DashboardData = {
  rows: DailyRow[];
  stores: string[];    // unique store names
  lastUpdated: string; // ISO timestamp
};

export type DateRange = {
  from: string;  // YYYY-MM-DD
  to: string;    // YYYY-MM-DD
};

export type PresetKey =
  | 'this_week'
  | 'last_7_days'
  | 'this_month'
  | 'last_month'
  | 'last_30_days'
  | 'custom';

export type Filters = {
  preset: PresetKey;
  range: DateRange;
  store: string;   // 'All' or store name
};
