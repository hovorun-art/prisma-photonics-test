import { render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it } from 'vitest';

import { API_BASE_PATH } from '@/config';
import { en } from '@/locales';

import { AppFrame } from './app-frame';

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<AppFrame />}>
          <Route path="/jobs" element={<p>jobs list page</p>} />
          <Route path="/jobs/new" element={<p>submit page</p>} />
          <Route path="/jobs/:id" element={<p>job page</p>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe('AppFrame', () => {
  it.each([
    ['/jobs', 'jobs list page'],
    ['/jobs/new', 'submit page'],
    ['/jobs/7f3a9c21-4b5d-4e6f-8a7b-9c0d1e2f3a4b', 'job page'],
  ])('Header on every page: %s shows the mark, navigation and New job', (path, page) => {
    renderAt(path);

    const header = screen.getByRole('banner');
    expect(within(header).getByRole('link', { name: en.frame.productName })).toBeVisible();
    const nav = within(header).getByRole('navigation', { name: en.frame.navLabel });
    expect(within(nav).getByRole('link', { name: en.frame.jobs })).toBeVisible();
    expect(within(nav).getByRole('link', { name: en.frame.apiDocs })).toBeVisible();
    expect(within(header).getByRole('link', { name: en.frame.newJob })).toBeVisible();
    expect(within(header).getByText(en.frame.apiStatus)).toBeVisible();
    expect(screen.getByText(page)).toBeVisible();
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
        <MemoryRouter initialEntries={['/jobs']}>
          <Routes>
            <Route element={<AppFrame />}>
              <Route path="/jobs" element={<FlakyPage />} />
              <Route path="/jobs/new" element={<p>submit page</p>} />
            </Route>
          </Routes>
        </MemoryRouter>,
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
