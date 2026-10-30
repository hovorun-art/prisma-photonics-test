import { EMAIL_LIMITS, JOB_LIMITS } from '@job-queue/contracts';
import { render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { Route, Routes } from 'react-router';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { en } from '@/locales';

import { jobFixtures } from '../testing/job-fixtures';
import { CurrentPath, TEST_API_BASE, TestProviders } from '../testing/test-providers';
import { SubmitJobPage } from './submit-job-page';

const JOBS_URL = `${TEST_API_BASE}/v1/jobs`;
const server = setupServer();
const posted: unknown[] = [];

beforeAll(() => {
  server.listen({ onUnhandledFrame: 'error' });
});
afterEach(() => {
  server.resetHandlers();
  posted.length = 0;
});
afterAll(() => {
  server.close();
});

function answerCreate(response: () => Response) {
  server.use(
    http.post(JOBS_URL, async ({ request }) => {
      posted.push(await request.json());
      return response();
    }),
  );
}

function renderSubmit() {
  return render(
    <TestProviders path="/jobs/new">
      <Routes>
        <Route path="/jobs/new" element={<SubmitJobPage />} />
        <Route path="*" element={<CurrentPath />} />
      </Routes>
    </TestProviders>,
  );
}

async function fillEmail(user: ReturnType<typeof userEvent.setup>, to = 'ops@acme.test') {
  await user.type(screen.getByLabelText(en.submit.to), to);
  await user.type(screen.getByLabelText(en.submit.subject), 'Weekly digest');
  await user.type(screen.getByLabelText(en.submit.body), 'Hi team');
}

describe('SubmitJobPage', () => {
  it('Submit a valid email job: creates it with the entered values and opens its page', async () => {
    const user = userEvent.setup();
    const created = jobFixtures.build();
    answerCreate(() => HttpResponse.json(created, { status: 201 }));
    renderSubmit();

    await fillEmail(user);
    await user.clear(screen.getByLabelText(en.submit.priority));
    await user.type(screen.getByLabelText(en.submit.priority), '8');
    await user.click(screen.getByRole('button', { name: en.submit.submit }));

    expect(await screen.findByRole('status', { name: 'current path' })).toHaveTextContent(
      `/jobs/${created.id}`,
    );
    expect(posted).toEqual([
      {
        type: 'email',
        payload: { to: 'ops@acme.test', subject: 'Weekly digest', body: 'Hi team' },
        priority: 8,
        maxAttempts: JOB_LIMITS.maxAttempts.default,
      },
    ]);
  });

  it('Defaults in the form: Priority and Max attempts hold the API defaults', () => {
    renderSubmit();

    expect(screen.getByLabelText(en.submit.priority)).toHaveValue(JOB_LIMITS.priority.default);
    expect(screen.getByLabelText(en.submit.maxAttempts)).toHaveValue(
      JOB_LIMITS.maxAttempts.default,
    );
  });

  it('Cancel the form: opens the jobs list and creates no job', async () => {
    const user = userEvent.setup();
    renderSubmit();

    await user.click(screen.getByRole('link', { name: en.submit.cancel }));

    expect(screen.getByRole('status', { name: 'current path' })).toHaveTextContent('/jobs');
    expect(posted).toEqual([]);
  });

  it('Disabled job types: Webhook and Aircraft transit are disabled, Email is selected', () => {
    renderSubmit();

    const types = screen.getByRole('group', { name: en.submit.typeSection });
    expect(within(types).getByRole('button', { name: /^Email/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(within(types).getByRole('button', { name: /^Webhook/ })).toBeDisabled();
    expect(within(types).getByRole('button', { name: /^Aircraft transit/ })).toBeDisabled();
  });

  it('Invalid email address: the To field shows an error and nothing is sent', async () => {
    const user = userEvent.setup();
    renderSubmit();

    await fillEmail(user, 'not-an-email');
    await user.click(screen.getByRole('button', { name: en.submit.submit }));

    const to = screen.getByLabelText(en.submit.to);
    expect(to).toHaveAttribute('aria-invalid', 'true');
    expect(to).toHaveAccessibleDescription(en.submit.errors.to);
    expect(posted).toEqual([]);
  });

  it('Priority out of range: the Priority field shows an error and nothing is sent', async () => {
    const user = userEvent.setup();
    renderSubmit();

    await fillEmail(user);
    await user.clear(screen.getByLabelText(en.submit.priority));
    await user.type(screen.getByLabelText(en.submit.priority), String(JOB_LIMITS.priority.max + 1));
    await user.click(screen.getByRole('button', { name: en.submit.submit }));

    const priority = screen.getByLabelText(en.submit.priority);
    expect(priority).toHaveAttribute('aria-invalid', 'true');
    expect(priority).toHaveAccessibleDescription(
      en.submit.errors.priority(JOB_LIMITS.priority.min, JOB_LIMITS.priority.max),
    );
    expect(posted).toEqual([]);
  });

  it('Missing subject: the Subject field shows an error and nothing is sent', async () => {
    const user = userEvent.setup();
    renderSubmit();

    await user.type(screen.getByLabelText(en.submit.to), 'ops@acme.test');
    await user.click(screen.getByRole('button', { name: en.submit.submit }));

    const subject = screen.getByLabelText(en.submit.subject);
    expect(subject).toHaveAttribute('aria-invalid', 'true');
    expect(subject).toHaveAccessibleDescription(en.submit.errors.subjectRequired);
    expect(posted).toEqual([]);
  });

  it('API validation error: the issue shows on its field and the values stay', async () => {
    const user = userEvent.setup();
    answerCreate(() =>
      HttpResponse.json(
        {
          code: 'VALIDATION_FAILED',
          message: 'Validation failed',
          details: { issues: [{ path: ['payload', 'to'], message: 'Domain not allowed' }] },
        },
        { status: 400 },
      ),
    );
    renderSubmit();

    await fillEmail(user);
    await user.click(screen.getByRole('button', { name: en.submit.submit }));

    const to = screen.getByLabelText(en.submit.to);
    await expect.poll(() => to.getAttribute('aria-invalid')).toBe('true');
    expect(to).toHaveAccessibleDescription('Domain not allowed');
    expect(to).toHaveValue('ops@acme.test');
    expect(screen.getByLabelText(en.submit.subject)).toHaveValue('Weekly digest');
  });

  it('Other API error: an alert above the buttons shows the message and the values stay', async () => {
    const user = userEvent.setup();
    answerCreate(() =>
      HttpResponse.json(
        { code: 'INTERNAL_ERROR', message: 'Internal error', details: {} },
        { status: 500 },
      ),
    );
    renderSubmit();

    await fillEmail(user);
    await user.click(screen.getByRole('button', { name: en.submit.submit }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Internal error');
    expect(screen.getByLabelText(en.submit.to)).toHaveValue('ops@acme.test');
  });

  it('API validation error on a field not in the form: the alert shows its message', async () => {
    const user = userEvent.setup();
    answerCreate(() =>
      HttpResponse.json(
        {
          code: 'VALIDATION_FAILED',
          message: 'Request validation failed',
          details: { issues: [{ path: ['type'], message: 'Unknown job type' }] },
        },
        { status: 400 },
      ),
    );
    renderSubmit();

    await fillEmail(user);
    await user.click(screen.getByRole('button', { name: en.submit.submit }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Unknown job type');
  });

  it('API validation error without issues: the alert shows the API message', async () => {
    const user = userEvent.setup();
    answerCreate(() =>
      HttpResponse.json(
        { code: 'VALIDATION_FAILED', message: 'Request body is not valid JSON', details: {} },
        { status: 400 },
      ),
    );
    renderSubmit();

    await fillEmail(user);
    await user.click(screen.getByRole('button', { name: en.submit.submit }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Request body is not valid JSON');
  });

  it('Subject longer than the limit is rejected before sending', async () => {
    const user = userEvent.setup();
    renderSubmit();

    await user.type(screen.getByLabelText(en.submit.to), 'ops@acme.test');
    await user.click(screen.getByLabelText(en.submit.subject));
    await user.paste('x'.repeat(EMAIL_LIMITS.subjectMaxLength + 1));
    await user.click(screen.getByRole('button', { name: en.submit.submit }));

    expect(screen.getByLabelText(en.submit.subject)).toHaveAccessibleDescription(
      en.submit.errors.subjectTooLong(EMAIL_LIMITS.subjectMaxLength),
    );
    expect(posted).toEqual([]);
  });

  it('Preview follows the form: the request preview shows the typed subject', async () => {
    const user = userEvent.setup();
    renderSubmit();

    await user.type(screen.getByLabelText(en.submit.subject), 'Quarterly report');

    expect(screen.getByRole('region', { name: en.submit.request })).toHaveTextContent(
      '"subject": "Quarterly report"',
    );
  });

  it('Copy cURL: the clipboard holds the submit command and the button reads Copied', async () => {
    const user = userEvent.setup();
    renderSubmit();
    await user.type(screen.getByLabelText(en.submit.subject), 'Hi');
    const preview = screen.getByRole('region', { name: en.submit.request });

    await user.click(within(preview).getByRole('button', { name: en.copy.copyCurl }));

    const command = await navigator.clipboard.readText();
    expect(command).toContain(`curl -X POST ${JOBS_URL}`);
    expect(command).toContain('"subject": "Hi"');
    expect(within(preview).getByRole('button', { name: en.copy.copied })).toBeVisible();
  });

  it('Example response: a 201 Created example with status pending and attempts zero', () => {
    renderSubmit();

    const response = screen.getByRole('region', { name: en.submit.response });
    expect(response).toHaveTextContent(en.submit.created);
    expect(response).toHaveTextContent(en.submit.example);
    expect(response).toHaveTextContent('"status": "pending"');
    expect(response).toHaveTextContent('"attempts": 0');
    expect(response).toHaveTextContent(`"priority": ${JOB_LIMITS.priority.default}`);
    expect(response).toHaveTextContent(`"maxAttempts": ${JOB_LIMITS.maxAttempts.default}`);
  });
});
