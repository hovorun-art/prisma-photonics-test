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
