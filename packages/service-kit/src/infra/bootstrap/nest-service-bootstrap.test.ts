import { EventEmitter } from 'node:events';

import { Controller, Get, Module, type INestApplication } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ConfigParser } from '../../domain/config/config-parser.js';
import type {
  BootstrapConfig,
  ServiceSetupStep,
  StartedService,
} from '../../domain/bootstrap/service-bootstrap.js';
import { LoggingModule } from '../../app/logging/logging.module.js';
import { NestServiceBootstrap } from './nest-service-bootstrap.js';

@Controller('ping')
class PingController {
  @Get()
  ping(): { pong: true } {
    return { pong: true };
  }
}

@Module({
  imports: [LoggingModule.forRoot({ nodeEnv: 'test', logLevel: 'silent' })],
  controllers: [PingController],
})
class TestAppModule {}

/** Stands in for `process`: tests emit the signals and read stderr and the exit code. */
class FakeProcess extends EventEmitter {
  exitCode: number | undefined;
  readonly stderr = { write: vi.fn() };
}

describe('NestServiceBootstrap', () => {
  const started: StartedService[] = [];

  afterEach(async () => {
    await Promise.all(started.splice(0).map((service) => service.close()));
  });

  const validParser: ConfigParser<BootstrapConfig> = {
    parse: () => ({ ok: true, config: { port: 0 } }),
  };

  it('writes an invalid configuration to stderr, fails the process and starts nothing', async () => {
    const process = new FakeProcess();
    const createModule = vi.fn(() => TestAppModule);
    const parser: ConfigParser<BootstrapConfig> = {
      parse: () => ({ ok: false, problems: 'REDIS_URL: required' }),
    };

    const result = await new NestServiceBootstrap(
      { parser, process },
      { serviceName: 'a-service', env: {}, createModule, setupSteps: [], shutdownSteps: [] },
    ).start();

    expect(result).toEqual({ started: false });
    expect(process.stderr.write).toHaveBeenCalledExactlyOnceWith(
      'Invalid a-service configuration:\nREDIS_URL: required\n',
    );
    expect(process.exitCode).toBe(1);
    expect(createModule).not.toHaveBeenCalled();
  });

  it('builds the app from the validated config, runs the setup steps in order, then listens', async () => {
    const order: string[] = [];
    const step = (name: string): ServiceSetupStep<INestApplication> => ({
      apply: vi.fn(() => {
        order.push(name);
        return {};
      }),
    });
    const first = step('first');
    const createModule = vi.fn(() => TestAppModule);
    const parser: ConfigParser<BootstrapConfig> = {
      parse: vi.fn(() => ({ ok: true as const, config: { port: 0 } })),
    };

    const result = await new NestServiceBootstrap(
      { parser, process: new FakeProcess() },
      {
        serviceName: 'a-service',
        env: { SOME: 'value' },
        createModule,
        setupSteps: [first, step('second')],
        shutdownSteps: [],
        host: '127.0.0.1',
      },
    ).start();
    if (!result.started) throw new Error('expected the service to start');
    started.push(result.service);

    expect(parser.parse).toHaveBeenCalledExactlyOnceWith({ env: { SOME: 'value' } });
    expect(createModule).toHaveBeenCalledExactlyOnceWith({ config: { port: 0 } });
    expect(order).toEqual(['first', 'second']);
    expect(first.apply).toHaveBeenCalledWith({ app: expect.anything() as INestApplication });
    const response = await fetch(new URL('/ping', result.service.url));
    expect(await response.json()).toEqual({ pong: true });
  });

  it('closes the app and the process ends with a success code on a termination signal', async () => {
    const process = new FakeProcess();
    const result = await new NestServiceBootstrap(
      { parser: validParser, process },
      {
        serviceName: 'a-service',
        env: {},
        createModule: () => TestAppModule,
        setupSteps: [],
        shutdownSteps: [],
        host: '127.0.0.1',
      },
    ).start();
    if (!result.started) throw new Error('expected the service to start');
    started.push(result.service);

    process.emit('SIGTERM');
    await vi.waitFor(() => {
      expect(process.exitCode).toBe(0);
    });

    await expect(fetch(new URL('/ping', result.service.url))).rejects.toThrow();
  });

  it('runs the params shutdown steps before closing', async () => {
    const process = new FakeProcess();
    const run = vi.fn(() => Promise.resolve({}));
    const result = await new NestServiceBootstrap(
      { parser: validParser, process },
      {
        serviceName: 'a-service',
        env: {},
        createModule: () => TestAppModule,
        setupSteps: [],
        shutdownSteps: [{ name: 'drain', run }],
        host: '127.0.0.1',
      },
    ).start();
    if (!result.started) throw new Error('expected the service to start');
    started.push(result.service);

    process.emit('SIGINT');
    await vi.waitFor(() => {
      expect(process.exitCode).toBe(0);
    });

    expect(run).toHaveBeenCalledOnce();
  });
});
