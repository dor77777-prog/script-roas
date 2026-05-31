'use client';

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
