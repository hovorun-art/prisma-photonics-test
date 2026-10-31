import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { GroupProgressBar } from './group-progress-bar';

describe('GroupProgressBar', () => {
  const renderBar = (counts: { completed: number; failed: number; total: number }) =>
    render(<GroupProgressBar {...counts} label="Progress" className="h-2" />);

  it('fills the completed share in the completed colour and the failed share in the failed colour', () => {
    renderBar({ completed: 2, failed: 1, total: 4 });

    const bar = screen.getByRole('progressbar', { name: 'Progress' });
    const [completed, failed] = Array.from(bar.children) as HTMLElement[];
    expect(completed).toHaveClass('bg-status-completed');
    expect(completed).toHaveStyle({ width: '50%' });
    expect(failed).toHaveClass('bg-status-failed');
    expect(failed).toHaveStyle({ width: '25%' });
    expect(bar).toHaveAttribute('aria-valuenow', '75');
  });

  it('shows an empty bar for a group without jobs', () => {
    renderBar({ completed: 0, failed: 0, total: 0 });

    const bar = screen.getByRole('progressbar', { name: 'Progress' });
    expect(bar).toHaveAttribute('aria-valuenow', '0');
    for (const segment of Array.from(bar.children) as HTMLElement[]) {
      expect(segment).toHaveStyle({ width: '0%' });
    }
  });
});
