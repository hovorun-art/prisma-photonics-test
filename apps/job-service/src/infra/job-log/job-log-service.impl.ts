import { JobLogCursor, type JobLogEntry } from '@job-queue/contracts';
import type { PageLimit } from '@job-queue/kernel';

import type {
  JobLogService,
  QueryJobLogServiceRequest,
  QueryJobLogServiceResponse,
} from '../../domain/job-log/job-log-service.js';
import type { JobLogStore, PositionedJobLogEntry } from '../../domain/job-log/job-log-store.js';
import type { JobRepository } from '../../domain/jobs/job-repository.js';

export interface JobLogServiceImplDeps {
  repository: JobRepository;
  store: JobLogStore;
  /** The configured default and maximum page size of the log route. */
  pageLimit: PageLimit;
}

/** Reads a job's log: checks the job exists, then pages through the log store. */
export class JobLogServiceImpl implements JobLogService {
  constructor(private readonly d: JobLogServiceImplDeps) {}

  async query(req: QueryJobLogServiceRequest): Promise<QueryJobLogServiceResponse> {
    const { limit } = this.d.pageLimit.resolve({ limit: req.limit });
    await this.d.repository.get({ id: req.jobId });
    const { entries } = await this.d.store.query({
      jobId: req.jobId,
      after: req.after,
      levels: req.levels,
      limit,
    });
    const last = entries.at(-1)?.position ?? req.after;
    return {
      items: entries.map((positioned) => this.toEntry(positioned)),
      nextCursor: last === undefined ? null : JobLogCursor.encode(last),
    };
  }

  private toEntry({ entry }: PositionedJobLogEntry): JobLogEntry {
    return {
      id: entry.id,
      jobId: entry.jobId,
      attempt: entry.attempt ?? null,
      level: entry.level,
      message: entry.message,
      metadata: entry.metadata,
      timestamp: new Date(entry.ts).toISOString(),
      source: entry.source,
      instanceId: entry.instanceId ?? null,
    };
  }
}
