import { JOB_LOG_STREAM_NAME } from '@job-queue/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { JobLogStreamDestinationFactory } from './job-log-stream-destination.factory.js';

const client = vi.hoisted(() => ({ on: vi.fn(), xadd: vi.fn() }));
const Redis = vi.hoisted(() => vi.fn());

vi.mock('ioredis', () => ({ Redis }));

describe('JobLogStreamDestinationFactory', () => {
  const redisUrl = 'redis://localhost:6379';

  beforeEach(() => {
    vi.resetAllMocks();
    Redis.mockImplementationOnce(function () {
      return client;
    });
  });

  it('builds a destination on its own named connection without an offline queue', () => {
    new JobLogStreamDestinationFactory().create({
      redisUrl,
      source: 'job-service',
      connectionName: 'a-service-job-log',
      maxLength: 10,
    });

    expect(Redis).toHaveBeenCalledExactlyOnceWith(redisUrl, {
      connectionName: 'a-service-job-log',
      enableOfflineQueue: false,
      maxRetriesPerRequest: 0,
    });
  });

  it('the destination appends job lines with the given source and trim length', () => {
    client.xadd.mockResolvedValueOnce('1-0');
    const { destination } = new JobLogStreamDestinationFactory().create({
      redisUrl,
      source: 'job-execution-service',
      connectionName: 'a-service-job-log',
      maxLength: 10,
    });

    destination.write(
      JSON.stringify({
        level: 30,
        time: 5,
        msg: 'hello',
        jobId: '0b7d6f2e-6c0e-4c5e-9d3a-111111111111',
      }) + '\n',
    );

    expect(client.xadd).toHaveBeenCalledExactlyOnceWith(
      JOB_LOG_STREAM_NAME,
      'MAXLEN',
      '~',
      10,
      '*',
      'data',
      expect.stringContaining('"source":"job-execution-service"'),
    );
  });
});
