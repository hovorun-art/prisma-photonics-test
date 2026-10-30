import { render, screen } from '@testing-library/react';
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

function renderForm() {
  return render(
    <TestProviders path="/jobs/new">
      <Routes>
        <Route path="/jobs/new" element={<SubmitJobPage />} />
        <Route path="*" element={<CurrentPath />} />
      </Routes>
    </TestProviders>,
  );
}

describe('JobForm', () => {
  it('Submit form unchanged: the idempotency key field is still disabled with its "Coming soon" tooltip', async () => {
    renderForm();
    const field = screen.getByLabelText(new RegExp(en.submit.idempotencyKey));

    expect(field).toBeDisabled();
    await userEvent.hover(field.closest('[aria-disabled="true"]')!);

    expect(await screen.findByRole('tooltip')).toHaveTextContent(en.comingSoon);
    expect(screen.getByRole('button', { name: en.submit.generate })).toBeDisabled();
  });

  it('Submit form unchanged: a submission carries no idempotency key', async () => {
    const user = userEvent.setup();
    server.use(
      http.post(JOBS_URL, async ({ request }) => {
        posted.push(await request.json());
        return HttpResponse.json(jobFixtures.build(), { status: 201 });
      }),
    );
    renderForm();

    await user.type(screen.getByLabelText(en.submit.to), 'ops@acme.test');
    await user.type(screen.getByLabelText(en.submit.subject), 'Weekly digest');
    await user.type(screen.getByLabelText(en.submit.body), 'Hi team');
    await user.click(screen.getByRole('button', { name: en.submit.submit }));

    await screen.findByRole('status', { name: 'current path' });
    expect(posted).toHaveLength(1);
    expect(posted[0]).not.toHaveProperty('idempotencyKey');
  });
});
