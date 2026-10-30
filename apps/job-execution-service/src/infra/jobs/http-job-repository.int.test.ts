import { randomUUID } from 'node:crypto';

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import { INTERNAL_JOBS_ROUTE, type Job } from '@job-queue/contracts';
import { UNREACHABLE_HTTP_URL } from '@job-queue/test-support';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { InvalidJobError } from '../../domain/jobs/errors/invalid-job.error.js';
import {
  FetchJobServiceHttp,
  JobNotFoundError,
  JobServiceUnavailableError,
  JobStatusConflictError,
} from '@job-queue/kernel';
import { HttpJobRepository } from './http-job-repository.js';

const TOKEN = 'int-test-token';
const TIMEOUT_MS = 300;
const MAX_PROCESSING_MS = 30_000;
const RUN_ATTEMPT = { run: 2, attempt: 3 };
const JOB: Job = {
  id: randomUUID(),
  type: 'email',
  payload: { to: 'ada@example.com', subject: 'Hello', body: 'Hi' },
  status: 'pending',
  priority: 5,
  attempts: 0,
  maxAttempts: 3,
  result: null,
  error: null,
  groupId: null,
  idempotencyKey: null,
  scheduledAt: null,
  startedAt: null,
  completedAt: null,
  createdAt: '2026-10-29T11:00:00.000Z',
  updatedAt: '2026-10-29T11:00:00.000Z',
};

/** The body of the internal read: the job with its type's maximum processing time. */
const INTERNAL_JOB = { ...JOB, maxProcessingMs: MAX_PROCESSING_MS };

interface Received {
  method: string | undefined;
  url: string | undefined;
  authorization: string | undefined;
  body: unknown;
}

describe('HttpJobRepository against a stub job-service', () => {
  let server: Server;
  let baseUrl: string;
  let received: Received[];
  /** How the stub answers the next request. */
  let answer: (res: ServerResponse) => void;

  const respond =
    (status: number, body?: unknown) =>
    (res: ServerResponse): void => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(body === undefined ? undefined : JSON.stringify(body));
    };

  const api = (): HttpJobRepository =>
    new HttpJobRepository(
      { http: new FetchJobServiceHttp({ fetch }, { baseUrl, timeoutMs: TIMEOUT_MS }) },
      { serviceToken: TOKEN },
    );

  beforeAll(async () => {
    server = createServer((req: IncomingMessage, res: ServerResponse) => {
      let raw = '';
      req.on('data', (chunk: Buffer) => (raw += chunk.toString()));
      req.on('end', () => {
        received.push({
          method: req.method,
          url: req.url,
          authorization: req.headers.authorization,
          body: raw === '' ? undefined : (JSON.parse(raw) as unknown),
        });
        answer(res);
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });
  beforeEach(() => {
    received = [];
  });

  it('Read a job with its time limit', async () => {
    answer = respond(200, INTERNAL_JOB);

    await expect(api().get({ id: JOB.id })).resolves.toEqual({
      job: JOB,
      maxProcessingMs: MAX_PROCESSING_MS,
    });
    expect(received).toEqual([
      {
        method: 'GET',
        url: `${INTERNAL_JOBS_ROUTE}/${JOB.id}`,
        authorization: `Bearer ${TOKEN}`,
        body: undefined,
      },
    ]);
  });

  it('sends a state report with its run and attempt and returns the updated job', async () => {
    answer = respond(200, { ...JOB, status: 'processing', attempts: 1 });

    const { job } = await api().update({
      id: JOB.id,
      update: { status: 'processing', ...RUN_ATTEMPT },
    });

    expect(job.status).toBe('processing');
    expect(received[0]).toMatchObject({
      method: 'PATCH',
      url: `${INTERNAL_JOBS_ROUTE}/${JOB.id}`,
      authorization: `Bearer ${TOKEN}`,
      body: { status: 'processing', run: 2, attempt: 3 },
    });
  });

  it('passes through an accepted report whose job does not match the contract', async () => {
    const corrupted = {
      ...JOB,
      status: 'processing',
      attempts: 1,
      payload: { to: 'not-an-email' },
    };
    answer = respond(200, corrupted);

    const { job } = await api().update({
      id: JOB.id,
      update: { status: 'processing', ...RUN_ATTEMPT },
    });

    expect(job).toEqual(corrupted);
  });

  it('maps 404 to JobNotFoundError', async () => {
    answer = respond(404, { code: 'JOB_NOT_FOUND', message: 'Job not found', details: {} });

    await expect(api().get({ id: JOB.id })).rejects.toBeInstanceOf(JobNotFoundError);
  });

  it('maps 409 to JobStatusConflictError carrying the status job-service names', async () => {
    answer = respond(409, {
      code: 'JOB_STATUS_CONFLICT',
      message: 'x',
      details: { id: JOB.id, status: 'scheduled' },
    });

    const refused = api().update({
      id: JOB.id,
      update: { status: 'completed', result: {}, ...RUN_ATTEMPT },
    });

    await expect(refused).rejects.toBeInstanceOf(JobStatusConflictError);
    await expect(refused).rejects.toMatchObject({
      details: { id: JOB.id, status: 'scheduled' },
    });
  });

  it('maps 409 without a status in its details to a conflict without a status', async () => {
    answer = respond(409, { code: 'JOB_STATUS_CONFLICT', message: 'x', details: {} });

    await expect(
      api().update({ id: JOB.id, update: { status: 'processing', ...RUN_ATTEMPT } }),
    ).rejects.toMatchObject({ details: { id: JOB.id } });
  });

  it('maps a server error to JobServiceUnavailableError', async () => {
    answer = respond(503, { code: 'INTERNAL_ERROR', message: 'x', details: {} });

    await expect(api().get({ id: JOB.id })).rejects.toBeInstanceOf(JobServiceUnavailableError);
  });

  it('maps a slow answer past the timeout to JobServiceUnavailableError', async () => {
    answer = (res) =>
      setTimeout(() => {
        respond(200, INTERNAL_JOB)(res);
      }, TIMEOUT_MS * 3);

    await expect(api().get({ id: JOB.id })).rejects.toBeInstanceOf(JobServiceUnavailableError);
  });

  it('maps a refused connection to JobServiceUnavailableError', async () => {
    const unreachable = new HttpJobRepository(
      {
        http: new FetchJobServiceHttp(
          { fetch },
          { baseUrl: UNREACHABLE_HTTP_URL, timeoutMs: TIMEOUT_MS },
        ),
      },
      { serviceToken: TOKEN },
    );

    await expect(unreachable.get({ id: JOB.id })).rejects.toBeInstanceOf(
      JobServiceUnavailableError,
    );
  });

  it('rejects a read without the time limit as invalid', async () => {
    answer = respond(200, JOB);

    await expect(api().get({ id: JOB.id })).rejects.toBeInstanceOf(InvalidJobError);
  });

  it('rejects a job that does not match the contract as invalid', async () => {
    answer = respond(200, { ...INTERNAL_JOB, payload: { to: 'not-an-email' } });

    const read = api().get({ id: JOB.id });

    await expect(read).rejects.toBeInstanceOf(InvalidJobError);
    await expect(read).rejects.toMatchObject({ details: { id: JOB.id } });
  });

  it('rejects a report job-service refuses as invalid', async () => {
    answer = respond(400, {
      code: 'VALIDATION_FAILED',
      message: 'Request validation failed',
      details: { issues: [{ code: 'invalid_type', path: ['result'], message: 'x' }] },
    });

    await expect(
      api().update({ id: JOB.id, update: { status: 'completed', result: {}, ...RUN_ATTEMPT } }),
    ).rejects.toBeInstanceOf(InvalidJobError);
  });
});
