import { randomUUID } from 'node:crypto';

import type { JobLogEntry } from '@job-queue/contracts';
import { render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { en } from '@/locales';

import { jobLogEntryFixtures } from '../testing/job-fixtures';
import { TEST_API_BASE, TestProviders } from '../testing/test-providers';
import { JobLogCard } from './job-log-card';

const server = setupServer();
const jobId = randomUUID();
const LOGS_URL = `${TEST_API_BASE}/v1/jobs/${jobId}/logs`;
/** Waits for a poll; generous, since the whole repo's tests share the machine. */
const POLL_WAIT = { timeout: 5000 };

beforeAll(() => {
  server.listen({ onUnhandledFrame: 'error' });
});
afterEach(() => {
  server.resetHandlers();
});
afterAll(() => {
  server.close();
});

function entry(message: string, extra: Partial<JobLogEntry> = {}): JobLogEntry {
  return jobLogEntryFixtures.build({ jobId, message, ...extra });
}

/** Answers the log route from `all`, filtered by the `level` parameters like the API does. */
function answerWith(all: JobLogEntry[]) {
  server.use(
    http.get(LOGS_URL, ({ request }) => {
      const params = new URL(request.url).searchParams;
      const levels = params.getAll('level');
      const after = params.get('after');
      const newer = all.filter((_, index) => after === null || index > Number(after));
      const items = newer.filter((item) => levels.length === 0 || levels.includes(item.level));
      return HttpResponse.json({ items, nextCursor: String(all.length - 1) });
    }),
  );
}

function renderCard(pollIntervalMs = 60_000) {
  return render(
    <TestProviders config={{ pollIntervalMs }}>
      <JobLogCard jobId={jobId} />
    </TestProviders>,
  );
}

function card() {
  return screen.getByRole('region', { name: en.log.title });
}

function rows() {
  return within(card()).queryAllByRole('listitem');
}

describe('JobLogCard', () => {
  it('Log of a completed job: one row per entry, oldest first, with time, level, attempt and message', async () => {
    answerWith([
      entry('Job submitted', { attempt: null, timestamp: '2026-10-29T21:02:09.000Z' }),
      entry('Attempt picked up', { attempt: 1, timestamp: '2026-10-29T21:02:10.250Z' }),
      entry('Attempt failed', {
        attempt: 2,
        level: 'warning',
        timestamp: '2026-10-29T21:03:11.900Z',
      }),
    ]);

    renderCard();

    await screen.findByText('Job submitted');
    const list = rows();
    expect(list).toHaveLength(3);
    expect(list[0]).toHaveTextContent('Job submitted');
    expect(list[0]).toHaveTextContent(en.log.noAttempt);
    expect(list[0]).toHaveTextContent(en.log.levels.info);
    // Times are local; the test setup pins the time zone to UTC.
    expect(list[0]).toHaveTextContent('21:02:09');
    expect(list[1]).toHaveTextContent('Attempt picked up');
    expect(list[1]).toHaveTextContent(en.log.attempt(1));
    expect(list[1]).toHaveTextContent(en.log.levels.info);
    expect(list[1]).toHaveTextContent('21:02:10');
    expect(list[2]).toHaveTextContent('Attempt failed');
    expect(list[2]).toHaveTextContent(en.log.attempt(2));
    expect(list[2]).toHaveTextContent(en.log.levels.warning);
    expect(list[2]).toHaveTextContent('21:03:11');
  });

  it("Expand an entry's metadata", async () => {
    answerWith([entry('Handler finished', { metadata: { durationMs: 1234 } })]);
    renderCard();
    await screen.findByText('Handler finished');
    expect(card()).not.toHaveTextContent('durationMs');

    await userEvent.click(screen.getByRole('button', { name: en.log.showMetadata }));

    expect(card()).toHaveTextContent('"durationMs": 1234');
    expect(screen.getByRole('button', { name: en.log.hideMetadata })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });

  it('Collapse the metadata again: the metadata is hidden', async () => {
    answerWith([entry('Handler finished', { metadata: { durationMs: 1234 } })]);
    renderCard();
    await screen.findByText('Handler finished');
    await userEvent.click(screen.getByRole('button', { name: en.log.showMetadata }));
    expect(card()).toHaveTextContent('durationMs');

    await userEvent.click(screen.getByRole('button', { name: en.log.hideMetadata }));

    expect(card()).not.toHaveTextContent('durationMs');
    expect(screen.getByRole('button', { name: en.log.showMetadata })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });

  it('An entry without metadata has no button to show it', async () => {
    answerWith([entry('Job submitted', { metadata: {} })]);

    renderCard();

    await screen.findByText('Job submitted');
    expect(screen.queryByRole('button', { name: en.log.showMetadata })).toBeNull();
  });

  it('New entry appears: the next poll adds it as the last row and keeps the others', async () => {
    const all = [entry('first')];
    answerWith(all);
    renderCard(30);
    await screen.findByText('first');

    all.push(entry('second'));

    await waitFor(() => {
      expect(rows().map((row) => row.textContent)).toEqual([
        expect.stringContaining('first'),
        expect.stringContaining('second'),
      ]);
    }, POLL_WAIT);
  });

  it('Show only errors: the Error button is pressed and only error entries stay', async () => {
    answerWith([
      entry('fine'),
      entry('careful', { level: 'warning' }),
      entry('broken', { level: 'error' }),
    ]);
    renderCard();
    await screen.findByText('fine');
    expect(screen.getByRole('button', { name: en.log.levels.all })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    await userEvent.click(screen.getByRole('button', { name: en.log.levels.error }));

    await waitFor(() => {
      expect(rows()).toHaveLength(1);
    }, POLL_WAIT);
    expect(rows()[0]).toHaveTextContent('broken');
    expect(screen.getByRole('button', { name: en.log.levels.error })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    for (const unpressed of [en.log.levels.all, en.log.levels.info, en.log.levels.warning]) {
      expect(screen.getByRole('button', { name: unpressed })).toHaveAttribute(
        'aria-pressed',
        'false',
      );
    }
  });

  it('Back to all: entries of every level are shown again', async () => {
    answerWith([entry('fine'), entry('broken', { level: 'error' })]);
    renderCard();
    await screen.findByText('fine');
    await userEvent.click(screen.getByRole('button', { name: en.log.levels.error }));
    await waitFor(() => {
      expect(rows()).toHaveLength(1);
    }, POLL_WAIT);

    await userEvent.click(screen.getByRole('button', { name: en.log.levels.all }));

    await waitFor(() => {
      expect(rows()).toHaveLength(2);
    }, POLL_WAIT);
    expect(screen.getByRole('button', { name: en.log.levels.all })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('Loading the log: skeleton rows until the first answer', async () => {
    answerWith([entry('late')]);

    renderCard();

    expect(within(card()).getByLabelText(en.log.loading)).toHaveAttribute('aria-busy', 'true');
    await screen.findByText('late');
    expect(within(card()).queryByLabelText(en.log.loading)).toBeNull();
  });

  it('No entries yet: the empty text with All chosen', async () => {
    answerWith([]);

    renderCard();

    expect(await screen.findByText(en.log.empty)).toBeVisible();
  });

  it('No entries of the chosen level: the text of that level', async () => {
    answerWith([entry('fine')]);
    renderCard();
    await screen.findByText('fine');

    await userEvent.click(screen.getByRole('button', { name: en.log.levels.warning }));

    expect(await screen.findByText(en.log.emptyLevel.warning)).toBeVisible();
  });

  it('Log unavailable: the card says so and keeps its title', async () => {
    server.use(
      http.get(LOGS_URL, () =>
        HttpResponse.json(
          { code: 'LOG_STORE_UNAVAILABLE', message: 'down', details: {} },
          { status: 503 },
        ),
      ),
    );

    renderCard();

    expect(await screen.findByText(en.log.unavailable)).toBeVisible();
    expect(card()).toBeVisible();
    expect(rows()).toHaveLength(0);
  });
});
