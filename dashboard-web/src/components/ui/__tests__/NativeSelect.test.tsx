import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NativeSelect } from '../NativeSelect';

describe('NativeSelect primitive', () => {
  it('renders options and reflects the controlled value', () => {
    render(
      <NativeSelect aria-label="store" value="a" onChange={() => {}}>
        <option value="a">A</option>
        <option value="b">B</option>
      </NativeSelect>,
    );
    const sel = screen.getByLabelText('store') as HTMLSelectElement;
    expect(sel.value).toBe('a');
  });

  it('calls onChange when user picks a different option', async () => {
    let v = 'a';
    render(
      <NativeSelect
        aria-label="store"
        value={v}
        onChange={(e) => {
          v = e.target.value;
        }}
      >
        <option value="a">A</option>
        <option value="b">B</option>
      </NativeSelect>,
    );
    await userEvent.selectOptions(screen.getByLabelText('store'), 'b');
    expect(v).toBe('b');
  });

  it('applies aria-invalid + red border on error', () => {
    render(
      <NativeSelect aria-label="bad" error="required" defaultValue="a">
        <option value="a">A</option>
      </NativeSelect>,
    );
    const sel = screen.getByLabelText('bad');
    expect(sel).toHaveAttribute('aria-invalid', 'true');
    expect(sel.className).toMatch(/border-status-red/);
  });

  it('renders error message with role="alert"', () => {
    render(
      <NativeSelect aria-label="bad" error="חובה" defaultValue="a">
        <option value="a">A</option>
      </NativeSelect>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('חובה');
  });
});
