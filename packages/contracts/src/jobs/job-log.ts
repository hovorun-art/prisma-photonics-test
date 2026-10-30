import { z } from 'zod';

import { JOBS_ROUTE, JsonObject, RepeatedQueryParam } from './job.js';

/** `GET /v1/jobs/:id/logs`: one job's log, oldest first. */
export const JOB_LOG_ROUTE = `${JOBS_ROUTE}/:id/logs`;

/** The Redis Stream the services append job log entries to and job-service reads them from. */
export const JOB_LOG_STREAM_NAME = 'job-log';

export const JOB_LOG_LEVELS = ['info', 'warning', 'error'] as const;
export const JobLogLevel = z.enum(JOB_LOG_LEVELS);
export type JobLogLevel = z.infer<typeof JobLogLevel>;

/** The service that wrote an entry. */
export const JobLogSource = z.enum(['job-service', 'job-execution-service']);
export type JobLogSource = z.infer<typeof JobLogSource>;

const Attempt = z.int().positive();

/**
 * One entry as the services append it to the stream: built from a pino line, `ts` is the line's
 * time in milliseconds. job-service validates it when it reads the stream.
 */
export const JobLogStreamMessage = z.object({
  id: z.uuid(),
  jobId: z.uuid(),
  attempt: Attempt.optional(),
  level: JobLogLevel,
  message: z.string(),
  metadata: JsonObject,
  ts: z.int().nonnegative(),
  source: JobLogSource,
  instanceId: z.string().min(1).optional(),
});
export type JobLogStreamMessage = z.infer<typeof JobLogStreamMessage>;

/** One entry of a job's log as the API returns it; `attempt` is null outside an attempt. */
export const JobLogEntry = z.object({
  id: z.uuid(),
  jobId: z.uuid(),
  attempt: Attempt.nullable(),
  level: JobLogLevel,
  message: z.string(),
  metadata: JsonObject,
  /** ISO date-time with milliseconds, like the other job timestamps the API returns. */
  timestamp: z.iso.datetime({ precision: 3 }),
  source: JobLogSource,
  /** The worker instance that wrote the entry; null for job-service's entries. */
  instanceId: z.string().nullable(),
});
export type JobLogEntry = z.infer<typeof JobLogEntry>;

/** The position of an entry in the log: the Redis Stream id `<ms>-<seq>` it was appended under. */
const JobLogPosition = z.string().regex(/^\d+-\d+$/, 'must be a log position');

/**
 * The opaque cursor of the log route: the base64url form of a log position. `encode` issues it
 * (job-service), `decode` reads it back, so a value the route did not issue fails to decode.
 */
export const JobLogCursor = z.codec(z.base64url().min(1), JobLogPosition, {
  decode: (cursor) =>
    atob(
      cursor.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - (cursor.length % 4)) % 4),
    ),
  encode: (position) => btoa(position).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, ''),
});

/**
 * Query string of `GET /v1/jobs/:id/logs`. Without `limit` job-service uses its configured default;
 * the configured maximum is checked by job-service, since it is runtime config. `after` returns only
 * entries after that cursor; `level` values combine with OR.
 */
export const QueryJobLogRequest = z.object({
  limit: z.coerce.number().int().positive().optional(),
  after: JobLogCursor.optional(),
  level: RepeatedQueryParam.pipe(z.array(JobLogLevel).min(1)).optional(),
});
export type QueryJobLogRequest = z.infer<typeof QueryJobLogRequest>;

/**
 * One page of a job's log, oldest first. `nextCursor` marks the last entry returned; it is the
 * request's `after` when nothing was returned, and null when there was neither.
 */
export const QueryJobLogResponse = z.object({
  items: z.array(JobLogEntry),
  nextCursor: z.string().nullable(),
});
export type QueryJobLogResponse = z.infer<typeof QueryJobLogResponse>;
