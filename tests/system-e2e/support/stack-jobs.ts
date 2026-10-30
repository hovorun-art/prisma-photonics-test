import {
  CreateJobsBulkResponse,
  type ChangeJobStatusRequest,
  FINISHED_JOB_STATUSES,
  JOBS_BULK_ROUTE,
  JOBS_ROUTE,
  Job,
} from '@job-queue/contracts';
import { type APIRequestContext, type APIResponse, expect } from '@playwright/test';

import { stack } from './running-stack.js';
import { EXECUTION_INSTANCES, JOB_SERVICE_URL } from './stack-settings.js';

/**
 * Jobs each execution instance runs at once: the stack's default `JOB_EXECUTION_CONCURRENCY`
 * (`.env.example`); keep the two in step, or the backlog of `waiting()` shrinks.
 */
const CONCURRENCY_PER_INSTANCE = 5;

/** Email jobs submitted ahead of a job that must still wait: many times what the stack runs at once. */
const QUEUE_AHEAD = CONCURRENCY_PER_INSTANCE * EXECUTION_INSTANCES * 6;

/** Webhook jobs tried to get one failed one; with the stack's failure rate one fails all but surely. */
const WEBHOOK_TRIES = 40;

const FINISHED: readonly Job['status'][] = FINISHED_JOB_STATUSES;

export interface SubmitStackJobsApiRequest {
  /** The body of `POST /v1/jobs`. */
  data: unknown;
}

export interface JobStackJobsApiResponse {
  job: Job;
}

export interface ReadStackJobsApiRequest {
  id: string;
}

export interface ChangeStatusStackJobsApiRequest {
  id: string;
  status: ChangeJobStatusRequest['status'];
}

export interface ChangeStatusStackJobsApiResponse {
  /** job-service's answer as it came, so a test can check a refusal too. */
  response: APIResponse;
}

export interface WaitingStackJobsApiResponse {
  /** The job that still waits, behind a backlog the workers are busy with. */
  job: Job;
}

export interface WorkerLoggedStackJobsApiRequest {
  jobId: string;
  /** The exact message of the job-execution-service log line. */
  msg: string;
}

export interface WorkerLoggedStackJobsApiResponse {
  /** The matching log lines, from every execution instance. */
  lines: Record<string, unknown>[];
}

/**
 * Jobs on the running stack, through job-service's public API: submitting, reading, cancelling and
 * retrying, and getting a job into the state a scenario starts from (waiting, running, failed); and
 * what the execution instances logged about a job.
 */
export interface StackJobsApi {
  submit(req: SubmitStackJobsApiRequest): Promise<JobStackJobsApiResponse>;
  read(req: ReadStackJobsApiRequest): Promise<JobStackJobsApiResponse>;
  changeStatus(req: ChangeStatusStackJobsApiRequest): Promise<ChangeStatusStackJobsApiResponse>;
  waiting(): Promise<WaitingStackJobsApiResponse>;
  running(): Promise<JobStackJobsApiResponse>;
  failed(): Promise<JobStackJobsApiResponse>;
  workerLogged(req: WorkerLoggedStackJobsApiRequest): Promise<WorkerLoggedStackJobsApiResponse>;
}

export interface StackJobsDeps {
  request: APIRequestContext;
}

/** `StackJobsApi` through Playwright's request context and the compose logs. */
export class StackJobs implements StackJobsApi {
  constructor(private readonly d: StackJobsDeps) {}

  async submit(req: SubmitStackJobsApiRequest): Promise<JobStackJobsApiResponse> {
    const response = await this.d.request.post(`${JOB_SERVICE_URL}${JOBS_ROUTE}`, {
      data: req.data,
    });
    expect(response.status()).toBe(201);
    return { job: Job.parse(await response.json()) };
  }

  async read(req: ReadStackJobsApiRequest): Promise<JobStackJobsApiResponse> {
    const response = await this.d.request.get(`${JOB_SERVICE_URL}${JOBS_ROUTE}/${req.id}`);
    expect(response.status()).toBe(200);
    return { job: Job.parse(await response.json()) };
  }

  async changeStatus(
    req: ChangeStatusStackJobsApiRequest,
  ): Promise<ChangeStatusStackJobsApiResponse> {
    const response = await this.d.request.patch(`${JOB_SERVICE_URL}${JOBS_ROUTE}/${req.id}`, {
      data: { status: req.status },
    });
    return { response };
  }

  /**
   * An email job that is still pending: submitted last in a bulk far larger than the stack runs
   * at once, so the jobs ahead of it keep the workers busy for a while.
   */
  async waiting(): Promise<WaitingStackJobsApiResponse> {
    const jobs = Array.from({ length: QUEUE_AHEAD + 1 }, (_value, index) => ({
      type: 'email',
      payload: { to: 'ada@example.com', subject: `Queued ${index}`, body: 'Hi Ada' },
    }));
    const response = await this.d.request.post(`${JOB_SERVICE_URL}${JOBS_BULK_ROUTE}`, {
      data: { jobs },
    });
    expect(response.status()).toBe(201);
    const job = CreateJobsBulkResponse.parse(await response.json()).items.at(-1);
    if (job === undefined) throw new Error('The bulk created no jobs');
    expect((await this.read({ id: job.id })).job.status).toBe('pending');
    return { job };
  }

  /** An email job a worker is running right now (sending takes the stack's configured time). */
  async running(): Promise<JobStackJobsApiResponse> {
    const { job } = await this.submit({
      data: {
        type: 'email',
        payload: { to: 'ada@example.com', subject: 'Running', body: 'Hi Ada' },
      },
    });
    await expect
      .poll(async () => (await this.read({ id: job.id })).job.status, {
        timeout: 30_000,
        intervals: [50],
      })
      .toBe('processing');
    return this.read({ id: job.id });
  }

  /**
   * A webhook job that failed for good: one attempt each, and enough of them that the stack's
   * simulated failure rate fails at least one.
   */
  async failed(): Promise<JobStackJobsApiResponse> {
    const jobs = Array.from({ length: WEBHOOK_TRIES }, (_value, index) => ({
      type: 'webhook',
      payload: { method: 'POST', url: `https://hooks.example.com/try-${index}` },
      maxAttempts: 1,
    }));
    const response = await this.d.request.post(`${JOB_SERVICE_URL}${JOBS_BULK_ROUTE}`, {
      data: { jobs },
    });
    expect(response.status()).toBe(201);
    const ids = CreateJobsBulkResponse.parse(await response.json()).items.map((job) => job.id);
    let failed: Job | undefined;
    await expect
      .poll(
        async () => {
          const read = await Promise.all(ids.map(async (id) => (await this.read({ id })).job));
          failed = read.find((job) => job.status === 'failed');
          return failed !== undefined || read.every((job) => FINISHED.includes(job.status));
        },
        { timeout: 60_000 },
      )
      .toBe(true);
    if (failed === undefined) throw new Error(`None of ${WEBHOOK_TRIES} webhook jobs failed`);
    return { job: failed };
  }

  async workerLogged(
    req: WorkerLoggedStackJobsApiRequest,
  ): Promise<WorkerLoggedStackJobsApiResponse> {
    const { lines } = await stack.logs({ service: 'job-execution-service' });
    return {
      lines: lines
        .map((line) => JSON.parse(line) as Record<string, unknown>)
        .filter((entry) => entry.jobId === req.jobId && entry.msg === req.msg),
    };
  }
}
