import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../Tabs';

describe('Tabs primitive', () => {
  it('switches active panel on trigger click', () => {
    render(
      <Tabs defaultValue="a">
        <TabsList>
          <TabsTrigger value="a">A</TabsTrigger>
          <TabsTrigger value="b">B</TabsTrigger>
        </TabsList>
        <TabsContent value="a">content A</TabsContent>
        <TabsContent value="b">content B</TabsContent>
      </Tabs>,
    );
    expect(screen.getByText('content A')).toBeInTheDocument();
    expect(screen.queryByText('content B')).not.toBeInTheDocument();
    fireEvent.mouseDown(screen.getByText('B'));
    expect(screen.getByText('content B')).toBeInTheDocument();
  });
});
