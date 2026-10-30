import { randomUUID } from 'node:crypto';

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
});
