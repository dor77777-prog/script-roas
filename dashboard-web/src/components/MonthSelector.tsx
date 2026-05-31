'use client';

import { ChevronDown } from 'lucide-react';

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
    <div className="relative">
      <select
        value={selectValue}
        onChange={e => {
          const v = e.target.value;
          onChange(v === 'all' ? null : parseInt(v, 10));
        }}
        className="appearance-none rounded-lg border border-glass-edge bg-glass-1 ps-3 pe-9 py-2.5 sm:py-2 text-sm font-medium text-ink hover:border-glass-edge-hot focus:outline-none focus:border-accent focus:shadow-focus transition-colors cursor-pointer"
      >
        <option value="all">כל השנה</option>
        {HE_MONTHS.map((label, idx) => (
          <option key={idx + 1} value={String(idx + 1)}>
            {label}
          </option>
        ))}
      </select>
      <ChevronDown
        size={14}
        className="pointer-events-none absolute end-2.5 top-1/2 -translate-y-1/2 text-ink-muted"
      />
    </div>
  );
}
