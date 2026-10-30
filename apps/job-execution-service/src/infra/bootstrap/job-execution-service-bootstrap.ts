import { SystemClock, SystemRandom } from '@job-queue/kernel';
import type {
  BootstrapProcess,
  CreateModuleRequest,
  ServiceBootstrap,
  ServiceSetupStep,
  StartServiceBootstrapResponse,
} from '@job-queue/service-kit';
import {
  IoRedisJobLogStreamRedis,
  JobLogStreamDestination,
  NestServiceBootstrap,
} from '@job-queue/service-kit';
import type { DynamicModule, INestApplication, Type } from '@nestjs/common';

import type { ExecutionConfig } from '../../domain/config/execution-config.js';
import { ZodExecutionConfigParser } from '../config/zod-execution-config-parser.js';

/**
 * How job-execution-service's Nest app is set up before it listens: nothing beyond the shared
 * bootstrap today. The e2e tests set up their app with this same list.
 */
export const JOB_EXECUTION_SERVICE_SETUP_STEPS: readonly ServiceSetupStep<INestApplication>[] = [];

/** How long the job log's Redis connection may take to get ready at startup. */
const JOB_LOG_OPEN_TIMEOUT_MS = 5_000;

export interface CreateJobExecutionModuleRequest extends CreateModuleRequest<ExecutionConfig> {
  jobLog: JobLogStreamDestination;
}

export interface JobExecutionServiceBootstrapDeps {
  process: BootstrapProcess;
}

export interface JobExecutionServiceBootstrapParams {
  /** The environment job-execution-service is configured from. */
  env: Readonly<Record<string, string | undefined>>;
  /**
   * Builds the root module from the validated config and the destination that turns the job lines
   * of its logs into job log entries.
   */
  createModule: (req: CreateJobExecutionModuleRequest) => Type | DynamicModule;
}

/**
 * The one definition of how job-execution-service starts: its service name, config parser and
 * setup steps. `main.ts` starts the service through it; the e2e tests reuse its
 * `JOB_EXECUTION_SERVICE_SETUP_STEPS`.
 */
export class JobExecutionServiceBootstrap implements ServiceBootstrap {
  constructor(
    private readonly d: JobExecutionServiceBootstrapDeps,
    private readonly p: JobExecutionServiceBootstrapParams,
  ) {}

  start(): Promise<StartServiceBootstrapResponse> {
    return new NestServiceBootstrap(
      { parser: new ZodExecutionConfigParser(), process: this.d.process },
      {
        serviceName: 'job-execution-service',
        env: this.p.env,
        createModule: ({ config }) =>
          this.p.createModule({ config, jobLog: this.createJobLog({ config }) }),
        setupSteps: JOB_EXECUTION_SERVICE_SETUP_STEPS,
        shutdownSteps: [],
      },
    ).start();
  }

  /** Its own Redis connection; a dropped entry is reported on the standard output. */
  private createJobLog({ config }: CreateModuleRequest<ExecutionConfig>): JobLogStreamDestination {
    return new JobLogStreamDestination(
      {
        redis: new IoRedisJobLogStreamRedis({
          redisUrl: config.redisUrl,
          connectionName: 'job-execution-service-job-log',
          openTimeoutMs: JOB_LOG_OPEN_TIMEOUT_MS,
        }),
        random: new SystemRandom(),
        clock: new SystemClock(),
        mainLog: process.stdout,
      },
      { source: 'job-execution-service', maxLength: config.jobLogStreamMaxLength },
    );
  }
}
