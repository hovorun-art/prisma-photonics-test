import type { Job } from '@job-queue/contracts';
import { render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { Route, Routes } from 'react-router';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { en } from '@/locales';

import { jobFixtures, transitJobFixtures, webhookJobFixtures } from '../testing/job-fixtures';
import { CurrentPath, TEST_API_BASE, TestProviders } from '../testing/test-providers';
import { JobPage } from './job-page';

const server = setupServer();
/** Waits for a poll; generous, since the whole repo's tests share the machine. */
const POLL_WAIT = { timeout: 5000 };
const requests: string[] = [];

beforeAll(() => {
  server.listen({ onUnhandledFrame: 'error' });
  server.events.on('request:start', ({ request }) => {
    requests.push(`${request.method} ${new URL(request.url).pathname}`);
  });
});
afterEach(() => {
  server.resetHandlers();
  requests.length = 0;
});
afterAll(() => {
  server.close();
});

const completed = jobFixtures.build({
  status: 'completed',
  attempts: 1,
  startedAt: '2026-10-29T21:02:10.000Z',
  completedAt: '2026-10-29T21:02:20.300Z',
  result: { messageId: 'msg_01HF8Z2K4' },
});
const failed = jobFixtures.build({
  status: 'failed',
  attempts: 3,
  startedAt: '2026-10-29T21:02:10.000Z',
  completedAt: '2026-10-29T21:02:20.000Z',
  error: { code: 'EMAIL_SEND_FAILED', message: 'SMTP timeout' },
});
const pending = jobFixtures.build({ status: 'pending' });

function jobUrl(id: string) {
  return `${TEST_API_BASE}/v1/jobs/${id}`;
}

/** Answers GET of the job with one answer per call, in order; the last one repeats. */
function answerJob(id: string, ...answers: (Job | 'not-found')[]) {
  let call = 0;
  server.use(
    http.get(jobUrl(id), () => {
      const answer = answers[Math.min(call++, answers.length - 1)]!;
      return answer === 'not-found'
        ? HttpResponse.json(
            { code: 'JOB_NOT_FOUND', message: 'Job not found', details: { id } },
            { status: 404 },
          )
        : HttpResponse.json(answer);
    }),
  );
}

function renderJob(id: string, pollIntervalMs?: number) {
  return render(
    <TestProviders path={`/jobs/${id}`} config={pollIntervalMs ? { pollIntervalMs } : {}}>
      <Routes>
        <Route path="/jobs/:id" element={<JobPage />} />
        <Route path="*" element={<CurrentPath />} />
      </Routes>
    </TestProviders>,
  );
}

function detail(name: string) {
  const list = screen.getByRole('region', { name: en.job.details });
  return within(list).getByText(name).nextElementSibling;
}

describe('JobPage', () => {
  it('Completed job: id, badges, payload, result and details', async () => {
    answerJob(completed.id, completed);

    renderJob(completed.id);

    expect(await screen.findByRole('heading', { level: 1, name: completed.id })).toBeVisible();
    const breadcrumb = screen.getByRole('navigation', { name: en.job.breadcrumb });
    expect(within(breadcrumb).getByRole('link', { name: en.job.jobs })).toHaveAttribute(
      'href',
      '/jobs',
    );
    expect(breadcrumb).toHaveTextContent(completed.id);
    expect(screen.getAllByText(en.statuses.completed)[0]).toBeVisible();
    const payload = screen.getByRole('region', { name: en.job.payload });
    expect(payload).toHaveTextContent('"to": "ops@acme.test"');
    const result = screen.getByRole('region', { name: en.job.result });
    expect(result).toHaveTextContent('"messageId": "msg_01HF8Z2K4"');
    expect(detail(en.job.fields.type)).toHaveTextContent('email');
    expect(detail(en.job.fields.priority)).toHaveTextContent('5');
    expect(detail(en.job.fields.attempts)).toHaveTextContent('1 / 3');
  });

  it('Times on the job page: local date-times and the total time', async () => {
    answerJob(completed.id, completed);

    renderJob(completed.id);

    await screen.findByRole('heading', { level: 1, name: completed.id });
    expect(detail(en.job.fields.created)).toHaveTextContent('29 Oct, 21:02:09');
    expect(detail(en.job.fields.started)).toHaveTextContent('29 Oct, 21:02:10');
    expect(detail(en.job.fields.finished)).toHaveTextContent('29 Oct, 21:02:20');
    expect(detail(en.job.fields.totalTime)).toHaveTextContent('10.3s');
  });

  it('Failed job: an alert with the attempts and the error, and an Error card', async () => {
    answerJob(failed.id, failed);

    renderJob(failed.id);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(en.job.failedTitle(3, 3));
    expect(alert).toHaveTextContent('SMTP timeout');
    expect(screen.getByRole('region', { name: en.job.error })).toHaveTextContent(
      '"code": "EMAIL_SEND_FAILED"',
    );
    expect(screen.queryByRole('region', { name: en.job.result })).toBeNull();
  });

  it('Waiting job: payload shown, no started or finished time', async () => {
    answerJob(pending.id, pending);

    renderJob(pending.id);

    expect(await screen.findByRole('region', { name: en.job.payload })).toBeVisible();
    expect(detail(en.job.fields.started)).toHaveTextContent(en.job.notYet);
    expect(detail(en.job.fields.finished)).toHaveTextContent(en.job.notYet);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('Lifecycle of a completed job: every step reached, with times', async () => {
    answerJob(completed.id, completed);

    renderJob(completed.id);

    const lifecycle = await screen.findByRole('region', { name: en.job.lifecycle });
    const steps = within(lifecycle).getAllByRole('listitem');
    expect(steps.map((s) => s.dataset.reached)).toEqual(['true', 'true', 'true']);
    expect(steps[0]).toHaveTextContent(`${en.statuses.pending}21:02:09`);
    expect(steps[1]).toHaveTextContent(`${en.statuses.processing}21:02:10`);
    expect(steps[2]).toHaveTextContent(`${en.statuses.completed}21:02:20`);
  });

  it('Lifecycle of a pending job: pending reached, processing not yet', async () => {
    answerJob(pending.id, pending);

    renderJob(pending.id);

    const lifecycle = await screen.findByRole('region', { name: en.job.lifecycle });
    const steps = within(lifecycle).getAllByRole('listitem');
    expect(steps.map((s) => s.dataset.reached)).toEqual(['true', 'false', 'false']);
  });

  it('Scheduled time on the job page: "Scheduled for" shows the local date and time, formatted like Created', async () => {
    const job = jobFixtures.build({ status: 'scheduled', scheduledAt: '2026-10-30T08:00:00.000Z' });
    answerJob(job.id, job);

    renderJob(job.id);

    await screen.findByRole('heading', { level: 1, name: job.id });
    expect(detail(en.job.fields.scheduledFor)).toHaveTextContent('30 Oct, 08:00:00');
    expect(detail(en.job.fields.created)).toHaveTextContent('29 Oct, 21:02:09');
  });

  it('No scheduled time on the job page: the Details list has no "Scheduled for" row', async () => {
    answerJob(pending.id, pending);

    renderJob(pending.id);

    const list = await screen.findByRole('region', { name: en.job.details });
    expect(within(list).queryByText(en.job.fields.scheduledFor)).toBeNull();
  });

  it('Lifecycle of a scheduled job: scheduled reached at the creation time, then processing and completed not yet', async () => {
    const job = jobFixtures.build({ status: 'scheduled', scheduledAt: '2026-10-30T08:00:00.000Z' });
    answerJob(job.id, job);

    renderJob(job.id);

    const lifecycle = await screen.findByRole('region', { name: en.job.lifecycle });
    const steps = within(lifecycle).getAllByRole('listitem');
    expect(steps.map((s) => s.dataset.reached)).toEqual(['true', 'false', 'false']);
    expect(steps[0]).toHaveTextContent(`${en.statuses.scheduled}21:02:09`);
    expect(lifecycle).not.toHaveTextContent(en.statuses.pending);
  });

  it('Loading a job: skeleton cards while the job loads', () => {
    server.use(http.get(jobUrl(pending.id), () => new Promise<never>(() => undefined)));

    renderJob(pending.id);

    expect(screen.getByLabelText(en.job.loading)).toHaveAttribute('aria-busy', 'true');
  });

  it('Unknown job id: "Job not found" with a link back to Jobs', async () => {
    answerJob(pending.id, 'not-found');

    renderJob(pending.id);

    expect(await screen.findByRole('heading', { name: en.job.notFoundTitle })).toBeVisible();
    expect(screen.getByRole('link', { name: en.job.backToJobs })).toHaveAttribute('href', '/jobs');
  });

  it('Malformed job id: "Job not found" and no request for the job', () => {
    renderJob('abc');

    expect(screen.getByRole('heading', { name: en.job.notFoundTitle })).toBeVisible();
    expect(screen.getByRole('link', { name: en.job.backToJobs })).toBeVisible();
    expect(requests).toEqual([]);
  });

  it('Job deleted while open: the next poll shows "Job not found"', async () => {
    answerJob(pending.id, pending);
    renderJob(pending.id, 20);
    expect(await screen.findByRole('heading', { level: 1, name: pending.id })).toBeVisible();

    // The next answer is served only now, so the first state cannot be skipped by a fast poll.
    answerJob(pending.id, 'not-found');

    expect(
      await screen.findByRole('heading', { name: en.job.notFoundTitle }, POLL_WAIT),
    ).toBeVisible();
  });

  it('Status change appears on the job page: the next poll shows the new status', async () => {
    const processing = { ...pending, status: 'processing' as const };
    answerJob(pending.id, pending);
    renderJob(pending.id, 20);
    const heading = await screen.findByRole('heading', { level: 1, name: pending.id });
    const header = heading.parentElement!;
    expect(within(header).getByText(en.statuses.pending)).toBeVisible();

    // The next answer is served only now, so the first state cannot be skipped by a fast poll.
    answerJob(pending.id, processing);

    expect(await within(header).findByText(en.statuses.processing, {}, POLL_WAIT)).toBeVisible();
  });

  it('Copy the payload: the clipboard holds the payload JSON and the button reads Copied', async () => {
    const user = userEvent.setup();
    answerJob(pending.id, pending);
    renderJob(pending.id);
    const payload = await screen.findByRole('region', { name: en.job.payload });

    await user.click(within(payload).getByRole('button', { name: en.copy.copy }));

    expect(await navigator.clipboard.readText()).toBe(JSON.stringify(pending.payload, null, 2));
    expect(within(payload).getByRole('button', { name: en.copy.copied })).toBeVisible();
  });

  it('Copy as cURL: the clipboard holds a curl command that gets this job', async () => {
    const user = userEvent.setup();
    answerJob(pending.id, pending);
    renderJob(pending.id);

    await user.click(await screen.findByRole('button', { name: en.copy.copyAsCurl }));

    expect(await navigator.clipboard.readText()).toBe(`curl ${jobUrl(pending.id)}`);
    expect(screen.getByRole('button', { name: en.copy.copied })).toBeVisible();
  });

  describe('delete', () => {
    function answerDelete(id: string, response: () => Response) {
      server.use(http.delete(jobUrl(id), response));
    }

    it('Delete a finished job: confirming deletes it and opens the jobs list', async () => {
      const user = userEvent.setup();
      answerJob(completed.id, completed);
      answerDelete(completed.id, () => new HttpResponse(null, { status: 204 }));
      renderJob(completed.id);

      await user.click(await screen.findByRole('button', { name: en.job.deleteJob }));
      const dialog = screen.getByRole('dialog', { name: en.job.deleteTitle });
      await user.click(within(dialog).getByRole('button', { name: en.job.deleteConfirm }));

      expect(await screen.findByRole('status', { name: 'current path' })).toHaveTextContent(
        '/jobs',
      );
      expect(requests).toContain(`DELETE /api/v1/jobs/${completed.id}`);
    });

    it.each([failed, { ...pending, status: 'cancelled' as const }])(
      'Delete a finished job: a $status job has the Delete button',
      async (job) => {
        answerJob(job.id, job);

        renderJob(job.id);

        expect(await screen.findByRole('button', { name: en.job.deleteJob })).toBeVisible();
      },
    );

    it('Cancel the confirmation: the dialog closes, nothing is deleted, the page stays', async () => {
      const user = userEvent.setup();
      answerJob(completed.id, completed);
      renderJob(completed.id);

      await user.click(await screen.findByRole('button', { name: en.job.deleteJob }));
      await user.click(screen.getByRole('button', { name: en.job.deleteCancel }));

      expect(screen.queryByRole('dialog')).toBeNull();
      expect(screen.getByRole('heading', { level: 1, name: completed.id })).toBeVisible();
      expect(requests.filter((r) => r.startsWith('DELETE'))).toEqual([]);
    });

    it.each([pending, { ...pending, status: 'processing' as const }])(
      'No delete for an unfinished job: no Delete button for a $status job',
      async (job) => {
        answerJob(job.id, job);

        renderJob(job.id);

        await screen.findByRole('heading', { level: 1, name: job.id });
        expect(screen.queryByRole('button', { name: en.job.deleteJob })).toBeNull();
      },
    );

    it('Delete rejected: the dialog stays open and shows the error message', async () => {
      const user = userEvent.setup();
      answerJob(completed.id, completed);
      answerDelete(completed.id, () =>
        HttpResponse.json(
          { code: 'JOB_STATUS_CONFLICT', message: 'Job is not finished', details: {} },
          { status: 409 },
        ),
      );
      renderJob(completed.id);

      await user.click(await screen.findByRole('button', { name: en.job.deleteJob }));
      const dialog = screen.getByRole('dialog', { name: en.job.deleteTitle });
      await user.click(within(dialog).getByRole('button', { name: en.job.deleteConfirm }));

      expect(await within(dialog).findByText('Job is not finished')).toBeVisible();
      expect(screen.getByRole('dialog')).toBeVisible();
    });

    it('Already deleted: a "job not found" answer opens the jobs list', async () => {
      const user = userEvent.setup();
      answerJob(completed.id, completed);
      answerDelete(completed.id, () =>
        HttpResponse.json(
          { code: 'JOB_NOT_FOUND', message: 'Job not found', details: {} },
          { status: 404 },
        ),
      );
      renderJob(completed.id);

      await user.click(await screen.findByRole('button', { name: en.job.deleteJob }));
      await user.click(screen.getByRole('button', { name: en.job.deleteConfirm }));

      expect(await screen.findByRole('status', { name: 'current path' })).toHaveTextContent(
        '/jobs',
      );
    });
  });

  describe('status change', () => {
    const processing = { ...pending, status: 'processing' as const, attempts: 1 };

    /** Answers PATCH of the job; records each body sent. */
    function answerStatusChange(id: string, response: () => Response | Promise<Response>) {
      const bodies: unknown[] = [];
      server.use(
        http.patch(jobUrl(id), async ({ request }) => {
          bodies.push(await request.json());
          return response();
        }),
      );
      return bodies;
    }

    /** The job's header: the title with its badges and actions. */
    async function header(id: string) {
      const heading = await screen.findByRole('heading', { level: 1, name: id });
      return heading.parentElement!.parentElement!;
    }

    function getRequests(id: string) {
      return requests.filter((r) => r === `GET /api/v1/jobs/${id}`);
    }

    it('Cancel a pending job: confirming sends the cancel and shows the job cancelled at once', async () => {
      const user = userEvent.setup();
      answerJob(pending.id, pending);
      const bodies = answerStatusChange(pending.id, () =>
        HttpResponse.json({ ...pending, status: 'cancelled' }),
      );
      renderJob(pending.id);
      const top = await header(pending.id);

      await user.click(within(top).getByRole('button', { name: en.job.cancelJob }));
      const dialog = screen.getByRole('dialog', { name: en.job.cancelTitle });
      await user.click(within(dialog).getByRole('button', { name: en.job.cancelConfirm }));

      expect(await within(top).findByText(en.statuses.cancelled)).toBeVisible();
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(bodies).toEqual([{ status: 'cancelled' }]);
      // Shown from the answer, not from another read of the job.
      expect(getRequests(pending.id)).toHaveLength(1);
    });

    // One status per scenario here; the presenter's test goes through every status.
    it('Cancel a processing job: a processing job has the Cancel job button', async () => {
      answerJob(processing.id, processing);

      renderJob(processing.id);

      expect(
        within(await header(processing.id)).getByRole('button', { name: en.job.cancelJob }),
      ).toBeVisible();
    });

    it('Keep the job: closing the dialog sends nothing and keeps the job', async () => {
      const user = userEvent.setup();
      answerJob(pending.id, pending);
      renderJob(pending.id);
      const top = await header(pending.id);

      await user.click(within(top).getByRole('button', { name: en.job.cancelJob }));
      const dialog = screen.getByRole('dialog', { name: en.job.cancelTitle });
      await user.click(within(dialog).getByRole('button', { name: en.job.deleteCancel }));

      expect(screen.queryByRole('dialog')).toBeNull();
      expect(within(top).getByText(en.statuses.pending)).toBeVisible();
      expect(requests.filter((r) => r.startsWith('PATCH'))).toEqual([]);
    });

    it('No cancel for a finished job: no Cancel job button for a completed job', async () => {
      answerJob(completed.id, completed);

      renderJob(completed.id);

      expect(
        within(await header(completed.id)).queryByRole('button', { name: en.job.cancelJob }),
      ).toBeNull();
    });

    it('Retry a failed job: one click sends the retry and shows the job pending with zero attempts', async () => {
      const user = userEvent.setup();
      answerJob(failed.id, failed);
      const bodies = answerStatusChange(failed.id, () =>
        HttpResponse.json({
          ...failed,
          status: 'pending',
          attempts: 0,
          error: null,
          startedAt: null,
          completedAt: null,
        }),
      );
      renderJob(failed.id);
      const top = await header(failed.id);

      await user.click(within(top).getByRole('button', { name: en.job.retryJob }));

      expect(await within(top).findByText(en.statuses.pending)).toBeVisible();
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(detail(en.job.fields.attempts)).toHaveTextContent('0 / 3');
      expect(bodies).toEqual([{ status: 'pending' }]);
      expect(getRequests(failed.id)).toHaveLength(1);
    });

    it('No retry for a job that has not failed: no Retry job button for a cancelled job', async () => {
      const cancelled = { ...pending, status: 'cancelled' as const };
      answerJob(cancelled.id, cancelled);

      renderJob(cancelled.id);

      expect(
        within(await header(cancelled.id)).queryByRole('button', { name: en.job.retryJob }),
      ).toBeNull();
    });

    it('Retry in flight: the Retry job button is disabled until the answer arrives', async () => {
      const user = userEvent.setup();
      let answer: () => void = () => undefined;
      answerJob(failed.id, failed);
      answerStatusChange(
        failed.id,
        () =>
          new Promise<Response>((resolve) => {
            answer = () => {
              resolve(HttpResponse.json({ ...failed, status: 'pending', attempts: 0 }));
            };
          }),
      );
      renderJob(failed.id);
      const top = await header(failed.id);
      const retry = within(top).getByRole('button', { name: en.job.retryJob });

      await user.click(retry);

      await vi.waitFor(() => {
        expect(retry).toBeDisabled();
      });
      await user.click(retry);
      answer();
      expect(await within(top).findByText(en.statuses.pending)).toBeVisible();
      expect(requests.filter((r) => r.startsWith('PATCH'))).toHaveLength(1);
    });

    it('Cancel in flight: the dialog confirm button is disabled until the answer arrives', async () => {
      const user = userEvent.setup();
      let answer: () => void = () => undefined;
      answerJob(pending.id, pending);
      answerStatusChange(
        pending.id,
        () =>
          new Promise<Response>((resolve) => {
            answer = () => {
              resolve(HttpResponse.json({ ...pending, status: 'cancelled' }));
            };
          }),
      );
      renderJob(pending.id);
      const top = await header(pending.id);

      await user.click(within(top).getByRole('button', { name: en.job.cancelJob }));
      const dialog = screen.getByRole('dialog', { name: en.job.cancelTitle });
      const confirm = within(dialog).getByRole('button', { name: en.job.cancelConfirm });
      await user.click(confirm);

      await vi.waitFor(() => {
        expect(confirm).toBeDisabled();
      });
      answer();
      expect(await within(top).findByText(en.statuses.cancelled)).toBeVisible();
      expect(requests.filter((r) => r.startsWith('PATCH'))).toHaveLength(1);
    });

    it('Cancel rejected: the dialog stays open with the message and the job is not shown cancelled', async () => {
      const user = userEvent.setup();
      answerJob(pending.id, pending);
      answerStatusChange(pending.id, () =>
        HttpResponse.json(
          {
            code: 'JOB_STATUS_CONFLICT',
            message: 'Job is completed',
            details: { id: pending.id, status: 'completed' },
          },
          { status: 409 },
        ),
      );
      renderJob(pending.id);
      const top = await header(pending.id);

      await user.click(within(top).getByRole('button', { name: en.job.cancelJob }));
      const dialog = screen.getByRole('dialog', { name: en.job.cancelTitle });
      await user.click(within(dialog).getByRole('button', { name: en.job.cancelConfirm }));

      expect(await within(dialog).findByText('Job is completed')).toBeVisible();
      expect(screen.getByRole('dialog')).toBeVisible();
      expect(within(dialog).getByRole('button', { name: en.job.cancelConfirm })).toBeEnabled();
      expect(within(top).getByText(en.statuses.pending)).toBeVisible();
      expect(within(top).queryByText(en.statuses.cancelled)).toBeNull();
    });

    it('Cancel rejected: reopening the dialog shows no old error', async () => {
      const user = userEvent.setup();
      answerJob(pending.id, pending);
      answerStatusChange(pending.id, () =>
        HttpResponse.json(
          { code: 'JOB_STATUS_CONFLICT', message: 'Job is completed', details: {} },
          { status: 409 },
        ),
      );
      renderJob(pending.id);
      const top = await header(pending.id);
      await user.click(within(top).getByRole('button', { name: en.job.cancelJob }));
      await user.click(screen.getByRole('button', { name: en.job.cancelConfirm }));
      await screen.findByText('Job is completed');

      await user.click(screen.getByRole('button', { name: en.job.deleteCancel }));
      await user.click(within(top).getByRole('button', { name: en.job.cancelJob }));

      expect(screen.queryByText('Job is completed')).toBeNull();
    });

    it('Retry rejected: the message shows next to the actions and the job stays failed', async () => {
      const user = userEvent.setup();
      answerJob(failed.id, failed);
      answerStatusChange(failed.id, () =>
        HttpResponse.json(
          {
            code: 'JOB_STATUS_CONFLICT',
            message: 'Job is not failed',
            details: { id: failed.id, status: 'pending' },
          },
          { status: 409 },
        ),
      );
      renderJob(failed.id);
      const top = await header(failed.id);

      await user.click(within(top).getByRole('button', { name: en.job.retryJob }));

      expect(await within(top).findByRole('alert')).toHaveTextContent('Job is not failed');
      expect(within(top).getByText(en.statuses.failed)).toBeVisible();
      expect(within(top).getByRole('button', { name: en.job.retryJob })).toBeEnabled();
    });

    it.each([
      [pending, en.job.cancelJob],
      [failed, en.job.retryJob],
    ])(
      'Cancel and Retry are not disabled: the %#. button is enabled, without "Coming soon"',
      async (job, name) => {
        const user = userEvent.setup();
        answerJob(job.id, job);
        renderJob(job.id);
        const button = within(await header(job.id)).getByRole('button', { name });

        await user.hover(button);

        expect(button).toBeEnabled();
        expect(button.closest('[aria-disabled="true"]')).toBeNull();
        expect(screen.queryByText(en.comingSoon)).toBeNull();
      },
    );
  });

  it('Completed webhook job page: type badge, webhook payload and the result', async () => {
    const job = webhookJobFixtures.build({
      status: 'completed',
      attempts: 1,
      startedAt: '2026-10-29T21:02:10.000Z',
      completedAt: '2026-10-29T21:02:11.500Z',
      result: { statusCode: 200, responseBody: { received: true } },
    });
    answerJob(job.id, job);

    renderJob(job.id);

    const heading = await screen.findByRole('heading', { level: 1, name: job.id });
    expect(heading.parentElement).toHaveTextContent(en.jobTypes.webhook);
    const payload = screen.getByRole('region', { name: en.job.payload });
    expect(payload).toHaveTextContent('"method": "POST"');
    expect(payload).toHaveTextContent('"url": "https://hooks.example.com/orders"');
    expect(payload).toHaveTextContent('"orderId": "ord_4821"');
    const result = screen.getByRole('region', { name: en.job.result });
    expect(result).toHaveTextContent('"statusCode": 200');
    expect(result).toHaveTextContent('"received": true');
    expect(detail(en.job.fields.type)).toHaveTextContent('webhook');
  });

  it('Failed webhook job page: the alert shows the message, the Error card the status code', async () => {
    const message = 'Webhook POST https://hooks.example.com/orders answered 503';
    const job = webhookJobFixtures.build({
      status: 'failed',
      attempts: 3,
      startedAt: '2026-10-29T21:02:10.000Z',
      completedAt: '2026-10-29T21:02:11.500Z',
      error: { code: 'WEBHOOK_HTTP_ERROR', message, details: { statusCode: 503 } },
    });
    answerJob(job.id, job);

    renderJob(job.id);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(message);
    const error = screen.getByRole('region', { name: en.job.error });
    expect(error).toHaveTextContent('"code": "WEBHOOK_HTTP_ERROR"');
    expect(error).toHaveTextContent(`"message": "${message}"`);
    expect(error).toHaveTextContent('"statusCode": 503');
  });

  describe('flight transit', () => {
    it('Completed transit job opens the report: titled by the route, no Payload card or Lifecycle', async () => {
      const job = transitJobFixtures.completed();
      answerJob(job.id, job);

      renderJob(job.id);

      expect(await screen.findByRole('heading', { level: 1, name: 'LHR → JFK' })).toBeVisible();
      expect(screen.getByRole('region', { name: en.report.summaryLabel })).toBeVisible();
      expect(screen.getByRole('region', { name: en.report.mapLabel })).toBeVisible();
      expect(screen.queryByRole('region', { name: en.job.payload })).toBeNull();
      expect(screen.queryByRole('region', { name: en.job.lifecycle })).toBeNull();
      expect(screen.getByRole('navigation', { name: en.job.breadcrumb })).toHaveTextContent(job.id);
    });

    it('Waiting transit job keeps the normal page: the transit payload is in the Payload card', async () => {
      const job = transitJobFixtures.build();
      answerJob(job.id, job);

      renderJob(job.id);

      expect(await screen.findByRole('heading', { level: 1, name: job.id })).toBeVisible();
      const payload = screen.getByRole('region', { name: en.job.payload });
      expect(payload).toHaveTextContent('"origin": "LHR"');
      expect(payload).toHaveTextContent('"destination": "JFK"');
      expect(payload).toHaveTextContent('"departureDate": "2026-10-28"');
      expect(screen.queryByRole('region', { name: en.report.mapLabel })).toBeNull();
    });

    it('Failed transit job keeps the normal page: the alert and the Error card', async () => {
      const job = transitJobFixtures.build({
        status: 'failed',
        attempts: 3,
        error: { code: 'TRANSIT_GENERATION_FAILED', message: 'No route between the airports' },
      });
      answerJob(job.id, job);

      renderJob(job.id);

      expect(await screen.findByRole('alert')).toHaveTextContent('No route between the airports');
      expect(screen.getByRole('region', { name: en.job.error })).toHaveTextContent(
        '"code": "TRANSIT_GENERATION_FAILED"',
      );
      expect(screen.queryByRole('region', { name: en.report.mapLabel })).toBeNull();
    });

    it('A failed poll keeps the last data: the report stays and "Connection lost, retrying" shows', async () => {
      const job = transitJobFixtures.completed();
      answerJob(job.id, job);
      renderJob(job.id, 20);
      await screen.findByRole('heading', { level: 1, name: 'LHR → JFK' });

      server.use(http.get(jobUrl(job.id), () => HttpResponse.error()));

      expect(await screen.findByText(en.list.connectionLost, {}, POLL_WAIT)).toBeVisible();
      expect(screen.getByRole('heading', { level: 1, name: 'LHR → JFK' })).toBeVisible();
    });

    it('Job completes while its page is open: the next poll switches to the report', async () => {
      const job = transitJobFixtures.build({ status: 'processing' });
      answerJob(job.id, job);
      renderJob(job.id, 20);
      await screen.findByRole('heading', { level: 1, name: job.id });

      // The next answer is served only now, so the first state cannot be skipped by a fast poll.
      answerJob(job.id, transitJobFixtures.completed({ id: job.id }));

      expect(
        await screen.findByRole('heading', { level: 1, name: 'LHR → JFK' }, POLL_WAIT),
      ).toBeVisible();
      expect(screen.queryByRole('region', { name: en.job.payload })).toBeNull();
    });
  });
});
