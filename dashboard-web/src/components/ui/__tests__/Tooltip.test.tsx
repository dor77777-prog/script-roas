import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '../Tooltip';

describe('Tooltip primitive', () => {
  it('shows content on hover', async () => {
    render(
      <TooltipProvider delayDuration={0}>
        <Tooltip>
          <TooltipTrigger>trigger</TooltipTrigger>
          <TooltipContent>tip text</TooltipContent>
        </Tooltip>
      </TooltipProvider>,
    );
    fireEvent.pointerMove(screen.getByText('trigger'));
    expect(await screen.findByRole('tooltip')).toBeInTheDocument();
  });
});
