import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TabHeader } from '../TabHeader';

describe('TabHeader', () => {
  it('renders title, description, and a slot for filters', () => {
    render(
      <TabHeader
        title="ביצועי קמפיינים"
        description="קמפיין-לכל-קמפיין…"
        filterSlot={<div data-testid="filter-slot">filter</div>}
        actionSlot={<button>action</button>}
      />,
    );
    expect(screen.getByRole('heading', { name: 'ביצועי קמפיינים' })).toBeInTheDocument();
    expect(screen.getByText('קמפיין-לכל-קמפיין…')).toBeInTheDocument();
    expect(screen.getByTestId('filter-slot')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'action' })).toBeInTheDocument();
  });
});
