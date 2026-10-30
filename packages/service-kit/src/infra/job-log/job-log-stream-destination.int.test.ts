import { randomUUID } from 'node:crypto';

import { JOB_LOG_STREAM_NAME, JobLogStreamMessage } from '@job-queue/contracts';
import { SystemClock, SystemRandom } from '@job-queue/kernel';
import { CONTAINER_IMAGES } from '@job-queue/test-support';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import { Redis } from 'ioredis';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { IoRedisJobLogStreamRedis } from './ioredis-job-log-stream-redis.js';
import { JobLogStreamDestination } from './job-log-stream-destination.js';

const POLL = { timeout: 30_000, interval: 100 };
const OPEN_TIMEOUT_MS = 20_000;
const NODE_MAX_ENTRIES = 10;

interface Built {
  destination: JobLogStreamDestination;
  connectionName: string;
}

/**
 * The producer against a real Redis. The destination is built on the ioredis adapter, so this file
 * covers that adapter as well.
 */
describe('JobLogStreamDestination against Redis', () => {
  let container: StartedRedisContainer;
  let reader: Redis;
  let built: Built[] = [];
  const mainLines: string[] = [];

  const build = (maxLength: number, redisUrl = container.getConnectionUrl()): Built => {
    const connectionName = `job-log-int-${randomUUID()}`;
    const destination = new JobLogStreamDestination(
      {
        redis: new IoRedisJobLogStreamRedis({
          redisUrl,
          connectionName,
          openTimeoutMs: OPEN_TIMEOUT_MS,
        }),
        random: new SystemRandom(),
        clock: new SystemClock(),
        mainLog: {
          write: (line: string) => {
            mainLines.push(line);
          },
        },
      },
      { source: 'job-service', maxLength },
    );
    const result = { destination, connectionName };
    built.push(result);
    return result;
  };

  const lineOf = (jobId: string, msg: string): string =>
    JSON.stringify({ level: 30, time: Date.now(), msg, jobId });

  /** The ids of the connections registered under a name in `CLIENT LIST`. */
  const connectionIds = async (name: string): Promise<string[]> => {
    const list = String(await reader.client('LIST'));
    return list
      .split('\n')
      .filter((entry) => entry.includes(` name=${name} `))
      .map((entry) => /(?:^| )id=(\d+)/.exec(entry)?.[1] ?? '');
  };

  const entries = async (): Promise<JobLogStreamMessage[]> => {
    const raw = await reader.xrange(JOB_LOG_STREAM_NAME, '-', '+');
    return raw.map(([, fields]) => {
      expect(fields[0]).toBe('data');
      return JobLogStreamMessage.parse(JSON.parse(fields[1] ?? '{}'));
    });
  };

  beforeAll(async () => {
    container = await new RedisContainer(CONTAINER_IMAGES.redis).start();
    reader = new Redis(container.getConnectionUrl());
    await reader.config('SET', 'stream-node-max-entries', String(NODE_MAX_ENTRIES));
  });
  afterEach(async () => {
    await Promise.all(built.map((b) => b.destination.close()));
    built = [];
    mainLines.length = 0;
    await reader.del(JOB_LOG_STREAM_NAME);
  });
  afterAll(async () => {
    reader.disconnect();
    await container.stop();
  });

  it('appends written lines to the stream in order as validated entries', async () => {
    const jobId = randomUUID();
    const { destination } = build(1000);
    await destination.open();

    destination.write(lineOf(jobId, 'first'));
    destination.write(lineOf(jobId, 'second'));
    destination.write(lineOf(jobId, 'third'));

    await expect
      .poll(async () => (await entries()).map((entry) => entry.message), POLL)
      .toEqual(['first', 'second', 'third']);
    expect(await entries()).toEqual([
      expect.objectContaining({ jobId, source: 'job-service', level: 'info' }),
      expect.objectContaining({ jobId }),
      expect.objectContaining({ jobId }),
    ]);
  });

  it('keeps the stream near the configured maximum length', async () => {
    const jobId = randomUUID();
    const maxLength = 10;
    const { destination } = build(maxLength);
    await destination.open();

    for (let i = 0; i < 400; i += 1) destination.write(lineOf(jobId, `line ${i}`));
    destination.write(lineOf(jobId, 'sentinel'));

    await expect.poll(async () => (await entries()).at(-1)?.message, POLL).toBe('sentinel');
    expect(await reader.xlen(JOB_LOG_STREAM_NAME)).toBeLessThanOrEqual(
      maxLength + NODE_MAX_ENTRIES,
    );
  });

  it('writes again after Redis dropped its connection', async () => {
    const jobId = randomUUID();
    const { destination, connectionName } = build(1000);
    await destination.open();
    const [oldId] = await connectionIds(connectionName);
    await reader.client('KILL', 'ID', oldId ?? '');

    await expect
      .poll(async () => {
        const ids = await connectionIds(connectionName);
        return ids.length === 1 && ids[0] !== oldId;
      }, POLL)
      .toBe(true);
    await destination.open();
    destination.write(lineOf(jobId, 'after reconnect'));

    await expect
      .poll(async () => (await entries()).map((entry) => entry.message), POLL)
      .toEqual(['after reconnect']);
  });

  it('removes its connection on close and does not throw on a later write', async () => {
    const jobId = randomUUID();
    const { destination, connectionName } = build(1000);
    await destination.open();
    expect(await connectionIds(connectionName)).toHaveLength(1);

    await destination.close();

    await expect.poll(() => connectionIds(connectionName), POLL).toEqual([]);
    expect(() => {
      destination.write(lineOf(jobId, 'late'));
    }).not.toThrow();
  });

  it('does not throw, drops the entry with a warning and closes while Redis is stopped', async () => {
    const jobId = randomUUID();
    const stopped = await new RedisContainer(CONTAINER_IMAGES.redis).start();
    const { destination } = build(1000, stopped.getConnectionUrl());
    await destination.open();
    await stopped.stop();

    expect(() => {
      destination.write(lineOf(jobId, 'lost'));
    }).not.toThrow();

    await expect.poll(() => mainLines.length, POLL).toBe(1);
    expect(JSON.parse(mainLines[0] ?? '{}')).toEqual(
      expect.objectContaining({ droppedJobLogEntry: true, jobId }),
    );
    await expect(destination.close()).resolves.toEqual({});
  });
});
