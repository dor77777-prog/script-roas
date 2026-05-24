/**
 * Type-only re-export contract preserved post-Phase-11 cutover (READ_FROM=postgres permanent).
 *
 * The Google Sheets reader (`fetchProductCatalog`) was deleted in Phase 12.4
 * as dead-at-runtime code. The `CatalogProduct` shape is still consumed by
 * `/api/product-catalog/route.ts`.
 *
 * Authoritative reader: `lib/postgresReaders.fetchProductCatalogFromPostgres`.
 *
 * Why this exists in addition to /api/products:
 *   - /api/products reads products-daily, which only contains products that
 *     SOLD at least one unit. Brand new products that haven't been ordered
 *     yet are invisible there.
 *   - The ProductPickerModal needs the *full* catalog so the operator can
 *     tag a campaign to a fresh product before any sales have rolled in.
 */

export type CatalogProduct = {
  productId: string;
  storeId: string;
  storeName: string;
  title: string;
  handle: string;
  status: string;        // 'active' typically
  priceCad: number;
  imageUrl: string;
  productType: string;
  vendor: string;
};
