import type { BootstrapProcess, StartedService } from '@job-queue/service-kit';
import type { DynamicModule, Type } from '@nestjs/common';
import { Module } from '@nestjs/common';
import { EventEmitter } from 'node:events';

import { AppModule } from '../../../src/app/app.module.js';
import type { JobServiceConfig } from '../../../src/domain/config/job-service-config.js';
import { JobServiceBootstrap } from '../../../src/infra/bootstrap/job-service-bootstrap.js';
import type {
  RunningJobService,
  UrlRunningJobServiceRequest,
  UrlRunningJobServiceResponse,
} from './running-job-service.js';

export interface InProcessJobServiceDeps {
  service: StartedService;
}

export interface StartInProcessJobServiceRequest {
  /** The process environment the app is configured from. */
  env: Readonly<Record<string, string>>;
  /** Test-only modules registered next to the real app. */
  extraModules?: (Type | DynamicModule)[];
}

export interface StartInProcessJobServiceResponse {
  service: InProcessJobService;
}

export type CloseInProcessJobServiceResponse = Record<string, never>;

interface TestAppOptions {
  config: JobServiceConfig;
  extraModules: (Type | DynamicModule)[];
}

/** The real `AppModule` plus the test-only modules of one test file. */
@Module({})
class TestAppModule {
  static forRoot({ config, extraModules }: TestAppOptions): DynamicModule {
    return { module: TestAppModule, imports: [AppModule.forRoot({ config }), ...extraModules] };
  }
}

/** A `process` of its own, so no signal handler is installed on the test process. */
class TestProcess extends EventEmitter {
  exitCode: number | undefined;
  readonly stderr = { write: (chunk: string): boolean => process.stderr.write(chunk) };
}

/** The full Nest app in the test process, started through the same bootstrap as `main.ts`, on a free port. */
export class InProcessJobService implements RunningJobService {
  constructor(private readonly d: InProcessJobServiceDeps) {}

  static async start(
    req: StartInProcessJobServiceRequest,
  ): Promise<StartInProcessJobServiceResponse> {
    const process: BootstrapProcess = new TestProcess();
    const result = await new JobServiceBootstrap(
      { process },
      {
        env: req.env,
        createModule: ({ config }) =>
          TestAppModule.forRoot({ config, extraModules: req.extraModules ?? [] }),
        host: '127.0.0.1',
      },
    ).start();
    if (!result.started) {
      throw new Error('Invalid job-service configuration (see stderr)');
    }
    return { service: new InProcessJobService({ service: result.service }) };
  }

  url(req: UrlRunningJobServiceRequest): UrlRunningJobServiceResponse {
    return { url: new URL(req.path, this.d.service.url).toString() };
  }

  async close(): Promise<CloseInProcessJobServiceResponse> {
    await this.d.service.close();
    return {};
  }
}
