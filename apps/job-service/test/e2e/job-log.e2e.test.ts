import { randomUUID } from 'node:crypto';

import {
  JobLogCursor,
  QueryJobLogResponse,
  type JobLogLevel,
  type JobLogStreamMessage,
} from '@job-queue/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { LogStoreUnavailableError } from '../../src/domain/job-log/errors/log-store-unavailable.error.js';
import { JOB_LOG_STORE, type JobLogStore } from '../../src/domain/job-log/job-log-store.js';
import { JobServiceUnderTest, TEST_CONFIG } from './job-service-under-test.js';

const UNKNOWN_ID = randomUUID();
// Recent, so the configured retention (applied on read, by ClickHouse's clock) never hides them.
const BASE_MS = Date.now() - 60_000;

describe('job-service job log route', () => {
  let service: JobServiceUnderTest;
  let jobId: string;

  /** Entry `n` of the job: position `<BASE_MS + n>-0`, so the order is the order of `n`. */
  const entry = (n: number, over: Partial<JobLogStreamMessage> = {}) => ({
    position: `${BASE_MS + n}-0`,
    entry: {
      id: randomUUID(),
      jobId,
      level: 'info' as JobLogLevel,
      message: `entry ${n}`,
      metadata: {},
      ts: BASE_MS + n,
      source: 'job-service' as const,
      ...over,
    },
  });

  const seedEntries = async (count: number): Promise<void> => {
    await service.seedLog(Array.from({ length: count }, (_, index) => entry(index)));
  };

  const page = async (params: [string, string][] = []): Promise<QueryJobLogResponse> => {
    const response = await service.jobLog({ id: jobId, params });
    expect(response.status).toBe(200);
    return QueryJobLogResponse.parse(await response.json());
  };

  const messages = (result: QueryJobLogResponse): string[] =>
    result.items.map((item) => item.message);

  beforeAll(async () => {
    service = await JobServiceUnderTest.start({ realJobLogStore: true });
  }, 240_000);
  beforeEach(async () => {
    await service.clear();
    jobId = (await service.seed({ status: 'completed' })).id;
  });
  afterAll(async () => {
    await service.close();
  });

  describe('reading', () => {
    it("Read a job's log", async () => {
      await seedEntries(6);

      const result = await page();

      expect(messages(result)).toEqual(['entry 0', 'entry 1', 'entry 2', 'entry 3']);
      expect(result.items).toHaveLength(TEST_CONFIG.jobLogQueryDefaultLimit);
      expect(result.nextCursor).toBe(JobLogCursor.encode(`${BASE_MS + 3}-0`));
    });

    it('Read only newer entries', async () => {
      await seedEntries(2);
      const first = await page();
      await service.seedLog([entry(2), entry(3)]);

      const second = await page([['after', first.nextCursor ?? '']]);

      expect(messages(second)).toEqual(['entry 2', 'entry 3']);
    });

    it('Nothing new', async () => {
      await seedEntries(2);
      const first = await page();

      const second = await page([['after', first.nextCursor ?? '']]);

      expect(second).toEqual({ items: [], nextCursor: first.nextCursor });
    });

    it('Job with no entries yet', async () => {
      expect(await page()).toEqual({ items: [], nextCursor: null });
    });

    it('Paging with limit', async () => {
      await seedEntries(5);
      const seen: string[] = [];
      let cursor: string | null = null;

      for (let guard = 0; guard < 10; guard++) {
        const params: [string, string][] = [['limit', '2']];
        if (cursor !== null) params.push(['after', cursor]);
        const result = await page(params);
        expect(result.items.length).toBeLessThanOrEqual(2);
        if (result.items.length === 0) break;
        seen.push(...messages(result));
        cursor = result.nextCursor;
      }

      expect(seen).toEqual(['entry 0', 'entry 1', 'entry 2', 'entry 3', 'entry 4']);
    });

    it('Entry fields', async () => {
      const job = entry(0);
      const worker = entry(1, {
        attempt: 2,
        level: 'warning',
        metadata: { code: 'E', nested: { a: [1] } },
        source: 'job-execution-service',
        instanceId: 'worker-1',
      });
      await service.seedLog([job, worker]);

      const { items } = await page();

      expect(items).toEqual([
        {
          id: job.entry.id,
          jobId,
          attempt: null,
          level: 'info',
          message: 'entry 0',
          metadata: {},
          timestamp: new Date(BASE_MS).toISOString(),
          source: 'job-service',
          instanceId: null,
        },
        {
          id: worker.entry.id,
          jobId,
          attempt: 2,
          level: 'warning',
          message: 'entry 1',
          metadata: { code: 'E', nested: { a: [1] } },
          timestamp: new Date(BASE_MS + 1).toISOString(),
          source: 'job-execution-service',
          instanceId: 'worker-1',
        },
      ]);
    });
  });

  describe('filtering', () => {
    beforeEach(async () => {
      await service.seedLog([
        entry(0, { level: 'info' }),
        entry(1, { level: 'warning' }),
        entry(2, { level: 'error' }),
      ]);
    });

    it('Only error entries', async () => {
      expect(messages(await page([['level', 'error']]))).toEqual(['entry 2']);
    });

    it('Two levels', async () => {
      const result = await page([
        ['level', 'warning'],
        ['level', 'error'],
      ]);

      expect(messages(result)).toEqual(['entry 1', 'entry 2']);
    });
  });

  describe('invalid queries', () => {
    it('Id is not a UUID', async () => {
      const response = await service.jobLog({ id: 'not-a-uuid' });

      expect(await service.issuePaths(response)).toContainEqual(['id']);
    });

    it('Limit above the maximum', async () => {
      const response = await service.jobLog({
        id: jobId,
        params: [['limit', String(TEST_CONFIG.jobLogQueryMaxLimit + 1)]],
      });

      expect(await service.issuePaths(response)).toContainEqual(['limit']);
    });

    it('accepts a limit equal to the configured maximum', async () => {
      await seedEntries(TEST_CONFIG.jobLogQueryMaxLimit + 2);

      const result = await page([['limit', String(TEST_CONFIG.jobLogQueryMaxLimit)]]);

      expect(result.items).toHaveLength(TEST_CONFIG.jobLogQueryMaxLimit);
    });

    it('Unknown level', async () => {
      const response = await service.jobLog({ id: jobId, params: [['level', 'debug']] });

      expect((await service.issuePaths(response)).flat()).toContain('level');
    });

    it.each(['not a cursor!'])('Malformed cursor: %s', async (after) => {
      const response = await service.jobLog({ id: jobId, params: [['after', after]] });

      expect(await service.issuePaths(response)).toContainEqual(['after']);
    });
  });

  describe('missing jobs', () => {
    it('Unknown job', async () => {
      const response = await service.jobLog({ id: UNKNOWN_ID });

      await service.errorBody({ response, status: 404, code: 'JOB_NOT_FOUND' });
    });

    it('Deleted job', async () => {
      await seedEntries(2);
      expect((await service.remove(jobId)).status).toBe(204);

      const response = await service.jobLog({ id: jobId });

      await service.errorBody({ response, status: 404, code: 'JOB_NOT_FOUND' });
    });
  });

  describe('log store outage', () => {
    it('Log store down on read', async () => {
      const spy = vi
        .spyOn(service.app.get<JobLogStore>(JOB_LOG_STORE), 'query')
        .mockRejectedValueOnce(new LogStoreUnavailableError({ operation: 'query' }));

      try {
        const response = await service.jobLog({ id: jobId });

        await service.errorBody({ response, status: 503, code: 'LOG_STORE_UNAVAILABLE' });
        expect((await service.get(jobId)).status).toBe(200);
      } finally {
        spy.mockRestore();
      }
    });
  });
});
