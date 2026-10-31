import { randomUUID } from 'node:crypto';

import {
  type CreateJobRequest,
  CreateJobsBulkResponse,
  EMAIL_LIMITS,
  JOB_LIMITS,
  JOBS_ROUTE,
  Job,
  QueryJobsResponse,
  WEBHOOK_LIMITS,
} from '@job-queue/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { JobQueueUnavailableError } from '../../src/domain/jobs/errors/job-queue-unavailable.error.js';
import { JobServiceUnderTest, TEST_CONFIG } from './job-service-under-test.js';

const UNKNOWN_ID = randomUUID();
const ERROR = { code: 'SEND_FAILED', message: 'Mailbox unavailable' };

const EMAIL_JOB = {
  type: 'email',
  payload: { to: 'ada@example.com', subject: 'Hello', body: 'Hi Ada' },
  priority: 7,
  maxAttempts: 4,
};

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

const WEBHOOK_JOB = {
  type: 'webhook',
  payload: {
    method: 'POST',
    url: 'https://hooks.example.com/orders',
    body: { orderId: 'ord_4821', event: 'order.paid' },
  },
};

describe('job-service public job routes', () => {
  let service: JobServiceUnderTest;

  /** A worker's reports about the first attempt of the first run, or of the run/attempt given. */
  const start = ({ run = 1, attempt = 1 } = {}) => ({ status: 'processing', run, attempt });
  const complete = ({ run = 1, attempt = 1 } = {}) => ({
    status: 'completed',
    run,
    attempt,
    result: { messageId: 'm-1' },
  });
  const fail = ({ run = 1, attempt = 1 } = {}) => ({
    status: 'failed',
    run,
    attempt,
    error: ERROR,
  });

  /** A submission rejected for `path`, after which nothing is stored or queued. */
  const expectRejected = async (body: unknown, path: unknown[]): Promise<void> => {
    expect(await service.issuePaths(await service.submit(body))).toContainEqual(path);
    expect(await service.total()).toBe(0);
    expect(service.queue.enqueue).not.toHaveBeenCalled();
  };

  /** An execution time the given milliseconds from now, at the app's real clock. */
  const fromNow = (ms: number): string => new Date(Date.now() + ms).toISOString();
  const maxAheadMs = JOB_LIMITS.scheduledAt.maxAheadDays * DAY_MS;

  const expectNotFound = async (response: Response): Promise<void> => {
    await service.errorBody({ response, status: 404, code: 'JOB_NOT_FOUND' });
  };

  beforeAll(async () => {
    service = await JobServiceUnderTest.start();
  }, 180_000);
  beforeEach(async () => {
    await service.clear();
  });
  afterAll(async () => {
    await service.close();
  });

  describe('submit', () => {
    it('Valid email job is accepted', async () => {
      const response = await service.submit(EMAIL_JOB);

      expect(response.status).toBe(201);
      const job = Job.parse(await response.json());
      expect(job).toMatchObject({
        type: 'email',
        status: 'pending',
        attempts: 0,
        payload: EMAIL_JOB.payload,
        priority: 7,
        maxAttempts: 4,
        result: null,
        error: null,
        scheduledAt: null,
        startedAt: null,
        completedAt: null,
      });
      expect(job.createdAt).toEqual(expect.any(String));
    });

    it('Defaults are applied', async () => {
      const job = await service.submitted({ type: 'email', payload: EMAIL_JOB.payload });

      expect(job.priority).toBe(JOB_LIMITS.priority.default);
      expect(job.maxAttempts).toBe(JOB_LIMITS.maxAttempts.default);
    });

    it('Submitted job can be read back', async () => {
      const job = await service.submitted(EMAIL_JOB);

      expect(Job.parse(await (await service.get(job.id)).json())).toEqual(job);
    });

    it.each([EMAIL_JOB, WEBHOOK_JOB])('Submitted job is queued ($type)', async (body) => {
      const job = await service.submitted(body);

      expect(service.queue.enqueue).toHaveBeenCalledExactlyOnceWith({
        jobId: job.id,
        run: 1,
        attempt: 1,
        priority: job.priority,
        runAt: null,
      });
    });

    it('Queue unavailable during submit', async () => {
      service.queue.enqueue.mockImplementationOnce(({ jobId, run, attempt }) =>
        Promise.reject(new JobQueueUnavailableError({ jobId, run, attempt })),
      );

      const response = await service.submit(EMAIL_JOB);

      expect(response.status).toBe(201);
      const job = Job.parse(await response.json());
      expect(job.status).toBe('pending');
      expect(service.queue.enqueue).toHaveBeenCalledExactlyOnceWith({
        jobId: job.id,
        run: 1,
        attempt: 1,
        priority: job.priority,
        runAt: null,
      });
      expect(await service.stored(job.id)).toEqual(job);
    });

    it('Concurrent submissions are separate jobs', async () => {
      const jobs = await Promise.all([
        service.submitted(EMAIL_JOB),
        service.submitted(EMAIL_JOB),
        service.submitted(EMAIL_JOB),
      ]);

      expect(new Set(jobs.map((job) => job.id)).size).toBe(3);
      expect(service.queue.enqueue).toHaveBeenCalledTimes(3);
      for (const job of jobs) {
        expect(service.queue.enqueue).toHaveBeenCalledWith({
          jobId: job.id,
          run: 1,
          attempt: 1,
          priority: job.priority,
          runAt: null,
        });
      }
      expect(await service.total()).toBe(3);
    });

    it('Job with a future execution time is scheduled', async () => {
      const scheduledAt = fromNow(60 * MINUTE_MS);

      const response = await service.submit({ ...EMAIL_JOB, scheduledAt });

      expect(response.status).toBe(201);
      const job = Job.parse(await response.json());
      expect(job).toMatchObject({ status: 'scheduled', attempts: 0, scheduledAt });
      expect(await service.stored(job.id)).toEqual(job);
    });

    it('Scheduled job is queued for its time', async () => {
      const scheduledAt = fromNow(60 * MINUTE_MS);

      const job = await service.submitted({ ...EMAIL_JOB, scheduledAt });

      expect(service.queue.enqueue).toHaveBeenCalledExactlyOnceWith({
        jobId: job.id,
        run: 1,
        attempt: 1,
        priority: EMAIL_JOB.priority,
        runAt: scheduledAt,
      });
    });

    it('Job with a past execution time runs at once', async () => {
      const scheduledAt = fromNow(-MINUTE_MS);

      const job = await service.submitted({ ...EMAIL_JOB, scheduledAt });

      expect(job).toMatchObject({ status: 'pending', scheduledAt });
      expect(service.queue.enqueue).toHaveBeenCalledExactlyOnceWith({
        jobId: job.id,
        run: 1,
        attempt: 1,
        priority: EMAIL_JOB.priority,
        runAt: scheduledAt,
      });
    });

    it('Execution time with a time zone offset', async () => {
      const utc = new Date(Date.now() + 60 * MINUTE_MS);
      utc.setUTCMilliseconds(0);
      // The same instant two hours ahead on the wall clock, written with `+02:00`.
      const local = new Date(utc.getTime() + 2 * 60 * MINUTE_MS).toISOString().slice(0, 19);

      const job = await service.submitted({ ...EMAIL_JOB, scheduledAt: `${local}+02:00` });

      expect(job).toMatchObject({ status: 'scheduled', scheduledAt: utc.toISOString() });
    });

    it('Queue unavailable during a scheduled submit', async () => {
      service.queue.enqueue.mockImplementationOnce(({ jobId, run, attempt }) =>
        Promise.reject(new JobQueueUnavailableError({ jobId, run, attempt })),
      );

      const scheduledAt = fromNow(MINUTE_MS);

      const response = await service.submit({ ...EMAIL_JOB, scheduledAt });

      expect(response.status).toBe(201);
      const job = Job.parse(await response.json());
      expect(job.status).toBe('scheduled');
      expect(service.queue.enqueue).toHaveBeenCalledExactlyOnceWith({
        jobId: job.id,
        run: 1,
        attempt: 1,
        priority: EMAIL_JOB.priority,
        runAt: scheduledAt,
      });
      expect(await service.stored(job.id)).toEqual(job);
    });

    it('Execution time is not a timestamp', async () => {
      await expectRejected({ ...EMAIL_JOB, scheduledAt: fromNow(MINUTE_MS).slice(0, 19) }, [
        'scheduledAt',
      ]);
    });

    it('Execution time too far ahead', async () => {
      const response = await service.submit({
        ...EMAIL_JOB,
        scheduledAt: fromNow(maxAheadMs + MINUTE_MS),
      });

      const body = await service.errorBody({ response, status: 400, code: 'VALIDATION_FAILED' });
      expect(body.details.issues).toEqual([
        expect.objectContaining({
          path: ['scheduledAt'],
          message: expect.stringContaining(
            `${String(JOB_LIMITS.scheduledAt.maxAheadDays)} days`,
          ) as unknown,
        }),
      ]);
      expect(await service.total()).toBe(0);
      expect(service.queue.enqueue).not.toHaveBeenCalled();
    });

    it('accepts an execution time just within the maximum', async () => {
      const job = await service.submitted({
        ...EMAIL_JOB,
        scheduledAt: fromNow(maxAheadMs - MINUTE_MS),
      });

      expect(job.status).toBe('scheduled');
    });

    it('Unknown job type', async () => {
      await expectRejected({ ...EMAIL_JOB, type: 'fax' }, ['type']);
    });

    it('Priority out of range', async () => {
      await expectRejected({ ...EMAIL_JOB, priority: JOB_LIMITS.priority.max + 1 }, ['priority']);
    });

    it('Max attempts out of range', async () => {
      await expectRejected({ ...EMAIL_JOB, maxAttempts: JOB_LIMITS.maxAttempts.min - 1 }, [
        'maxAttempts',
      ]);
    });

    it('Fields the server owns are ignored on submit', async () => {
      const job = await service.submitted({
        ...EMAIL_JOB,
        id: UNKNOWN_ID,
        status: 'completed',
        attempts: 5,
        result: { messageId: 'forged' },
        error: ERROR,
        startedAt: new Date().toISOString(),
      });

      expect(job.id).not.toBe(UNKNOWN_ID);
      expect(job).toMatchObject({
        status: 'pending',
        attempts: 0,
        result: null,
        error: null,
        startedAt: null,
      });
      expect(service.queue.enqueue).toHaveBeenCalledExactlyOnceWith({
        jobId: job.id,
        run: 1,
        attempt: 1,
        priority: job.priority,
        runAt: null,
      });
    });
  });

  describe('submit in bulk', () => {
    /** A flight transit departing in `days` days (negative for a day that is over). */
    const transitJob = (days: number) => ({
      type: 'flight-transit',
      payload: { origin: 'LHR', destination: 'JFK', departureDate: service.utcDate(days) },
    });

    /** A bulk rejected for `path`, after which nothing is stored or queued. */
    const expectBulkRejected = async (jobs: unknown[], path: unknown[]): Promise<void> => {
      expect(await service.issuePaths(await service.submitBulk({ jobs }))).toContainEqual(path);
      expect(await service.total()).toBe(0);
      expect(service.queue.enqueueMany).not.toHaveBeenCalled();
    };

    it('Mixed job types are created in request order', async () => {
      const requested = [EMAIL_JOB, WEBHOOK_JOB, transitJob(1)];

      const jobs = await service.submittedBulk(requested);

      expect(jobs.map((job) => [job.type, job.payload, job.status])).toEqual(
        requested.map((item) => [item.type, item.payload, 'pending']),
      );
      expect(new Set(jobs.map((job) => job.id)).size).toBe(3);
    });

    it('Defaults are applied to each item', async () => {
      const jobs = await service.submittedBulk([
        { type: 'email', payload: EMAIL_JOB.payload },
        { type: 'webhook', payload: WEBHOOK_JOB.payload },
      ]);

      for (const job of jobs) {
        expect(job.priority).toBe(JOB_LIMITS.priority.default);
        expect(job.maxAttempts).toBe(JOB_LIMITS.maxAttempts.default);
      }
    });

    it('Bulk-created jobs can be read back', async () => {
      const jobs = await service.submittedBulk([EMAIL_JOB, WEBHOOK_JOB]);

      for (const job of jobs) {
        const response = await service.get(job.id);
        expect(response.status).toBe(200);
        expect(Job.parse(await response.json())).toEqual(job);
      }
    });

    it('Jobs of one bulk keep the request order in the job query', async () => {
      const jobs = await service.submittedBulk([EMAIL_JOB, WEBHOOK_JOB, EMAIL_JOB]);

      const page = QueryJobsResponse.parse(await (await fetch(service.url(JOBS_ROUTE))).json());

      expect(page.items.map((job) => job.id)).toEqual(jobs.map((job) => job.id).reverse());
    });

    it('Bulk items with and without an execution time', async () => {
      const scheduledAt = fromNow(60 * MINUTE_MS);

      const jobs = await service.submittedBulk([{ ...EMAIL_JOB, scheduledAt }, WEBHOOK_JOB]);

      expect(jobs.map((job) => [job.status, job.scheduledAt])).toEqual([
        ['scheduled', scheduledAt],
        ['pending', null],
      ]);
      expect(service.queue.enqueueMany).toHaveBeenCalledExactlyOnceWith({
        entries: [
          {
            jobId: jobs[0]!.id,
            run: 1,
            attempt: 1,
            priority: EMAIL_JOB.priority,
            runAt: scheduledAt,
          },
          {
            jobId: jobs[1]!.id,
            run: 1,
            attempt: 1,
            priority: JOB_LIMITS.priority.default,
            runAt: null,
          },
        ],
      });
    });

    it('Bulk item with an execution time too far ahead', async () => {
      await expectBulkRejected(
        [EMAIL_JOB, { ...WEBHOOK_JOB, scheduledAt: fromNow(maxAheadMs + MINUTE_MS) }],
        ['jobs', 1, 'scheduledAt'],
      );
    });

    it('One item with an invalid payload', async () => {
      const invalid = { ...EMAIL_JOB, payload: { ...EMAIL_JOB.payload, to: 'not-an-email' } };

      await expectBulkRejected([EMAIL_JOB, invalid], ['jobs', 1, 'payload', 'to']);
    });

    it('One item breaking a job-service rule', async () => {
      await expectBulkRejected(
        [EMAIL_JOB, transitJob(-1)],
        ['jobs', 1, 'payload', 'departureDate'],
      );
    });

    it('Unknown job type in one item', async () => {
      await expectBulkRejected(
        [EMAIL_JOB, WEBHOOK_JOB, { ...EMAIL_JOB, type: 'sms' }],
        ['jobs', 2, 'type'],
      );
    });

    it('Every bulk job is queued', async () => {
      service.queue.enqueueMany.mockResolvedValueOnce({});

      const jobs = await service.submittedBulk([EMAIL_JOB, WEBHOOK_JOB]);

      expect(service.queue.enqueueMany).toHaveBeenCalledExactlyOnceWith({
        entries: jobs.map((job) => ({
          jobId: job.id,
          run: 1,
          attempt: 1,
          priority: job.priority,
          runAt: null,
        })),
      });
      expect(service.queue.enqueue).not.toHaveBeenCalled();
    });

    it('Queue unavailable during bulk submit', async () => {
      service.queue.enqueueMany.mockImplementationOnce(({ entries }) =>
        Promise.reject(new JobQueueUnavailableError({ entries })),
      );

      const jobs = await service.submittedBulk([EMAIL_JOB, WEBHOOK_JOB]);

      expect(service.queue.enqueueMany).toHaveBeenCalledExactlyOnceWith({
        entries: jobs.map((job) => ({
          jobId: job.id,
          run: 1,
          attempt: 1,
          priority: job.priority,
          runAt: null,
        })),
      });
      expect(jobs.map((job) => job.status)).toEqual(['pending', 'pending']);
      for (const job of jobs) expect(await service.stored(job.id)).toEqual(job);
    });
  });

  describe('idempotency key', () => {
    const KEY = 'order-4711';
    const keyed = (overrides: Record<string, unknown> = {}) => ({
      ...EMAIL_JOB,
      idempotencyKey: KEY,
      ...overrides,
    });
    const expectConflict = async (response: Response, existingId: string): Promise<void> => {
      const body = await service.errorBody({
        response,
        status: 409,
        code: 'IDEMPOTENCY_KEY_CONFLICT',
      });
      expect(body.details).toEqual({ idempotencyKey: KEY, existingJobId: existingId });
    };
    /** Runs a job's only attempt to completion through the internal routes. */
    const finish = async (job: Job): Promise<void> => {
      expect((await service.report({ id: job.id, body: start() })).status).toBe(200);
      expect((await service.report({ id: job.id, body: complete() })).status).toBe(200);
    };
    /** `iso` written with a +02:00 offset instead of `Z`: the same instant. */
    const withOffset = (iso: string): string =>
      new Date(Date.parse(iso) + 2 * 60 * MINUTE_MS).toISOString().replace('Z', '+02:00');

    it('Job with a key', async () => {
      const job = await service.submitted(keyed());

      expect(job.idempotencyKey).toBe(KEY);
      expect(Job.parse(await (await service.get(job.id)).json()).idempotencyKey).toBe(KEY);
    });

    it('Job without a key (New job has no idempotency key)', async () => {
      const job = await service.submitted(EMAIL_JOB);

      expect(job.idempotencyKey).toBeNull();
      expect(Job.parse(await (await service.get(job.id)).json()).idempotencyKey).toBeNull();
    });

    it('Empty key', async () => {
      await expectRejected(keyed({ idempotencyKey: '' }), ['idempotencyKey']);
    });

    it('Key too long', async () => {
      const idempotencyKey = 'k'.repeat(JOB_LIMITS.idempotencyKey.maxLength + 1);

      await expectRejected(keyed({ idempotencyKey }), ['idempotencyKey']);
    });

    it('Key at the maximum length is accepted', async () => {
      const idempotencyKey = 'k'.repeat(JOB_LIMITS.idempotencyKey.maxLength);

      const job = await service.submitted(keyed({ idempotencyKey }));

      expect(job.idempotencyKey).toBe(idempotencyKey);
    });

    it('Identical replay', async () => {
      service.queue.enqueue.mockResolvedValueOnce({});

      const first = await service.submit(keyed());
      const second = await service.submit(keyed());

      expect(first.status).toBe(201);
      expect(second.status).toBe(200);
      const job = Job.parse(await first.json());
      expect(Job.parse(await second.json())).toEqual(job);
      expect(await service.total()).toBe(1);
      expect(service.queue.enqueue).toHaveBeenCalledOnce();
    });

    it('Replay spelling out the defaults', async () => {
      const job = await service.submitted({
        type: 'email',
        payload: EMAIL_JOB.payload,
        idempotencyKey: KEY,
      });

      const replay = await service.submit({
        type: 'email',
        payload: { body: 'Hi Ada', subject: 'Hello', to: 'ada@example.com' },
        priority: JOB_LIMITS.priority.default,
        maxAttempts: JOB_LIMITS.maxAttempts.default,
        idempotencyKey: KEY,
      });

      expect(replay.status).toBe(200);
      expect(Job.parse(await replay.json())).toEqual(job);
    });

    it('Replay after a failed attempt', async () => {
      service.queue.enqueue.mockResolvedValueOnce({}).mockResolvedValueOnce({});
      const job = await service.submitted(keyed());
      expect((await service.report({ id: job.id, body: start() })).status).toBe(200);
      const failure = await service.report({ id: job.id, body: fail() });
      expect(failure.status).toBe(200);
      const waiting = Job.parse(await failure.json());

      const replay = await service.submit(keyed());

      expect(replay.status).toBe(200);
      const replayed = Job.parse(await replay.json());
      expect(replayed).toEqual(waiting);
      expect(replayed).toMatchObject({ status: 'scheduled', attempts: 1, error: ERROR });
      expect(Date.parse(replayed.scheduledAt ?? '')).toBeGreaterThan(Date.parse(job.createdAt));
      expect(await service.total()).toBe(1);
      // The submission and the retry were queued; the replay queued nothing.
      expect(service.queue.enqueue).toHaveBeenCalledTimes(2);
    });

    it('Replay of a flight transit after its departure day', async () => {
      const request: CreateJobRequest = {
        type: 'flight-transit',
        payload: { origin: 'LHR', destination: 'JFK', departureDate: service.utcDate(-1) },
        priority: JOB_LIMITS.priority.default,
        maxAttempts: JOB_LIMITS.maxAttempts.default,
        idempotencyKey: KEY,
      };
      const existing = await service.seedKeyed({ request });

      const replay = await service.submit(request);

      expect(replay.status).toBe(200);
      expect(Job.parse(await replay.json())).toEqual(existing);
      expect(await service.total()).toBe(1);
    });

    it('Replay of a scheduled job in another time zone notation', async () => {
      const scheduledAt = fromNow(10 * MINUTE_MS);
      const job = await service.submitted(keyed({ scheduledAt }));

      const replay = await service.submit(keyed({ scheduledAt: withOffset(scheduledAt) }));

      expect(replay.status).toBe(200);
      expect(Job.parse(await replay.json())).toEqual(job);
      expect(await service.total()).toBe(1);
    });

    it.each([
      [
        'Same key, different payload',
        () => ({ payload: { ...EMAIL_JOB.payload, subject: 'Other' } }),
      ],
      ['Same key, different priority', () => ({ priority: EMAIL_JOB.priority + 1 })],
      ['Same key, different group', () => ({ groupId: randomUUID() })],
    ])('%s', async (_name, change) => {
      const first = await service.submitted(keyed());

      const second = await service.submit(keyed(change()));

      await expectConflict(second, first.id);
      expect(await service.total()).toBe(1);
      expect(await service.stored(first.id)).toEqual(first);
    });

    it('Two submissions at the same time', async () => {
      service.queue.enqueue.mockResolvedValueOnce({});

      const responses = await Promise.all([service.submit(keyed()), service.submit(keyed())]);

      expect(responses.map((response) => response.status).sort()).toEqual([200, 201]);
      const [first, second] = await Promise.all(
        responses.map(async (response) => Job.parse(await response.json())),
      );
      expect(first).toEqual(second);
      expect(await service.total()).toBe(1);
      expect(service.queue.enqueue).toHaveBeenCalledOnce();
    });

    it('Key reused after the job was deleted', async () => {
      const first = await service.submitted(keyed());
      await finish(first);
      expect((await service.remove(first.id)).status).toBe(204);

      const second = await service.submitted(keyed());

      expect(second.idempotencyKey).toBe(KEY);
      expect(second.id).not.toBe(first.id);
      expect(await service.total()).toBe(1);
    });

    it('Key taken by a finished job', async () => {
      const first = await service.submitted(keyed());
      await finish(first);

      const replay = await service.submit(keyed());

      expect(replay.status).toBe(200);
      expect(Job.parse(await replay.json())).toMatchObject({ id: first.id, status: 'completed' });
      expect(await service.total()).toBe(1);
    });

    describe('in a bulk', () => {
      const item = (key: string, subject = 'Hello') => ({
        ...EMAIL_JOB,
        payload: { ...EMAIL_JOB.payload, subject },
        idempotencyKey: key,
      });

      it('Bulk items carry their keys', async () => {
        const jobs = await service.submittedBulk([item('k-1'), EMAIL_JOB, item('k-3')]);

        expect(jobs.map((job) => job.idempotencyKey)).toEqual(['k-1', null, 'k-3']);
      });

      it('One item already exists', async () => {
        const existing = await service.submitted(item('k-2'));

        const response = await service.submitBulk({ jobs: [item('k-1'), item('k-2'), EMAIL_JOB] });

        expect(response.status).toBe(201);
        const { items } = CreateJobsBulkResponse.parse(await response.json());
        expect(items).toHaveLength(3);
        expect(items[1]).toEqual(existing);
        expect(items[0]).toMatchObject({ idempotencyKey: 'k-1', status: 'pending' });
        expect(items[2]).toMatchObject({ idempotencyKey: null, status: 'pending' });
        expect(new Set(items.map((job) => job.id)).size).toBe(3);
        expect(await service.total()).toBe(3);
        expect(service.queue.enqueueMany).toHaveBeenCalledExactlyOnceWith({
          entries: [items[0]!, items[2]!].map((job) => ({
            jobId: job.id,
            run: 1,
            attempt: 1,
            priority: job.priority,
            runAt: null,
          })),
        });
      });

      it('Every item already exists', async () => {
        const created = await service.submittedBulk([item('k-1'), item('k-2')]);

        const response = await service.submitBulk({ jobs: [item('k-1'), item('k-2')] });

        expect(response.status).toBe(200);
        expect(CreateJobsBulkResponse.parse(await response.json()).items).toEqual(created);
        expect(await service.total()).toBe(2);
        expect(service.queue.enqueueMany).toHaveBeenCalledOnce();
      });

      it('One item conflicts', async () => {
        const existing = await service.submitted(item('k-2'));

        const response = await service.submitBulk({
          jobs: [item('k-1'), item('k-2', 'Another subject')],
        });

        const body = await service.errorBody({
          response,
          status: 409,
          code: 'IDEMPOTENCY_KEY_CONFLICT',
        });
        expect(body.details).toEqual({ idempotencyKey: 'k-2', existingJobId: existing.id });
        expect(await service.total()).toBe(1);
        expect(service.queue.enqueueMany).not.toHaveBeenCalled();
      });

      it('Bulk item with a bad key', async () => {
        const response = await service.submitBulk({ jobs: [item('k-1'), item('')] });

        expect(await service.issuePaths(response)).toContainEqual(['jobs', 1, 'idempotencyKey']);
        expect(await service.total()).toBe(0);
        expect(service.queue.enqueueMany).not.toHaveBeenCalled();
      });

      it('Duplicate key within the bulk', async () => {
        const response = await service.submitBulk({
          jobs: [item('k-1'), item('k-2'), item('k-1')],
        });

        const paths = await service.issuePaths(response);
        expect(paths).toContainEqual(['jobs', 2, 'idempotencyKey']);
        expect(paths).not.toContainEqual(['jobs', 0, 'idempotencyKey']);
        expect(await service.total()).toBe(0);
        expect(service.queue.enqueueMany).not.toHaveBeenCalled();
      });
    });
  });

  describe('group id', () => {
    const GROUP_ID = randomUUID();

    it('Single job with a group id', async () => {
      const job = await service.submitted({ ...EMAIL_JOB, groupId: GROUP_ID });

      expect(job.groupId).toBe(GROUP_ID);
      expect(Job.parse(await (await service.get(job.id)).json()).groupId).toBe(GROUP_ID);
    });

    it('Bulk items with a group id', async () => {
      const jobs = await service.submittedBulk([
        { ...EMAIL_JOB, groupId: GROUP_ID },
        { ...WEBHOOK_JOB, groupId: GROUP_ID },
      ]);

      expect(jobs.map((job) => job.groupId)).toEqual([GROUP_ID, GROUP_ID]);
    });

    it('Job without a group id', async () => {
      const job = await service.submitted(EMAIL_JOB);

      expect(job.groupId).toBeNull();
    });

    it('Malformed group id', async () => {
      await expectRejected({ ...EMAIL_JOB, groupId: 'campaign-1' }, ['groupId']);
    });
  });

  describe('submit an email job', () => {
    const withPayload = (payload: Record<string, unknown>): unknown => ({
      ...EMAIL_JOB,
      payload: { ...EMAIL_JOB.payload, ...payload },
    });

    it('Invalid email address', async () => {
      await expectRejected(withPayload({ to: 'not-an-email' }), ['payload', 'to']);
    });

    it('Empty subject', async () => {
      await expectRejected(withPayload({ subject: '' }), ['payload', 'subject']);
    });

    it('Email field too long', async () => {
      await expectRejected(withPayload({ body: 'a'.repeat(EMAIL_LIMITS.bodyMaxLength + 1) }), [
        'payload',
        'body',
      ]);
    });
  });

  describe('submit a webhook job', () => {
    const withPayload = (payload: Record<string, unknown>): unknown => ({
      ...WEBHOOK_JOB,
      payload: { ...WEBHOOK_JOB.payload, ...payload },
    });

    const urlOfLength = (length: number): string => {
      const prefix = 'https://hooks.example.com/';
      return prefix + 'a'.repeat(length - prefix.length);
    };

    it('Valid webhook job is accepted', async () => {
      const response = await service.submit(WEBHOOK_JOB);

      expect(response.status).toBe(201);
      expect(Job.parse(await response.json())).toMatchObject({
        type: 'webhook',
        status: 'pending',
        attempts: 0,
        payload: WEBHOOK_JOB.payload,
        result: null,
        error: null,
      });
    });

    it('Webhook job without a body is accepted', async () => {
      const payload = { method: 'GET', url: 'http://example.com/ping' };

      const job = await service.submitted({ type: 'webhook', payload });

      expect(job.payload).toEqual(payload);
    });

    it('Webhook job is read and listed like any job', async () => {
      const email = await service.submitted(EMAIL_JOB);
      const webhook = await service.submitted(WEBHOOK_JOB);

      const read = Job.parse(await (await service.get(webhook.id)).json());
      const page = QueryJobsResponse.parse(await (await fetch(service.url(JOBS_ROUTE))).json());

      expect(read).toEqual(webhook);
      expect(page.items).toEqual([webhook, email]);
    });

    it('Method not allowed', async () => {
      await expectRejected(withPayload({ method: 'DELETE' }), ['payload', 'method']);
    });

    it('URL with another scheme', async () => {
      await expectRejected(withPayload({ url: 'ftp://example.com/hook' }), ['payload', 'url']);
    });

    it('URL missing or not a URL', async () => {
      await expectRejected(withPayload({ url: 'not a url' }), ['payload', 'url']);
    });

    it('URL too long', async () => {
      await expectRejected(withPayload({ url: urlOfLength(WEBHOOK_LIMITS.urlMaxLength + 1) }), [
        'payload',
        'url',
      ]);
    });

    it('Body is not a JSON object', async () => {
      await expectRejected(withPayload({ body: ['a'] }), ['payload', 'body']);
    });
  });

  describe('submit a flight transit job', () => {
    const transitJob = (payload: Record<string, unknown> = {}): Record<string, unknown> => ({
      type: 'flight-transit',
      payload: {
        origin: 'LHR',
        destination: 'JFK',
        departureDate: service.utcDate(1),
        ...payload,
      },
    });

    /** A submission rejected with exactly these issue paths, after which nothing is stored or queued. */
    const expectOnlyIssues = async (body: unknown, paths: unknown[][]): Promise<void> => {
      expect(await service.issuePaths(await service.submit(body))).toEqual(paths);
      expect(await service.total()).toBe(0);
      expect(service.queue.enqueue).not.toHaveBeenCalled();
    };

    it('Valid flight transit job is accepted', async () => {
      const body = transitJob();
      service.queue.enqueue.mockResolvedValueOnce({});

      const response = await service.submit(body);

      expect(response.status).toBe(201);
      const job = Job.parse(await response.json());
      expect(job).toMatchObject({
        type: 'flight-transit',
        status: 'pending',
        attempts: 0,
        priority: JOB_LIMITS.priority.default,
        maxAttempts: JOB_LIMITS.maxAttempts.default,
        payload: body.payload,
        result: null,
        error: null,
      });
      expect(service.queue.enqueue).toHaveBeenCalledExactlyOnceWith({
        jobId: job.id,
        run: 1,
        attempt: 1,
        priority: job.priority,
        runAt: null,
      });
    });

    it('Flight transit job is read and listed like any job', async () => {
      const email = await service.submitted(EMAIL_JOB);
      const webhook = await service.submitted(WEBHOOK_JOB);
      const transit = await service.submitted(transitJob());

      const read = Job.parse(await (await service.get(transit.id)).json());
      const page = QueryJobsResponse.parse(await (await fetch(service.url(JOBS_ROUTE))).json());

      expect(read).toEqual(transit);
      expect(page.items).toEqual([transit, webhook, email]);
    });

    it('Unknown airport code', async () => {
      await expectOnlyIssues(transitJob({ origin: 'XXX' }), [['payload', 'origin']]);
    });

    it('Same airport twice', async () => {
      await expectOnlyIssues(transitJob({ destination: 'LHR' }), [['payload', 'destination']]);
    });

    it('Departure yesterday is rejected', async () => {
      await expectOnlyIssues(transitJob({ departureDate: service.utcDate(-1) }), [
        ['payload', 'departureDate'],
      ]);
    });

    it('Missing payload fields', async () => {
      await expectOnlyIssues({ type: 'flight-transit', payload: {} }, [
        ['payload', 'origin'],
        ['payload', 'destination'],
        ['payload', 'departureDate'],
      ]);
    });

    it('Lower-case airport code', async () => {
      await expectOnlyIssues(transitJob({ destination: 'jfk' }), [['payload', 'destination']]);
    });

    it('Airport code of the wrong form', async () => {
      for (const origin of ['LH', 'LHRX']) {
        await expectOnlyIssues(transitJob({ origin }), [['payload', 'origin']]);
      }
    });

    it('Departure date is not a calendar date', async () => {
      for (const departureDate of ['2026-02-30', '30/10/2026', '2030-06-15T08:00:00.000Z']) {
        await expectOnlyIssues(transitJob({ departureDate }), [['payload', 'departureDate']]);
      }
    });
  });

  describe('get', () => {
    it('Existing job', async () => {
      const job = await service.seed({ status: 'completed' });

      const response = await service.get(job.id);

      expect(response.status).toBe(200);
      expect(Job.parse(await response.json())).toEqual(job);
    });

    it('Unknown job', async () => {
      await expectNotFound(await service.get(UNKNOWN_ID));
    });

    it('Malformed id', async () => {
      expect(await service.issuePaths(await service.get('abc'))).toContainEqual(['id']);
    });
  });

  describe('query', () => {
    const query = async (search = ''): Promise<QueryJobsResponse> => {
      const response = await fetch(service.url(`${JOBS_ROUTE}${search}`));
      expect(response.status).toBe(200);
      return QueryJobsResponse.parse(await response.json());
    };

    const submittedInOrder = async (count: number): Promise<Job[]> => {
      const jobs: Job[] = [];
      for (let i = 0; i < count; i += 1) jobs.push(await service.submitted(EMAIL_JOB));
      return jobs;
    };

    it('Newest first', async () => {
      const jobs = await submittedInOrder(3);

      const page = await query();

      expect(page.items.map((job) => job.id)).toEqual(jobs.map((job) => job.id).reverse());
      expect(page.total).toBe(3);
    });

    it('Paging', async () => {
      const jobs = await submittedInOrder(5);

      const page = await query('?limit=2&offset=1');
      const last = await query('?limit=2&offset=4');
      const past = await query('?limit=2&offset=5');

      expect(page.items.map((job) => job.id)).toEqual([jobs[3]!.id, jobs[2]!.id]);
      expect(page.total).toBe(5);
      expect(last.items.map((job) => job.id)).toEqual([jobs[0]!.id]);
      expect(past).toEqual({ items: [], total: 5 });
    });

    it('Default page size', async () => {
      const jobs = await submittedInOrder(TEST_CONFIG.queryDefaultLimit + 1);

      const page = await query();

      expect(page.items.map((job) => job.id)).toEqual(
        jobs
          .slice(1)
          .map((job) => job.id)
          .reverse(),
      );
      expect(page.total).toBe(TEST_CONFIG.queryDefaultLimit + 1);
    });

    it('Maximum page size is accepted', async () => {
      await submittedInOrder(TEST_CONFIG.queryMaxLimit + 1);

      expect((await query(`?limit=${TEST_CONFIG.queryMaxLimit}`)).items).toHaveLength(
        TEST_CONFIG.queryMaxLimit,
      );
    });

    it('Empty query result', async () => {
      expect(await query()).toEqual({ items: [], total: 0 });
    });

    it('Limit above maximum', async () => {
      const response = await fetch(
        service.url(`${JOBS_ROUTE}?limit=${TEST_CONFIG.queryMaxLimit + 1}`),
      );

      expect(await service.issuePaths(response)).toContainEqual(['limit']);
    });

    it('Negative offset', async () => {
      const response = await fetch(service.url(`${JOBS_ROUTE}?offset=-1`));

      expect(await service.issuePaths(response)).toContainEqual(['offset']);
    });

    describe('filters', () => {
      // Filter semantics (several types, AND, paging and `total` over filtered jobs, no match) are
      // tested against Postgres in `prisma-job-repository.int.test.ts`; these tests prove the HTTP
      // wiring and the HTTP answers the spec names.

      /** Repeated parameters, as a client builds them: `[['status', 'failed'], ...]`. */
      const filtered = (params: [string, string][]): Promise<QueryJobsResponse> =>
        query(`?${new URLSearchParams(params).toString()}`);

      /** Ids in the API's order: creation time descending, id descending for equal times. */
      const newestFirst = (jobs: Job[]): string[] =>
        [...jobs]
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
          .map((job) => job.id);

      /** The fields with an issue in a `VALIDATION_FAILED` answer to the given parameters. */
      const rejectedFields = async (params: [string, string][]): Promise<unknown[]> => {
        const search = new URLSearchParams(params).toString();
        const paths = await service.issuePaths(await fetch(service.url(`${JOBS_ROUTE}?${search}`)));
        return paths.map((path) => (path as unknown[])[0]);
      };

      it('Filter by one status', async () => {
        const failed = [
          await service.seed({ status: 'failed' }),
          await service.seed({ status: 'failed', type: 'webhook' }),
        ];
        await service.seed({ status: 'completed' });
        await service.seed({ status: 'pending' });

        const page = await filtered([['status', 'failed']]);

        expect(page.items.map((job) => job.id)).toEqual(newestFirst(failed));
        expect(page.total).toBe(2);
        expect(service.queue.enqueue).not.toHaveBeenCalled();
      });

      it('Filter by several statuses', async () => {
        const matching = [
          await service.seed({ status: 'failed' }),
          await service.seed({ status: 'cancelled' }),
        ];
        await service.seed({ status: 'completed' });
        await service.seed({ status: 'scheduled' });

        const page = await filtered([
          ['status', 'failed'],
          ['status', 'cancelled'],
        ]);

        expect(page.items.map((job) => job.id)).toEqual(newestFirst(matching));
        expect(page.total).toBe(2);
      });

      it('Repeated status value', async () => {
        await service.seed({ status: 'failed' });
        await service.seed({ status: 'completed' });

        const once = await filtered([['status', 'failed']]);
        const twice = await filtered([
          ['status', 'failed'],
          ['status', 'failed'],
        ]);

        expect(twice).toEqual(once);
        expect(twice.total).toBe(1);
      });

      it('Filter by one type', async () => {
        const webhooks = [
          await service.seed({ status: 'pending', type: 'webhook' }),
          await service.seed({ status: 'completed', type: 'webhook' }),
        ];
        await service.seed({ status: 'pending', type: 'email' });
        await service.seed({ status: 'pending', type: 'flight-transit' });

        const page = await filtered([['type', 'webhook']]);

        expect(page.items.map((job) => job.id)).toEqual(newestFirst(webhooks));
        expect(page.total).toBe(2);
      });

      describe('by group', () => {
        const GROUP_A = randomUUID();
        const GROUP_B = randomUUID();

        it("Only the group's jobs are returned", async () => {
          const groupA = await service.submittedBulk([
            { ...EMAIL_JOB, groupId: GROUP_A },
            { ...WEBHOOK_JOB, groupId: GROUP_A },
          ]);
          await service.submittedBulk([{ ...EMAIL_JOB, groupId: GROUP_B }]);
          await service.submitted(EMAIL_JOB);

          const page = await filtered([['groupId', GROUP_A]]);

          // Whole jobs, so the query route is seen returning `groupId` too.
          expect(page.items).toEqual([...groupA].reverse());
          expect(page.items.map((job) => job.id)).toEqual(newestFirst(groupA));
          expect(page.total).toBe(2);
        });

        it('Group filter combines with status and type', async () => {
          const [, webhook] = await service.submittedBulk([
            { ...EMAIL_JOB, groupId: GROUP_A },
            { ...WEBHOOK_JOB, groupId: GROUP_A },
          ]);
          await service.submittedBulk([{ ...WEBHOOK_JOB, groupId: GROUP_B }]);

          const page = await filtered([
            ['groupId', GROUP_A],
            ['status', 'pending'],
            ['type', 'webhook'],
          ]);

          expect(page).toEqual({ items: [webhook], total: 1 });
        });

        it('Unknown group', async () => {
          await service.submittedBulk([{ ...EMAIL_JOB, groupId: GROUP_A }]);

          expect(await filtered([['groupId', randomUUID()]])).toEqual({ items: [], total: 0 });
        });

        it('Malformed group id filter', async () => {
          expect(await rejectedFields([['groupId', 'campaign-1']])).toEqual(['groupId']);
        });
      });

      it('Unknown status filter', async () => {
        expect(await rejectedFields([['status', 'done']])).toContain('status');
      });

      it('Unknown type filter', async () => {
        expect(await rejectedFields([['type', 'sms']])).toContain('type');
      });

      it('Empty filter value', async () => {
        expect(await rejectedFields([['status', '']])).toContain('status');
      });

      it('One unknown value among known ones', async () => {
        expect(
          await rejectedFields([
            ['status', 'failed'],
            ['status', 'done'],
          ]),
        ).toContain('status');
      });
    });
  });

  describe('status change', () => {
    const CANCEL = { status: 'cancelled' } as const;
    const RETRY = { status: 'pending' } as const;

    /** The job a successful status change answered with. */
    const changed = async (response: Response): Promise<Job> => {
      expect(response.status).toBe(200);
      return Job.parse(await response.json());
    };

    it('Unsupported target status', async () => {
      const job = await service.seed({ status: 'pending' });

      const response = await service.changeStatus({ id: job.id, body: { status: 'completed' } });

      expect(await service.issuePaths(response)).toEqual([['status']]);
      expect(await service.stored(job.id)).toEqual(job);
    });

    it('Missing status', async () => {
      const job = await service.seed({ status: 'failed' });

      const response = await service.changeStatus({ id: job.id, body: {} });

      expect(await service.issuePaths(response)).toEqual([['status']]);
      expect(await service.stored(job.id)).toEqual(job);
    });

    it('Status change for an unknown job', async () => {
      await expectNotFound(await service.changeStatus({ id: UNKNOWN_ID, body: CANCEL }));
      expect(service.queue.cancel).not.toHaveBeenCalled();
    });

    it('Status change with a malformed id', async () => {
      const response = await service.changeStatus({ id: 'abc', body: CANCEL });

      expect(await service.issuePaths(response)).toEqual([['id']]);
    });

    describe('cancel', () => {
      it.each([
        ['Cancel a pending job', 'pending'],
        ['Cancel a scheduled job', 'scheduled'],
        ['Cancel a processing job', 'processing'],
      ] as const)('%s', async (_name, status) => {
        service.queue.cancel.mockResolvedValueOnce({});
        const job = await service.seed({ status, error: ERROR });

        const cancelled = await changed(await service.changeStatus({ id: job.id, body: CANCEL }));

        expect(cancelled).toEqual({
          ...job,
          status: 'cancelled',
          completedAt: expect.any(String) as string,
          updatedAt: cancelled.updatedAt,
        });
        expect(Date.parse(cancelled.completedAt ?? '')).not.toBeNaN();
        expect(await service.stored(job.id)).toEqual(cancelled);
        const later = await service.get(job.id);
        expect(later.status).toBe(200);
        expect(Job.parse(await later.json())).toEqual(cancelled);
        expect(service.queue.cancel).toHaveBeenCalledExactlyOnceWith({ jobId: job.id });
        expect(service.queue.enqueue).not.toHaveBeenCalled();
      });

      it('A cancel still succeeds when the workers cannot be told', async () => {
        service.queue.cancel.mockImplementationOnce(({ jobId }) =>
          Promise.reject(new JobQueueUnavailableError({ cancelledJobId: jobId })),
        );
        const job = await service.seed({ status: 'processing' });

        const cancelled = await changed(await service.changeStatus({ id: job.id, body: CANCEL }));

        expect(cancelled.status).toBe('cancelled');
        expect((await service.stored(job.id)).status).toBe('cancelled');
        expect(service.queue.cancel).toHaveBeenCalledExactlyOnceWith({ jobId: job.id });
      });

      it('Cancel a job waiting for its retry', async () => {
        service.queue.enqueue.mockResolvedValueOnce({}).mockResolvedValueOnce({});
        service.queue.cancel.mockResolvedValueOnce({});
        const job = await service.submitted(EMAIL_JOB);
        expect((await service.report({ id: job.id, body: start() })).status).toBe(200);
        expect((await service.report({ id: job.id, body: fail() })).status).toBe(200);
        expect((await service.stored(job.id)).status).toBe('scheduled');

        const cancelled = await changed(await service.changeStatus({ id: job.id, body: CANCEL }));

        expect(cancelled).toMatchObject({ status: 'cancelled', attempts: 1, error: ERROR });
        expect(cancelled.completedAt).toEqual(expect.any(String));
        expect(await service.stored(job.id)).toEqual(cancelled);
        expect(service.queue.cancel).toHaveBeenCalledExactlyOnceWith({ jobId: job.id });
        // The retry's entry may still fire: its start is refused and nothing changes.
        await service.expectConflict({
          response: await service.report({ id: job.id, body: start({ attempt: 2 }) }),
          status: 'cancelled',
        });
        expect(await service.stored(job.id)).toEqual(cancelled);
      });

      it('Cancel a finished job', async () => {
        const status = 'completed';
        const job = await service.seed({ status });

        const response = await service.changeStatus({ id: job.id, body: CANCEL });

        await service.expectConflict({ response, status });
        expect(await service.stored(job.id)).toEqual(job);
        expect(service.queue.cancel).not.toHaveBeenCalled();
      });

      it('Two cancels at the same time', async () => {
        service.queue.cancel.mockResolvedValueOnce({});
        const job = await service.seed({ status: 'pending' });

        const responses = await Promise.all([
          service.changeStatus({ id: job.id, body: CANCEL }),
          service.changeStatus({ id: job.id, body: CANCEL }),
        ]);

        expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
        await service.expectConflict({
          response: responses.find((response) => response.status === 409)!,
          status: 'cancelled',
        });
        expect((await service.stored(job.id)).status).toBe('cancelled');
        expect(service.queue.cancel).toHaveBeenCalledExactlyOnceWith({ jobId: job.id });
      });

      it('A cancel and a completion report at the same time', async () => {
        service.queue.cancel.mockResolvedValueOnce({});
        const job = await service.seed({ status: 'processing' });
        const result = { messageId: 'm-1' };

        const responses = await Promise.all([
          service.changeStatus({ id: job.id, body: CANCEL }),
          service.report({ id: job.id, body: { status: 'completed', run: 1, attempt: 1, result } }),
        ]);

        expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
        const loser = responses.find((response) => response.status === 409)!;
        await service.errorBody({ response: loser, status: 409, code: 'JOB_STATUS_CONFLICT' });
        const stored = await service.stored(job.id);
        if (stored.status === 'cancelled') {
          expect(stored.result).toBeNull();
          expect(service.queue.cancel).toHaveBeenCalledExactlyOnceWith({ jobId: job.id });
        } else {
          expect(stored).toMatchObject({ status: 'completed', result });
          expect(service.queue.cancel).not.toHaveBeenCalled();
        }
      });
    });

    describe('retry', () => {
      it('Retry a failed job', async () => {
        service.queue.enqueue.mockResolvedValueOnce({}).mockResolvedValueOnce({});
        // A keyed job with an execution time, whose only attempt failed: the time stays on it.
        const request = {
          ...EMAIL_JOB,
          maxAttempts: 1,
          scheduledAt: fromNow(10 * MINUTE_MS),
          idempotencyKey: 'order-4711',
        };
        const submitted = await service.submitted(request);
        expect((await service.report({ id: submitted.id, body: start() })).status).toBe(200);
        expect((await service.report({ id: submitted.id, body: fail() })).status).toBe(200);
        const job = await service.stored(submitted.id);
        expect(job).toMatchObject({ status: 'failed', error: ERROR });
        expect(job.scheduledAt).not.toBeNull();

        const retried = await changed(await service.changeStatus({ id: job.id, body: RETRY }));

        expect(retried).toEqual({
          ...job,
          status: 'pending',
          attempts: 0,
          error: null,
          result: null,
          scheduledAt: null,
          startedAt: null,
          completedAt: null,
          updatedAt: retried.updatedAt,
        });
        expect(retried.idempotencyKey).toBe('order-4711');
        expect(await service.stored(job.id)).toEqual(retried);
        expect(service.queue.cancel).not.toHaveBeenCalled();
        // The original submission still finds the job, now retried.
        const replay = await service.submit(request);
        expect(replay.status).toBe(200);
        expect(Job.parse(await replay.json())).toEqual(retried);
        expect(await service.total()).toBe(1);
      });

      it('Retried job is queued', async () => {
        service.queue.enqueue.mockResolvedValueOnce({});
        const job = await service.seed({ status: 'failed', attempts: 3, maxAttempts: 3 });

        await changed(await service.changeStatus({ id: job.id, body: RETRY }));

        expect(service.queue.enqueue).toHaveBeenCalledExactlyOnceWith({
          jobId: job.id,
          run: 2,
          attempt: 1,
          priority: job.priority,
          runAt: null,
        });
      });

      it('A retried job starts again from its first attempt', async () => {
        service.queue.enqueue.mockResolvedValueOnce({});
        const job = await service.seed({ status: 'failed', attempts: 3, maxAttempts: 3 });
        await changed(await service.changeStatus({ id: job.id, body: RETRY }));

        // The retry started the job's second run.
        const response = await service.report({ id: job.id, body: start({ run: 2 }) });

        expect(response.status).toBe(200);
        expect(Job.parse(await response.json())).toMatchObject({
          status: 'processing',
          attempts: 1,
        });
      });

      it('A job retried twice is queued in a new run each time', async () => {
        const job = await service.seed({ status: 'failed', attempts: 1, maxAttempts: 1 });
        for (let run = 2; run <= 3; run += 1) {
          service.queue.enqueue.mockResolvedValueOnce({});
          await changed(await service.changeStatus({ id: job.id, body: RETRY }));
          expect((await service.report({ id: job.id, body: start({ run }) })).status).toBe(200);
          expect((await service.report({ id: job.id, body: fail({ run }) })).status).toBe(200);
        }

        expect(service.queue.enqueue.mock.calls.map(([entry]) => entry)).toEqual([
          { jobId: job.id, run: 2, attempt: 1, priority: job.priority, runAt: null },
          { jobId: job.id, run: 3, attempt: 1, priority: job.priority, runAt: null },
        ]);
      });

      it('Manual retry survives an unavailable queue', async () => {
        service.queue.enqueue.mockImplementationOnce(({ jobId, run, attempt }) =>
          Promise.reject(new JobQueueUnavailableError({ jobId, run, attempt })),
        );
        const job = await service.seed({ status: 'failed', attempts: 3, maxAttempts: 3 });

        const retried = await changed(await service.changeStatus({ id: job.id, body: RETRY }));

        expect(retried.status).toBe('pending');
        expect((await service.stored(job.id)).status).toBe('pending');
        expect(service.queue.enqueue).toHaveBeenCalledExactlyOnceWith({
          jobId: job.id,
          run: 2,
          attempt: 1,
          priority: job.priority,
          runAt: null,
        });
      });

      it('Retry a job that has not failed', async () => {
        const status = 'cancelled';
        const job = await service.seed({ status });

        const response = await service.changeStatus({ id: job.id, body: RETRY });

        await service.expectConflict({ response, status });
        expect(await service.stored(job.id)).toEqual(job);
        expect(service.queue.enqueue).not.toHaveBeenCalled();
      });

      it('Two retries at the same time', async () => {
        service.queue.enqueue.mockResolvedValueOnce({});
        const job = await service.seed({ status: 'failed', attempts: 3, maxAttempts: 3 });

        const responses = await Promise.all([
          service.changeStatus({ id: job.id, body: RETRY }),
          service.changeStatus({ id: job.id, body: RETRY }),
        ]);

        expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
        await service.expectConflict({
          response: responses.find((response) => response.status === 409)!,
          status: 'pending',
        });
        expect(service.queue.enqueue).toHaveBeenCalledExactlyOnceWith({
          jobId: job.id,
          run: 2,
          attempt: 1,
          priority: job.priority,
          runAt: null,
        });
        expect(await service.stored(job.id)).toMatchObject({ status: 'pending', attempts: 0 });
      });
    });
  });

  describe('delete', () => {
    it('Delete a finished job', async () => {
      const status = 'completed';
      const job = await service.seed({ status });

      const response = await service.remove(job.id);

      expect(response.status).toBe(204);
      expect(await response.text()).toBe('');
      await expectNotFound(await service.get(job.id));
      await expectNotFound(await service.remove(job.id));
    });

    it('Delete a finished webhook job', async () => {
      const job = await service.seed({ status: 'completed', type: 'webhook' });

      expect((await service.remove(job.id)).status).toBe(204);
      await expectNotFound(await service.get(job.id));
    });

    it('Delete a job that has not finished', async () => {
      const status = 'pending';
      const job = await service.seed({ status });

      await service.expectConflict({ response: await service.remove(job.id), status });
      expect(await service.stored(job.id)).toEqual(job);
    });

    it('Two clients delete the same job', async () => {
      const job = await service.seed({ status: 'completed' });

      const responses = await Promise.all([service.remove(job.id), service.remove(job.id)]);

      expect(responses.map((response) => response.status).sort()).toEqual([204, 404]);
      await expectNotFound(responses.find((response) => response.status === 404)!);
    });

    it('Delete an unknown job', async () => {
      await expectNotFound(await service.remove(UNKNOWN_ID));
    });

    it('Delete with a malformed id', async () => {
      expect(await service.issuePaths(await service.remove('abc'))).toContainEqual(['id']);
    });
  });
});
