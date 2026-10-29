import type {
  BootstrapProcess,
  CreateModuleRequest,
  ServiceBootstrap,
  StartServiceBootstrapResponse,
} from '@job-queue/service-kit';
import { NestServiceBootstrap } from '@job-queue/service-kit';
import type { DynamicModule, Type } from '@nestjs/common';

import type { JobServiceConfig } from '../../domain/config/job-service-config.js';
import { ZodJobServiceConfigParser } from '../config/zod-job-service-config-parser.js';
import {
  JOB_SERVICE_API_DOCS_PARAMS,
  SwaggerApiDocsSetupStep,
} from '../docs/swagger-api-docs-setup-step.js';
import { RequestBodySetupStep } from '../http/request-body-setup-step.js';

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
 * `main.ts` and the in-process e2e harness both start the service through it.
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
        setupSteps: [
          new RequestBodySetupStep(),
          new SwaggerApiDocsSetupStep(JOB_SERVICE_API_DOCS_PARAMS),
        ],
        shutdownSteps: [],
        ...(this.p.host === undefined ? {} : { host: this.p.host }),
      },
    ).start();
  }
}
