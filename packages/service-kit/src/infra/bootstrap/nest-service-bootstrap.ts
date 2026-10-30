import {
  SignalGracefulShutdown,
  TERMINATION_SIGNALS,
  type Closable,
  type ShutdownStep,
} from '@job-queue/kernel';
import { Logger, type DynamicModule, type INestApplication, type Type } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Logger as PinoLogger } from 'nestjs-pino';

import type { ConfigParser } from '../../domain/config/config-parser.js';
import type {
  BootstrapConfig,
  BootstrapProcess,
  ServiceBootstrap,
  ServiceSetupStep,
  StartServiceBootstrapResponse,
  StartedService,
} from '../../domain/bootstrap/service-bootstrap.js';
import { NestShutdownLog } from './nest-shutdown-log.js';

export interface NestServiceBootstrapDeps<TConfig extends BootstrapConfig> {
  parser: ConfigParser<TConfig>;
  process: BootstrapProcess;
}

export interface CreateModuleRequest<TConfig> {
  config: TConfig;
}

export interface NestServiceBootstrapParams<TConfig extends BootstrapConfig> {
  /** Names the service in the start log and in the invalid-configuration message. */
  serviceName: string;
  /** The environment to configure the service from. */
  env: Readonly<Record<string, string | undefined>>;
  /** Builds the app's root module from the validated config. */
  createModule: (req: CreateModuleRequest<TConfig>) => Type | DynamicModule;
  /** The app's own setup, run in order once the app exists and before it listens. */
  setupSteps: readonly ServiceSetupStep<INestApplication>[];
  /** Run in order before the app is closed on a termination signal. */
  shutdownSteps: readonly ShutdownStep[];
  /** Every interface when omitted. */
  host?: string;
  /** Off for a service whose routes read no body, so a sent body is ignored; on when omitted. */
  bodyParser?: boolean;
}

/**
 * Parses the config (an invalid one goes to stderr with exit code 1), creates the Nest app with
 * buffered logs handed to pino, runs the app's setup steps, installs the graceful shutdown, listens
 * and logs the start.
 */
export class NestServiceBootstrap<TConfig extends BootstrapConfig> implements ServiceBootstrap {
  constructor(
    private readonly d: NestServiceBootstrapDeps<TConfig>,
    private readonly p: NestServiceBootstrapParams<TConfig>,
  ) {}

  async start(): Promise<StartServiceBootstrapResponse> {
    const parsed = this.d.parser.parse({ env: this.p.env });
    if (!parsed.ok) {
      // The logger does not exist yet, so an invalid config goes straight to stderr.
      this.d.process.stderr.write(
        `Invalid ${this.p.serviceName} configuration:\n${parsed.problems}\n`,
      );
      this.d.process.exitCode = 1;
      return { started: false };
    }
    const { config } = parsed;
    const app = await NestFactory.create(this.p.createModule({ config }), {
      bufferLogs: true,
      bodyParser: this.p.bodyParser ?? true,
    });
    app.useLogger(app.get(PinoLogger));
    for (const step of this.p.setupSteps) {
      step.apply({ app });
    }
    const closable: Closable = {
      close: async () => {
        await app.close();
        return {};
      },
    };
    new SignalGracefulShutdown(
      {
        app: closable,
        process: this.d.process,
        log: new NestShutdownLog({ logger: new Logger('Shutdown') }),
      },
      { signals: TERMINATION_SIGNALS, steps: this.p.shutdownSteps },
    ).install();
    await (this.p.host === undefined
      ? app.listen(config.port)
      : app.listen(config.port, this.p.host));
    new Logger('Bootstrap').log(`${this.p.serviceName} started on port ${config.port}`);
    const service: StartedService = { ...closable, url: await app.getUrl() };
    return { started: true, service };
  }
}
