import { SystemClock, SystemRandom } from '@job-queue/kernel';

import type {
  CreateJobLogDestinationFactoryRequest,
  CreateJobLogDestinationFactoryResponse,
  JobLogDestinationFactory,
} from '../../domain/job-log/job-log-destination.js';
import { IoRedisJobLogStreamRedis } from './ioredis-job-log-stream-redis.js';
import { JobLogStreamDestination } from './job-log-stream-destination.js';

/** How long the start waits for the job log's Redis connection before it carries on without it. */
const OPEN_TIMEOUT_MS = 5000;

/** The Redis Stream destination: its own connection, a dropped entry reported on standard output. */
export class JobLogStreamDestinationFactory implements JobLogDestinationFactory {
  create(req: CreateJobLogDestinationFactoryRequest): CreateJobLogDestinationFactoryResponse {
    return {
      destination: new JobLogStreamDestination(
        {
          redis: new IoRedisJobLogStreamRedis({
            redisUrl: req.redisUrl,
            connectionName: req.connectionName,
            openTimeoutMs: OPEN_TIMEOUT_MS,
          }),
          random: new SystemRandom(),
          clock: new SystemClock(),
          mainLog: process.stdout,
        },
        { source: req.source, maxLength: req.maxLength },
      ),
    };
  }
}
