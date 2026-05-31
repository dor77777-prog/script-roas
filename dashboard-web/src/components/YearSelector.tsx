'use client';

import { ChevronDown } from 'lucide-react';

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
    <div className="relative">
      <select
        value={String(selected)}
        onChange={e => onChange?.(parseInt(e.target.value, 10))}
        className="appearance-none rounded-lg border border-glass-edge bg-glass-1 ps-3 pe-9 py-2.5 sm:py-2 text-sm font-medium text-ink hover:border-glass-edge-hot focus:outline-none focus:border-accent transition-colors cursor-pointer"
      >
        {years.map(y => (
          <option key={y} value={String(y)}>
            {y}
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
