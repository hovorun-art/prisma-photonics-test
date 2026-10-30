import { EventEmitter } from 'node:events';

import { Body, Controller, Get, Module, Post, type INestApplication } from '@nestjs/common';
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

  /** Answers with the body it received, so a test sees whether the body was parsed. */
  @Post()
  echo(@Body() body: unknown): { body: unknown } {
    return { body: body ?? null };
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
    const createModule = vi.fn();
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
      apply: vi.fn().mockImplementationOnce(({ app }: { app: INestApplication }) => {
        const server = app.getHttpServer() as { listening: boolean };
        order.push(`${name}${server.listening ? ' after listen' : ''}`);
        return {};
      }),
    });
    const first = step('first');
    const createModule = vi.fn().mockReturnValueOnce(TestAppModule);
    const parser: ConfigParser<BootstrapConfig> = {
      parse: vi.fn().mockReturnValueOnce({ ok: true, config: { port: 0 } }),
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
    let answeredDuringStep = false;
    let url = '';
    const run = vi.fn().mockImplementationOnce(async () => {
      answeredDuringStep = (await fetch(new URL('/ping', url))).ok;
      return {};
    });
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
    url = result.service.url;

    process.emit('SIGINT');
    await vi.waitFor(() => {
      expect(process.exitCode).toBe(0);
    });

    expect(run).toHaveBeenCalledOnce();
    expect(answeredDuringStep).toBe(true);
    await expect(fetch(new URL('/ping', url))).rejects.toThrow();
  });

  it('parses JSON bodies by default and ignores them when the body parser is off', async () => {
    const start = async (bodyParser: boolean | undefined): Promise<StartedService> => {
      const result = await new NestServiceBootstrap(
        { parser: validParser, process: new FakeProcess() },
        {
          serviceName: 'a-service',
          env: {},
          createModule: () => TestAppModule,
          setupSteps: [],
          shutdownSteps: [],
          host: '127.0.0.1',
          ...(bodyParser === undefined ? {} : { bodyParser }),
        },
      ).start();
      if (!result.started) throw new Error('expected the service to start');
      started.push(result.service);
      return result.service;
    };
    const post = async (service: StartedService): Promise<unknown> => {
      const response = await fetch(new URL('/ping', service.url), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ a: 1 }),
      });
      return response.json();
    };

    expect(await post(await start(undefined))).toEqual({ body: { a: 1 } });
    expect(await post(await start(false))).toEqual({ body: null });
  });

  it('rejects the start and listens on nothing when a setup step fails', async () => {
    const failure = new Error('docs could not be built');
    const failing: ServiceSetupStep<INestApplication> = {
      apply: vi.fn().mockImplementationOnce(() => {
        throw failure;
      }),
    };

    await expect(
      new NestServiceBootstrap(
        { parser: validParser, process: new FakeProcess() },
        {
          serviceName: 'a-service',
          env: {},
          createModule: () => TestAppModule,
          setupSteps: [failing],
          shutdownSteps: [],
          host: '127.0.0.1',
        },
      ).start(),
    ).rejects.toBe(failure);
  });

  it('stops answering once the started service is closed', async () => {
    const result = await new NestServiceBootstrap(
      { parser: validParser, process: new FakeProcess() },
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

    await result.service.close();

    await expect(fetch(new URL('/ping', result.service.url))).rejects.toThrow();
  });
});
