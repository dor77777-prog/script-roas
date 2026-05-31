'use client';

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
