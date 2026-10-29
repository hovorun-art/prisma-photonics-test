import { describe, expect, it, vi } from 'vitest';

import { NestShutdownLog } from './nest-shutdown-log.js';

describe('NestShutdownLog', () => {
  it('logs info as the message', () => {
    const logger = { log: vi.fn(), error: vi.fn() };

    new NestShutdownLog({ logger }).info({ message: 'Received SIGTERM, shutting down' });

    expect(logger.log).toHaveBeenCalledExactlyOnceWith('Received SIGTERM, shutting down');
  });

  it('logs an error with its cause under `err`, as pino expects', () => {
    const logger = { log: vi.fn(), error: vi.fn() };
    const err = new Error('boom');

    new NestShutdownLog({ logger }).error({ message: 'Graceful shutdown failed', err });

    expect(logger.error).toHaveBeenCalledExactlyOnceWith({ err }, 'Graceful shutdown failed');
  });
});
