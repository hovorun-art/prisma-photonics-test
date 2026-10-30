import { JOB_LIMITS } from '@job-queue/contracts';
import { render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { Route, Routes } from 'react-router';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import type { UiConfig } from '@/config';
import { en } from '@/locales';

import { CurrentPath, TEST_API_BASE, TestProviders } from '../../jobs/testing/test-providers';
import { groupFixtures } from '../testing/group-fixtures';
import { NewGroupPage } from './new-group-page';

const GROUPS_URL = `${TEST_API_BASE}/v1/groups`;
const BULK_URL = `${TEST_API_BASE}/v1/jobs/bulk`;
const server = setupServer();
/** What the page sent, in order: group creates, bulk bodies and group deletes. */
const sent: { groups: number; bulks: unknown[]; deletes: string[] } = {
  groups: 0,
  bulks: [],
  deletes: [],
};

beforeAll(() => {
  server.listen({ onUnhandledFrame: 'error' });
});
afterEach(() => {
  server.resetHandlers();
  sent.groups = 0;
  sent.bulks.length = 0;
  sent.deletes.length = 0;
});
afterAll(() => {
  server.close();
});

type User = ReturnType<typeof userEvent.setup>;

function errorBody(status: number, code: string, message: string, details = {}) {
  return HttpResponse.json({ code, message, details }, { status });
}

/** job-group-service answers each group create with the next of `answers`. */
function answerGroups(...answers: (() => Response)[]) {
  server.use(
    http.post(GROUPS_URL, () => {
      sent.groups += 1;
      const answer = answers[sent.groups - 1];
      if (!answer) throw new TypeError('unexpected group create');
      return answer();
    }),
    http.delete(`${GROUPS_URL}/:id`, ({ params }) => {
      sent.deletes.push(String(params.id));
      return new HttpResponse(null, { status: 204 });
    }),
  );
}

/** job-service answers each bulk submit with the next of `answers`. */
function answerBulk(...answers: (() => Response | Promise<Response>)[]) {
  server.use(
    http.post(BULK_URL, async ({ request }) => {
      sent.bulks.push(await request.json());
      const answer = answers[sent.bulks.length - 1];
      if (!answer) throw new TypeError('unexpected bulk submit');
      return answer();
    }),
  );
}

function renderPage(config: Partial<UiConfig> = {}) {
  return render(
    <TestProviders path="/groups/new" config={config}>
      <Routes>
        <Route
          path="/groups/new"
          element={
            <>
              <NewGroupPage />
              <CurrentPath />
            </>
          }
        />
        <Route path="*" element={<CurrentPath />} />
      </Routes>
    </TestProviders>,
  );
}

function currentPath() {
  return screen.getByRole('status', { name: 'current path' }).textContent;
}

function tabNames() {
  return screen.getAllByRole('tab').map((tab) => tab.textContent);
}

function tab(n: number) {
  return screen.getAllByRole('tab')[n - 1]!;
}

/** The open tab's job form. */
function panel() {
  return screen.getByRole('tabpanel');
}

function createButton(count: number) {
  return screen.getByRole('button', { name: en.newGroup.create(count) });
}

async function fillEmail(user: User, { to = 'ops@acme.test', subject = 'Weekly digest' } = {}) {
  const form = within(panel());
  await user.clear(form.getByLabelText(en.submit.to));
  await user.type(form.getByLabelText(en.submit.to), to);
  await user.clear(form.getByLabelText(en.submit.subject));
  await user.type(form.getByLabelText(en.submit.subject), subject);
  await user.clear(form.getByLabelText(en.submit.body));
  await user.type(form.getByLabelText(en.submit.body), 'Hi team');
}

async function fillWebhook(user: User, url = 'https://hooks.example.com/orders') {
  const form = within(panel());
  await user.click(form.getByRole('button', { name: new RegExp(en.submit.types.webhook.name) }));
  await user.type(within(panel()).getByLabelText(en.submit.url), url);
}

async function addJob(user: User) {
  await user.click(screen.getByRole('button', { name: en.newGroup.addJob }));
}

describe('NewGroupPage', () => {
  describe('tabs', () => {
    it('New group page at first: breadcrumb, one open Email job at initial values, no preview', () => {
      renderPage();

      const breadcrumb = screen.getByRole('navigation', { name: en.job.breadcrumb });
      expect(within(breadcrumb).getByRole('link', { name: en.group.groups })).toHaveAttribute(
        'href',
        '/groups',
      );
      expect(breadcrumb).toHaveTextContent(en.newGroup.breadcrumbNew);
      expect(tabNames()).toEqual([en.newGroup.tabLabel(1, en.submit.types.email.name)]);
      expect(tab(1)).toHaveAttribute('aria-selected', 'true');
      const form = within(panel());
      expect(form.getByLabelText(en.submit.to)).toHaveValue('');
      expect(form.getByLabelText(en.submit.priority)).toHaveValue(JOB_LIMITS.priority.default);
      expect(form.getByLabelText(en.submit.maxAttempts)).toHaveValue(
        JOB_LIMITS.maxAttempts.default,
      );
      expect(screen.queryByText(en.submit.request)).not.toBeInTheDocument();
    });

    it('Tab label follows the type: choosing Webhook relabels Job 1', async () => {
      const user = userEvent.setup();
      renderPage();

      await user.click(
        within(panel()).getByRole('button', { name: new RegExp(en.submit.types.webhook.name) }),
      );

      expect(tabNames()).toEqual([en.newGroup.tabLabel(1, en.submit.types.webhook.name)]);
    });

    it('Switching type in a tab keeps the execution settings and the URL', async () => {
      const user = userEvent.setup();
      renderPage();
      const priority = () => within(panel()).getByLabelText(en.submit.priority);
      const maxAttempts = () => within(panel()).getByLabelText(en.submit.maxAttempts);

      await user.clear(priority());
      await user.type(priority(), '8');
      await user.clear(maxAttempts());
      await user.type(maxAttempts(), '2');
      await user.type(within(panel()).getByLabelText(en.submit.subject), 'Weekly');
      await user.click(
        within(panel()).getByRole('button', { name: new RegExp(en.submit.types.webhook.name) }),
      );
      await user.click(
        within(panel()).getByRole('button', { name: new RegExp(en.submit.types.email.name) }),
      );

      expect(priority()).toHaveValue(8);
      expect(maxAttempts()).toHaveValue(2);
      expect(within(panel()).getByLabelText(en.submit.subject)).toHaveValue('');
      expect(screen.getByRole('status', { name: 'current path' })).toHaveTextContent('/groups/new');
    });

    it('Each tab keeps its own values', async () => {
      const user = userEvent.setup();
      renderPage();

      await user.type(within(panel()).getByLabelText(en.submit.subject), 'First');
      await addJob(user);
      expect(within(panel()).getByLabelText(en.submit.subject)).toHaveValue('');
      await user.click(tab(1));

      expect(within(panel()).getByLabelText(en.submit.subject)).toHaveValue('First');
    });

    it('Add a job: Job 2 is added at initial values and opened', async () => {
      const user = userEvent.setup();
      renderPage();

      await addJob(user);

      expect(tabNames()).toEqual([
        en.newGroup.tabLabel(1, en.submit.types.email.name),
        en.newGroup.tabLabel(2, en.submit.types.email.name),
      ]);
      expect(tab(2)).toHaveAttribute('aria-selected', 'true');
      expect(within(panel()).getByLabelText(en.submit.to)).toHaveValue('');
    });

    it('Duplicate a job: the copy opens right after Job 1 and the former Job 2 becomes Job 3', async () => {
      const user = userEvent.setup();
      renderPage();
      await addJob(user);
      await user.click(tab(1));
      await fillWebhook(user, 'https://hooks.example.com/copy');
      await user.clear(within(panel()).getByLabelText(en.submit.priority));
      await user.type(within(panel()).getByLabelText(en.submit.priority), '7');

      await user.click(within(panel()).getByRole('button', { name: en.newGroup.duplicate }));

      expect(tabNames()).toEqual([
        en.newGroup.tabLabel(1, en.submit.types.webhook.name),
        en.newGroup.tabLabel(2, en.submit.types.webhook.name),
        en.newGroup.tabLabel(3, en.submit.types.email.name),
      ]);
      expect(tab(2)).toHaveAttribute('aria-selected', 'true');
      expect(within(panel()).getByLabelText(en.submit.url)).toHaveValue(
        'https://hooks.example.com/copy',
      );
      expect(within(panel()).getByLabelText(en.submit.priority)).toHaveValue(7);
    });

    it('a duplicate is its own job: editing the copy leaves the original as it was', async () => {
      const user = userEvent.setup();
      renderPage();
      await fillWebhook(user, 'https://hooks.example.com/a');
      await user.click(within(panel()).getByRole('button', { name: en.newGroup.duplicate }));

      await user.type(within(panel()).getByLabelText(en.submit.url), '/copy');
      await user.click(tab(1));

      expect(within(panel()).getByLabelText(en.submit.url)).toHaveValue(
        'https://hooks.example.com/a',
      );
    });

    it('two Aircraft transit tabs: each is labelled and has its own airport fields', async () => {
      const user = userEvent.setup();
      renderPage();
      const chooseTransit = () =>
        user.click(
          within(panel()).getByRole('button', {
            name: new RegExp(en.submit.types.transit.name),
          }),
        );
      await chooseTransit();
      await addJob(user);
      await chooseTransit();

      expect(tabNames()).toEqual([
        en.newGroup.tabLabel(1, en.submit.types.transit.name),
        en.newGroup.tabLabel(2, en.submit.types.transit.name),
      ]);
      expect(panel()).toContainElement(within(panel()).getByLabelText(en.submit.origin));
      expect(panel()).toContainElement(within(panel()).getByLabelText(en.submit.departureDate));
    });

    it('Remove a job: removing the open Job 2 of three leaves Job 1 and Job 2, Job 1 open', async () => {
      const user = userEvent.setup();
      renderPage();
      await addJob(user);
      await addJob(user);
      await fillWebhook(user);
      await user.click(tab(2));

      await user.click(screen.getByRole('button', { name: en.newGroup.removeJob(2) }));

      expect(tabNames()).toEqual([
        en.newGroup.tabLabel(1, en.submit.types.email.name),
        en.newGroup.tabLabel(2, en.submit.types.webhook.name),
      ]);
      expect(tab(1)).toHaveAttribute('aria-selected', 'true');
    });

    it('Remove the first job: the former Job 2 is Job 1, open, with its values', async () => {
      const user = userEvent.setup();
      renderPage();
      await addJob(user);
      await fillWebhook(user, 'https://hooks.example.com/kept');
      await user.click(tab(1));

      await user.click(screen.getByRole('button', { name: en.newGroup.removeJob(1) }));

      expect(tabNames()).toEqual([en.newGroup.tabLabel(1, en.submit.types.webhook.name)]);
      expect(tab(1)).toHaveAttribute('aria-selected', 'true');
      expect(within(panel()).getByLabelText(en.submit.url)).toHaveValue(
        'https://hooks.example.com/kept',
      );
    });

    it('Last job cannot be removed: a single tab has no ×', () => {
      renderPage();

      expect(
        screen.queryByRole('button', { name: en.newGroup.removeJob(1) }),
      ).not.toBeInTheDocument();
    });

    it('At the maximum: "+" and Duplicate are disabled and a hint names the maximum', async () => {
      const user = userEvent.setup();
      renderPage({ maxGroupJobs: 2 });

      expect(screen.queryByText(en.newGroup.maxJobs(2))).not.toBeInTheDocument();
      await addJob(user);

      expect(screen.getByRole('button', { name: en.newGroup.addJob })).toBeDisabled();
      expect(within(panel()).getByRole('button', { name: en.newGroup.duplicate })).toBeDisabled();
      expect(screen.getByText(en.newGroup.maxJobs(2))).toBeInTheDocument();
    });

    it('Below the maximum again: removing a job enables "+" and Duplicate, the hint goes', async () => {
      const user = userEvent.setup();
      renderPage({ maxGroupJobs: 2 });
      await addJob(user);

      await user.click(screen.getByRole('button', { name: en.newGroup.removeJob(2) }));

      expect(screen.getByRole('button', { name: en.newGroup.addJob })).toBeEnabled();
      expect(within(panel()).getByRole('button', { name: en.newGroup.duplicate })).toBeEnabled();
      expect(screen.queryByText(en.newGroup.maxJobs(2))).not.toBeInTheDocument();
    });
  });

  describe('creating', () => {
    it('Create a group with two jobs: one group, both jobs with its id in tab order, its page opens', async () => {
      const user = userEvent.setup();
      const group = groupFixtures.build();
      answerGroups(() => HttpResponse.json(group, { status: 201 }));
      answerBulk(() => HttpResponse.json({ items: [] }, { status: 201 }));
      renderPage();
      await fillEmail(user);
      await addJob(user);
      await fillWebhook(user);

      await user.click(createButton(2));

      await expect.poll(currentPath).toBe(`/groups/${group.id}`);
      expect(sent.groups).toBe(1);
      expect(sent.bulks).toEqual([
        {
          jobs: [
            {
              type: 'email',
              payload: { to: 'ops@acme.test', subject: 'Weekly digest', body: 'Hi team' },
              priority: JOB_LIMITS.priority.default,
              maxAttempts: JOB_LIMITS.maxAttempts.default,
              groupId: group.id,
            },
            {
              type: 'webhook',
              payload: { method: 'POST', url: 'https://hooks.example.com/orders' },
              priority: JOB_LIMITS.priority.default,
              maxAttempts: JOB_LIMITS.maxAttempts.default,
              groupId: group.id,
            },
          ],
        },
      ]);
    });

    it('the button counts the jobs', async () => {
      const user = userEvent.setup();
      renderPage();

      expect(createButton(1)).toBeInTheDocument();
      await addJob(user);
      expect(createButton(2)).toBeInTheDocument();
    });

    it('Busy while creating: the button shows a busy state and a second click sends nothing', async () => {
      const user = userEvent.setup();
      const group = groupFixtures.build();
      let release: (() => void) | undefined;
      const answered = new Promise<void>((resolve) => {
        release = resolve;
      });
      answerGroups(() => HttpResponse.json(group, { status: 201 }));
      answerBulk(async () => {
        await answered;
        return HttpResponse.json({ items: [] }, { status: 201 });
      });
      renderPage();
      await fillEmail(user);

      await user.click(createButton(1));
      const busy = await screen.findByRole('button', { name: en.newGroup.creating });
      expect(busy).toBeDisabled();
      await user.click(busy);
      release?.();

      await expect.poll(currentPath).toBe(`/groups/${group.id}`);
      expect(sent.groups).toBe(1);
      expect(sent.bulks).toHaveLength(1);
    });

    it('Cancel the new group: the groups list opens and nothing is created', async () => {
      const user = userEvent.setup();
      answerGroups();
      answerBulk();
      renderPage();
      await fillEmail(user);

      await user.click(screen.getByRole('link', { name: en.newGroup.cancel }));

      expect(currentPath()).toBe('/groups');
      expect(sent.groups).toBe(0);
      expect(sent.bulks).toHaveLength(0);
    });
  });

  describe('validation', () => {
    it('Invalid job in another tab: nothing is sent, Job 2 is red and opens with its To error', async () => {
      const user = userEvent.setup();
      answerGroups();
      answerBulk();
      renderPage();
      await fillEmail(user);
      await addJob(user);
      await fillEmail(user, { to: 'not-an-email' });
      await user.click(tab(1));

      await user.click(createButton(2));

      expect(await screen.findByText(en.submit.errors.to)).toBeInTheDocument();
      expect(tab(2)).toHaveAttribute('aria-selected', 'true');
      expect(tab(2)).toHaveAttribute('aria-invalid', 'true');
      expect(tab(1)).not.toHaveAttribute('aria-invalid');
      expect(within(panel()).getByLabelText(en.submit.to)).toHaveAttribute('aria-invalid', 'true');
      expect(sent.groups).toBe(0);
      expect(sent.bulks).toHaveLength(0);
    });

    it('Several invalid tabs: Job 2 and Job 3 are red and Job 2 is open', async () => {
      const user = userEvent.setup();
      answerGroups();
      answerBulk();
      renderPage();
      await fillEmail(user);
      await addJob(user);
      await addJob(user);

      await user.click(createButton(3));

      expect(await within(panel()).findByText(en.submit.errors.to)).toBeInTheDocument();
      expect(tab(1)).not.toHaveAttribute('aria-invalid');
      expect(tab(2)).toHaveAttribute('aria-invalid', 'true');
      expect(tab(3)).toHaveAttribute('aria-invalid', 'true');
      expect(tab(2)).toHaveAttribute('aria-selected', 'true');
      expect(sent.groups).toBe(0);
      expect(sent.bulks).toHaveLength(0);
    });

    it('Fixing a tab clears its highlight: correcting the only invalid field', async () => {
      const user = userEvent.setup();
      renderPage();
      await fillEmail(user, { to: 'not-an-email' });
      await user.click(createButton(1));
      expect(await screen.findByText(en.submit.errors.to)).toBeInTheDocument();
      expect(tab(1)).toHaveAttribute('aria-invalid', 'true');

      await user.clear(within(panel()).getByLabelText(en.submit.to));
      await user.type(within(panel()).getByLabelText(en.submit.to), 'ops@acme.test');

      expect(screen.queryByText(en.submit.errors.to)).not.toBeInTheDocument();
      expect(tab(1)).not.toHaveAttribute('aria-invalid');
    });
  });

  describe('API errors', () => {
    it("API validation error on a job's field: Job 2 is red, its URL shows the message, values stay", async () => {
      const user = userEvent.setup();
      answerGroups(() => HttpResponse.json(groupFixtures.build(), { status: 201 }));
      answerBulk(() =>
        errorBody(400, 'VALIDATION_FAILED', 'Validation failed', {
          issues: [{ path: ['jobs', 1, 'payload', 'url'], message: 'Host is not allowed' }],
        }),
      );
      renderPage();
      await fillEmail(user);
      await addJob(user);
      await fillWebhook(user, 'https://blocked.example.com/hook');
      await user.click(tab(1));

      await user.click(createButton(2));

      await expect.poll(() => tab(2).getAttribute('aria-invalid')).toBe('true');
      expect(tab(1)).not.toHaveAttribute('aria-invalid');
      expect(tab(2)).toHaveAttribute('aria-selected', 'true');
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(within(panel()).getByText('Host is not allowed')).toBeInTheDocument();
      expect(within(panel()).getByLabelText(en.submit.url)).toHaveValue(
        'https://blocked.example.com/hook',
      );
      await user.click(tab(1));
      expect(within(panel()).getByLabelText(en.submit.to)).toHaveValue('ops@acme.test');
    });

    it("API validation error not tied to a job's field: the alert shows the issue's message", async () => {
      const user = userEvent.setup();
      answerGroups(() => HttpResponse.json(groupFixtures.build(), { status: 201 }));
      answerBulk(() =>
        errorBody(400, 'VALIDATION_FAILED', 'Validation failed', {
          issues: [{ path: ['jobs'], message: 'Too many jobs' }],
        }),
      );
      renderPage();
      await fillEmail(user);

      await user.click(createButton(1));

      expect(await screen.findByRole('alert')).toHaveTextContent('Too many jobs');
      expect(tab(1)).not.toHaveAttribute('aria-invalid');
    });

    it("an issue on a job's path the form has no field for goes to the alert", async () => {
      const user = userEvent.setup();
      answerGroups(() => HttpResponse.json(groupFixtures.build(), { status: 201 }));
      answerBulk(() =>
        errorBody(400, 'VALIDATION_FAILED', 'Validation failed', {
          issues: [
            { path: ['jobs', 0, 'payload', 'unknownField'], message: 'Unknown field' },
            { path: ['jobs', 1, 'payload', 'url'], message: 'Host is not allowed' },
          ],
        }),
      );
      renderPage();
      await fillEmail(user);
      await addJob(user);
      await fillWebhook(user);

      await user.click(createButton(2));

      expect(await screen.findByRole('alert')).toHaveTextContent('Unknown field');
      expect(tab(1)).not.toHaveAttribute('aria-invalid');
      expect(tab(2)).toHaveAttribute('aria-invalid', 'true');
    });

    it('a validation answer without issues shows its message in the alert', async () => {
      const user = userEvent.setup();
      answerGroups(() => HttpResponse.json(groupFixtures.build(), { status: 201 }));
      answerBulk(() => errorBody(400, 'VALIDATION_FAILED', 'Validation failed', { issues: [] }));
      renderPage();
      await fillEmail(user);

      await user.click(createButton(1));

      expect(await screen.findByRole('alert')).toHaveTextContent('Validation failed');
    });

    it('Group cannot be created: the alert shows the error, no job is submitted, values stay', async () => {
      const user = userEvent.setup();
      answerGroups(() => errorBody(500, 'INTERNAL_ERROR', 'Internal server error'));
      renderPage();
      await fillEmail(user);

      await user.click(createButton(1));

      expect(await screen.findByRole('alert')).toHaveTextContent('Internal server error');
      expect(sent.bulks).toHaveLength(0);
      expect(within(panel()).getByLabelText(en.submit.to)).toHaveValue('ops@acme.test');
    });

    it('API unreachable: the alert says so and values stay', async () => {
      const user = userEvent.setup();
      answerGroups(() => HttpResponse.error());
      renderPage();
      await fillEmail(user);

      await user.click(createButton(1));

      expect(await screen.findByRole('alert')).toHaveTextContent('API unreachable');
      expect(within(panel()).getByLabelText(en.submit.subject)).toHaveValue('Weekly digest');
    });

    it('Other API error on the job submit: the alert shows its message and values stay', async () => {
      const user = userEvent.setup();
      answerGroups(() => HttpResponse.json(groupFixtures.build(), { status: 201 }));
      answerBulk(() => errorBody(503, 'QUEUE_UNAVAILABLE', 'The queue is unavailable'));
      renderPage();
      await fillEmail(user);

      await user.click(createButton(1));

      expect(await screen.findByRole('alert')).toHaveTextContent('The queue is unavailable');
      expect(within(panel()).getByLabelText(en.submit.to)).toHaveValue('ops@acme.test');
    });

    it('the alert goes when the user creates again', async () => {
      const user = userEvent.setup();
      let release: (() => void) | undefined;
      const answered = new Promise<void>((resolve) => {
        release = resolve;
      });
      answerGroups(
        () => errorBody(500, 'INTERNAL_ERROR', 'Internal server error'),
        () => HttpResponse.json(groupFixtures.build(), { status: 201 }),
      );
      answerBulk(async () => {
        await answered;
        return HttpResponse.json({ items: [] }, { status: 201 });
      });
      renderPage();
      await fillEmail(user);
      await user.click(createButton(1));
      expect(await screen.findByRole('alert')).toBeInTheDocument();

      await user.click(createButton(1));

      await screen.findByRole('button', { name: en.newGroup.creating });
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      release?.();
    });
  });

  describe('failed submit', () => {
    it('Group deleted after a failed submit: the group is deleted and the submit error shown', async () => {
      const user = userEvent.setup();
      const group = groupFixtures.build();
      answerGroups(() => HttpResponse.json(group, { status: 201 }));
      answerBulk(() => errorBody(503, 'QUEUE_UNAVAILABLE', 'The queue is unavailable'));
      renderPage();
      await fillEmail(user);

      await user.click(createButton(1));

      expect(await screen.findByRole('alert')).toHaveTextContent('The queue is unavailable');
      expect(sent.deletes).toEqual([group.id]);
    });

    it("Delete fails after a failed submit: only the submit's error is shown", async () => {
      const user = userEvent.setup();
      const group = groupFixtures.build();
      answerGroups(() => HttpResponse.json(group, { status: 201 }));
      answerBulk(() => errorBody(503, 'QUEUE_UNAVAILABLE', 'The queue is unavailable'));
      server.use(
        http.delete(`${GROUPS_URL}/:id`, ({ params }) => {
          sent.deletes.push(String(params.id));
          return errorBody(503, 'JOB_SERVICE_UNAVAILABLE', 'job-service is unavailable');
        }),
      );
      renderPage();
      await fillEmail(user);

      await user.click(createButton(1));

      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent('The queue is unavailable');
      expect(alert).not.toHaveTextContent('job-service is unavailable');
      expect(sent.deletes).toEqual([group.id]);
    });

    it('Try again after a failed submit: a new group is created and the jobs carry its id', async () => {
      const user = userEvent.setup();
      const failed = groupFixtures.build();
      const created = groupFixtures.build();
      answerGroups(
        () => HttpResponse.json(failed, { status: 201 }),
        () => HttpResponse.json(created, { status: 201 }),
      );
      answerBulk(
        () => errorBody(503, 'QUEUE_UNAVAILABLE', 'The queue is unavailable'),
        () => HttpResponse.json({ items: [] }, { status: 201 }),
      );
      renderPage();
      await fillEmail(user);
      await user.click(createButton(1));
      expect(await screen.findByRole('alert')).toBeInTheDocument();

      await user.click(createButton(1));

      await expect.poll(currentPath).toBe(`/groups/${created.id}`);
      expect(sent.groups).toBe(2);
      expect(sent.bulks[1]).toMatchObject({ jobs: [{ groupId: created.id }] });
    });
  });
});
