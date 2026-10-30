import type { QueueStats } from '@job-queue/contracts';
import { render, screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { en } from '@/locales';

import { queueStatsFixtures } from '../jobs/testing/job-fixtures';
import { TEST_API_BASE, TestProviders } from '../jobs/testing/test-providers';
import { ApiStatusPill } from './api-status-pill';

const STATS_URL = `${TEST_API_BASE}/v1/stats`;
/** Waits for a poll; generous, since the whole repo's tests share the machine. */
const POLL_WAIT = { timeout: 5000 };
const server = setupServer();

beforeAll(() => {
  server.listen({ onUnhandledFrame: 'error' });
});
afterEach(() => {
  server.resetHandlers();
});
afterAll(() => {
  server.close();
});

/** Answers the statistics route with one answer per call, in order; the last one repeats. */
function answerStats(...answers: (QueueStats | 'network-error' | 'server-error')[]) {
  let call = 0;
  server.use(
    http.get(STATS_URL, () => {
      const answer = answers[Math.min(call++, answers.length - 1)]!;
      if (answer === 'network-error') return HttpResponse.error();
      if (answer === 'server-error') {
        return HttpResponse.json(
          { code: 'INTERNAL_ERROR', message: 'Internal server error', details: {} },
          { status: 500 },
        );
      }
      return HttpResponse.json(answer);
    }),
  );
}

function renderPill(pollIntervalMs?: number) {
  return render(
    <TestProviders config={pollIntervalMs ? { pollIntervalMs } : {}}>
      <ApiStatusPill />
    </TestProviders>,
  );
}

describe('ApiStatusPill', () => {
  it('API status unknown: reads "API status —" until the first statistics request answers', () => {
    server.use(http.get(STATS_URL, () => new Promise<never>(() => undefined)));

    renderPill();

    expect(screen.getByText(en.frame.apiStatus)).toBeVisible();
  });

  it('API online: the latest statistics request succeeded', async () => {
    answerStats(queueStatsFixtures.build());

    renderPill();

    const pill = await screen.findByText(en.frame.apiOnline);
    expect(pill).toBeVisible();
    // Statistics without data: the pill is not wrapped as a "Coming soon" control.
    expect(pill.closest('[aria-disabled="true"]')).toBeNull();
  });

  it.each(['network-error', 'server-error'] as const)(
    'API offline: the latest statistics request failed (%s)',
    async (failure) => {
      answerStats(failure);

      renderPill();

      expect(await screen.findByText(en.frame.apiOffline)).toBeVisible();
    },
  );

  it('API offline after values were shown: a failed poll turns the pill offline', async () => {
    answerStats(queueStatsFixtures.build(), 'network-error');

    renderPill(20);

    await screen.findByText(en.frame.apiOnline);
    expect(await screen.findByText(en.frame.apiOffline, {}, POLL_WAIT)).toBeVisible();
  });

  it('API back online: a successful poll after a failed one', async () => {
    answerStats('network-error', queueStatsFixtures.build());

    renderPill(20);

    await screen.findByText(en.frame.apiOffline);
    expect(await screen.findByText(en.frame.apiOnline, {}, POLL_WAIT)).toBeVisible();
  });
});
