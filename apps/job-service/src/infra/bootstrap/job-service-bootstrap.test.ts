import { EventEmitter } from 'node:events';

import { Module } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { JobServiceBootstrap } from './job-service-bootstrap.js';

class FakeProcess extends EventEmitter {
  exitCode: number | undefined;
  readonly stderr = { write: vi.fn() };
}

@Module({})
class EmptyModule {}

describe('JobServiceBootstrap', () => {
  it('names job-service when the configuration is invalid and starts nothing', async () => {
    const process = new FakeProcess();
    const createModule = vi.fn(() => EmptyModule);

    const result = await new JobServiceBootstrap({ process }, { env: {}, createModule }).start();

    expect(result).toEqual({ started: false });
    expect(process.exitCode).toBe(1);
    expect(process.stderr.write).toHaveBeenCalledWith(
      expect.stringContaining('Invalid job-service configuration'),
    );
    expect(createModule).not.toHaveBeenCalled();
  });
});
