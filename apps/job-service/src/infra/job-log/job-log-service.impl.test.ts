import { randomUUID } from 'node:crypto';

import { JobLogCursor, type JobLogStreamMessage } from '@job-queue/contracts';
import { JobNotFoundError, QueryLimitExceededError, type PageLimit } from '@job-queue/kernel';
import { beforeEach, describe, expect, it } from 'vitest';
import { mockDeep, type DeepMockProxy } from 'vitest-mock-extended';

import { LogStoreUnavailableError } from '../../domain/job-log/errors/log-store-unavailable.error.js';
import type { JobLogStore, PositionedJobLogEntry } from '../../domain/job-log/job-log-store.js';
import type { JobRepository } from '../../domain/jobs/job-repository.js';
import { JobLogServiceImpl } from './job-log-service.impl.js';

const JOB_ID = randomUUID();
const PAGE_SIZE = 7;
const TS = Date.parse('2026-10-29T12:00:00.123Z');

describe('JobLogServiceImpl', () => {
  let repository: DeepMockProxy<JobRepository>;
  let store: DeepMockProxy<JobLogStore>;
  let pageLimit: DeepMockProxy<PageLimit>;
  let service: JobLogServiceImpl;

  const positioned = (
    position: string,
    over: Partial<JobLogStreamMessage> = {},
  ): PositionedJobLogEntry => ({
    position,
    entry: {
      id: randomUUID(),
      jobId: JOB_ID,
      level: 'info',
      message: 'step',
      metadata: { a: 1 },
      ts: TS,
      source: 'job-service',
      ...over,
    },
  });

  beforeEach(() => {
    repository = mockDeep<JobRepository>();
    store = mockDeep<JobLogStore>();
    pageLimit = mockDeep<PageLimit>();
    service = new JobLogServiceImpl({ repository, store, pageLimit });
  });

  it('fails for an unknown job without querying the store', async () => {
    pageLimit.resolve.mockReturnValueOnce({ limit: PAGE_SIZE });
    repository.get.mockRejectedValueOnce(new JobNotFoundError({ id: JOB_ID }));

    await expect(service.query({ jobId: JOB_ID })).rejects.toBeInstanceOf(JobNotFoundError);

    expect(repository.get).toHaveBeenCalledExactlyOnceWith({ id: JOB_ID });
    expect(store.query).not.toHaveBeenCalled();
  });

  it('does not query the store when the limit is above the maximum', async () => {
    pageLimit.resolve.mockImplementationOnce(() => {
      throw new QueryLimitExceededError({ maxLimit: 10 });
    });

    await expect(service.query({ jobId: JOB_ID, limit: 11 })).rejects.toBeInstanceOf(
      QueryLimitExceededError,
    );

    expect(pageLimit.resolve).toHaveBeenCalledExactlyOnceWith({ limit: 11 });
    expect(store.query).not.toHaveBeenCalled();
  });

  it('uses the resolved page size and passes after and levels to the store', async () => {
    repository.get.mockResolvedValueOnce({ job: {} as never, run: 1, requestFingerprint: null });
    pageLimit.resolve.mockReturnValueOnce({ limit: PAGE_SIZE });
    store.query.mockResolvedValueOnce({ entries: [] });

    await service.query({ jobId: JOB_ID, after: '5-1', levels: ['error'] });

    expect(pageLimit.resolve).toHaveBeenCalledExactlyOnceWith({ limit: undefined });
    expect(store.query).toHaveBeenCalledExactlyOnceWith({
      jobId: JOB_ID,
      after: '5-1',
      levels: ['error'],
      limit: PAGE_SIZE,
    });
  });

  it('maps entries and takes the cursor from the last one', async () => {
    repository.get.mockResolvedValueOnce({ job: {} as never, run: 1, requestFingerprint: null });
    pageLimit.resolve.mockReturnValueOnce({ limit: PAGE_SIZE });
    const first = positioned('10-0');
    const last = positioned('11-2', {
      attempt: 2,
      source: 'job-execution-service',
      instanceId: 'worker-1',
    });
    store.query.mockResolvedValueOnce({ entries: [first, last] });

    const result = await service.query({ jobId: JOB_ID });

    expect(result.nextCursor).toBe(JobLogCursor.encode('11-2'));
    expect(result.items).toEqual([
      {
        id: first.entry.id,
        jobId: JOB_ID,
        attempt: null,
        level: 'info',
        message: 'step',
        metadata: { a: 1 },
        timestamp: '2026-10-29T12:00:00.123Z',
        source: 'job-service',
        instanceId: null,
      },
      expect.objectContaining({
        id: last.entry.id,
        attempt: 2,
        source: 'job-execution-service',
        instanceId: 'worker-1',
      }),
    ]);
  });

  it('returns the given after as the cursor when nothing is returned', async () => {
    repository.get.mockResolvedValueOnce({ job: {} as never, run: 1, requestFingerprint: null });
    pageLimit.resolve.mockReturnValueOnce({ limit: PAGE_SIZE });
    store.query.mockResolvedValueOnce({ entries: [] });

    const result = await service.query({ jobId: JOB_ID, after: '5-1' });

    expect(result).toEqual({ items: [], nextCursor: JobLogCursor.encode('5-1') });
  });

  it('returns a null cursor when nothing is returned and no after was given', async () => {
    repository.get.mockResolvedValueOnce({ job: {} as never, run: 1, requestFingerprint: null });
    pageLimit.resolve.mockReturnValueOnce({ limit: PAGE_SIZE });
    store.query.mockResolvedValueOnce({ entries: [] });

    expect(await service.query({ jobId: JOB_ID })).toEqual({ items: [], nextCursor: null });
  });

  it('passes a store outage on', async () => {
    repository.get.mockResolvedValueOnce({ job: {} as never, run: 1, requestFingerprint: null });
    pageLimit.resolve.mockReturnValueOnce({ limit: PAGE_SIZE });
    store.query.mockRejectedValueOnce(new LogStoreUnavailableError({ operation: 'query' }));

    await expect(service.query({ jobId: JOB_ID })).rejects.toBeInstanceOf(LogStoreUnavailableError);
  });
});
