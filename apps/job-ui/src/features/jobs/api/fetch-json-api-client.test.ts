import { randomUUID } from 'node:crypto';

import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { ApiError } from './api-error';
import { FetchJsonApiClient } from './fetch-json-api-client';

const BASE = 'http://job-ui.test/api';
const server = setupServer();
const client = new FetchJsonApiClient({ baseUrl: BASE, networkErrorMessage: 'API unreachable' });
const Thing = z.object({ name: z.string() });

beforeAll(() => {
  server.listen({ onUnhandledFrame: 'error' });
});
afterEach(() => {
  server.resetHandlers();
});
afterAll(() => {
  server.close();
});

describe('FetchJsonApiClient', () => {
  it('sends the call below the API root and asks for JSON, keeping the call’s own headers', async () => {
    let accept: string | null = null;
    let contentType: string | null = null;
    server.use(
      http.post(`${BASE}/v1/things`, ({ request }) => {
        accept = request.headers.get('accept');
        contentType = request.headers.get('content-type');
        return HttpResponse.json({ name: 'a' }, { status: 201 });
      }),
    );

    const { response } = await client.send({
      path: '/v1/things',
      init: { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
    });

    expect(response.status).toBe(201);
    expect(accept).toBe('application/json');
    expect(contentType).toBe('application/json');
  });

  it('reads a body that matches the schema', async () => {
    server.use(http.get(`${BASE}/v1/things`, () => HttpResponse.json({ name: 'a' })));
    const { response } = await client.send({ path: '/v1/things', init: { method: 'GET' } });

    await expect(client.read({ schema: Thing, response })).resolves.toEqual({
      body: { name: 'a' },
    });
  });

  it('an error body becomes an ApiError with its status, code, message and details', async () => {
    const id = randomUUID();
    server.use(
      http.get(`${BASE}/v1/things`, () =>
        HttpResponse.json(
          { code: 'JOB_GROUP_NOT_FOUND', message: 'Job group not found', details: { id } },
          { status: 404 },
        ),
      ),
    );

    const error: unknown = await client
      .send({ path: '/v1/things', init: { method: 'GET' } })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 404,
      code: 'JOB_GROUP_NOT_FOUND',
      message: 'Job group not found',
      details: { id },
    });
  });

  it('a network failure becomes an ApiError without a status or code', async () => {
    server.use(http.get(`${BASE}/v1/things`, () => HttpResponse.error()));

    const error: unknown = await client
      .send({ path: '/v1/things', init: { method: 'GET' } })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: null, code: null, message: 'API unreachable' });
  });

  it('an error answer without an error body becomes an ApiError with the status but no code', async () => {
    server.use(
      http.get(`${BASE}/v1/things`, () => new HttpResponse('Bad gateway', { status: 502 })),
    );

    const error: unknown = await client
      .send({ path: '/v1/things', init: { method: 'GET' } })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 502, code: null, message: 'API unreachable' });
  });

  it('a successful answer that does not match the schema becomes an ApiError without a code', async () => {
    server.use(http.get(`${BASE}/v1/things`, () => HttpResponse.json({ name: 1 })));
    const { response } = await client.send({ path: '/v1/things', init: { method: 'GET' } });

    const error: unknown = await client
      .read({ schema: Thing, response })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 200, code: null, message: 'API unreachable' });
  });

  it('a successful answer that is not JSON becomes an ApiError without a code', async () => {
    server.use(http.get(`${BASE}/v1/things`, () => new HttpResponse('<html>', { status: 200 })));
    const { response } = await client.send({ path: '/v1/things', init: { method: 'GET' } });

    const error: unknown = await client
      .read({ schema: Thing, response })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 200, code: null, message: 'API unreachable' });
  });
});
