import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import { JOBS_ROUTE, type Job } from '@job-queue/contracts';
import { DomainError, JobServiceUnavailableError } from '@job-queue/kernel';
import { UNREACHABLE_HTTP_URL } from '@job-queue/test-support';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { HttpGroupChildJobs } from './http-group-child-jobs.js';

/** Generous, so a busy machine never times out the calls that should succeed. */
const TIMEOUT_MS = 5_000;
/** The timeout of the one test that waits for it. */
const SHORT_TIMEOUT_MS = 200;
const GROUP_ID = randomUUID();
const JOB: Job = {
  id: randomUUID(),
  type: 'email',
  payload: { to: 'ada@example.com', subject: 'Hello', body: 'Hi' },
  status: 'completed',
  priority: 5,
  attempts: 1,
  maxAttempts: 3,
  result: null,
  error: null,
  groupId: GROUP_ID,
  scheduledAt: null,
  startedAt: null,
  completedAt: null,
  createdAt: '2026-10-29T11:00:00.000Z',
  updatedAt: '2026-10-29T11:00:00.000Z',
};

describe('HttpGroupChildJobs against a stub job-service', () => {
  let server: Server;
  let baseUrl: string;
  let received: string[];
  let methods: (string | undefined)[];
  /** How the stub answers the next requests; gets the request's query string. */
  let answer: (res: ServerResponse, query: URLSearchParams) => void;

  const respond =
    (status: number, body?: unknown) =>
    (res: ServerResponse): void => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(body === undefined ? undefined : JSON.stringify(body));
    };

  const childJobs = (url = baseUrl, timeoutMs = TIMEOUT_MS): HttpGroupChildJobs =>
    new HttpGroupChildJobs({ baseUrl: url, timeoutMs });

  const failureOf = async (): Promise<unknown> =>
    childJobs()
      .count({ groupId: GROUP_ID })
      .then(
        () => undefined,
        (error: unknown) => error,
      );

  beforeAll(async () => {
    server = createServer((req: IncomingMessage, res: ServerResponse) => {
      received.push(req.url ?? '');
      methods.push(req.method);
      answer(res, new URL(req.url ?? '', 'http://stub').searchParams);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });
  beforeEach(() => {
    received = [];
    methods = [];
    answer = respond(500);
  });

  it('counts a group with three queries and returns their totals', async () => {
    answer = (res, query) => {
      const statuses = query.getAll('status').join(',');
      const total = { '': 7, completed: 4, 'failed,cancelled': 2 }[statuses];
      respond(200, { items: [JOB], total })(res);
    };

    await expect(childJobs().count({ groupId: GROUP_ID })).resolves.toEqual({
      total: 7,
      completed: 4,
      failed: 2,
    });

    expect(methods).toEqual(['GET', 'GET', 'GET']);
    expect([...received].sort()).toEqual(
      [
        `${JOBS_ROUTE}?groupId=${GROUP_ID}&limit=1`,
        `${JOBS_ROUTE}?groupId=${GROUP_ID}&limit=1&status=completed`,
        `${JOBS_ROUTE}?groupId=${GROUP_ID}&limit=1&status=failed&status=cancelled`,
      ].sort(),
    );
  });

  it('never reports fewer jobs in all than finished ones, when a child appears between the calls', async () => {
    answer = (res, query) => {
      const statuses = query.getAll('status').join(',');
      // The all-jobs call was answered before a new child was submitted and finished.
      const total = { '': 3, completed: 3, 'failed,cancelled': 1 }[statuses];
      respond(200, { items: [JOB], total })(res);
    };

    await expect(childJobs().count({ groupId: GROUP_ID })).resolves.toEqual({
      total: 4,
      completed: 3,
      failed: 1,
    });
  });

  it('A child was cancelled', async () => {
    answer = (res, query) => {
      // Two children: one completed, one cancelled, which job-service lists among the second query.
      const statuses = query.getAll('status').join(',');
      const total = { '': 2, completed: 1, 'failed,cancelled': 1 }[statuses];
      respond(200, { items: [JOB], total })(res);
    };

    await expect(childJobs().count({ groupId: GROUP_ID })).resolves.toEqual({
      total: 2,
      completed: 1,
      failed: 1,
    });
    expect(received.filter((url) => url.includes('status=cancelled'))).toHaveLength(1);
  });

  it('throws JobServiceUnavailableError on a refused connection', async () => {
    await expect(
      childJobs(UNREACHABLE_HTTP_URL).count({ groupId: GROUP_ID }),
    ).rejects.toBeInstanceOf(JobServiceUnavailableError);
  });

  it('throws JobServiceUnavailableError on a slow answer past the timeout', async () => {
    answer = (res) =>
      setTimeout(() => {
        respond(200, { items: [], total: 0 })(res);
      }, SHORT_TIMEOUT_MS * 3);

    await expect(
      childJobs(baseUrl, SHORT_TIMEOUT_MS).count({ groupId: GROUP_ID }),
    ).rejects.toBeInstanceOf(JobServiceUnavailableError);
  });

  it('throws JobServiceUnavailableError on a 5xx', async () => {
    answer = respond(503, { code: 'INTERNAL_ERROR', message: 'x', details: {} });

    await expect(childJobs().count({ groupId: GROUP_ID })).rejects.toBeInstanceOf(
      JobServiceUnavailableError,
    );
  });

  it('throws JobServiceUnavailableError when only one of the three calls fails', async () => {
    answer = (res, query) => {
      if (query.get('status') === 'completed') respond(500)(res);
      else respond(200, { items: [], total: 1 })(res);
    };

    await expect(childJobs().count({ groupId: GROUP_ID })).rejects.toBeInstanceOf(
      JobServiceUnavailableError,
    );
  });

  it('throws a non-domain error on a 4xx', async () => {
    answer = respond(400, { code: 'VALIDATION_FAILED', message: 'x', details: {} });

    const error = await failureOf();

    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(DomainError);
  });

  it.each([
    ['a missing total', { items: [] }],
    ['a negative total', { items: [], total: -1 }],
    ['a non-object body', 'nope'],
  ])('throws a non-domain error on a body with %s', async (_name, body) => {
    answer = respond(200, body);

    const error = await failureOf();

    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(DomainError);
  });

  it('throws a non-domain error on a 200 whose body is not JSON', async () => {
    answer = (res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('<html>');
    };

    const error = await failureOf();

    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(DomainError);
  });
});
