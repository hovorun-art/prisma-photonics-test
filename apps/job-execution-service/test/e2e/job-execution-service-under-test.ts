import { randomUUID } from 'node:crypto';

import type { EmailJob, Job, UpdateJobRequest, WebhookJob } from '@job-queue/contracts';
import {
  type Closable,
  type CloseClosableResponse,
  RANDOM,
  type Random,
  SLEEPER,
  type Sleeper,
} from '@job-queue/kernel';
import { REDIS_CONNECTION, type RedisConnection } from '@job-queue/service-kit';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Logger as PinoLogger } from 'nestjs-pino';
import { type DeepMockProxy, mockDeep, mockReset } from 'vitest-mock-extended';

import { AppModule } from '../../src/app/app.module.js';
import type { ExecutionConfig } from '../../src/domain/config/execution-config.js';
import type { InstanceId } from '../../src/domain/instance/instance-id.js';
import { JOB_REPOSITORY, type JobRepository } from '../../src/domain/jobs/job-repository.js';
import {
  JOB_CANCELLATIONS,
  type JobCancellations,
  type ListenJobCancellationsRequest,
} from '../../src/domain/queue/job-cancellations.js';
import {
  JOB_QUEUE_CONSUMER,
  type JobQueueConsumer,
  type JobQueueEntry,
  type StartJobQueueConsumerRequest,
} from '../../src/domain/queue/job-queue-consumer.js';
import { JOB_EXECUTION_SERVICE_SETUP_STEPS } from '../../src/infra/bootstrap/job-execution-service-bootstrap.js';
import { ZodExecutionConfigParser } from '../../src/infra/config/zod-execution-config-parser.js';

/** The configured values the e2e tests depend on. */
export const TEST_CONFIG = {
  emailSendMinMs: 100,
  emailSendMaxMs: 200,
  webhookCallMs: 300,
  webhookFailureRate: 0.5,
  reportRetries: 2,
  /** Real waits between tries (the retries do not go through the sleeper), kept short. */
  reportRetryDelayMs: 1,
  reportRetryMaxDelayMs: 2,
  shutdownGraceMs: 5_000,
} as const;

/** The id the instance under test puts on every log line. */
export const INSTANCE_ID = randomUUID() as string as InstanceId;

/** What the email handler draws: its send time (within the configured range) and message id. */
export interface SendsEmailRequest {
  sendMs: number;
  messageId: string;
}

export interface StartRequest {
  /** Listening for cancellations fails at bootstrap with this error. */
  listenFails?: Error;
}

/** One JSON log line as pino writes it. */
export type LogLine = Record<string, unknown> & { level: number; msg?: string };

interface JobExecutionServiceUnderTestDeps {
  app: INestApplication;
  baseUrl: string;
  config: ExecutionConfig;
  execute: StartJobQueueConsumerRequest['execute'];
  consumer: DeepMockProxy<JobQueueConsumer>;
  cancellations: DeepMockProxy<JobCancellations>;
  onCancel: ListenJobCancellationsRequest['onCancel'];
  redis: DeepMockProxy<RedisConnection>;
  jobs: DeepMockProxy<JobRepository>;
  random: DeepMockProxy<Random>;
  sleeper: DeepMockProxy<Sleeper>;
}

/**
 * job-execution-service for the e2e tests: the real `AppModule`, set up with the same steps as
 * `main.ts`, listening over HTTP, with its log lines collected. It has no database; what is outside
 * it is mocked at its ports: the queue consumer (entries are handed in through the `execute` it
 * registered on start), the cancellations job-service announces (handed in through the `onCancel`
 * it listens with), the Redis connection and job-service's internal API. Time and randomness
 * are mocked too, so handlers and the shutdown grace period run deterministically.
 */
export class JobExecutionServiceUnderTest implements Closable {
  /**
   * The log lines of every app started in this test file. Nest's logger is process-wide, so a
   * second app's lines can reach the first app's pino; one list keeps them all.
   */
  private static readonly logLines: LogLine[] = [];

  readonly app: INestApplication;
  readonly config: ExecutionConfig;
  readonly consumer: DeepMockProxy<JobQueueConsumer>;
  readonly cancellations: DeepMockProxy<JobCancellations>;
  readonly redis: DeepMockProxy<RedisConnection>;
  readonly jobs: DeepMockProxy<JobRepository>;
  readonly random: DeepMockProxy<Random>;
  readonly sleeper: DeepMockProxy<Sleeper>;

  private constructor(private readonly d: JobExecutionServiceUnderTestDeps) {
    this.app = d.app;
    this.config = d.config;
    this.consumer = d.consumer;
    this.cancellations = d.cancellations;
    this.redis = d.redis;
    this.jobs = d.jobs;
    this.random = d.random;
    this.sleeper = d.sleeper;
  }

  static async start(req: StartRequest = {}): Promise<JobExecutionServiceUnderTest> {
    const parsed = new ZodExecutionConfigParser().parse({
      env: {
        NODE_ENV: 'test',
        LOG_LEVEL: 'info',
        JOB_EXECUTION_SERVICE_PORT: '0',
        INTERNAL_SERVICE_TOKEN: 'e2e-service-token',
        // Never connected to: the queue consumer, the Redis connection and job-service are mocked.
        REDIS_URL: 'redis://127.0.0.1:1',
        JOB_SERVICE_URL: 'http://127.0.0.1:1',
        EMAIL_SEND_MIN_MS: String(TEST_CONFIG.emailSendMinMs),
        EMAIL_SEND_MAX_MS: String(TEST_CONFIG.emailSendMaxMs),
        WEBHOOK_CALL_MS: String(TEST_CONFIG.webhookCallMs),
        WEBHOOK_FAILURE_RATE: String(TEST_CONFIG.webhookFailureRate),
        JOB_REPORT_RETRIES: String(TEST_CONFIG.reportRetries),
        JOB_REPORT_RETRY_DELAY_MS: String(TEST_CONFIG.reportRetryDelayMs),
        JOB_REPORT_RETRY_MAX_DELAY_MS: String(TEST_CONFIG.reportRetryMaxDelayMs),
        JOB_EXECUTION_SHUTDOWN_GRACE_MS: String(TEST_CONFIG.shutdownGraceMs),
      },
    });
    if (!parsed.ok) throw new Error(parsed.problems);
    const logs = JobExecutionServiceUnderTest.logLines;
    const consumer = mockDeep<JobQueueConsumer>();
    const cancellations = mockDeep<JobCancellations>();
    // Listening starts on bootstrap and resolves once subscribed, as the Redis adapter does.
    if (req.listenFails === undefined) cancellations.listen.mockResolvedValueOnce({});
    else cancellations.listen.mockRejectedValueOnce(req.listenFails);
    const redis = mockDeep<RedisConnection>();
    const jobs = mockDeep<JobRepository>();
    const random = mockDeep<Random>();
    const sleeper = mockDeep<Sleeper>();
    const moduleRef = await Test.createTestingModule({
      imports: [
        AppModule.forRoot({
          config: parsed.config,
          instanceId: INSTANCE_ID,
          logDestination: { write: (line: string) => logs.push(JSON.parse(line) as LogLine) },
        }),
      ],
    })
      .overrideProvider(JOB_QUEUE_CONSUMER)
      .useValue(consumer)
      .overrideProvider(JOB_CANCELLATIONS)
      .useValue(cancellations)
      .overrideProvider(REDIS_CONNECTION)
      .useValue(redis)
      .overrideProvider(JOB_REPOSITORY)
      .useValue(jobs)
      .overrideProvider(RANDOM)
      .useValue(random)
      .overrideProvider(SLEEPER)
      .useValue(sleeper)
      .compile();
    // As the bootstrap does: Nest's own log calls go to pino.
    const app = moduleRef.createNestApplication({ bufferLogs: true });
    app.useLogger(app.get(PinoLogger));
    for (const step of JOB_EXECUTION_SERVICE_SETUP_STEPS) step.apply({ app });
    await app.listen(0, '127.0.0.1');
    const [started] = consumer.start.mock.calls[0] ?? [];
    if (started === undefined) throw new Error('job-execution-service did not start its consumer');
    const [listening] = cancellations.listen.mock.calls[0] ?? [];
    if (listening === undefined) {
      throw new Error('job-execution-service did not listen for cancellations');
    }
    return new JobExecutionServiceUnderTest({
      app,
      baseUrl: await app.getUrl(),
      config: parsed.config,
      execute: started.execute,
      consumer,
      cancellations,
      onCancel: listening.onCancel,
      redis,
      jobs,
      random,
      sleeper,
    });
  }

  /** The log lines written since the last `clear()`. */
  get logs(): readonly LogLine[] {
    return JobExecutionServiceUnderTest.logLines;
  }

  /** Before each test: no log lines, and mocks that remember no calls and answer nothing. */
  clear(): void {
    JobExecutionServiceUnderTest.logLines.length = 0;
    mockReset(this.consumer);
    mockReset(this.cancellations);
    mockReset(this.redis);
    mockReset(this.jobs);
    mockReset(this.random);
    mockReset(this.sleeper);
  }

  /** Closes the app, as a shutdown would; stub the consumer's close and the grace period first. */
  async close(): Promise<CloseClosableResponse> {
    await this.app.close();
    return {};
  }

  /** The next shutdown with no job running: the consumer closes at once, within the grace period. */
  stubIdleShutdown(): void {
    this.consumer.close.mockResolvedValueOnce({});
    this.cancellations.close.mockResolvedValueOnce({});
    this.sleepsUntilAborted();
  }

  /** The next sleep (a handler's wait or the shutdown grace period) lasts until it is aborted. */
  sleepsUntilAborted(): void {
    this.sleeper.sleep.mockImplementationOnce(
      ({ signal }) =>
        new Promise((_resolve, reject) => {
          signal?.addEventListener(
            'abort',
            () => {
              reject(signal.reason as Error);
            },
            { once: true },
          );
        }),
    );
  }

  url(path: string): string {
    return new URL(path, this.d.baseUrl).toString();
  }

  /** Tells the app that job-service cancelled a job, as the cancellations listener does. */
  announceCancel(jobId: string): void {
    this.d.onCancel(jobId);
  }

  /** Hands one queue entry to the app, as the queue consumer does. */
  run(entry: JobQueueEntry): Promise<unknown> {
    return this.d.execute(entry);
  }

  // --- Jobs as job-service sends them, and its answers --------------------------------------------

  /** A pending email job; `overrides` change its fields. */
  emailJob(overrides: Partial<EmailJob> & Pick<EmailJob, 'id'>): EmailJob {
    return {
      type: 'email',
      payload: { to: 'ada@example.com', subject: 'Hello', body: 'Hi' },
      status: 'pending',
      priority: 5,
      attempts: 0,
      maxAttempts: 3,
      result: null,
      error: null,
      groupId: null,
      scheduledAt: null,
      startedAt: null,
      completedAt: null,
      createdAt: '2026-10-29T11:00:00.000Z',
      updatedAt: '2026-10-29T11:00:00.000Z',
      ...overrides,
    };
  }

  /** A pending webhook job (`POST https://example.com/hook`); `overrides` change its fields. */
  webhookJob(overrides: Partial<WebhookJob> & Pick<WebhookJob, 'id'>): WebhookJob {
    return {
      ...this.emailJob({ id: overrides.id }),
      type: 'webhook',
      payload: { method: 'POST', url: 'https://example.com/hook', body: { order: 42 } },
      result: null,
      ...overrides,
    };
  }

  /** job-service sends the job when it is read, then accepts its start. */
  readAndStart(job: Job): void {
    this.jobs.get.mockResolvedValueOnce({ job });
    this.acceptsReport({ ...job, status: 'processing', attempts: job.attempts + 1 });
  }

  /** job-service accepts the next state report and answers with this job. */
  acceptsReport(job: Job): void {
    this.jobs.update.mockResolvedValueOnce({ job });
  }

  /** The email handler draws its send time, waits it out and draws the message id. */
  sendsEmail(req: SendsEmailRequest): void {
    this.random.int.mockReturnValueOnce({ value: req.sendMs });
    this.sleeper.sleep.mockResolvedValueOnce({});
    this.random.uuid.mockReturnValueOnce({ value: req.messageId });
  }

  /** Whether a job handler ran: each one waits through the sleeper or draws a random value. */
  handlerRan(): boolean {
    return (
      this.sleeper.sleep.mock.calls.length > 0 ||
      [this.random.int, this.random.next, this.random.uuid].some((fn) => fn.mock.calls.length > 0)
    );
  }

  // --- Checks -------------------------------------------------------------------------------------

  /** The state reports sent to job-service, in order. */
  reports(): UpdateJobRequest[] {
    return this.jobs.update.mock.calls.map(([request]) => request.update);
  }

  /** The log lines about one job. */
  jobLogs(jobId: string): LogLine[] {
    return this.logs.filter((line) => line.jobId === jobId);
  }
}
