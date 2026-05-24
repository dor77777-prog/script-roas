/**
 * Type-only re-export contract preserved post-Phase-11 cutover (READ_FROM=postgres permanent).
 *
 * The Google Sheets reader (`fetchProductsData`) was deleted in Phase 12.4 as
 * dead-at-runtime code. The `ProductRow` shape is still consumed by:
 *   - `/api/products/route.ts`
 *   - `components/ProductPickerModal.tsx`
 *   - `components/ProductsTable.tsx`
 *   - `components/WhatsWorking.tsx`
 *
 * Authoritative reader: `lib/postgresReaders.fetchProductsFromPostgres`.
 *
 * Note: Phase 12.2's STA-46 + STA-47 fixes (inline parseDate bypass + filter
 * asymmetry vs Postgres reader) were applied to the deleted Sheets reader.
 * Now that the reader is gone, those audit findings are permanently moot.
 */

export type ProductRow = {
  date: string;        // YYYY-MM-DD
  storeId: string;
  storeName: string;
  productId: string;
  productTitle: string;
  units: number;
  revenue: number;     // gross CAD (before discounts and refunds)
  /** Distinct orders that contained this product. 0 for historical rows
   *  written before the Orders column was added. */
  orders: number;
  /** Net revenue: gross − discounts − refunds.
   *  null when the row was written before the Net Revenue column existed
   *  (so the dashboard can distinguish "no data" from "0 net"). */
  netRevenue: number | null;
};
