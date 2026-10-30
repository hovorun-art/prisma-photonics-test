import { randomUUID } from 'node:crypto';

import type { Job, JobStatus } from '@job-queue/contracts';
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { Route, Routes } from 'react-router';
import { describe, expect, it } from 'vitest';

import { en } from '@/locales';

import { jobFixtures } from '../../jobs/testing/job-fixtures';
import { CurrentPath, TestProviders } from '../../jobs/testing/test-providers';
import { GroupJobCells } from './group-job-cells';

function job(status: JobStatus = 'pending'): Job {
  return jobFixtures.build({ id: randomUUID(), status });
}

function cellName(j: Job): string {
  return en.group.cell(j.id.slice(0, 8), en.statuses[j.status]);
}

function renderCells(jobs: Job[]) {
  return render(
    <TestProviders path="/groups/g">
      <Routes>
        <Route path="/groups/g" element={<GroupJobCells jobs={jobs} />} />
        <Route path="*" element={<CurrentPath />} />
      </Routes>
    </TestProviders>,
  );
}

describe('GroupJobCells', () => {
  it('One cell per job: a cell for every job in the given order, and the header "Jobs 1–n"', () => {
    const jobs = Array.from({ length: 7 }, () => job());

    renderCells(jobs);

    expect(screen.getByText(en.group.jobsRange(7))).toBeVisible();
    const cells = screen.getAllByRole('link');
    expect(cells.map((cell) => cell.getAttribute('aria-label'))).toEqual(jobs.map(cellName));
  });

  it('Cell colours: completed, failed and cancelled, pending and processing', () => {
    const jobs = [
      job('completed'),
      job('failed'),
      job('cancelled'),
      job('pending'),
      job('processing'),
    ];

    renderCells(jobs);

    const kinds = jobs.map((j) =>
      screen.getByRole('link', { name: cellName(j) }).getAttribute('data-kind'),
    );
    expect(kinds).toEqual(['completed', 'failed', 'failed', 'remaining', 'remaining']);
  });

  it('Cell tooltip: hovering a cell shows the job’s short id and status', async () => {
    const user = userEvent.setup();
    const processing = job('processing');
    renderCells([processing]);

    await user.hover(screen.getByRole('link', { name: cellName(processing) }));

    expect(await screen.findByRole('tooltip')).toHaveTextContent(cellName(processing));
  });

  it('Cell tooltip: focusing a cell with the keyboard shows the job’s short id and status', async () => {
    const user = userEvent.setup();
    const failed = job('failed');
    renderCells([failed]);

    await user.tab();

    expect(screen.getByRole('link', { name: cellName(failed) })).toHaveFocus();
    expect(await screen.findByRole('tooltip')).toHaveTextContent(cellName(failed));
  });

  it('Open a job from its cell: clicking it opens the job page', async () => {
    const user = userEvent.setup();
    const completed = job('completed');
    renderCells([job(), completed]);

    await user.click(screen.getByRole('link', { name: cellName(completed) }));

    expect(screen.getByRole('status', { name: 'current path' })).toHaveTextContent(
      `/jobs/${completed.id}`,
    );
  });

  it('No jobs in the group: "No jobs in this group yet" and no cells', () => {
    renderCells([]);

    expect(screen.getByText(en.group.noJobs)).toBeVisible();
    expect(screen.queryAllByRole('link')).toHaveLength(0);
  });
});
