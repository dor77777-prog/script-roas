import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AiInsightPill } from '../AiInsightPill';

describe('AiInsightPill', () => {
  it('renders the AI-tagged text content', () => {
    render(<AiInsightPill>הקמפיין הראשון מתחיל לטפוף.</AiInsightPill>);
    expect(screen.getByText('הקמפיין הראשון מתחיל לטפוף.')).toBeInTheDocument();
  });

  it('has role="status" so screen readers pick it up as a non-disruptive announcement', () => {
    render(<AiInsightPill data-testid="pill">x</AiInsightPill>);
    expect(screen.getByTestId('pill')).toHaveAttribute('role', 'status');
  });

  it('renders nothing when children is falsy', () => {
    const { container } = render(<AiInsightPill>{null}</AiInsightPill>);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing for empty string', () => {
    const { container } = render(<AiInsightPill>{''}</AiInsightPill>);
    expect(container.firstChild).toBeNull();
  });
});
