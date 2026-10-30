import type { QueueStats as QueueStatsBody } from '@job-queue/contracts';
import { render, screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { en } from '@/locales';

import { STATUS_DOT } from '../model/status-style';
import { queueStatsFixtures } from '../testing/job-fixtures';
import { TEST_API_BASE, TestProviders } from '../testing/test-providers';
import { QueueStats } from './queue-stats';

const STATS_URL = `${TEST_API_BASE}/v1/stats`;
/** Waits for a poll; generous, since the whole repo's tests share the machine. */
const POLL_WAIT = { timeout: 5000 };
const LABELS = [
  en.list.stats.pending,
  en.list.stats.processing,
  en.list.stats.scheduled,
  en.list.stats.completed,
  en.list.stats.failed,
  en.list.stats.throughput,
];
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

/**
 * Answers the statistics route with one answer per call, in order; the last one repeats. Returns
 * the number of calls so far.
 */
function answerStats(...answers: (QueueStatsBody | 'network-error')[]): () => number {
  let call = 0;
  server.use(
    http.get(STATS_URL, () => {
      const answer = answers[Math.min(call++, answers.length - 1)]!;
      return answer === 'network-error' ? HttpResponse.error() : HttpResponse.json(answer);
    }),
  );
  return () => call;
}

function renderStats(pollIntervalMs?: number) {
  return render(
    <TestProviders config={pollIntervalMs ? { pollIntervalMs } : {}}>
      <QueueStats />
    </TestProviders>,
  );
}

function card(label: string): HTMLElement {
  return screen.getByRole('group', { name: label });
}

/** The value text of every card, in the order they are shown. */
function cardValues(): string[] {
  const region = screen.getByRole('region', { name: en.list.statsLabel });
  return within(region)
    .getAllByRole('group')
    .map((group) => group.querySelector('[data-stat-value]')?.textContent ?? '');
}

describe('QueueStats', () => {
  it('Statistics shown: the six cards show the reported values in order', async () => {
    answerStats(queueStatsFixtures.build());

    renderStats();

    await screen.findByText('1,234', {}, POLL_WAIT);
    const region = screen.getByRole('region', { name: en.list.statsLabel });
    expect(
      within(region)
        .getAllByRole('group')
        .map((group) => group.getAttribute('aria-label')),
    ).toEqual(LABELS);
    expect(cardValues()).toEqual(['12', '3', '7', '1,234', '5', '2.4/min']);
  });

  it('Statistics shown: each card keeps the colour of its status', async () => {
    answerStats(queueStatsFixtures.build());

    renderStats();

    await screen.findByText('1,234', {}, POLL_WAIT);
    const dots: [string, string][] = [
      [en.list.stats.pending, STATUS_DOT.pending],
      [en.list.stats.processing, STATUS_DOT.processing],
      [en.list.stats.scheduled, STATUS_DOT.scheduled],
      [en.list.stats.completed, STATUS_DOT.completed],
      [en.list.stats.failed, STATUS_DOT.failed],
      [en.list.stats.throughput, 'bg-muted-foreground'],
    ];
    for (const [label, dot] of dots) {
      expect(card(label).querySelector('[data-stat-dot]')).toHaveClass(dot);
    }
  });

  it('Large count: the Pending card shows 1,234', async () => {
    answerStats(queueStatsFixtures.build({ pending: 1234 }));

    renderStats();

    await expect
      .poll(() => card(en.list.stats.pending).querySelector('[data-stat-value]')?.textContent)
      .toBe('1,234');
  });

  it('Throughput value: the Throughput card shows 2.4/min', async () => {
    answerStats(queueStatsFixtures.build({ throughput: { windowMinutes: 5, perMinute: 2.4 } }));

    renderStats();

    await expect
      .poll(() => card(en.list.stats.throughput).querySelector('[data-stat-value]')?.textContent)
      .toBe('2.4/min');
  });

  it('Statistics loading: each card shows a skeleton until the first answer', () => {
    server.use(http.get(STATS_URL, () => new Promise<never>(() => undefined)));

    renderStats();

    expect(screen.getByRole('region', { name: en.list.statsLabel })).toHaveAttribute(
      'aria-busy',
      'true',
    );
    for (const label of LABELS) {
      expect(card(label).querySelector('[data-slot="skeleton"]')).not.toBeNull();
    }
  });

  it('Statistics update by polling: the cards show the new values after the next poll', async () => {
    answerStats(queueStatsFixtures.build(), queueStatsFixtures.build({ pending: 40 }));

    renderStats(20);

    await screen.findByText('12', {}, POLL_WAIT);
    expect(await within(card(en.list.stats.pending)).findByText('40', {}, POLL_WAIT)).toBeVisible();
  });

  it('Statistics poll fails after values were shown: the cards keep the last values', async () => {
    const calls = answerStats(queueStatsFixtures.build(), 'network-error');

    renderStats(20);

    await screen.findByText('1,234', {}, POLL_WAIT);
    await expect.poll(calls, POLL_WAIT).toBeGreaterThan(2);
    expect(cardValues()).toEqual(['12', '3', '7', '1,234', '5', '2.4/min']);
  });

  it('First statistics request fails: each card shows "—"', async () => {
    answerStats('network-error');

    renderStats();

    await expect.poll(() => cardValues(), POLL_WAIT).toEqual(Array(6).fill(en.list.noValue));
    expect(screen.getByRole('region', { name: en.list.statsLabel })).toHaveAttribute(
      'aria-busy',
      'false',
    );
  });

  it('Statistics recover: a successful poll after a failed first request shows the values', async () => {
    answerStats('network-error', queueStatsFixtures.build());

    renderStats(20);

    expect(await screen.findByText('2.4/min', {}, POLL_WAIT)).toBeVisible();
    expect(cardValues()).toEqual(['12', '3', '7', '1,234', '5', '2.4/min']);
  });

  it('Statistics without data: the cards are not disabled and show no "Coming soon"', async () => {
    answerStats(queueStatsFixtures.build());

    renderStats();

    await screen.findByText('1,234', {}, POLL_WAIT);
    for (const label of LABELS) {
      expect(card(label).closest('[aria-disabled="true"]')).toBeNull();
    }
  });
});
