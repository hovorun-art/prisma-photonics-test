import {
  FetchJobServiceHttp,
  RANDOM,
  type Random,
  SLEEPER,
  type Sleeper,
  SystemRandom,
  SystemSleeper,
} from '@job-queue/kernel';
import {
  type BeforeApplicationShutdown,
  Inject,
  Logger,
  Module,
  type OnApplicationBootstrap,
} from '@nestjs/common';

import { EXECUTION_CONFIG, type ExecutionConfig } from '../../domain/config/execution-config.js';
import { JOB_EXECUTION, type JobExecution } from '../../domain/execution/job-execution.js';
import { JOB_REPOSITORY, type JobRepository } from '../../domain/jobs/job-repository.js';
import { JOB_HANDLERS, type JobHandlers } from '../../domain/execution/job-handler.js';
import {
  JOB_QUEUE_CONSUMER,
  type JobQueueConsumer,
} from '../../domain/queue/job-queue-consumer.js';
import { JobExecutionImpl } from '../../infra/execution/job-execution.impl.js';
import { HttpJobRepository } from '../../infra/jobs/http-job-repository.js';
import { EmailJobHandler } from '../../infra/notifications/email-job-handler.js';
import { FlightTransitJobHandler } from '../../infra/flight-transit/flight-transit-job-handler.js';
import { TurfTransitReportGenerator } from '../../infra/flight-transit/turf-transit-report-generator.js';
import { BullMqJobQueueConsumer } from '../../infra/queue/bullmq-job-queue-consumer.js';
import { WebhookJobHandler } from '../../infra/webhooks/webhook-job-handler.js';

/**
 * Runs queued jobs: starts taking entries once the app has started, and on shutdown stops taking
 * new ones and lets running jobs finish for the configured grace period, then abandons the rest.
 */
@Module({
  providers: [
    { provide: RANDOM, useClass: SystemRandom },
    { provide: SLEEPER, useClass: SystemSleeper },
    {
      provide: JOB_REPOSITORY,
      useFactory: (config: ExecutionConfig): JobRepository =>
        new HttpJobRepository(
          {
            http: new FetchJobServiceHttp(
              { fetch },
              { baseUrl: config.jobServiceUrl, timeoutMs: config.jobServiceTimeoutMs },
            ),
          },
          { serviceToken: config.internalServiceToken },
        ),
      inject: [EXECUTION_CONFIG],
    },
    {
      provide: JOB_HANDLERS,
      useFactory: (random: Random, sleeper: Sleeper, config: ExecutionConfig): JobHandlers => ({
        email: new EmailJobHandler(
          { random, sleeper },
          { sendMinMs: config.emailSendMinMs, sendMaxMs: config.emailSendMaxMs },
        ),
        webhook: new WebhookJobHandler(
          { random, sleeper },
          { callMs: config.webhookCallMs, failureRate: config.webhookFailureRate },
        ),
        'flight-transit': new FlightTransitJobHandler(
          {
            random,
            sleeper,
            reports: new TurfTransitReportGenerator(
              { random },
              {
                pathPoints: config.flightTransitPathPoints,
                cruiseWaypoints: config.flightTransitCruiseWaypoints,
                longHaulKm: config.flightTransitLongHaulKm,
                climbKm: config.flightTransitClimbKm,
                descentKm: config.flightTransitDescentKm,
                taxiSpeedKmh: config.flightTransitTaxiSpeedKmh,
              },
            ),
            logger: new Logger('FlightTransit'),
          },
          {
            generateMs: config.flightTransitGenerateMs,
            failureRate: config.flightTransitFailureRate,
          },
        ),
      }),
      inject: [RANDOM, SLEEPER, EXECUTION_CONFIG],
    },
    {
      provide: JOB_EXECUTION,
      useFactory: (
        jobs: JobRepository,
        handlers: JobHandlers,
        config: ExecutionConfig,
      ): JobExecution =>
        new JobExecutionImpl(
          { jobs, handlers, logger: new Logger('JobExecution') },
          {
            reportRetries: config.reportRetries,
            reportRetryDelayMs: config.reportRetryDelayMs,
            reportRetryMaxDelayMs: config.reportRetryMaxDelayMs,
          },
        ),
      inject: [JOB_REPOSITORY, JOB_HANDLERS, EXECUTION_CONFIG],
    },
    {
      provide: JOB_QUEUE_CONSUMER,
      useFactory: (config: ExecutionConfig): JobQueueConsumer =>
        new BullMqJobQueueConsumer(
          { logger: new Logger('JobQueue') },
          { redisUrl: config.redisUrl, concurrency: config.concurrency },
        ),
      inject: [EXECUTION_CONFIG],
    },
  ],
})
export class ExecutionModule implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private readonly logger = new Logger(ExecutionModule.name);

  constructor(
    @Inject(JOB_QUEUE_CONSUMER) private readonly consumer: JobQueueConsumer,
    @Inject(JOB_EXECUTION) private readonly execution: JobExecution,
    @Inject(SLEEPER) private readonly sleeper: Sleeper,
    @Inject(EXECUTION_CONFIG) private readonly config: ExecutionConfig,
  ) {}

  onApplicationBootstrap(): void {
    this.consumer.start({ execute: (entry) => this.execution.execute(entry) });
  }

  async beforeApplicationShutdown(): Promise<void> {
    const closing = this.consumer.close().then(() => 'closed' as const);
    const graceTimer = new AbortController();
    const graceOver = this.sleeper
      .sleep({ ms: this.config.shutdownGraceMs, signal: graceTimer.signal })
      .then(
        () => 'grace over' as const,
        () => 'closed' as const,
      );

    if ((await Promise.race([closing, graceOver])) === 'grace over') {
      this.logger.warn('Shutdown grace period is over: abandoning running jobs');
      this.execution.abort();
      await closing;
    } else {
      graceTimer.abort();
    }
  }
}
