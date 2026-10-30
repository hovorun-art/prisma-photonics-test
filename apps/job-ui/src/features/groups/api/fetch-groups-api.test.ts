import { randomUUID } from 'node:crypto';

import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { ApiError } from '../../jobs/api/api-error';
import { groupFixtures } from '../testing/group-fixtures';
import { FetchGroupsApi } from './fetch-groups-api';

const BASE = 'http://job-ui.test/api';
const server = setupServer();
const api = new FetchGroupsApi({ baseUrl: BASE, networkErrorMessage: 'API unreachable' });

beforeAll(() => {
  server.listen({ onUnhandledFrame: 'error' });
});
afterEach(() => {
  server.resetHandlers();
});
afterAll(() => {
  server.close();
});

describe('FetchGroupsApi', () => {
  it('query sends the offset and returns the page and the total', async () => {
    const group = groupFixtures.build();
    let search = '';
    server.use(
      http.get(`${BASE}/v1/groups`, ({ request }) => {
        search = new URL(request.url).search;
        return HttpResponse.json({ items: [group], total: 21 });
      }),
    );

    const page = await api.query({ offset: 20 });

    expect(Object.fromEntries(new URLSearchParams(search))).toEqual({ offset: '20' });
    expect(page).toEqual({ items: [group], total: 21 });
  });

  it('get returns the group of the id', async () => {
    const group = groupFixtures.build();
    server.use(http.get(`${BASE}/v1/groups/${group.id}`, () => HttpResponse.json(group)));

    await expect(api.get({ id: group.id })).resolves.toEqual({ group });
  });

  it('create posts without a body and returns the new group', async () => {
    const group = groupFixtures.build();
    let body: string | null = null;
    server.use(
      http.post(`${BASE}/v1/groups`, async ({ request }) => {
        body = await request.text();
        return HttpResponse.json(group, { status: 201 });
      }),
    );

    await expect(api.create()).resolves.toEqual({ group });
    expect(body).toBe('');
  });

  it('create turns an error body into an ApiError with its code', async () => {
    server.use(
      http.post(`${BASE}/v1/groups`, () =>
        HttpResponse.json(
          { code: 'INTERNAL_ERROR', message: 'Internal server error', details: {} },
          { status: 500 },
        ),
      ),
    );

    const error: unknown = await api.create().catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 500, code: 'INTERNAL_ERROR' });
  });

  it('create rejects an answer that does not match the group contract', async () => {
    server.use(
      http.post(`${BASE}/v1/groups`, () =>
        HttpResponse.json({ ...groupFixtures.build(), completed: -1 }, { status: 201 }),
      ),
    );

    const error: unknown = await api.create().catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 201, code: null, message: 'API unreachable' });
  });

  it('delete calls the group route and returns the id', async () => {
    const id = randomUUID();
    server.use(
      http.delete(`${BASE}/v1/groups/${id}`, () => new HttpResponse(null, { status: 204 })),
    );

    await expect(api.delete({ id })).resolves.toEqual({ id });
  });

  it('delete of a group with jobs becomes an ApiError with JOB_GROUP_NOT_EMPTY', async () => {
    const id = randomUUID();
    server.use(
      http.delete(`${BASE}/v1/groups/${id}`, () =>
        HttpResponse.json(
          { code: 'JOB_GROUP_NOT_EMPTY', message: 'Group has jobs', details: { id } },
          { status: 409 },
        ),
      ),
    );

    const error: unknown = await api.delete({ id }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 409, code: 'JOB_GROUP_NOT_EMPTY' });
  });

  it('an answer that does not match the group contract becomes an ApiError without a code', async () => {
    const group = groupFixtures.build();
    server.use(
      http.get(`${BASE}/v1/groups/${group.id}`, () =>
        HttpResponse.json({ ...group, completed: -1 }),
      ),
    );

    const error: unknown = await api.get({ id: group.id }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 200, code: null, message: 'API unreachable' });
  });
});
