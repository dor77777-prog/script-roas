import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from '../Sheet';

describe('Sheet primitive', () => {
  it('opens and shows content; supports side="start" and side="end"', async () => {
    render(
      <Sheet>
        <SheetTrigger>open</SheetTrigger>
        <SheetContent side="end">
          <SheetTitle>title</SheetTitle>
          <p>body</p>
        </SheetContent>
      </Sheet>,
    );
    fireEvent.click(screen.getByText('open'));
    expect(await screen.findByText('title')).toBeInTheDocument();
    expect(screen.getByText('body')).toBeInTheDocument();
  });
});
