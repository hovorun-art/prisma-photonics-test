import { randomUUID } from 'node:crypto';

import { render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { Route, Routes } from 'react-router';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { API_BASE_PATH } from '@/config';
import { en } from '@/locales';

import { queueStatsFixtures } from '../jobs/testing/job-fixtures';
import { TEST_API_BASE, TestProviders } from '../jobs/testing/test-providers';
import { AppFrame } from './app-frame';

const JOB_ID = randomUUID();
const GROUP_ID = randomUUID();

/** The header's API status pill polls the statistics; every test here sees job-service online. */
const server = setupServer(
  http.get(`${TEST_API_BASE}/v1/stats`, () => HttpResponse.json(queueStatsFixtures.build())),
);

beforeAll(() => {
  server.listen({ onUnhandledFrame: 'error' });
});
afterEach(() => {
  server.resetHandlers();
});
afterAll(() => {
  server.close();
});

function renderAt(path: string) {
  return render(
    <TestProviders path={path}>
      <Routes>
        <Route element={<AppFrame />}>
          <Route path="/jobs" element={<p>jobs list page</p>} />
          <Route path="/jobs/new" element={<p>submit page</p>} />
          <Route path="/jobs/:id" element={<p>job page</p>} />
          <Route path="/groups" element={<p>groups list page</p>} />
          <Route path="/groups/:id" element={<p>group page</p>} />
        </Route>
      </Routes>
    </TestProviders>,
  );
}

describe('AppFrame', () => {
  it.each([
    ['/jobs', 'jobs list page'],
    ['/jobs/new', 'submit page'],
    [`/jobs/${JOB_ID}`, 'job page'],
    ['/groups', 'groups list page'],
    [`/groups/${GROUP_ID}`, 'group page'],
  ])('Header on every page: %s shows the mark, navigation and New job', (path, page) => {
    renderAt(path);

    const header = screen.getByRole('banner');
    expect(within(header).getByRole('link', { name: en.frame.productName })).toBeVisible();
    const nav = within(header).getByRole('navigation', { name: en.frame.navLabel });
    expect(within(nav).getByRole('link', { name: en.frame.jobs })).toBeVisible();
    expect(within(nav).getByRole('link', { name: en.frame.groups })).toBeVisible();
    expect(within(nav).getByRole('link', { name: en.frame.apiDocs })).toBeVisible();
    expect(within(header).getByRole('link', { name: en.frame.newJob })).toBeVisible();
    expect(screen.getByText(page)).toBeVisible();
  });

  it('Statistics without data: the header pill is not disabled and shows no "Coming soon"', async () => {
    renderAt('/jobs');

    const pill = await within(screen.getByRole('banner')).findByText(en.frame.apiOnline);
    expect(pill.closest('[aria-disabled="true"]')).toBeNull();
  });

  it('New job from the header: opens the submit page', async () => {
    const user = userEvent.setup();
    renderAt('/jobs');

    await user.click(screen.getByRole('link', { name: en.frame.newJob }));

    expect(screen.getByText('submit page')).toBeVisible();
  });

  it('Jobs in the navigation opens the jobs list', async () => {
    const user = userEvent.setup();
    renderAt('/jobs/new');

    await user.click(screen.getByRole('link', { name: en.frame.jobs }));

    expect(screen.getByText('jobs list page')).toBeVisible();
  });

  it('Groups from the header: clicking Groups opens the groups list', async () => {
    const user = userEvent.setup();
    renderAt('/jobs');

    await user.click(screen.getByRole('link', { name: en.frame.groups }));

    expect(screen.getByText('groups list page')).toBeVisible();
  });

  it('API docs in a new tab: links to the API documentation in a new tab', () => {
    renderAt('/jobs');

    const link = screen.getByRole('link', { name: en.frame.apiDocs });
    expect(link).toHaveAttribute('href', `${API_BASE_PATH}/docs`);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  describe('an unexpected error on a page', () => {
    let failing = true;
    function FlakyPage() {
      if (failing) throw new Error('render failed');
      return <p>recovered page</p>;
    }
    function renderFlaky() {
      return render(
        <TestProviders path="/jobs">
          <Routes>
            <Route element={<AppFrame />}>
              <Route path="/jobs" element={<FlakyPage />} />
              <Route path="/jobs/new" element={<p>submit page</p>} />
            </Route>
          </Routes>
        </TestProviders>,
      );
    }

    beforeEach(() => {
      failing = true;
    });

    it('Unexpected error on a page: only the page shows the error, the header still works', async () => {
      const user = userEvent.setup();
      renderFlaky();

      expect(screen.getByText(en.pageError.title)).toBeVisible();
      expect(screen.getByRole('button', { name: en.pageError.reload })).toBeVisible();
      await user.click(
        within(screen.getByRole('banner')).getByRole('link', { name: en.frame.newJob }),
      );
      expect(screen.getByText('submit page')).toBeVisible();
    });

    it('Reload after an unexpected error: the page is shown again', async () => {
      const user = userEvent.setup();
      renderFlaky();
      failing = false;

      await user.click(screen.getByRole('button', { name: en.pageError.reload }));

      expect(screen.getByText('recovered page')).toBeVisible();
    });
  });
});
