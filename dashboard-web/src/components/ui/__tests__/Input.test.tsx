import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Input } from '../Input';

describe('Input primitive', () => {
  it('accepts user typing', async () => {
    render(<Input defaultValue="" aria-label="x" />);
    await userEvent.type(screen.getByLabelText('x'), 'hello');
    expect(screen.getByLabelText('x')).toHaveValue('hello');
  });
});
