import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';

import { JOB_LOG_STREAM_NAME } from '@job-queue/contracts';
import {
  IoRedisJobLogStreamRedis,
  type JobLogDestination,
  JobLogStreamDestination,
  LoggingModule,
} from '@job-queue/service-kit';
import { Module } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { JobExecutionServiceBootstrap } from './job-execution-service-bootstrap.js';

class FakeProcess extends EventEmitter {
  exitCode: number | undefined;
  readonly stderr = { write: vi.fn() };
}

@Module({})
class EmptyModule {}

const ENV = {
  JOB_EXECUTION_SERVICE_PORT: '0',
  // Never connected to: nothing is sent to it in these tests.
  REDIS_URL: 'redis://127.0.0.1:1',
  JOB_SERVICE_URL: 'http://127.0.0.1:1',
  INTERNAL_SERVICE_TOKEN: 'a-service-token',
};

describe('JobExecutionServiceBootstrap', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

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
    const createModule = vi.fn((_req: { jobLog: JobLogDestination }) => ({
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
    await createModule.mock.calls[0]![0].jobLog.close();

    const messages = lines.map((line) => (JSON.parse(line) as { msg?: string }).msg);
    expect(messages).toContain('job-execution-service started on port 0');
  });

  describe('Job log destination', () => {
    const buildJobLog = async (): Promise<JobLogDestination> => {
      const createModule = vi.fn((req: { jobLog: JobLogDestination }) => ({
        module: EmptyModule,
        imports: [
          LoggingModule.forRoot({
            nodeEnv: 'test',
            logLevel: 'info',
            destination: { write: () => undefined },
            jobLog: req.jobLog,
          }),
        ],
      }));
      const result = await new JobExecutionServiceBootstrap(
        { process: new FakeProcess() },
        { env: { ...ENV, JOB_LOG_STREAM_MAX_LENGTH: '50' }, createModule },
      ).start();
      if (!result.started) throw new Error('expected the service to start');
      await result.service.close();
      expect(createModule).toHaveBeenCalledExactlyOnceWith({
        config: expect.objectContaining({ jobLogStreamMaxLength: 50 }) as unknown,
        jobLog: expect.any(JobLogStreamDestination) as unknown,
      });
      return createModule.mock.calls[0]![0].jobLog;
    };

    it('the module is built with the destination of job-execution-service', async () => {
      const append = vi
        .spyOn(IoRedisJobLogStreamRedis.prototype, 'append')
        .mockResolvedValueOnce({});
      const jobLog = await buildJobLog();

      jobLog.write(
        JSON.stringify({
          level: 30,
          time: 1,
          msg: 'x',
          jobId: randomUUID(),
          attempt: 1,
          instanceId: randomUUID(),
        }) + '\n',
      );

      expect(append).toHaveBeenCalledExactlyOnceWith({
        stream: JOB_LOG_STREAM_NAME,
        maxLength: 50,
        data: expect.stringContaining('"source":"job-execution-service"') as unknown,
      });
      await jobLog.close();
    });

    it('a dropped job line is written to the normal log output', async () => {
      const jobLog = await buildJobLog();
      // Its Redis connection is not open, so a job line is dropped and the drop is written to the
      // normal log output (the standard output), which is kept quiet here.
      const stdout = vi.spyOn(process.stdout, 'write').mockImplementationOnce(() => true);
      const jobId = randomUUID();

      jobLog.write(JSON.stringify({ level: 30, time: 1, msg: 'x', jobId }) + '\n');

      await vi.waitFor(() => {
        expect(stdout).toHaveBeenCalledWith(expect.stringContaining(jobId));
      });
      await jobLog.close();
    });
  });
});
