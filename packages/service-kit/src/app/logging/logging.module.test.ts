import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Logger as PinoLogger } from 'nestjs-pino';
import { describe, expect, it } from 'vitest';

import { LoggingModule } from './logging.module.js';

describe('LoggingModule', () => {
  it('writes each line as JSON with the base fields to the given destination', async () => {
    const lines: string[] = [];
    const moduleRef = await Test.createTestingModule({
      imports: [
        LoggingModule.forRoot({
          nodeEnv: 'test',
          logLevel: 'info',
          base: { service: 'a-service' },
          destination: { write: (line: string) => lines.push(line) },
        }),
      ],
    }).compile();
    const app = moduleRef.createNestApplication({ bufferLogs: true });
    app.useLogger(app.get(PinoLogger));
    await app.init();

    new Logger('Test').log({ jobId: 'job-1' }, 'Job started');
    await app.close();

    expect(lines.map((line) => JSON.parse(line) as unknown)).toContainEqual(
      expect.objectContaining({
        level: 30,
        service: 'a-service',
        jobId: 'job-1',
        msg: 'Job started',
      }),
    );
  });
});
