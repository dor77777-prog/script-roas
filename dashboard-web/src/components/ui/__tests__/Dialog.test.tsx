import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Dialog, DialogContent, DialogTrigger, DialogTitle, DialogDescription, DialogFooter } from '../Dialog';

describe('Dialog primitive', () => {
  it('opens on trigger click and shows content', async () => {
    render(
      <Dialog>
        <DialogTrigger>open</DialogTrigger>
        <DialogContent>
          <DialogTitle>title</DialogTitle>
          <DialogDescription>desc</DialogDescription>
          <p>body</p>
          <DialogFooter>actions</DialogFooter>
        </DialogContent>
      </Dialog>,
    );
    fireEvent.click(screen.getByText('open'));
    expect(await screen.findByText('title')).toBeInTheDocument();
    expect(screen.getByText('desc')).toBeInTheDocument();
    expect(screen.getByText('body')).toBeInTheDocument();
    expect(screen.getByText('actions')).toBeInTheDocument();
  });
});
