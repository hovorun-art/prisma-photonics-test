import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Logger as PinoLogger } from 'nestjs-pino';
import { describe, expect, it } from 'vitest';

import { LoggingModule } from './logging.module.js';

/**
 * nestjs-pino keeps one pino instance per process, built by the first module, so this file builds
 * the module once and checks every behaviour of it on the same lines. The `jobLog` branch without
 * `destination` (standard output, or pino-pretty in development) is covered by the apps' wiring
 * (group 5) and the system e2e.
 */
describe('LoggingModule', () => {
  it('writes JSON lines with the base fields to the destination and info lines also to the job log, all redacted', async () => {
    const mainLines: string[] = [];
    const jobLogLines: string[] = [];
    const moduleRef = await Test.createTestingModule({
      imports: [
        LoggingModule.forRoot({
          nodeEnv: 'test',
          logLevel: 'debug',
          base: { service: 'a-service' },
          destination: { write: (line: string) => mainLines.push(line) },
          jobLog: { write: (line: string) => jobLogLines.push(line) },
        }),
      ],
    }).compile();
    const app = moduleRef.createNestApplication({ bufferLogs: true });
    app.useLogger(app.get(PinoLogger));
    await app.init();

    const logger = new Logger('Test');
    logger.log(
      { jobId: 'job-1', upstream: { headers: { authorization: 'Bearer secret' } } },
      'Job started',
    );
    logger.debug({ jobId: 'job-1' }, 'Job detail');
    await app.close();

    const parse = (lines: string[]): unknown[] => lines.map((line) => JSON.parse(line) as unknown);
    expect(parse(mainLines)).toContainEqual(
      expect.objectContaining({
        level: 30,
        service: 'a-service',
        jobId: 'job-1',
        msg: 'Job started',
      }),
    );
    expect(parse(mainLines)).toContainEqual(expect.objectContaining({ msg: 'Job detail' }));
    expect(
      parse(jobLogLines).filter((line) => (line as { msg?: string }).msg === 'Job started'),
    ).toEqual([
      expect.objectContaining({
        level: 30,
        jobId: 'job-1',
        upstream: { headers: { authorization: '[Redacted]' } },
      }),
    ]);
    expect(parse(jobLogLines)).not.toContainEqual(expect.objectContaining({ msg: 'Job detail' }));
    expect(mainLines.join('')).not.toContain('Bearer secret');
    expect(jobLogLines.join('')).not.toContain('Bearer secret');
  });
});
