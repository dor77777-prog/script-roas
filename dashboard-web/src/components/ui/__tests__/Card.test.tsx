import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Card, CardHeader, CardTitle, CardDescription, CardBody, CardFooter } from '../Card';

describe('Card primitive', () => {
  it('renders all subcomponents', () => {
    render(
      <Card data-testid="card">
        <CardHeader>
          <CardTitle>Title</CardTitle>
          <CardDescription>Desc</CardDescription>
        </CardHeader>
        <CardBody>Body</CardBody>
        <CardFooter>Footer</CardFooter>
      </Card>,
    );
    expect(screen.getByTestId('card')).toBeInTheDocument();
    expect(screen.getByText('Title')).toBeInTheDocument();
    expect(screen.getByText('Desc')).toBeInTheDocument();
    expect(screen.getByText('Body')).toBeInTheDocument();
    expect(screen.getByText('Footer')).toBeInTheDocument();
  });

  it('accepts variant="elevated" → applies shadow class', () => {
    render(<Card variant="elevated" data-testid="card">x</Card>);
    expect(screen.getByTestId('card').className).toMatch(/shadow/);
  });

  it('accepts variant="flat" → does not apply border/shadow classes', () => {
    render(<Card variant="flat" data-testid="card">x</Card>);
    const cls = screen.getByTestId('card').className;
    expect(cls).not.toMatch(/shadow/);
    expect(cls).not.toMatch(/border-/);
  });

  it('preserves user className via cn() merge (no clobber)', () => {
    render(<Card className="mt-10" data-testid="card">x</Card>);
    expect(screen.getByTestId('card').className).toMatch(/mt-10/);
  });

  it('uses RTL-safe padding utilities (no pl-/pr-)', () => {
    render(<Card data-testid="card">x</Card>);
    const cls = screen.getByTestId('card').className;
    expect(cls).not.toMatch(/\bpl-/);
    expect(cls).not.toMatch(/\bpr-/);
  });
});
