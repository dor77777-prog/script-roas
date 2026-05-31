import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Heading, Text } from '../Typography';

describe('Heading primitive', () => {
  it('renders an <h2> by default (level="section" → h2)', () => {
    render(<Heading>Section title</Heading>);
    const node = screen.getByText('Section title');
    expect(node.tagName).toBe('H2');
  });

  it('picks a sensible default tag per level (display→h1, hero→h1, section→h2, panel→h3, label→h4)', () => {
    const cases: Array<[Parameters<typeof Heading>[0]['level'], string]> = [
      ['display', 'H1'],
      ['hero',    'H1'],
      ['section', 'H2'],
      ['panel',   'H3'],
      ['label',   'H4'],
    ];
    cases.forEach(([level, expectedTag]) => {
      const { unmount } = render(
        <Heading level={level} data-testid={`h-${level}`}>{level}</Heading>,
      );
      const node = screen.getByTestId(`h-${level}`);
      expect(node.tagName).toBe(expectedTag);
      unmount();
    });
  });

  it('honours `as` polymorphic prop (overrides default tag)', () => {
    render(
      <Heading level="display" as="h2" data-testid="poly">
        Polymorphic
      </Heading>,
    );
    const node = screen.getByTestId('poly');
    // `as="h2"` overrides display's default <h1>
    expect(node.tagName).toBe('H2');
    // Still gets the display level styles
    expect(node.className).toMatch(/font-extrabold/);
  });

  it('display level uses extrabold + tracking-tight', () => {
    render(<Heading level="display" data-testid="d">Title</Heading>);
    const cls = screen.getByTestId('d').className;
    expect(cls).toMatch(/font-extrabold/);
    expect(cls).toMatch(/tracking-tight/);
  });

  it('label level uses font-mono + uppercase + custom tracking', () => {
    render(<Heading level="label" data-testid="lab">scope</Heading>);
    const cls = screen.getByTestId('lab').className;
    expect(cls).toMatch(/font-mono/);
    expect(cls).toMatch(/uppercase/);
    expect(cls).toMatch(/tracking-\[0\.08em\]/);
  });

  it('merges user className via cn()', () => {
    render(
      <Heading level="section" className="mb-3 flex items-center gap-2" data-testid="merged">
        T
      </Heading>,
    );
    const cls = screen.getByTestId('merged').className;
    expect(cls).toMatch(/mb-3/);
    expect(cls).toMatch(/flex/);
    expect(cls).toMatch(/items-center/);
    // Default level styling still present
    expect(cls).toMatch(/font-semibold/);
  });

  it('forwards extra HTML attributes (id, aria-*, data-*)', () => {
    render(
      <Heading id="my-h" aria-label="hello" data-x="1" data-testid="attrs">
        T
      </Heading>,
    );
    const node = screen.getByTestId('attrs');
    expect(node.id).toBe('my-h');
    expect(node.getAttribute('aria-label')).toBe('hello');
    expect(node.getAttribute('data-x')).toBe('1');
  });
});

describe('Text primitive', () => {
  it('renders a <p> by default', () => {
    render(<Text data-testid="t">body</Text>);
    expect(screen.getByTestId('t').tagName).toBe('P');
  });

  it('honours `as="span"`', () => {
    render(<Text as="span" data-testid="s">inline</Text>);
    expect(screen.getByTestId('s').tagName).toBe('SPAN');
  });

  it('maps tones to text-ink-* utilities', () => {
    const cases: Array<[Parameters<typeof Text>[0]['tone'], RegExp]> = [
      ['default',   /\btext-ink\b/],
      ['secondary', /text-ink-secondary/],
      ['muted',     /text-ink-muted/],
      ['subtle',    /text-ink-subtle/],
    ];
    cases.forEach(([tone, re]) => {
      const { unmount } = render(
        <Text tone={tone} data-testid={`t-${tone}`}>x</Text>,
      );
      expect(screen.getByTestId(`t-${tone}`).className).toMatch(re);
      unmount();
    });
  });

  it('merges user className via cn()', () => {
    render(<Text tone="muted" className="mt-2 text-xs" data-testid="m">x</Text>);
    const cls = screen.getByTestId('m').className;
    expect(cls).toMatch(/mt-2/);
    expect(cls).toMatch(/text-xs/);
    expect(cls).toMatch(/text-ink-muted/);
  });

  it('forwards extra HTML attributes', () => {
    render(
      <Text id="meta" role="note" data-testid="attrs">x</Text>,
    );
    const node = screen.getByTestId('attrs');
    expect(node.id).toBe('meta');
    expect(node.getAttribute('role')).toBe('note');
  });
});
