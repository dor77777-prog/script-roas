import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { InsightCard } from '@/components/ui/InsightCard';

describe('InsightCard', () => {
  it('renders title + body and applies tone="warning" classes', () => {
    const { container } = render(
      <InsightCard tone="warning" title="פעולה נדרשת">
        <p>טוקן Meta פג תוקף</p>
      </InsightCard>,
    );
    expect(screen.getByText('פעולה נדרשת')).toBeInTheDocument();
    expect(screen.getByText('טוקן Meta פג תוקף')).toBeInTheDocument();
    expect(container.firstChild).toHaveClass('border-status-warning');
  });
});
