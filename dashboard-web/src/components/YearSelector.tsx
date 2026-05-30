'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';

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
  const [internal, setInternal] = useState<number>(value ?? end);
  const selected = value ?? internal;
  const years: number[] = [];
  for (let y = start; y <= end; y++) years.push(y);
  return (
    <div role="group" aria-label="Year selector" className="flex gap-1.5">
      {years.map((y) => (
        <Button
          key={y}
          variant={y === selected ? 'primary' : 'ghost'}
          size="sm"
          aria-pressed={y === selected}
          onClick={() => {
            setInternal(y);
            onChange?.(y);
          }}
        >
          {y}
        </Button>
      ))}
    </div>
  );
}
