import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockDeep } from 'vitest-mock-extended';

import { AppModule, type JobLogDestination } from './app.module.js';

describe('AppModule', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('Job log opens at startup', async () => {
    const jobLog = mockDeep<JobLogDestination>();
    jobLog.open.mockResolvedValueOnce({});

    await new AppModule(jobLog).onModuleInit();

    expect(jobLog.open).toHaveBeenCalledOnce();
  });

  it('Job log cannot open: startup carries on', async () => {
    const jobLog = mockDeep<JobLogDestination>();
    const error = new Error('not ready within 5000 ms');
    jobLog.open.mockRejectedValueOnce(error);
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementationOnce(() => undefined);

    await expect(new AppModule(jobLog).onModuleInit()).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalledExactlyOnceWith(
      { err: error },
      'Job log unavailable at startup: job log entries are dropped until Redis answers',
    );
  });

  it('Job log closes once at shutdown', async () => {
    const jobLog = mockDeep<JobLogDestination>();
    jobLog.close.mockResolvedValueOnce({});

    await new AppModule(jobLog).onApplicationShutdown();

    expect(jobLog.close).toHaveBeenCalledOnce();
  });
});
