'use client';

import { Button } from '@/components/ui/Button';

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
  return (
    <div role="group" aria-label="Month selector" className="flex flex-wrap gap-1.5">
      <Button
        variant={value === null ? 'primary' : 'ghost'}
        size="sm"
        aria-pressed={value === null}
        onClick={() => onChange(null)}
      >
        כל השנה
      </Button>
      {HE_MONTHS.map((label, idx) => {
        const m = idx + 1;
        return (
          <Button
            key={m}
            variant={value === m ? 'primary' : 'ghost'}
            size="sm"
            aria-pressed={value === m}
            onClick={() => onChange(m)}
          >
            {label}
          </Button>
        );
      })}
    </div>
  );
}
