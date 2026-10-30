import type {
  BootstrapProcess,
  CreateModuleRequest,
  ServiceBootstrap,
  ServiceSetupStep,
  StartServiceBootstrapResponse,
} from '@job-queue/service-kit';
import { NestServiceBootstrap } from '@job-queue/service-kit';
import type { DynamicModule, INestApplication, Type } from '@nestjs/common';

import type { JobServiceConfig } from '../../domain/config/job-service-config.js';
import { ZodJobServiceConfigParser } from '../config/zod-job-service-config-parser.js';
import {
  JOB_SERVICE_API_DOCS_PARAMS,
  SwaggerApiDocsSetupStep,
} from '../docs/swagger-api-docs-setup-step.js';
import { RequestBodySetupStep } from '../http/request-body-setup-step.js';
import { InternalAccessSetupStep } from '../internal-access/internal-access-setup-step.js';

/**
 * How job-service's Nest app is set up before it listens, in order: the internal token is checked
 * before any body is parsed. The e2e tests set up their app with this same list.
 */
export const JOB_SERVICE_SETUP_STEPS: readonly ServiceSetupStep<INestApplication>[] = [
  new InternalAccessSetupStep(),
  new RequestBodySetupStep(),
  new SwaggerApiDocsSetupStep(JOB_SERVICE_API_DOCS_PARAMS),
];

export interface JobServiceBootstrapDeps {
  process: BootstrapProcess;
}

export interface JobServiceBootstrapParams {
  /** The environment job-service is configured from. */
  env: Readonly<Record<string, string | undefined>>;
  /** Builds the root module from the validated config. */
  createModule: (req: CreateModuleRequest<JobServiceConfig>) => Type | DynamicModule;
  /** Every interface when omitted. */
  host?: string;
}

/**
 * The one definition of how job-service starts: its service name, config parser and setup steps.
 * `main.ts` starts the service through it; the e2e tests reuse its `JOB_SERVICE_SETUP_STEPS`.
 */
export class JobServiceBootstrap implements ServiceBootstrap {
  constructor(
    private readonly d: JobServiceBootstrapDeps,
    private readonly p: JobServiceBootstrapParams,
  ) {}

  start(): Promise<StartServiceBootstrapResponse> {
    return new NestServiceBootstrap(
      { parser: new ZodJobServiceConfigParser(), process: this.d.process },
      {
        serviceName: 'job-service',
        env: this.p.env,
        createModule: this.p.createModule,
        setupSteps: JOB_SERVICE_SETUP_STEPS,
        shutdownSteps: [],
        ...(this.p.host === undefined ? {} : { host: this.p.host }),
      },
    ).start();
  }
}
