import type { JobGroup } from '@job-queue/contracts';

import type {
  CreateJobGroupRepositoryResponse,
  DeleteJobGroupRepositoryRequest,
  DeleteJobGroupRepositoryResponse,
  GetJobGroupRepositoryRequest,
  GetJobGroupRepositoryResponse,
  JobGroupRepository,
  ListRunningJobGroupRepositoryRequest,
  ListRunningJobGroupRepositoryResponse,
  QueryJobGroupRepositoryRequest,
  QueryJobGroupRepositoryResponse,
  RecordCheckJobGroupRepositoryRequest,
  RecordCheckJobGroupRepositoryResponse,
} from '../../../domain/groups/job-group-repository.js';
import {
  Prisma,
  type JobGroup as JobGroupRow,
  type PrismaClient,
} from '../../prisma/generated/client.js';

export interface PrismaJobGroupRepositoryDeps {
  /** job-group-service's one connection pool (`PrismaDatabase`). */
  prisma: PrismaClient;
}

export interface PrismaJobGroupRepositoryParams {
  /** The Postgres schema of the table (`job_groups`); raw SQL does not get it from the adapter. */
  schema: string;
}

/**
 * Job groups in the `job_groups` table. `recordCheck` is a single conditional `UPDATE`, so
 * Postgres' row lock decides between a poll and a concurrent delete: whichever comes second
 * matches no row.
 */
export class PrismaJobGroupRepository implements JobGroupRepository {
  constructor(
    private readonly d: PrismaJobGroupRepositoryDeps,
    private readonly p: PrismaJobGroupRepositoryParams,
  ) {}

  async create(): Promise<CreateJobGroupRepositoryResponse> {
    const row = await this.d.prisma.jobGroup.create({
      data: { status: 'running', total: 0, completed: 0, failed: 0 },
    });
    return { group: this.toJobGroup(row) };
  }

  async get(req: GetJobGroupRepositoryRequest): Promise<GetJobGroupRepositoryResponse> {
    const row = await this.d.prisma.jobGroup.findUnique({ where: { id: req.id } });
    return { group: row === null ? null : this.toJobGroup(row) };
  }

  async query(req: QueryJobGroupRepositoryRequest): Promise<QueryJobGroupRepositoryResponse> {
    const [rows, total] = await this.d.prisma.$transaction([
      this.d.prisma.jobGroup.findMany({
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: req.limit,
        skip: req.offset,
      }),
      this.d.prisma.jobGroup.count(),
    ]);
    return { items: rows.map((row) => this.toJobGroup(row)), total };
  }

  async delete(req: DeleteJobGroupRepositoryRequest): Promise<DeleteJobGroupRepositoryResponse> {
    const { count } = await this.d.prisma.jobGroup.deleteMany({ where: { id: req.id } });
    return { deleted: count > 0 };
  }

  async listRunning(
    req: ListRunningJobGroupRepositoryRequest,
  ): Promise<ListRunningJobGroupRepositoryResponse> {
    const rows = await this.d.prisma.jobGroup.findMany({
      where: {
        status: 'running',
        ...(req.afterId === undefined ? {} : { id: { gt: req.afterId } }),
      },
      orderBy: { id: 'asc' },
      take: req.limit,
    });
    return { groups: rows.map((row) => this.toJobGroup(row)) };
  }

  async recordCheck(
    req: RecordCheckJobGroupRepositoryRequest,
  ): Promise<RecordCheckJobGroupRepositoryResponse> {
    const schema = `"${this.p.schema.replaceAll('"', '""')}"`;
    const table = Prisma.raw(`${schema}."job_groups"`);
    const statusType = Prisma.raw(`${schema}."job_group_status"`);
    const updated = await this.d.prisma.$executeRaw`
      UPDATE ${table}
      SET "status" = ${req.status}::${statusType},
          "total" = GREATEST("total", ${req.total}),
          "completed" = ${req.completed},
          "failed" = ${req.failed},
          "checked_at" = ${new Date(req.checkedAt)},
          "finished_at" = ${req.finishedAt === null ? null : new Date(req.finishedAt)},
          "updated_at" = now()
      WHERE "id" = ${req.id}::uuid AND "status" = 'running'`;
    return { recorded: updated > 0 };
  }

  private toJobGroup(row: JobGroupRow): JobGroup {
    return {
      id: row.id,
      status: row.status,
      total: row.total,
      completed: row.completed,
      failed: row.failed,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      checkedAt: row.checkedAt === null ? null : row.checkedAt.toISOString(),
      finishedAt: row.finishedAt === null ? null : row.finishedAt.toISOString(),
    };
  }
}
