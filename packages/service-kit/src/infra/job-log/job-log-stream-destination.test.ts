import { randomUUID } from 'node:crypto';

import { JOB_LOG_STREAM_NAME } from '@job-queue/contracts';
import type { Clock, Random } from '@job-queue/kernel';
import { beforeEach, describe, expect, it } from 'vitest';
import { mockDeep, type DeepMockProxy } from 'vitest-mock-extended';

import type { LogDestination } from '../../domain/logging/log-destination.js';
import type { JobLogStreamRedis } from '../../domain/job-log/job-log-stream-redis.js';
import { JobLogStreamDestination } from './job-log-stream-destination.js';

const ENTRY_ID = randomUUID();
const JOB_ID = randomUUID();
const MAX_LENGTH = 500;
const TIME = 1_700_000_000_123;

interface Fixture {
  redis: DeepMockProxy<JobLogStreamRedis>;
  random: DeepMockProxy<Random>;
  clock: DeepMockProxy<Clock>;
  mainLog: DeepMockProxy<LogDestination>;
  destination: JobLogStreamDestination;
  line(fields: Record<string, unknown>): string;
  flush(): Promise<void>;
}

describe('JobLogStreamDestination', () => {
  let f: Fixture;

  beforeEach(() => {
    const redis = mockDeep<JobLogStreamRedis>();
    const random = mockDeep<Random>();
    const clock = mockDeep<Clock>();
    const mainLog = mockDeep<LogDestination>();
    f = {
      redis,
      random,
      clock,
      mainLog,
      destination: new JobLogStreamDestination(
        {
          redis,
          random,
          clock,
          mainLog,
        },
        { source: 'job-execution-service', maxLength: MAX_LENGTH },
      ),
      line: (fields) => JSON.stringify({ time: TIME, pid: 1, hostname: 'h', ...fields }),
      flush: async () => {
        await new Promise((resolve) => setImmediate(resolve));
      },
    };
  });

  it('Log line becomes an entry', () => {
    f.random.uuid.mockReturnValueOnce({ value: ENTRY_ID });
    f.redis.append.mockResolvedValueOnce({});

    f.destination.write(
      f.line({
        level: 40,
        msg: 'Attempt failed',
        jobId: JOB_ID,
        attempt: 2,
        instanceId: 'worker-1',
        code: 'HANDLER_FAILED',
      }),
    );

    expect(f.redis.append).toHaveBeenCalledExactlyOnceWith({
      stream: JOB_LOG_STREAM_NAME,
      maxLength: MAX_LENGTH,
      data: JSON.stringify({
        id: ENTRY_ID,
        jobId: JOB_ID,
        attempt: 2,
        level: 'warning',
        message: 'Attempt failed',
        metadata: { code: 'HANDLER_FAILED' },
        ts: TIME,
        source: 'job-execution-service',
        instanceId: 'worker-1',
      }),
    });
  });

  it.each([
    [30, 'info'],
    [40, 'warning'],
    [50, 'error'],
    [60, 'error'],
  ])('maps pino level %i to %s', (pinoLevel, level) => {
    f.random.uuid.mockReturnValueOnce({ value: ENTRY_ID });
    f.redis.append.mockResolvedValueOnce({});

    f.destination.write(f.line({ level: pinoLevel, msg: 'm', jobId: JOB_ID }));

    const [call] = f.redis.append.mock.calls;
    expect(JSON.parse(call?.[0].data ?? '{}')).toEqual(expect.objectContaining({ level }));
  });

  it('Debug line is not an entry', () => {
    f.destination.write(f.line({ level: 20, msg: 'detail', jobId: JOB_ID }));

    expect(f.redis.append).not.toHaveBeenCalled();
  });

  it('ignores a line without a job id', () => {
    f.destination.write(f.line({ level: 30, msg: 'Server started' }));

    expect(f.redis.append).not.toHaveBeenCalled();
  });

  it('ignores a line whose job id is not a UUID', () => {
    f.random.uuid.mockReturnValueOnce({ value: ENTRY_ID });

    f.destination.write(f.line({ level: 30, msg: 'm', jobId: 'job-1' }));

    expect(f.redis.append).not.toHaveBeenCalled();
    expect(f.mainLog.write).not.toHaveBeenCalled();
  });

  it('ignores a line that is not JSON', () => {
    expect(() => {
      f.destination.write('not json');
    }).not.toThrow();

    expect(f.redis.append).not.toHaveBeenCalled();
    expect(f.mainLog.write).not.toHaveBeenCalled();
  });

  it('ignores a JSON null line', () => {
    expect(() => {
      f.destination.write('null');
    }).not.toThrow();

    expect(f.redis.append).not.toHaveBeenCalled();
  });

  it('gives an entry without a message an empty message', () => {
    f.random.uuid.mockReturnValueOnce({ value: ENTRY_ID });
    f.redis.append.mockResolvedValueOnce({});

    f.destination.write(f.line({ level: 30, jobId: JOB_ID }));

    const [call] = f.redis.append.mock.calls;
    expect(JSON.parse(call?.[0].data ?? '{}')).toEqual(expect.objectContaining({ message: '' }));
  });

  it('passes an err that is a string through unchanged', () => {
    f.random.uuid.mockReturnValueOnce({ value: ENTRY_ID });
    f.redis.append.mockResolvedValueOnce({});

    f.destination.write(f.line({ level: 50, msg: 'm', jobId: JOB_ID, err: 'plain failure' }));

    const [call] = f.redis.append.mock.calls;
    expect(JSON.parse(call?.[0].data ?? '{}')).toEqual(
      expect.objectContaining({ metadata: { err: 'plain failure' } }),
    );
  });

  it('Secrets and stacks stay out of the entry', () => {
    f.random.uuid.mockReturnValueOnce({ value: ENTRY_ID });
    f.redis.append.mockResolvedValueOnce({});

    f.destination.write(
      f.line({
        level: 50,
        msg: 'Request failed',
        jobId: JOB_ID,
        req: { headers: { authorization: '[Redacted]' } },
        err: { type: 'Error', message: 'boom', stack: 'Error: boom\n    at secret.ts:1' },
      }),
    );

    const [call] = f.redis.append.mock.calls;
    const entry = JSON.parse(call?.[0].data ?? '{}') as { metadata: Record<string, unknown> };
    expect(entry.metadata).toEqual({
      req: { headers: { authorization: '[Redacted]' } },
      err: { type: 'Error', message: 'boom' },
    });
    expect(call?.[0].data).not.toContain('secret.ts');
  });

  it('Entry cannot be sent', async () => {
    f.random.uuid.mockReturnValueOnce({ value: ENTRY_ID });
    f.redis.append.mockRejectedValueOnce(new Error('Stream is not writeable'));
    f.clock.now.mockReturnValueOnce({ now: new Date(TIME) });

    expect(() => {
      f.destination.write(f.line({ level: 30, msg: 'm', jobId: JOB_ID }));
    }).not.toThrow();
    await f.flush();

    expect(f.mainLog.write).toHaveBeenCalledExactlyOnceWith(
      JSON.stringify({
        level: 40,
        time: TIME,
        msg: 'Job log entry dropped',
        droppedJobLogEntry: true,
        jobId: JOB_ID,
        reason: 'Stream is not writeable',
      }) + '\n',
    );
    expect(f.redis.append).toHaveBeenCalledTimes(1);
  });

  it('reports the string form of a rejection that is not an Error', async () => {
    f.random.uuid.mockReturnValueOnce({ value: ENTRY_ID });
    f.redis.append.mockRejectedValueOnce('connection refused');
    f.clock.now.mockReturnValueOnce({ now: new Date(TIME) });

    f.destination.write(f.line({ level: 30, msg: 'm', jobId: JOB_ID }));
    await f.flush();

    expect(f.mainLog.write).toHaveBeenCalledExactlyOnceWith(
      expect.stringContaining('"reason":"connection refused"') as unknown,
    );
  });

  it('does not make an entry of a dropped-entry warning', () => {
    f.destination.write(
      f.line({ level: 40, msg: 'Job log entry dropped', jobId: JOB_ID, droppedJobLogEntry: true }),
    );

    expect(f.redis.append).not.toHaveBeenCalled();
  });

  it('closes its Redis connection', async () => {
    f.redis.close.mockResolvedValueOnce({});

    await f.destination.close();

    expect(f.redis.close).toHaveBeenCalledOnce();
  });

  it('opens its Redis connection', async () => {
    f.redis.open.mockResolvedValueOnce({});

    await expect(f.destination.open()).resolves.toEqual({});

    expect(f.redis.open).toHaveBeenCalledOnce();
  });
});
