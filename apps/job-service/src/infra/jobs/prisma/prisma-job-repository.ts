import { Job, type JobType } from '@job-queue/contracts';

import { JobNotFoundError, JobStatusConflictError } from '@job-queue/kernel';
import type {
  CreateJobRepositoryRequest,
  CreateJobRepositoryResponse,
  DeleteJobRepositoryRequest,
  DeleteJobRepositoryResponse,
  GetJobRepositoryRequest,
  GetJobRepositoryResponse,
  JobChanges,
  JobRepository,
  QueryJobRepositoryRequest,
  QueryJobRepositoryResponse,
  UpdateJobRepositoryRequest,
  UpdateJobRepositoryResponse,
} from '../../../domain/jobs/job-repository.js';
import {
  Prisma,
  type PrismaClient,
  type Job as JobRow,
  type JobType as JobRowType,
} from '../../prisma/generated/client.js';

export interface PrismaJobRepositoryDeps {
  /** job-service's one connection pool (`PrismaDatabase`). */
  prisma: PrismaClient;
}

/** "An operation failed because it depends on one or more records that were required but not found." */
const RECORD_NOT_FOUND = 'P2025';

/** Prisma names an enum value by its schema name, which cannot hold the `-` of `flight-transit`. */
const ROW_TYPES: Readonly<Record<JobType, JobRowType>> = {
  email: 'email',
  webhook: 'webhook',
  'flight-transit': 'flight_transit',
};

const JOB_TYPES: Readonly<Record<JobRowType, JobType>> = {
  email: 'email',
  webhook: 'webhook',
  flight_transit: 'flight-transit',
};

/**
 * Jobs in the `jobs` table. Conditional writes put the expected state into the `WHERE` clause of
 * a single `UPDATE`/`DELETE`, so Postgres' row lock decides between concurrent callers: the loser
 * matches no row and gets a status conflict.
 */
export class PrismaJobRepository implements JobRepository {
  constructor(private readonly d: PrismaJobRepositoryDeps) {}

  async create(req: CreateJobRepositoryRequest): Promise<CreateJobRepositoryResponse> {
    const { job } = req;
    const row = await this.d.prisma.job.create({
      data: {
        type: ROW_TYPES[job.type],
        payload: job.payload,
        status: job.status,
        priority: job.priority,
        attempts: job.attempts,
        maxAttempts: job.maxAttempts,
        result: this.toJsonColumn(job.result),
        error: this.toJsonColumn(job.error),
        scheduledAt: this.toDate(job.scheduledAt),
        startedAt: this.toDate(job.startedAt),
        completedAt: this.toDate(job.completedAt),
      },
    });
    return { job: this.toJob(row) };
  }

  async get(req: GetJobRepositoryRequest): Promise<GetJobRepositoryResponse> {
    const row = await this.d.prisma.job.findUnique({ where: { id: req.id } });
    if (row === null) throw new JobNotFoundError({ id: req.id });
    return { job: this.toJob(row) };
  }

  async query(req: QueryJobRepositoryRequest): Promise<QueryJobRepositoryResponse> {
    const where = this.toQueryWhere(req);
    const [rows, total] = await this.d.prisma.$transaction([
      this.d.prisma.job.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: req.offset,
        take: req.limit,
      }),
      this.d.prisma.job.count({ where }),
    ]);
    return { items: rows.map((row) => this.toJob(row)), total };
  }

  async update(req: UpdateJobRepositoryRequest): Promise<UpdateJobRepositoryResponse> {
    try {
      const row = await this.d.prisma.job.update({
        where: { id: req.id, status: req.expected.status, attempts: req.expected.attempts },
        data: this.toUpdateData(req.changes),
      });
      return { job: this.toJob(row) };
    } catch (error) {
      if (this.isRecordNotFound(error)) await this.throwMissOn(req.id);
      throw error;
    }
  }

  async delete(req: DeleteJobRepositoryRequest): Promise<DeleteJobRepositoryResponse> {
    try {
      await this.d.prisma.job.delete({
        where: { id: req.id, status: { in: [...req.allowedStatuses] } },
      });
      return {};
    } catch (error) {
      if (this.isRecordNotFound(error)) await this.throwMissOn(req.id);
      throw error;
    }
  }

  /** A conditional write matched no row: the job is gone, or its state differs from the expected one. */
  /** Each filter only when given; Prisma ANDs the two, `in` ORs the values of one. */
  private toQueryWhere(req: QueryJobRepositoryRequest): Prisma.JobWhereInput {
    return {
      ...(req.statuses && { status: { in: req.statuses } }),
      ...(req.types && { type: { in: req.types.map((type) => ROW_TYPES[type]) } }),
    };
  }

  private async throwMissOn(id: string): Promise<never> {
    const row = await this.d.prisma.job.findUnique({ where: { id }, select: { status: true } });
    if (row === null) throw new JobNotFoundError({ id });
    throw new JobStatusConflictError({ id, status: row.status });
  }

  private isRecordNotFound(error: unknown): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === RECORD_NOT_FOUND;
  }

  private toUpdateData(changes: JobChanges): Prisma.JobUpdateInput {
    return {
      status: changes.status,
      ...(changes.attempts === undefined ? {} : { attempts: changes.attempts }),
      ...(changes.result === undefined ? {} : { result: this.toJsonColumn(changes.result) }),
      ...(changes.error === undefined ? {} : { error: this.toJsonColumn(changes.error) }),
      ...(changes.startedAt === undefined ? {} : { startedAt: this.toDate(changes.startedAt) }),
      ...(changes.completedAt === undefined
        ? {}
        : { completedAt: this.toDate(changes.completedAt) }),
    };
  }

  /** `null` becomes SQL `NULL` (not the JSON value `null`). */
  private toJsonColumn(value: unknown): Prisma.InputJsonValue | typeof Prisma.DbNull {
    return value === null ? Prisma.DbNull : (value as Prisma.InputJsonValue);
  }

  private toDate(value: string | null): Date | null {
    return value === null ? null : new Date(value);
  }

  private toIso(value: Date | null): string | null {
    return value === null ? null : value.toISOString();
  }

  /** Rows are read back through the shared `Job` schema, so the API never returns a malformed job. */
  private toJob(row: JobRow): Job {
    return Job.parse({
      id: row.id,
      type: JOB_TYPES[row.type],
      payload: row.payload,
      status: row.status,
      priority: row.priority,
      attempts: row.attempts,
      maxAttempts: row.maxAttempts,
      result: row.result,
      error: row.error,
      scheduledAt: this.toIso(row.scheduledAt),
      startedAt: this.toIso(row.startedAt),
      completedAt: this.toIso(row.completedAt),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    });
  }
}
