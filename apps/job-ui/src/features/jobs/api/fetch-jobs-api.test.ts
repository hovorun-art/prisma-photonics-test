import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { jobFixtures, queueStatsFixtures } from '../testing/job-fixtures';
import { ApiError } from './api-error';
import { FetchJobsApi } from './fetch-jobs-api';

const BASE = 'http://job-ui.test/api';
const server = setupServer();
const api = new FetchJobsApi({ baseUrl: BASE, networkErrorMessage: 'API unreachable' });

beforeAll(() => {
  server.listen({ onUnhandledFrame: 'error' });
});
afterEach(() => {
  server.resetHandlers();
});
afterAll(() => {
  server.close();
});

describe('FetchJobsApi', () => {
  it('query sends the offset and returns the page and the total', async () => {
    const job = jobFixtures.build();
    let offset: string | null = null;
    server.use(
      http.get(`${BASE}/v1/jobs`, ({ request }) => {
        offset = new URL(request.url).searchParams.get('offset');
        return HttpResponse.json({ items: [job], total: 21 });
      }),
    );

    const page = await api.query({ offset: 20 });

    expect(offset).toBe('20');
    expect(page).toEqual({ items: [job], total: 21 });
  });

  it('get returns the job of the id', async () => {
    const job = jobFixtures.build();
    server.use(http.get(`${BASE}/v1/jobs/${job.id}`, () => HttpResponse.json(job)));

    await expect(api.get({ id: job.id })).resolves.toEqual({ job });
  });

  it('create posts the request and returns the created job', async () => {
    const job = jobFixtures.build();
    let body: unknown = null;
    server.use(
      http.post(`${BASE}/v1/jobs`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(job, { status: 201 });
      }),
    );
    const request = {
      type: 'email' as const,
      payload: job.payload,
      priority: 5,
      maxAttempts: 3,
    };

    await expect(api.create({ request })).resolves.toEqual({ job });
    expect(body).toEqual(request);
  });

  it('delete calls the job route and returns the id', async () => {
    const job = jobFixtures.build();
    server.use(
      http.delete(`${BASE}/v1/jobs/${job.id}`, () => new HttpResponse(null, { status: 204 })),
    );

    await expect(api.delete({ id: job.id })).resolves.toEqual({ id: job.id });
  });

  it('stats calls the statistics route and returns the statistics', async () => {
    const stats = queueStatsFixtures.build();
    server.use(http.get(`${BASE}/v1/stats`, () => HttpResponse.json(stats)));

    await expect(api.stats()).resolves.toEqual({ stats });
  });

  it('stats rejects an answer that does not match the statistics contract', async () => {
    server.use(
      http.get(`${BASE}/v1/stats`, () =>
        HttpResponse.json({ ...queueStatsFixtures.build(), pending: -1 }),
      ),
    );

    const error: unknown = await api.stats().catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 200, code: null, message: 'API unreachable' });
  });

  it('stats turns an error answer into an ApiError with its code', async () => {
    server.use(
      http.get(`${BASE}/v1/stats`, () =>
        HttpResponse.json(
          { code: 'INTERNAL_ERROR', message: 'Internal server error', details: {} },
          { status: 500 },
        ),
      ),
    );

    const error: unknown = await api.stats().catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 500, code: 'INTERNAL_ERROR' });
  });

  it('an error body becomes an ApiError with its status, code, message and details', async () => {
    const id = jobFixtures.build().id;
    server.use(
      http.get(`${BASE}/v1/jobs/${id}`, () =>
        HttpResponse.json(
          { code: 'JOB_NOT_FOUND', message: 'Job not found', details: { id } },
          { status: 404 },
        ),
      ),
    );

    const error = await api.get({ id }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 404,
      code: 'JOB_NOT_FOUND',
      message: 'Job not found',
      details: { id },
    });
  });

  it('a network failure becomes an ApiError without a status or code', async () => {
    server.use(http.get(`${BASE}/v1/jobs`, () => HttpResponse.error()));

    const error = await api.query({ offset: 0 }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: null, code: null, message: 'API unreachable' });
  });

  it('an answer without an error body becomes an ApiError with the status but no code', async () => {
    server.use(http.get(`${BASE}/v1/jobs`, () => new HttpResponse('Bad gateway', { status: 502 })));

    const error = await api.query({ offset: 0 }).catch((e: unknown) => e);

    expect(error).toMatchObject({ status: 502, code: null, message: 'API unreachable' });
  });
});
