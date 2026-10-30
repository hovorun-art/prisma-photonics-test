import { EventEmitter } from 'node:events';

import { LoggingModule } from '@job-queue/service-kit';
import { Module } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { JobExecutionServiceBootstrap } from './job-execution-service-bootstrap.js';

class FakeProcess extends EventEmitter {
  exitCode: number | undefined;
  readonly stderr = { write: vi.fn() };
}

@Module({})
class EmptyModule {}

describe('JobExecutionServiceBootstrap', () => {
  it('names job-execution-service when the configuration is invalid and starts nothing', async () => {
    const process = new FakeProcess();
    const createModule = vi.fn(() => EmptyModule);

    const result = await new JobExecutionServiceBootstrap(
      { process },
      { env: {}, createModule },
    ).start();

    expect(result).toEqual({ started: false });
    expect(process.exitCode).toBe(1);
    expect(process.stderr.write).toHaveBeenCalledWith(
      expect.stringContaining('Invalid job-execution-service configuration'),
    );
    expect(createModule).not.toHaveBeenCalled();
  });

  it('Instance started: logs that job-execution-service has started', async () => {
    const lines: string[] = [];
    const createModule = vi.fn(() => ({
      module: EmptyModule,
      imports: [
        LoggingModule.forRoot({
          nodeEnv: 'test',
          logLevel: 'info',
          destination: { write: (line: string) => lines.push(line) },
        }),
      ],
    }));

    const result = await new JobExecutionServiceBootstrap(
      { process: new FakeProcess() },
      {
        env: {
          JOB_EXECUTION_SERVICE_PORT: '0',
          REDIS_URL: 'redis://127.0.0.1:1',
          JOB_SERVICE_URL: 'http://127.0.0.1:1',
          INTERNAL_SERVICE_TOKEN: 'a-service-token',
        },
        createModule,
      },
    ).start();
    if (!result.started) throw new Error('expected the service to start');
    await result.service.close();

    const messages = lines.map((line) => (JSON.parse(line) as { msg?: string }).msg);
    expect(messages).toContain('job-execution-service started on port 0');
  });
});
