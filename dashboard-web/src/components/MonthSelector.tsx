'use client';

// Horizon re-skin (W6.4): fully token-driven via the shared <NativeSelect>
// primitive (glass-1 surface, glass-edge rim, ink text, accent focus ring —
// both themes). No bespoke colour/type lives here, so the re-skin is "adopt the
// primitive": nothing to retint, no sub-floor type literals. HE_MONTHS is
// duplicated with MonthlyTables on purpose for now (dedup is a separate
// cleanup) and behaviour is left UNCHANGED.

import { NativeSelect } from '@/components/ui/NativeSelect';

const HE_MONTHS = [
  'ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני',
  'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר',
];

interface Props {
  /** 1..12, or null = "all months in year" */
  value: number | null;
  onChange: (month: number | null) => void;
}

export function MonthSelector({ value, onChange }: Props) {
  const selectValue = value === null ? 'all' : String(value);
  return (
    <NativeSelect
      value={selectValue}
      onChange={e => {
        const v = e.target.value;
        onChange(v === 'all' ? null : parseInt(v, 10));
      }}
      className="font-medium"
    >
      <option value="all">כל השנה</option>
      {HE_MONTHS.map((label, idx) => (
        <option key={idx + 1} value={String(idx + 1)}>
          {label}
        </option>
      ))}
    </NativeSelect>
  );
}
