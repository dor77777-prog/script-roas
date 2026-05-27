export interface Violation {
  label: string;
  detail: string;
  values?: Record<string, number>;
}

/** Cross-source (L2): agree if within 1% OR within $1, whichever is more lenient. */
export function withinTolerance(
  a: number,
  b: number,
  { pctTol = 0.01, absTol = 1 }: { pctTol?: number; absTol?: number } = {},
): boolean {
  const diff = Math.abs(a - b);
  if (diff <= absTol) return true;
  const denom = Math.max(Math.abs(a), Math.abs(b));
  if (denom === 0) return diff === 0;
  return diff / denom <= pctTol;
}

/** Same-source (L1): every value must match within an accounting tolerance — spread ≤ max(1¢, 1ppm of the largest magnitude). */
export function agree(
  values: number[],
  { label = 'value', eps = 0.01 }: { label?: string; eps?: number } = {},
): Violation[] {
  if (values.length < 2) return [];
  const max = Math.max(...values);
  const min = Math.min(...values);
  const tol = Math.max(eps, 1e-6 * Math.max(...values.map(Math.abs)));
  if (max - min <= tol) return [];
  return [{ label, detail: `spread ${(max - min).toFixed(4)} > tol ${tol.toFixed(4)}`, values: Object.fromEntries(values.map((v, i) => [`src${i}`, v])) }];
}
