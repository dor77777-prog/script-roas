// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, screen } from '@testing-library/react';
import { SourceBadge } from '@/components/ui/SourceBadge';
afterEach(() => cleanup());

describe('SourceBadge', () => {
  it('renders Meta for meta-paid', () => {
    render(<SourceBadge source="meta-paid" />);
    expect(screen.getByText('Meta')).toBeInTheDocument();
  });
  it('renders Google for google-paid', () => {
    render(<SourceBadge source="google-paid" />);
    expect(screen.getByText('Google')).toBeInTheDocument();
  });
  it('renders TikTok for tiktok-paid', () => {
    render(<SourceBadge source="tiktok-paid" />);
    expect(screen.getByText('TikTok')).toBeInTheDocument();
  });
  it('maps meta-organic to the Meta badge too', () => {
    render(<SourceBadge source="meta-organic" />);
    expect(screen.getByText('Meta')).toBeInTheDocument();
  });
  it('renders a neutral "ישיר" chip for direct', () => {
    render(<SourceBadge source="direct" />);
    expect(screen.getByText('ישיר')).toBeInTheDocument();
  });
  it('renders nothing for null source', () => {
    const { container } = render(<SourceBadge source={null} />);
    expect(container.firstChild).toBeNull();
  });
  it('renders nothing for empty-string source', () => {
    const { container } = render(<SourceBadge source="" />);
    expect(container.firstChild).toBeNull();
  });
});
