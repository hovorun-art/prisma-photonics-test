import { randomUUID } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { JobServiceUnavailableError } from '../domain/jobs/job-service-unavailable.error.js';
import { FetchJobServiceHttp } from './fetch-job-service-http.js';

const BASE_URL = 'http://job-service:3000';
const TIMEOUT_MS = 2_000;
const GROUP_ID = randomUUID();

describe('FetchJobServiceHttp', () => {
  const setup = () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const http = new FetchJobServiceHttp({ fetch }, { baseUrl: BASE_URL, timeoutMs: TIMEOUT_MS });
    return { fetch, http };
  };
  const json = (status: number, body: unknown): Response =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  it('calls the path on the base URL with repeated query parameters and returns status and JSON body', async () => {
    const { fetch, http } = setup();
    fetch.mockResolvedValueOnce(json(200, { items: [], total: 4 }));

    const response = await http.send({
      method: 'GET',
      path: '/v1/jobs',
      query: [
        ['groupId', GROUP_ID],
        ['status', 'failed'],
        ['status', 'cancelled'],
      ],
    });

    expect(response).toEqual({ status: 200, body: { items: [], total: 4 } });
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toEqual(
      new URL(`${BASE_URL}/v1/jobs?groupId=${GROUP_ID}&status=failed&status=cancelled`),
    );
    expect(init?.method).toBe('GET');
    expect(init?.body).toBeUndefined();
    expect(init?.headers).toEqual({});
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('sends a body as JSON with the given headers', async () => {
    const { fetch, http } = setup();
    fetch.mockResolvedValueOnce(json(200, { ok: true }));

    await http.send({
      method: 'PATCH',
      path: '/internal/v1/jobs/1',
      headers: { authorization: 'Service t' },
      body: { status: 'processing' },
    });

    const init = fetch.mock.calls[0]?.[1];
    expect(init?.body).toBe('{"status":"processing"}');
    expect(init?.headers).toEqual({
      authorization: 'Service t',
      'content-type': 'application/json',
    });
  });

  it('returns a 4xx answer with its body for the caller to interpret', async () => {
    const { fetch, http } = setup();
    fetch.mockResolvedValueOnce(json(404, { code: 'JOB_NOT_FOUND' }));

    await expect(http.send({ method: 'GET', path: '/x' })).resolves.toEqual({
      status: 404,
      body: { code: 'JOB_NOT_FOUND' },
    });
  });

  it('returns an undefined body when the answer has none or is not JSON', async () => {
    const { fetch, http } = setup();
    fetch.mockResolvedValueOnce(new Response(null, { status: 204 }));
    fetch.mockResolvedValueOnce(new Response('<html>', { status: 200 }));

    expect(await http.send({ method: 'DELETE', path: '/x' })).toEqual({
      status: 204,
      body: undefined,
    });
    expect(await http.send({ method: 'GET', path: '/x' })).toEqual({
      status: 200,
      body: undefined,
    });
  });

  it('throws JobServiceUnavailableError on a 5xx, with the status as reason', async () => {
    const { fetch, http } = setup();
    fetch.mockResolvedValueOnce(json(500, {}));

    const failure = await http.send({ method: 'GET', path: '/x' }).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(JobServiceUnavailableError);
    expect((failure as JobServiceUnavailableError).details).toEqual({ reason: 'HTTP 500' });
  });

  it('throws JobServiceUnavailableError when the call fails or times out', async () => {
    const { fetch, http } = setup();
    fetch.mockRejectedValueOnce(new TypeError('fetch failed'));
    fetch.mockRejectedValueOnce(new DOMException('The operation timed out.', 'TimeoutError'));

    const refused = await http.send({ method: 'GET', path: '/x' }).catch((error: unknown) => error);
    const slow = await http.send({ method: 'GET', path: '/x' }).catch((error: unknown) => error);

    expect(refused).toBeInstanceOf(JobServiceUnavailableError);
    expect((refused as JobServiceUnavailableError).details).toEqual({ reason: 'fetch failed' });
    expect(slow).toBeInstanceOf(JobServiceUnavailableError);
    expect((slow as JobServiceUnavailableError).details).toEqual({
      reason: 'The operation timed out.',
    });
  });

  it('turns a rejection that is not an Error into its text as the reason', async () => {
    const { fetch, http } = setup();
    fetch.mockRejectedValueOnce('socket hang up');

    const failure = await http.send({ method: 'GET', path: '/x' }).catch((error: unknown) => error);

    expect((failure as JobServiceUnavailableError).details).toEqual({ reason: 'socket hang up' });
  });

  it('throws JobServiceUnavailableError when the caller aborts the call in flight', async () => {
    const { fetch, http } = setup();
    fetch.mockRejectedValueOnce(new DOMException('This operation was aborted', 'AbortError'));
    const caller = new AbortController();
    caller.abort();

    await expect(
      http.send({ method: 'GET', path: '/x', signal: caller.signal }),
    ).rejects.toBeInstanceOf(JobServiceUnavailableError);
  });

  it('passes a signal that aborts when the caller signal aborts', async () => {
    const { fetch, http } = setup();
    fetch.mockResolvedValueOnce(json(200, {}));
    const caller = new AbortController();

    await http.send({ method: 'GET', path: '/x', signal: caller.signal });
    const signal = fetch.mock.calls[0]?.[1]?.signal;
    caller.abort();

    expect(signal?.aborted).toBe(true);
  });
});
