import { describe, expect, it } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { InsightCardGroup, InsightCardRow } from '@/components/ui/InsightCard';

describe('InsightCard compound API', () => {
  it('renders InsightCardGroup with header label + count badge', () => {
    render(
      <InsightCardGroup severity="warning" label="פעולה נדרשת" count={2}>
        <p>row content</p>
      </InsightCardGroup>,
    );
    expect(screen.getByText('פעולה נדרשת')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('InsightCardGroup collapsible toggle hides body', () => {
    render(
      <InsightCardGroup severity="info" label="More" count={1} defaultExpanded={true}>
        <div data-testid="body">x</div>
      </InsightCardGroup>,
    );
    expect(screen.getByTestId('body')).toBeInTheDocument();
    // Click the toggle (the header)
    fireEvent.click(screen.getByText('More'));
    expect(screen.queryByTestId('body')).toBeNull();
  });

  it('alwaysExpanded suppresses collapsing for critical/warning groups', () => {
    render(
      <InsightCardGroup severity="critical" label="קריטי" count={1} alwaysExpanded>
        <div data-testid="body">x</div>
      </InsightCardGroup>,
    );
    fireEvent.click(screen.getByText('קריטי'));
    // Body still visible.
    expect(screen.getByTestId('body')).toBeInTheDocument();
  });

  it('renders InsightCardRow with title + detail + actions', () => {
    render(
      <InsightCardRow
        severity="warning"
        title="Token פג"
        detail="Refresh Meta"
        actions={<button data-testid="act">Refresh</button>}
      />,
    );
    expect(screen.getByText('Token פג')).toBeInTheDocument();
    expect(screen.getByText('Refresh Meta')).toBeInTheDocument();
    expect(screen.getByTestId('act')).toBeInTheDocument();
  });
});
