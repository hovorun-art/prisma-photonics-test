import type { JobStatus, JobType } from '@job-queue/contracts';

import type {
  CountByStatusAndTypeJobCountsRequest,
  CountByStatusAndTypeJobCountsResponse,
  CountJobCountsRequest,
  CountJobCountsResponse,
  JobCounts,
} from '../../../domain/jobs/job-counts.js';
import { Prisma, type PrismaClient } from '../../prisma/generated/client.js';

export interface PrismaJobCountsDeps {
  /** job-service's one connection pool (`PrismaDatabase`). */
  prisma: PrismaClient;
}

/**
 * Counts jobs with one `SELECT` of `count(*) FILTER (...)` columns, so every number comes from the
 * same snapshot. `countByStatusAndType` is one `GROUP BY` over the whole table (at most one row per
 * status and type pair); the cast to `text` returns the enum values as Postgres stores them, which
 * are the API's. The `(status, created_at)` and `(status, completed_at)` indexes keep it from
 * scanning all finished jobs; `::int` makes Postgres return numbers instead of bigints.
 */
export class PrismaJobCounts implements JobCounts {
  constructor(private readonly d: PrismaJobCountsDeps) {}

  async count(req: CountJobCountsRequest): Promise<CountJobCountsResponse> {
    const recentSince = new Date(req.recentSince);
    const throughputSince = new Date(req.throughputSince);
    const rows = await this.d.prisma.$queryRaw<CountJobCountsResponse[]>`
      SELECT
        count(*) FILTER (WHERE status = 'pending')::int AS "pending",
        count(*) FILTER (WHERE status = 'processing')::int AS "processing",
        count(*) FILTER (WHERE status = 'scheduled')::int AS "scheduled",
        count(*) FILTER (
          WHERE status = 'completed' AND completed_at >= ${recentSince}::timestamptz
        )::int AS "recentCompleted",
        count(*) FILTER (
          WHERE status = 'failed' AND completed_at >= ${recentSince}::timestamptz
        )::int AS "recentFailed",
        count(*) FILTER (
          WHERE status = 'completed' AND completed_at >= ${throughputSince}::timestamptz
        )::int AS "throughputCompleted"
      FROM jobs
      WHERE status IN ('pending', 'processing', 'scheduled')
        OR (
          status IN ('completed', 'failed')
          AND completed_at >= LEAST(${recentSince}::timestamptz, ${throughputSince}::timestamptz)
        )`;
    const [counts] = rows;
    if (counts === undefined) throw new Error('A count query returned no row');
    return counts;
  }

  async countByStatusAndType(
    req: CountByStatusAndTypeJobCountsRequest,
  ): Promise<CountByStatusAndTypeJobCountsResponse> {
    const group =
      req.groupId === undefined
        ? Prisma.empty
        : req.groupId === null
          ? Prisma.sql`WHERE group_id IS NULL`
          : Prisma.sql`WHERE group_id = ${req.groupId}::uuid`;
    const cells = await this.d.prisma.$queryRaw<
      { status: JobStatus; type: JobType; count: number }[]
    >`
      SELECT status::text AS "status", type::text AS "type", count(*)::int AS "count"
      FROM jobs
      ${group}
      GROUP BY status, type`;
    return { cells };
  }
}
