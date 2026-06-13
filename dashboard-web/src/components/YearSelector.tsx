'use client';

// Horizon re-skin (W6.4): this selector is fully token-driven via the shared
// <NativeSelect> primitive (glass-1 surface, glass-edge rim, ink text, accent
// focus ring — both themes). No bespoke colour/type lives here, so the re-skin
// is "adopt the primitive": nothing to retint, and no sub-floor type literals.
// The tz / 3-year-cap window logic is intentionally left UNCHANGED (look-only).

import { NativeSelect } from '@/components/ui/NativeSelect';

interface Props {
  value?: number;
  onChange?: (year: number) => void;
  startYear?: number;
  endYear?: number;
}

export function YearSelector({ value, onChange, startYear, endYear }: Props) {
  const now = new Date();
  const end = endYear ?? now.getFullYear();
  const start = startYear ?? end - 2;
  const selected = value ?? end;
  const years: number[] = [];
  for (let y = start; y <= end; y++) years.push(y);
  return (
    <NativeSelect
      value={String(selected)}
      onChange={e => onChange?.(parseInt(e.target.value, 10))}
      className="font-medium"
    >
      {years.map(y => (
        <option key={y} value={String(y)}>
          {y}
        </option>
      ))}
    </NativeSelect>
  );
}
