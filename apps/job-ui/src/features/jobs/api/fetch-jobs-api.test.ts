import { randomUUID } from 'node:crypto';

import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { jobFixtures, jobLogEntryFixtures, queueStatsFixtures } from '../testing/job-fixtures';
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
    let search = '';
    server.use(
      http.get(`${BASE}/v1/jobs`, ({ request }) => {
        search = new URL(request.url).search;
        return HttpResponse.json({ items: [job], total: 21 });
      }),
    );

    const page = await api.query({ offset: 20 });

    expect(Object.fromEntries(new URLSearchParams(search))).toEqual({ offset: '20' });
    expect(page).toEqual({ items: [job], total: 21 });
  });

  it('query sends the status and type filters when given', async () => {
    let search = '';
    server.use(
      http.get(`${BASE}/v1/jobs`, ({ request }) => {
        search = new URL(request.url).search;
        return HttpResponse.json({ items: [], total: 0 });
      }),
    );

    await api.query({ offset: 0, status: 'failed', type: 'flight-transit' });

    expect(Object.fromEntries(new URLSearchParams(search))).toEqual({
      offset: '0',
      status: 'failed',
      type: 'flight-transit',
    });
  });

  it('query leaves out the filters that are not given', async () => {
    let search = '';
    server.use(
      http.get(`${BASE}/v1/jobs`, ({ request }) => {
        search = new URL(request.url).search;
        return HttpResponse.json({ items: [], total: 0 });
      }),
    );

    await api.query({ offset: 0, type: 'webhook' });

    expect(Object.fromEntries(new URLSearchParams(search))).toEqual({
      offset: '0',
      type: 'webhook',
    });
  });

  it('query sends the group id and the page size when given', async () => {
    const groupId = randomUUID();
    let search = '';
    server.use(
      http.get(`${BASE}/v1/jobs`, ({ request }) => {
        search = new URL(request.url).search;
        return HttpResponse.json({ items: [], total: 0 });
      }),
    );

    await api.query({ offset: 100, groupId, limit: 100 });

    expect(Object.fromEntries(new URLSearchParams(search))).toEqual({
      offset: '100',
      groupId,
      limit: '100',
    });
  });

  it('query sends groupId=null for the jobs without a group', async () => {
    let search = '';
    server.use(
      http.get(`${BASE}/v1/jobs`, ({ request }) => {
        search = new URL(request.url).search;
        return HttpResponse.json({ items: [], total: 0 });
      }),
    );

    await api.query({ offset: 0, groupId: null });

    expect(Object.fromEntries(new URLSearchParams(search))).toEqual({
      offset: '0',
      groupId: 'null',
    });
  });

  it('get returns the job of the id', async () => {
    const job = jobFixtures.build();
    server.use(http.get(`${BASE}/v1/jobs/${job.id}`, () => HttpResponse.json(job)));

    await expect(api.get({ id: job.id })).resolves.toEqual({ job });
  });

  it('create posts the request and returns the created job', async () => {
    const job = jobFixtures.build();
    let body: unknown = null;
    let contentType: string | null = null;
    server.use(
      http.post(`${BASE}/v1/jobs`, async ({ request }) => {
        body = await request.json();
        contentType = request.headers.get('content-type');
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
    expect(contentType).toBe('application/json');
  });

  it('createBulk posts the jobs and returns the created jobs in order', async () => {
    const first = jobFixtures.build();
    const second = jobFixtures.build();
    let body: unknown = null;
    let contentType: string | null = null;
    server.use(
      http.post(`${BASE}/v1/jobs/bulk`, async ({ request }) => {
        body = await request.json();
        contentType = request.headers.get('content-type');
        return HttpResponse.json({ items: [first, second] }, { status: 201 });
      }),
    );
    const groupId = randomUUID();
    const jobs = [first, second].map((job) => ({
      type: 'email' as const,
      payload: job.payload,
      priority: 5,
      maxAttempts: 3,
      groupId,
    }));

    await expect(api.createBulk({ jobs })).resolves.toEqual({ jobs: [first, second] });
    expect(body).toEqual({ jobs });
    expect(contentType).toBe('application/json');
  });

  it('createBulk rejects an answer that does not match the bulk contract', async () => {
    server.use(
      http.post(`${BASE}/v1/jobs/bulk`, () =>
        HttpResponse.json({ items: [{ ...jobFixtures.build(), priority: -1 }] }, { status: 201 }),
      ),
    );
    const job = jobFixtures.build();

    const error: unknown = await api
      .createBulk({
        jobs: [{ type: 'email', payload: job.payload, priority: 5, maxAttempts: 3 }],
      })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 201, code: null, message: 'API unreachable' });
  });

  it('createBulk turns a validation answer into an ApiError with its details', async () => {
    const details = { issues: [{ path: ['jobs', 1, 'payload', 'to'], message: 'Invalid email' }] };
    server.use(
      http.post(`${BASE}/v1/jobs/bulk`, () =>
        HttpResponse.json(
          { code: 'VALIDATION_FAILED', message: 'Validation failed', details },
          { status: 400 },
        ),
      ),
    );
    const job = jobFixtures.build();

    const error: unknown = await api
      .createBulk({
        jobs: [{ type: 'email', payload: job.payload, priority: 5, maxAttempts: 3 }],
      })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 400, code: 'VALIDATION_FAILED', details });
  });

  // The status is passed through as it is, so one of the two values is enough.
  it.each(['cancelled'] as const)(
    'changeStatus patches the job with status %s and returns the updated job',
    async (status) => {
      const job = jobFixtures.build({ status });
      let body: unknown = null;
      let contentType: string | null = null;
      server.use(
        http.patch(`${BASE}/v1/jobs/${job.id}`, async ({ request }) => {
          body = await request.json();
          contentType = request.headers.get('content-type');
          return HttpResponse.json(job);
        }),
      );

      await expect(api.changeStatus({ id: job.id, status })).resolves.toEqual({ job });
      expect(body).toEqual({ status });
      expect(contentType).toBe('application/json');
    },
  );

  it('changeStatus turns a status conflict into an ApiError with its code and details', async () => {
    const id = jobFixtures.build().id;
    server.use(
      http.patch(`${BASE}/v1/jobs/${id}`, () =>
        HttpResponse.json(
          {
            code: 'JOB_STATUS_CONFLICT',
            message: 'Job is completed',
            details: { id, status: 'completed' },
          },
          { status: 409 },
        ),
      ),
    );

    const error: unknown = await api
      .changeStatus({ id, status: 'cancelled' })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 409,
      code: 'JOB_STATUS_CONFLICT',
      message: 'Job is completed',
      details: { id, status: 'completed' },
    });
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

    await expect(api.stats({})).resolves.toEqual({ stats });
  });

  it('stats sends no filters when none are given', async () => {
    let search: string | null = null;
    server.use(
      http.get(`${BASE}/v1/stats`, ({ request }) => {
        search = new URL(request.url).search;
        return HttpResponse.json(queueStatsFixtures.build());
      }),
    );

    await api.stats({});

    expect(search).toBe('');
  });

  it('stats sends the status and type filters and returns the faceted counts', async () => {
    const stats = queueStatsFixtures.build();
    let search = '';
    server.use(
      http.get(`${BASE}/v1/stats`, ({ request }) => {
        search = new URL(request.url).search;
        return HttpResponse.json(stats);
      }),
    );

    const answer = await api.stats({ status: 'failed', type: 'webhook' });

    expect(Object.fromEntries(new URLSearchParams(search))).toEqual({
      status: 'failed',
      type: 'webhook',
    });
    expect(answer.stats.counts).toEqual(stats.counts);
  });

  it('stats rejects an answer that does not match the statistics contract', async () => {
    server.use(
      http.get(`${BASE}/v1/stats`, () =>
        HttpResponse.json({ ...queueStatsFixtures.build(), pending: -1 }),
      ),
    );

    const error: unknown = await api.stats({}).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 200, code: null, message: 'API unreachable' });
  });

  describe('logs', () => {
    const jobId = jobFixtures.build().id;
    const entry = jobLogEntryFixtures.build({ jobId });

    it('sends no parameters when none are given and returns the parsed page', async () => {
      let search = '?unset';
      const page = { items: [entry], nextCursor: 'MS0w' };
      server.use(
        http.get(`${BASE}/v1/jobs/${jobId}/logs`, ({ request }) => {
          search = new URL(request.url).search;
          return HttpResponse.json(page);
        }),
      );

      await expect(api.logs({ id: jobId })).resolves.toEqual(page);
      expect(search).toBe('');
    });

    it('sends after, limit and one level parameter per level when given', async () => {
      let params = new URLSearchParams();
      server.use(
        http.get(`${BASE}/v1/jobs/${jobId}/logs`, ({ request }) => {
          params = new URL(request.url).searchParams;
          return HttpResponse.json({ items: [], nextCursor: null });
        }),
      );

      await api.logs({ id: jobId, after: 'MS0w', limit: 50, level: ['warning', 'error'] });

      expect(params.get('after')).toBe('MS0w');
      expect(params.get('limit')).toBe('50');
      expect(params.getAll('level')).toEqual(['warning', 'error']);
    });

    it('throws an ApiError with LOG_STORE_UNAVAILABLE on a 503', async () => {
      server.use(
        http.get(`${BASE}/v1/jobs/${jobId}/logs`, () =>
          HttpResponse.json(
            { code: 'LOG_STORE_UNAVAILABLE', message: 'Log store unavailable', details: {} },
            { status: 503 },
          ),
        ),
      );

      const error = await api.logs({ id: jobId }).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ApiError);
      expect(error).toMatchObject({ status: 503, code: 'LOG_STORE_UNAVAILABLE' });
    });
  });
});
