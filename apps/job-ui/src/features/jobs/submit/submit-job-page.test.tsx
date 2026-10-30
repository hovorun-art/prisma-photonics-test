import { EMAIL_LIMITS, JOB_LIMITS } from '@job-queue/contracts';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { Route, Routes, useLocation, useNavigate } from 'react-router';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { en } from '@/locales';

import { jobFixtures, transitJobFixtures, webhookJobFixtures } from '../testing/job-fixtures';
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

/** Test-only: the query string of the current URL, and the browser's Back button. */
function UrlControls() {
  const navigate = useNavigate();
  return (
    <>
      <output aria-label="current search">{useLocation().search}</output>
      <button type="button" onClick={() => void navigate(-1)}>
        Browser back
      </button>
    </>
  );
}

function renderSubmit(path = '/jobs/new') {
  return render(
    <TestProviders path={path}>
      <Routes>
        <Route
          path="/jobs/new"
          element={
            <>
              <SubmitJobPage />
              <UrlControls />
            </>
          }
        />
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

/** Opens the webhook form and fills its URL (and body, pasted so `{` is not read as a key). */
async function fillWebhook(
  user: ReturnType<typeof userEvent.setup>,
  { url = 'https://hooks.example.com/orders', body }: { url?: string; body?: string } = {},
) {
  if (url) await user.type(screen.getByLabelText(en.submit.url), url);
  if (body) {
    await user.click(screen.getByLabelText(en.submit.jsonBody));
    await user.paste(body);
  }
}

/** Opens an airport field's list, types the search and chooses the option of the given code. */
async function pickAirport(
  user: ReturnType<typeof userEvent.setup>,
  label: string,
  { search, iata }: { search: string; iata: string },
) {
  await user.click(screen.getByLabelText(label));
  await user.type(screen.getByPlaceholderText(en.submit.searchAirport), search);
  await user.click(screen.getByRole('option', { name: new RegExp(`^${iata} ·`) }));
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

  it('Submit form unchanged: the key field stays disabled with its "Coming soon" tooltip and no key is sent', async () => {
    const user = userEvent.setup();
    answerCreate(() => HttpResponse.json(jobFixtures.build(), { status: 201 }));
    renderSubmit();
    const field = screen.getByLabelText(new RegExp(en.submit.idempotencyKey));
    const comingSoon = field.closest('[aria-disabled="true"]');

    expect(field).toBeDisabled();
    expect(screen.getByRole('button', { name: en.submit.generate })).toBeDisabled();
    expect(comingSoon).not.toBeNull();
    await user.hover(comingSoon!);
    expect(await screen.findByRole('tooltip')).toHaveTextContent(en.comingSoon);

    await fillEmail(user);
    await user.click(screen.getByRole('button', { name: en.submit.submit }));

    await screen.findByRole('status', { name: 'current path' });
    expect(posted).toEqual([
      {
        type: 'email',
        payload: { to: 'ops@acme.test', subject: 'Weekly digest', body: 'Hi team' },
        priority: JOB_LIMITS.priority.default,
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

  it('Disabled job types: Webhook and Aircraft transit can be chosen, Email is selected', () => {
    renderSubmit();

    const types = screen.getByRole('group', { name: en.submit.typeSection });
    expect(within(types).getByRole('button', { name: /^Email/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(within(types).getByRole('button', { name: /^Webhook/ })).toBeEnabled();
    expect(within(types).getByRole('button', { name: /^Aircraft transit/ })).toBeEnabled();
  });

  it('Choose Webhook: the card is selected, the webhook fields show and the URL has the type', async () => {
    const user = userEvent.setup();
    renderSubmit();

    await user.click(screen.getByRole('button', { name: /^Webhook/ }));

    expect(screen.getByRole('button', { name: /^Webhook/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByLabelText(en.submit.method)).toBeVisible();
    expect(screen.getByLabelText(en.submit.url)).toBeVisible();
    expect(screen.queryByLabelText(en.submit.to)).not.toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'current search' })).toHaveTextContent(
      '?type=webhook',
    );
  });

  it('Direct link to the webhook form: Webhook is selected and its fields are shown', () => {
    renderSubmit('/jobs/new?type=webhook');

    expect(screen.getByRole('button', { name: /^Webhook/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByLabelText(en.submit.jsonBody)).toBeVisible();
  });

  it('Back to the previous type: Back after choosing Webhook shows the email form', async () => {
    const user = userEvent.setup();
    renderSubmit();
    await user.click(screen.getByRole('button', { name: /^Webhook/ }));

    await user.click(screen.getByRole('button', { name: 'Browser back' }));

    expect(screen.getByRole('button', { name: /^Email/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText(en.submit.to)).toBeVisible();
    expect(screen.getByRole('status', { name: 'current search' })).toHaveTextContent('');
  });

  it('Switching keeps the execution settings: Back keeps Priority changed on the webhook form', async () => {
    const user = userEvent.setup();
    renderSubmit();
    await user.click(screen.getByRole('button', { name: /^Webhook/ }));
    await user.clear(screen.getByLabelText(en.submit.priority));
    await user.type(screen.getByLabelText(en.submit.priority), '9');

    await user.click(screen.getByRole('button', { name: 'Browser back' }));

    expect(screen.getByRole('button', { name: /^Email/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText(en.submit.priority)).toHaveValue(9);
  });

  it('Switching keeps the execution settings: Priority stays, the email fields start empty', async () => {
    const user = userEvent.setup();
    renderSubmit();
    await user.clear(screen.getByLabelText(en.submit.priority));
    await user.type(screen.getByLabelText(en.submit.priority), '8');
    await user.type(screen.getByLabelText(en.submit.subject), 'Weekly digest');

    await user.click(screen.getByRole('button', { name: /^Webhook/ }));
    await user.click(screen.getByRole('button', { name: /^Email/ }));

    expect(screen.getByLabelText(en.submit.priority)).toHaveValue(8);
    expect(screen.getByLabelText(en.submit.subject)).toHaveValue('');
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

  it('Submit a valid webhook job: creates it with the entered values and opens its page', async () => {
    const user = userEvent.setup();
    const created = webhookJobFixtures.build();
    answerCreate(() => HttpResponse.json(created, { status: 201 }));
    renderSubmit('/jobs/new?type=webhook');

    await user.selectOptions(screen.getByLabelText(en.submit.method), 'PUT');
    await fillWebhook(user, { body: '{"orderId": "o-1"}' });
    await user.click(screen.getByRole('button', { name: en.submit.submit }));

    expect(await screen.findByRole('status', { name: 'current path' })).toHaveTextContent(
      `/jobs/${created.id}`,
    );
    expect(posted).toEqual([
      {
        type: 'webhook',
        payload: {
          method: 'PUT',
          url: 'https://hooks.example.com/orders',
          body: { orderId: 'o-1' },
        },
        priority: JOB_LIMITS.priority.default,
        maxAttempts: JOB_LIMITS.maxAttempts.default,
      },
    ]);
  });

  it('Submit without a body: the created webhook job has no body', async () => {
    const user = userEvent.setup();
    answerCreate(() => HttpResponse.json(webhookJobFixtures.build(), { status: 201 }));
    renderSubmit('/jobs/new?type=webhook');

    await fillWebhook(user);
    await user.click(screen.getByRole('button', { name: en.submit.submit }));

    await screen.findByRole('status', { name: 'current path' });
    expect(posted).toEqual([
      {
        type: 'webhook',
        payload: { method: 'POST', url: 'https://hooks.example.com/orders' },
        priority: JOB_LIMITS.priority.default,
        maxAttempts: JOB_LIMITS.maxAttempts.default,
      },
    ]);
  });

  it('Webhook form at first: POST, empty URL and body, API defaults and the mock note', () => {
    renderSubmit('/jobs/new?type=webhook');

    expect(screen.getByLabelText(en.submit.method)).toHaveValue('POST');
    expect(screen.getByLabelText(en.submit.url)).toHaveValue('');
    expect(screen.getByLabelText(en.submit.jsonBody)).toHaveValue('');
    expect(screen.getByLabelText(en.submit.priority)).toHaveValue(JOB_LIMITS.priority.default);
    expect(screen.getByLabelText(en.submit.maxAttempts)).toHaveValue(
      JOB_LIMITS.maxAttempts.default,
    );
    expect(screen.getByText(en.submit.webhookHint)).toBeVisible();
  });

  it.each([
    ['Invalid webhook URL', 'ftp://example.com/hook'],
    ['Missing webhook URL', ''],
  ])('%s: the URL field shows an error and nothing is sent', async (_name, url) => {
    const user = userEvent.setup();
    renderSubmit('/jobs/new?type=webhook');

    await fillWebhook(user, { url });
    await user.click(screen.getByRole('button', { name: en.submit.submit }));

    expect(await screen.findByText(en.submit.errors.url)).toBeVisible();
    expect(screen.getByLabelText(en.submit.url)).toHaveAttribute('aria-invalid', 'true');
    expect(posted).toEqual([]);
  });

  it.each([
    ['Body is not valid JSON', '{ orderId: ', en.submit.errors.jsonInvalid],
    ['Body is not a JSON object', '[1, 2]', en.submit.errors.jsonNotObject],
  ])(
    '%s: the Body (JSON) field shows an error and nothing is sent',
    async (_name, body, message) => {
      const user = userEvent.setup();
      renderSubmit('/jobs/new?type=webhook');

      await fillWebhook(user, { body });
      await user.click(screen.getByRole('button', { name: en.submit.submit }));

      expect(await screen.findByText(message)).toBeVisible();
      expect(screen.getByLabelText(en.submit.jsonBody)).toHaveAttribute('aria-invalid', 'true');
      expect(posted).toEqual([]);
    },
  );

  it('API validation error on a webhook field: the URL field shows the issue and the values stay', async () => {
    const user = userEvent.setup();
    answerCreate(() =>
      HttpResponse.json(
        {
          code: 'VALIDATION_FAILED',
          message: 'Request validation failed',
          details: { issues: [{ path: ['payload', 'url'], message: 'URL is blocked' }] },
        },
        { status: 400 },
      ),
    );
    renderSubmit('/jobs/new?type=webhook');

    await fillWebhook(user, { body: '{"a": 1}' });
    await user.click(screen.getByRole('button', { name: en.submit.submit }));

    await screen.findByText('URL is blocked');
    const url = screen.getByLabelText(en.submit.url);
    expect(url).toHaveAccessibleDescription('URL is blocked');
    expect(url).toHaveAttribute('aria-invalid', 'true');
    expect(url).toHaveValue('https://hooks.example.com/orders');
    expect(screen.getByLabelText(en.submit.jsonBody)).toHaveValue('{"a": 1}');
  });

  it('Preview of a webhook request: shows type webhook, the method and the typed URL', async () => {
    const user = userEvent.setup();
    renderSubmit('/jobs/new?type=webhook');

    await user.selectOptions(screen.getByLabelText(en.submit.method), 'GET');
    await fillWebhook(user, { url: 'https://example.com/ping' });

    const preview = screen.getByRole('region', { name: en.submit.request });
    expect(preview).toHaveTextContent('"type": "webhook"');
    expect(preview).toHaveTextContent('"method": "GET"');
    expect(preview).toHaveTextContent('"url": "https://example.com/ping"');
  });

  it('Example response for a webhook job: a 201 Created example with type webhook, pending', async () => {
    const user = userEvent.setup();
    renderSubmit();

    await user.click(screen.getByRole('button', { name: /^Webhook/ }));

    const response = screen.getByRole('region', { name: en.submit.response });
    expect(response).toHaveTextContent(en.submit.created);
    expect(response).toHaveTextContent(en.submit.example);
    expect(response).toHaveTextContent('"type": "webhook"');
    expect(response).toHaveTextContent('"status": "pending"');
  });

  describe('aircraft transit', () => {
    /** Late evening in UTC, so "today" is the UTC date the API checks against. */
    const NOW = new Date('2026-10-30T23:30:00.000Z');
    const TODAY = '2026-10-30';
    const TRANSIT_PATH = '/jobs/new?type=flight-transit';

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(NOW);
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('Choose Aircraft transit: the card is selected, the transit fields show and the URL has the type', async () => {
      const user = userEvent.setup();
      renderSubmit();

      await user.click(screen.getByRole('button', { name: /^Aircraft transit/ }));

      expect(screen.getByRole('button', { name: /^Aircraft transit/ })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      expect(screen.getByLabelText(en.submit.origin)).toBeVisible();
      expect(screen.getByLabelText(en.submit.destination)).toBeVisible();
      expect(screen.getByLabelText(en.submit.departureDate)).toBeVisible();
      expect(screen.queryByLabelText(en.submit.to)).not.toBeInTheDocument();
      expect(screen.getByRole('status', { name: 'current search' })).toHaveTextContent(
        '?type=flight-transit',
      );
    });

    it('Direct link to the transit form: Aircraft transit is selected and its fields are shown', () => {
      renderSubmit(TRANSIT_PATH);

      expect(screen.getByRole('button', { name: /^Aircraft transit/ })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      expect(screen.getByLabelText(en.submit.origin)).toBeVisible();
    });

    it('Back to the previous type: Back after choosing Aircraft transit shows the webhook form', async () => {
      const user = userEvent.setup();
      renderSubmit('/jobs/new?type=webhook');
      await user.click(screen.getByRole('button', { name: /^Aircraft transit/ }));

      await user.click(screen.getByRole('button', { name: 'Browser back' }));

      expect(screen.getByRole('button', { name: /^Webhook/ })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      expect(screen.getByLabelText(en.submit.url)).toBeVisible();
    });

    it('Switching to transit keeps the execution settings: Max attempts stays, the origin starts empty', async () => {
      const user = userEvent.setup();
      renderSubmit(TRANSIT_PATH);
      await user.clear(screen.getByLabelText(en.submit.maxAttempts));
      await user.type(screen.getByLabelText(en.submit.maxAttempts), '5');
      await pickAirport(user, en.submit.origin, { search: 'LHR', iata: 'LHR' });

      await user.click(screen.getByRole('button', { name: /^Email/ }));
      await user.click(screen.getByRole('button', { name: /^Aircraft transit/ }));

      expect(screen.getByLabelText(en.submit.maxAttempts)).toHaveValue(5);
      expect(screen.getByLabelText(en.submit.origin)).toHaveTextContent(en.submit.chooseAirport);
    });

    it("Transit form at first: no airports, today's UTC date, the API defaults and the note", () => {
      renderSubmit(TRANSIT_PATH);

      expect(screen.getByLabelText(en.submit.origin)).toHaveTextContent(en.submit.chooseAirport);
      expect(screen.getByLabelText(en.submit.destination)).toHaveTextContent(
        en.submit.chooseAirport,
      );
      expect(screen.getByLabelText(en.submit.departureDate)).toHaveValue(TODAY);
      expect(screen.getByLabelText(en.submit.priority)).toHaveValue(JOB_LIMITS.priority.default);
      expect(screen.getByLabelText(en.submit.maxAttempts)).toHaveValue(
        JOB_LIMITS.maxAttempts.default,
      );
      expect(screen.getByText(en.submit.transitHint)).toBeVisible();
    });

    it('Submit a valid transit job: creates it with the chosen airports and date and opens its page', async () => {
      const user = userEvent.setup();
      const created = transitJobFixtures.build();
      answerCreate(() => HttpResponse.json(created, { status: 201 }));
      renderSubmit(TRANSIT_PATH);

      await pickAirport(user, en.submit.origin, { search: 'london', iata: 'LHR' });
      await pickAirport(user, en.submit.destination, { search: 'jfk', iata: 'JFK' });
      await user.click(screen.getByRole('button', { name: en.submit.submit }));

      expect(await screen.findByRole('status', { name: 'current path' })).toHaveTextContent(
        `/jobs/${created.id}`,
      );
      expect(posted).toEqual([
        {
          type: 'flight-transit',
          payload: { origin: 'LHR', destination: 'JFK', departureDate: TODAY },
          priority: JOB_LIMITS.priority.default,
          maxAttempts: JOB_LIMITS.maxAttempts.default,
        },
      ]);
    });

    it('Choosing an airport: the field shows the code and name and the list closes', async () => {
      const user = userEvent.setup();
      renderSubmit(TRANSIT_PATH);

      await pickAirport(user, en.submit.origin, { search: 'LHR', iata: 'LHR' });

      expect(screen.getByLabelText(en.submit.origin)).toHaveTextContent(
        en.submit.airportChosen('LHR', 'Heathrow Airport'),
      );
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    });

    it('Search by city: `london` lists only the London airport, as "<IATA> · <name>, <city>"', async () => {
      const user = userEvent.setup();
      renderSubmit(TRANSIT_PATH);

      await user.click(screen.getByLabelText(en.submit.origin));
      await user.type(screen.getByPlaceholderText(en.submit.searchAirport), 'london');

      expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
        en.submit.airportOption('LHR', 'Heathrow Airport', 'London'),
      ]);
    });

    it('Search by code ignores case: `jfk` lists the JFK option', async () => {
      const user = userEvent.setup();
      renderSubmit(TRANSIT_PATH);

      await user.click(screen.getByLabelText(en.submit.destination));
      await user.type(screen.getByPlaceholderText(en.submit.searchAirport), 'jfk');

      expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
        en.submit.airportOption('JFK', 'John F. Kennedy International Airport', 'New York'),
      ]);
    });

    it('Nothing matches: the list shows "No airport found" and offers nothing', async () => {
      const user = userEvent.setup();
      renderSubmit(TRANSIT_PATH);

      await user.click(screen.getByLabelText(en.submit.origin));
      await user.type(screen.getByPlaceholderText(en.submit.searchAirport), 'zzqx');

      expect(screen.getByText(en.submit.noAirport)).toBeVisible();
      expect(screen.queryAllByRole('option')).toEqual([]);
    });

    it('Missing airport: the Origin airport field shows an error and nothing is sent', async () => {
      const user = userEvent.setup();
      renderSubmit(TRANSIT_PATH);

      await pickAirport(user, en.submit.destination, { search: 'JFK', iata: 'JFK' });
      await user.click(screen.getByRole('button', { name: en.submit.submit }));

      const origin = screen.getByLabelText(en.submit.origin);
      expect(origin).toHaveAttribute('aria-invalid', 'true');
      expect(origin).toHaveAccessibleDescription(en.submit.errors.originRequired);
      expect(posted).toEqual([]);
    });

    it('Same airport twice: the Destination airport field shows an error and nothing is sent', async () => {
      const user = userEvent.setup();
      renderSubmit(TRANSIT_PATH);

      await pickAirport(user, en.submit.origin, { search: 'LHR', iata: 'LHR' });
      await pickAirport(user, en.submit.destination, { search: 'LHR', iata: 'LHR' });
      await user.click(screen.getByRole('button', { name: en.submit.submit }));

      const destination = screen.getByLabelText(en.submit.destination);
      expect(destination).toHaveAttribute('aria-invalid', 'true');
      expect(destination).toHaveAccessibleDescription(en.submit.errors.sameAirport);
      expect(posted).toEqual([]);
    });

    it("Departure date in the past: yesterday's UTC date shows an error and nothing is sent", async () => {
      const user = userEvent.setup();
      renderSubmit(TRANSIT_PATH);

      await pickAirport(user, en.submit.origin, { search: 'LHR', iata: 'LHR' });
      await pickAirport(user, en.submit.destination, { search: 'JFK', iata: 'JFK' });
      await user.clear(screen.getByLabelText(en.submit.departureDate));
      await user.type(screen.getByLabelText(en.submit.departureDate), '2026-10-29');
      await user.click(screen.getByRole('button', { name: en.submit.submit }));

      const date = screen.getByLabelText(en.submit.departureDate);
      expect(date).toHaveAttribute('aria-invalid', 'true');
      expect(date).toHaveAccessibleDescription(en.submit.errors.departureDatePast(TODAY));
      expect(posted).toEqual([]);
    });

    it('API validation error on a transit field: the Departure date shows the issue and the values stay', async () => {
      const user = userEvent.setup();
      answerCreate(() =>
        HttpResponse.json(
          {
            code: 'VALIDATION_FAILED',
            message: 'Request validation failed',
            details: {
              issues: [{ path: ['payload', 'departureDate'], message: 'Departure day is over' }],
            },
          },
          { status: 400 },
        ),
      );
      renderSubmit(TRANSIT_PATH);

      await pickAirport(user, en.submit.origin, { search: 'LHR', iata: 'LHR' });
      await pickAirport(user, en.submit.destination, { search: 'JFK', iata: 'JFK' });
      await user.click(screen.getByRole('button', { name: en.submit.submit }));

      await screen.findByText('Departure day is over');
      const date = screen.getByLabelText(en.submit.departureDate);
      expect(date).toHaveAccessibleDescription('Departure day is over');
      expect(date).toHaveValue(TODAY);
      expect(posted).toHaveLength(1);
      expect(screen.getByLabelText(en.submit.origin)).toHaveTextContent('LHR');
      expect(screen.getByLabelText(en.submit.destination)).toHaveTextContent('JFK');
    });

    it('Preview of a transit request: shows type flight-transit, the chosen origin and the date', async () => {
      const user = userEvent.setup();
      renderSubmit(TRANSIT_PATH);

      await pickAirport(user, en.submit.origin, { search: 'LHR', iata: 'LHR' });

      const preview = screen.getByRole('region', { name: en.submit.request });
      expect(preview).toHaveTextContent('"type": "flight-transit"');
      expect(preview).toHaveTextContent('"origin": "LHR"');
      expect(preview).toHaveTextContent(`"departureDate": "${TODAY}"`);
    });

    it('Example response for a transit job: a 201 Created example with type flight-transit, pending', async () => {
      const user = userEvent.setup();
      renderSubmit();

      await user.click(screen.getByRole('button', { name: /^Aircraft transit/ }));

      const response = screen.getByRole('region', { name: en.submit.response });
      expect(response).toHaveTextContent(en.submit.created);
      expect(response).toHaveTextContent(en.submit.example);
      expect(response).toHaveTextContent('"type": "flight-transit"');
      expect(response).toHaveTextContent('"status": "pending"');
    });
  });

  describe('run choice', () => {
    /** Tests run in UTC (test-setup), so the local time typed is also the UTC time sent. */
    const NOW = new Date('2026-10-30T12:00:00.000Z');
    const LOCAL_TIME = '2026-10-31T09:30';
    const SENT_TIME = '2026-10-31T09:30:00.000Z';

    beforeEach(() => {
      // Only Date: user-event's own timers keep running.
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(NOW);
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    /** Chooses "At a specific time" and enters the time as the `datetime-local` input holds it. */
    async function scheduleAt(user: ReturnType<typeof userEvent.setup>, value: string) {
      await user.click(screen.getByRole('button', { name: en.submit.runLater }));
      fireEvent.change(screen.getByLabelText(en.submit.scheduledAt), { target: { value } });
    }

    it('Immediately at first: "Immediately" is selected, no time input, no scheduledAt in the preview', () => {
      renderSubmit();

      expect(screen.getByRole('button', { name: en.submit.runNow })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      expect(screen.getByRole('button', { name: en.submit.runLater })).toHaveAttribute(
        'aria-pressed',
        'false',
      );
      expect(screen.queryByLabelText(en.submit.scheduledAt)).toBeNull();
      expect(screen.getByRole('region', { name: en.submit.request })).not.toHaveTextContent(
        'scheduledAt',
      );
    });

    it("Choose a specific time: a date and time input shows, with a hint naming the browser's time zone", async () => {
      const user = userEvent.setup();
      renderSubmit();

      await user.click(screen.getByRole('button', { name: en.submit.runLater }));

      expect(screen.getByRole('button', { name: en.submit.runLater })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      const input = screen.getByLabelText(en.submit.scheduledAt);
      expect(input).toHaveAttribute('type', 'datetime-local');
      expect(input).toHaveAccessibleDescription(en.submit.scheduleHint('UTC'));
    });

    it('Run choice is enabled: both choices can be chosen and show no "Coming soon"', async () => {
      const user = userEvent.setup();
      renderSubmit();

      expect(screen.getByRole('button', { name: en.submit.runNow })).toBeEnabled();
      expect(screen.getByRole('button', { name: en.submit.runLater })).toBeEnabled();
      await user.hover(screen.getByRole('button', { name: en.submit.runLater }));
      expect(screen.queryByRole('tooltip')).toBeNull();
    });

    it('Submit a scheduled job: the local time is sent as scheduledAt in UTC and the job page opens', async () => {
      const user = userEvent.setup();
      const created = jobFixtures.build();
      answerCreate(() => HttpResponse.json(created, { status: 201 }));
      renderSubmit();

      await fillEmail(user);
      await scheduleAt(user, LOCAL_TIME);
      await user.click(screen.getByRole('button', { name: en.submit.submit }));

      expect(await screen.findByRole('status', { name: 'current path' })).toHaveTextContent(
        `/jobs/${created.id}`,
      );
      expect(posted).toEqual([
        {
          type: 'email',
          payload: { to: 'ops@acme.test', subject: 'Weekly digest', body: 'Hi team' },
          priority: JOB_LIMITS.priority.default,
          maxAttempts: JOB_LIMITS.maxAttempts.default,
          scheduledAt: SENT_TIME,
        },
      ]);
    });

    it('Back to immediately: a time entered before choosing "Immediately" is not sent', async () => {
      const user = userEvent.setup();
      answerCreate(() => HttpResponse.json(jobFixtures.build(), { status: 201 }));
      renderSubmit();

      await fillEmail(user);
      await scheduleAt(user, LOCAL_TIME);
      await user.click(screen.getByRole('button', { name: en.submit.runNow }));
      await user.click(screen.getByRole('button', { name: en.submit.submit }));

      await expect.poll(() => posted.length).toBe(1);
      expect(posted[0]).not.toHaveProperty('scheduledAt');
      expect(screen.queryByLabelText(en.submit.scheduledAt)).toBeNull();
    });

    it.each([
      ['No time entered', '', en.submit.errors.scheduleRequired],
      ['Time in the past', '2026-10-30T11:59', en.submit.errors.schedulePast],
      [
        'Time too far ahead',
        '2026-11-29T12:01',
        en.submit.errors.scheduleTooFar(JOB_LIMITS.scheduledAt.maxAheadDays),
      ],
    ])('%s: the time input shows its error and nothing is sent', async (_name, value, message) => {
      const user = userEvent.setup();
      renderSubmit();

      await fillEmail(user);
      await scheduleAt(user, value);
      await user.click(screen.getByRole('button', { name: en.submit.submit }));

      const input = screen.getByLabelText(en.submit.scheduledAt);
      await expect.poll(() => input.getAttribute('aria-invalid')).toBe('true');
      expect(input).toHaveAccessibleDescription(message);
      expect(posted).toEqual([]);
    });

    it('a time that has passed since it was entered is rejected on submit', async () => {
      const user = userEvent.setup();
      renderSubmit();

      await fillEmail(user);
      await scheduleAt(user, '2026-10-30T12:02');
      vi.setSystemTime(new Date('2026-10-30T12:03:00.000Z'));
      await user.click(screen.getByRole('button', { name: en.submit.submit }));

      const input = screen.getByLabelText(en.submit.scheduledAt);
      await expect.poll(() => input.getAttribute('aria-invalid')).toBe('true');
      expect(input).toHaveAccessibleDescription(en.submit.errors.schedulePast);
      expect(posted).toEqual([]);
    });

    it('a missing time and a missing subject are shown together', async () => {
      const user = userEvent.setup();
      renderSubmit();

      await user.type(screen.getByLabelText(en.submit.to), 'ops@acme.test');
      await scheduleAt(user, '');
      await user.click(screen.getByRole('button', { name: en.submit.submit }));

      const input = screen.getByLabelText(en.submit.scheduledAt);
      await expect.poll(() => input.getAttribute('aria-invalid')).toBe('true');
      expect(screen.getByLabelText(en.submit.subject)).toHaveAttribute('aria-invalid', 'true');
      expect(posted).toEqual([]);
    });

    it('API validation error on the scheduled time: the time input shows the issue and the values stay', async () => {
      const user = userEvent.setup();
      answerCreate(() =>
        HttpResponse.json(
          {
            code: 'VALIDATION_FAILED',
            message: 'Validation failed',
            details: { issues: [{ path: ['scheduledAt'], message: 'Too far ahead' }] },
          },
          { status: 400 },
        ),
      );
      renderSubmit();

      await fillEmail(user);
      await scheduleAt(user, LOCAL_TIME);
      await user.click(screen.getByRole('button', { name: en.submit.submit }));

      const input = screen.getByLabelText(en.submit.scheduledAt);
      await expect.poll(() => input.getAttribute('aria-invalid')).toBe('true');
      expect(input).toHaveAccessibleDescription('Too far ahead');
      expect(input).toHaveValue(LOCAL_TIME);
      expect(screen.getByLabelText(en.submit.subject)).toHaveValue('Weekly digest');
    });

    it('Preview of a scheduled request: the preview, the cURL and the example response carry the time', async () => {
      const user = userEvent.setup();
      renderSubmit();

      await scheduleAt(user, LOCAL_TIME);

      const preview = screen.getByRole('region', { name: en.submit.request });
      expect(preview).toHaveTextContent(`"scheduledAt": "${SENT_TIME}"`);
      await user.click(within(preview).getByRole('button', { name: en.copy.copyCurl }));
      expect(await navigator.clipboard.readText()).toContain(`"scheduledAt": "${SENT_TIME}"`);
      const response = screen.getByRole('region', { name: en.submit.response });
      expect(response).toHaveTextContent('"status": "scheduled"');
      expect(response).toHaveTextContent(`"scheduledAt": "${SENT_TIME}"`);
    });

    it('Switching keeps the scheduled time: the webhook form keeps "At a specific time" and the time', async () => {
      const user = userEvent.setup();
      renderSubmit();

      await scheduleAt(user, LOCAL_TIME);
      await user.click(screen.getByRole('button', { name: /^Webhook/ }));

      expect(screen.getByRole('button', { name: en.submit.runLater })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      expect(screen.getByLabelText(en.submit.scheduledAt)).toHaveValue(LOCAL_TIME);
    });
  });
});
