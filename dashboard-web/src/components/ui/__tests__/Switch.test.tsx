import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Switch } from '../Switch';

describe('Switch primitive', () => {
  it('toggles on click', () => {
    let value = false;
    const { rerender } = render(<Switch checked={value} onCheckedChange={v => (value = v)} aria-label="s" />);
    fireEvent.click(screen.getByLabelText('s'));
    rerender(<Switch checked={value} onCheckedChange={v => (value = v)} aria-label="s" />);
    expect(value).toBe(true);
  });
});
