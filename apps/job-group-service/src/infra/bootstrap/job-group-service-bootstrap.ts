import type {
  BootstrapProcess,
  CreateModuleRequest,
  ServiceBootstrap,
  ServiceSetupStep,
  StartServiceBootstrapResponse,
} from '@job-queue/service-kit';
import {
  NestServiceBootstrap,
  SwaggerApiDocsSetupStep,
  type SwaggerApiDocsSetupStepParams,
} from '@job-queue/service-kit';
import type { DynamicModule, INestApplication, Type } from '@nestjs/common';

import type { JobGroupServiceConfig } from '../../domain/config/job-group-service-config.js';
import { ZodJobGroupServiceConfigParser } from '../config/zod-job-group-service-config-parser.js';

/** How job-group-service publishes its docs: Swagger UI at `/docs`, the document at `/docs-json`. */
export const JOB_GROUP_SERVICE_API_DOCS_PARAMS: SwaggerApiDocsSetupStepParams = {
  path: 'docs',
  title: 'job-group-service',
  description:
    'Job groups: create a group, submit its jobs to job-service with its id as `groupId`, and follow their counts and status here.',
};

/** How job-group-service's Nest app is set up before it listens. The e2e tests use this same list. */
export const JOB_GROUP_SERVICE_SETUP_STEPS: readonly ServiceSetupStep<INestApplication>[] = [
  new SwaggerApiDocsSetupStep(JOB_GROUP_SERVICE_API_DOCS_PARAMS),
];

/** No group route reads a body, so the body parser is off and a sent body is ignored. */
export const JOB_GROUP_SERVICE_BODY_PARSER = false;

export interface JobGroupServiceBootstrapDeps {
  process: BootstrapProcess;
}

export interface JobGroupServiceBootstrapParams {
  /** The environment job-group-service is configured from. */
  env: Readonly<Record<string, string | undefined>>;
  /** Builds the root module from the validated config. */
  createModule: (req: CreateModuleRequest<JobGroupServiceConfig>) => Type | DynamicModule;
}

/**
 * The one definition of how job-group-service starts: its service name, config parser, setup steps
 * and body parser setting. `main.ts` starts the service through it; the e2e tests reuse its constants.
 */
export class JobGroupServiceBootstrap implements ServiceBootstrap {
  constructor(
    private readonly d: JobGroupServiceBootstrapDeps,
    private readonly p: JobGroupServiceBootstrapParams,
  ) {}

  start(): Promise<StartServiceBootstrapResponse> {
    return new NestServiceBootstrap(
      { parser: new ZodJobGroupServiceConfigParser(), process: this.d.process },
      {
        serviceName: 'job-group-service',
        env: this.p.env,
        createModule: this.p.createModule,
        setupSteps: JOB_GROUP_SERVICE_SETUP_STEPS,
        shutdownSteps: [],
        bodyParser: JOB_GROUP_SERVICE_BODY_PARSER,
      },
    ).start();
  }
}
