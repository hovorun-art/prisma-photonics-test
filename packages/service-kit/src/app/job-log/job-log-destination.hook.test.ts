import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockDeep } from 'vitest-mock-extended';

import type { JobLogDestination } from '../../domain/job-log/job-log-destination.js';
import { JobLogDestinationHook } from './job-log-destination.hook.js';

describe('JobLogDestinationHook', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('opens the job log at startup and logs no warning', async () => {
    const jobLog = mockDeep<JobLogDestination>();
    jobLog.open.mockResolvedValueOnce({});
    const warn = vi.spyOn(Logger.prototype, 'warn');

    await new JobLogDestinationHook(jobLog).onModuleInit();

    expect(jobLog.open).toHaveBeenCalledOnce();
    expect(warn).not.toHaveBeenCalled();
  });

  it('carries on with a warning when the job log cannot open', async () => {
    const jobLog = mockDeep<JobLogDestination>();
    const error = new Error('not ready within 5000 ms');
    jobLog.open.mockRejectedValueOnce(error);
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementationOnce(() => undefined);

    await expect(new JobLogDestinationHook(jobLog).onModuleInit()).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalledExactlyOnceWith(
      { err: error },
      'Job log unavailable at startup: job log entries are dropped until Redis answers',
    );
  });

  it('closes the job log once at shutdown', async () => {
    const jobLog = mockDeep<JobLogDestination>();
    jobLog.close.mockResolvedValueOnce({});

    await new JobLogDestinationHook(jobLog).onApplicationShutdown();

    expect(jobLog.close).toHaveBeenCalledOnce();
  });

  it('passes on a failure to close the job log at shutdown', async () => {
    const jobLog = mockDeep<JobLogDestination>();
    const failure = new Error('connection lost');
    jobLog.close.mockRejectedValueOnce(failure);

    await expect(new JobLogDestinationHook(jobLog).onApplicationShutdown()).rejects.toBe(failure);
  });
});
