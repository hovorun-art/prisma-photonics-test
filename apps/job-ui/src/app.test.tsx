import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { useNavigate } from 'react-router';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { en } from '@/locales';

import { AppRoutes } from './app';
import { jobFixtures } from './features/jobs/testing/job-fixtures';
import { TEST_API_BASE, TestProviders } from './features/jobs/testing/test-providers';

const job = jobFixtures.build();
const server = setupServer(
  http.get(`${TEST_API_BASE}/v1/jobs`, () => HttpResponse.json({ items: [job], total: 1 })),
  http.get(`${TEST_API_BASE}/v1/jobs/${job.id}`, () => HttpResponse.json(job)),
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

/** The browser's Back button, for a MemoryRouter. */
function BackButton() {
  const navigate = useNavigate();
  return (
    <button
      type="button"
      onClick={() => {
        void navigate(-1);
      }}
    >
      test: back
    </button>
  );
}

describe('AppRoutes', () => {
  it('Start page is the jobs list: / shows the jobs list', async () => {
    render(
      <TestProviders path="/">
        <AppRoutes />
      </TestProviders>,
    );

    expect(await screen.findByRole('heading', { level: 1, name: en.list.title })).toBeVisible();
    expect(await screen.findByRole('link', { name: job.id.slice(0, 8) })).toBeVisible();
  });

  it('Direct link to a job: /jobs/<id> shows that job', async () => {
    render(
      <TestProviders path={`/jobs/${job.id}`}>
        <AppRoutes />
      </TestProviders>,
    );

    expect(await screen.findByRole('heading', { level: 1, name: job.id })).toBeVisible();
  });

  it('Submit page: /jobs/new shows the submit form', () => {
    render(
      <TestProviders path="/jobs/new">
        <AppRoutes />
      </TestProviders>,
    );

    expect(screen.getByRole('heading', { level: 1, name: en.submit.title })).toBeVisible();
  });

  it('Back returns to the list: Back after opening a job shows the list again', async () => {
    const user = userEvent.setup();
    render(
      <TestProviders path="/jobs">
        <AppRoutes />
        <BackButton />
      </TestProviders>,
    );
    await user.click(await screen.findByRole('link', { name: job.id.slice(0, 8) }));
    expect(await screen.findByRole('heading', { level: 1, name: job.id })).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'test: back' }));

    expect(await screen.findByRole('heading', { level: 1, name: en.list.title })).toBeVisible();
  });

  describe('a failed first load', () => {
    const failing = () =>
      HttpResponse.json(
        { code: 'INTERNAL_ERROR', message: 'Internal error', details: {} },
        { status: 500 },
      );

    it('Jobs list fails to load: "Something went wrong" and Reload instead of the table', async () => {
      server.use(http.get(`${TEST_API_BASE}/v1/jobs`, failing, { once: true }));

      render(
        <TestProviders path="/jobs">
          <AppRoutes />
        </TestProviders>,
      );

      expect(await screen.findByText(en.pageError.title)).toBeVisible();
      expect(screen.getByRole('button', { name: en.pageError.reload })).toBeVisible();
      expect(screen.queryByRole('table')).toBeNull();
      expect(screen.getByRole('banner')).toBeVisible();
    });

    it('Job page fails to load: "Something went wrong" and Reload instead of the job', async () => {
      server.use(http.get(`${TEST_API_BASE}/v1/jobs/${job.id}`, failing, { once: true }));

      render(
        <TestProviders path={`/jobs/${job.id}`}>
          <AppRoutes />
        </TestProviders>,
      );

      expect(await screen.findByText(en.pageError.title)).toBeVisible();
      expect(screen.getByRole('button', { name: en.pageError.reload })).toBeVisible();
      expect(screen.queryByRole('heading', { level: 1, name: job.id })).toBeNull();
    });

    it('Reload after a failed load: the next successful request shows the data', async () => {
      const user = userEvent.setup();
      server.use(http.get(`${TEST_API_BASE}/v1/jobs/${job.id}`, failing, { once: true }));
      render(
        <TestProviders path={`/jobs/${job.id}`}>
          <AppRoutes />
        </TestProviders>,
      );

      await user.click(await screen.findByRole('button', { name: en.pageError.reload }));

      expect(await screen.findByRole('heading', { level: 1, name: job.id })).toBeVisible();
      expect(screen.queryByText(en.pageError.title)).toBeNull();
    });
  });
});
