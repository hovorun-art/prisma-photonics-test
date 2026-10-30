import {
  FINISHED_JOB_STATUSES,
  JOB_QUEUE_NAME,
  JobQueueEntryId,
  type Job,
  type JobStatus,
} from '@job-queue/contracts';
import { Queue } from 'bullmq';

import { PrismaJobRepository } from '../../../src/infra/jobs/prisma/prisma-job-repository.js';
import { PrismaDatabase } from '../../../src/infra/prisma/prisma-database.js';

/** Test-only access to job-service's data: jobs in states no public route can create yet, and the queue. */
export interface JobFixtures {
  /** Stores an email job in the given state, as if it had got there through the lifecycle. */
  seed(req: SeedJobFixturesRequest): Promise<SeedJobFixturesResponse>;
  /** The attempts that have an entry on the job queue for the job, ascending. */
  queued(req: QueuedJobFixturesRequest): Promise<QueuedJobFixturesResponse>;
  /** Removes every job and every queue entry. */
  clear(): Promise<ClearJobFixturesResponse>;
  close(): Promise<CloseJobFixturesResponse>;
}

export interface SeedJobFixturesRequest {
  status: JobStatus;
  attempts?: number;
  maxAttempts?: number;
}

export interface SeedJobFixturesResponse {
  job: Job;
}

export interface QueuedJobFixturesRequest {
  jobId: string;
}

export interface QueuedJobFixturesResponse {
  attempts: number[];
}

export type ClearJobFixturesResponse = Record<string, never>;
export type CloseJobFixturesResponse = Record<string, never>;

export interface ContainerJobFixturesParams {
  databaseUrl: string;
  redisUrl: string;
}

/** Reads and writes the e2e containers directly, next to the app under test. */
export class ContainerJobFixtures implements JobFixtures {
  private readonly database: PrismaDatabase;
  /** Jobs are stored through the app's own repository, so rows and `Job`s are converted once. */
  private readonly repository: PrismaJobRepository;
  private readonly queue: Queue;

  constructor(p: ContainerJobFixturesParams) {
    this.database = new PrismaDatabase({ databaseUrl: p.databaseUrl });
    this.repository = new PrismaJobRepository({ prisma: this.database });
    this.queue = new Queue(JOB_QUEUE_NAME, { connection: { url: p.redisUrl } });
  }

  async seed(req: SeedJobFixturesRequest): Promise<SeedJobFixturesResponse> {
    const now = new Date().toISOString();
    const finished = (FINISHED_JOB_STATUSES as readonly JobStatus[]).includes(req.status);
    return this.repository.create({
      job: {
        type: 'email',
        payload: { to: 'ada@example.com', subject: 'Seeded', body: 'Hi' },
        status: req.status,
        priority: 5,
        attempts: req.attempts ?? (req.status === 'pending' ? 0 : 1),
        maxAttempts: req.maxAttempts ?? 3,
        result: req.status === 'completed' ? { messageId: 'seeded-message' } : null,
        error: null,
        scheduledAt: null,
        startedAt: req.status === 'pending' ? null : now,
        completedAt: finished ? now : null,
      },
    });
  }

  async queued(req: QueuedJobFixturesRequest): Promise<QueuedJobFixturesResponse> {
    const entries = await this.queue.getJobs(['waiting', 'prioritized', 'delayed']);
    const attempts = entries
      .map((entry) => JobQueueEntryId.safeDecode(entry.id ?? ''))
      .flatMap((decoded) => (decoded.success ? [decoded.data] : []))
      .filter((attempt) => attempt.jobId === req.jobId)
      .map((attempt) => attempt.attempt)
      .sort((a, b) => a - b);
    return { attempts };
  }

  async clear(): Promise<ClearJobFixturesResponse> {
    await this.database.job.deleteMany();
    await this.queue.obliterate({ force: true });
    return {};
  }

  async close(): Promise<CloseJobFixturesResponse> {
    await this.queue.close();
    await this.database.close();
    return {};
  }
}
