import type { QueueStats } from '@job-queue/contracts';
import { render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { en } from '@/locales';

import type { JobListFilters } from '../api/jobs-api';
import { JobsToolbar } from './jobs-toolbar';

/** Two failed webhook jobs and one completed email job. */
const COUNTS: QueueStats['counts'] = {
  status: { scheduled: 0, pending: 0, processing: 0, completed: 1, failed: 2, cancelled: 0 },
  type: { email: 1, webhook: 2, 'flight-transit': 0 },
};

function renderToolbar(props: { filters?: JobListFilters; counts?: QueueStats['counts'] } = {}) {
  const onChange = vi.fn<(filters: JobListFilters) => void>();
  render(<JobsToolbar filters={props.filters ?? {}} counts={props.counts} onChange={onChange} />);
  return {
    onChange,
    statusGroup: screen.getByRole('group', { name: en.list.filterByStatus }),
    typeGroup: screen.getByRole('group', { name: en.list.filterByType }),
  };
}

const names = (group: HTMLElement) =>
  within(group)
    .getAllByRole('button')
    .map((button) => button.textContent);

describe('JobsToolbar', () => {
  it('Status filter buttons: All and every status, with All pressed', () => {
    const { statusGroup } = renderToolbar();

    expect(names(statusGroup)).toEqual([
      'All',
      'Scheduled',
      'Pending',
      'Processing',
      'Completed',
      'Failed',
      'Cancelled',
    ]);
    expect(within(statusGroup).getByRole('button', { name: 'All' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(within(statusGroup).getByRole('button', { name: 'Failed' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('Type filter buttons: All types and every job type, no Batch, with All types pressed', () => {
    const { typeGroup } = renderToolbar();

    expect(names(typeGroup)).toEqual(['All types', 'Email', 'Webhook', 'Aircraft transit']);
    expect(within(typeGroup).getByRole('button', { name: 'All types' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('shows the chosen status and type pressed and the All buttons not', () => {
    const { statusGroup, typeGroup } = renderToolbar({
      filters: { status: 'failed', type: 'flight-transit' },
    });

    expect(within(statusGroup).getByRole('button', { pressed: true })).toHaveTextContent('Failed');
    expect(within(typeGroup).getByRole('button', { pressed: true })).toHaveTextContent(
      'Aircraft transit',
    );
  });

  it('Filters are not disabled: every filter button is enabled, without "Coming soon"', async () => {
    const { statusGroup, typeGroup } = renderToolbar();

    for (const button of [
      ...within(statusGroup).getAllByRole('button'),
      ...within(typeGroup).getAllByRole('button'),
    ]) {
      expect(button).toBeEnabled();
    }
    await userEvent.hover(within(statusGroup).getByRole('button', { name: 'Failed' }));
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('Disabled search: the search field is disabled with a "Coming soon" tooltip', async () => {
    renderToolbar();
    const search = screen.getByRole('searchbox', { name: en.list.searchLabel });

    expect(search).toBeDisabled();
    await userEvent.hover(search.closest('[aria-disabled="true"]')!);

    expect(await screen.findByRole('tooltip')).toHaveTextContent(en.comingSoon);
  });

  it('choosing a status keeps the chosen type', async () => {
    const { onChange, statusGroup } = renderToolbar({ filters: { type: 'webhook' } });

    await userEvent.click(within(statusGroup).getByRole('button', { name: 'Failed' }));

    expect(onChange).toHaveBeenCalledExactlyOnceWith({ status: 'failed', type: 'webhook' });
  });

  it('choosing a type keeps the chosen status', async () => {
    const { onChange, typeGroup } = renderToolbar({ filters: { status: 'failed' } });

    await userEvent.click(within(typeGroup).getByRole('button', { name: 'Aircraft transit' }));

    expect(onChange).toHaveBeenCalledExactlyOnceWith({ status: 'failed', type: 'flight-transit' });
  });

  it('All and All types clear only their own filter', async () => {
    const { onChange, statusGroup, typeGroup } = renderToolbar({
      filters: { status: 'failed', type: 'webhook' },
    });

    await userEvent.click(within(statusGroup).getByRole('button', { name: 'All' }));
    await userEvent.click(within(typeGroup).getByRole('button', { name: 'All types' }));

    expect(onChange).toHaveBeenNthCalledWith(1, { type: 'webhook' });
    expect(onChange).toHaveBeenNthCalledWith(2, { status: 'failed' });
  });

  it('Counts without filters: a muted count after each label, All and All types as sums', () => {
    const { statusGroup, typeGroup } = renderToolbar({ counts: COUNTS });

    expect(names(statusGroup)).toEqual([
      'All 3',
      'Scheduled 0',
      'Pending 0',
      'Processing 0',
      'Completed 1',
      'Failed 2',
      'Cancelled 0',
    ]);
    expect(names(typeGroup)).toEqual(['All types 3', 'Email 1', 'Webhook 2', 'Aircraft transit 0']);
    const count = within(statusGroup).getByText('2');
    expect(count).toHaveClass('text-muted-foreground');
    expect(within(statusGroup).getByRole('button', { name: 'Failed 2' })).toContainElement(count);
  });

  it('All and All types add up the counts they are given, not a separate total', () => {
    const { statusGroup, typeGroup } = renderToolbar({
      filters: { type: 'webhook' },
      counts: {
        status: { ...COUNTS.status, completed: 1, failed: 2 },
        type: { email: 5, webhook: 3, 'flight-transit': 1 },
      },
    });

    expect(within(statusGroup).getByRole('button', { name: 'All 3' })).toBeVisible();
    expect(within(typeGroup).getByRole('button', { name: 'All types 9' })).toBeVisible();
  });

  it('Large count on a filter button: counts use thousands separators', () => {
    const { statusGroup, typeGroup } = renderToolbar({
      counts: {
        status: { ...COUNTS.status, completed: 0, failed: 1234 },
        type: { email: 0, webhook: 1234, 'flight-transit': 0 },
      },
    });

    expect(within(statusGroup).getByRole('button', { name: 'Failed 1,234' })).toBeVisible();
    expect(within(statusGroup).getByRole('button', { name: 'All 1,234' })).toBeVisible();
    expect(within(typeGroup).getByRole('button', { name: 'Webhook 1,234' })).toBeVisible();
  });

  it('Counts loading: the buttons show their labels without counts and can be clicked', async () => {
    const { onChange, statusGroup, typeGroup } = renderToolbar({ counts: undefined });

    expect(names(statusGroup)).not.toContainEqual(expect.stringMatching(/\d/));
    expect(names(typeGroup)).not.toContainEqual(expect.stringMatching(/\d/));
    await userEvent.click(within(typeGroup).getByRole('button', { name: 'Webhook' }));
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ type: 'webhook' });
  });
});
