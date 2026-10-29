import { EventEmitter } from 'node:events';

import { describe, expect, it, vi } from 'vitest';

import type { Closable, CloseClosableResponse } from '../domain/closable.js';
import type { ShutdownLog, ShutdownStep } from '../domain/graceful-shutdown.js';
import { SignalGracefulShutdown } from './signal-graceful-shutdown.js';

/** Stands in for `process`: tests emit the signals and read the exit code. */
class SignalledProcess extends EventEmitter {
  exitCode: number | undefined;
}

const SIGNALS = ['SIGTERM', 'SIGINT'] as const;

describe('SignalGracefulShutdown', () => {
  const logOf = (): ShutdownLog => ({ info: vi.fn(() => ({})), error: vi.fn(() => ({})) });

  it.each(SIGNALS)(
    'on %s it logs, closes the app and exits with a success code',
    async (signal) => {
      const process = new SignalledProcess();
      const app: Closable = { close: vi.fn(() => Promise.resolve({})) };
      const log = logOf();
      new SignalGracefulShutdown({ app, process, log }, { signals: SIGNALS, steps: [] }).install();

      process.emit(signal);
      await vi.waitFor(() => {
        expect(process.exitCode).toBe(0);
      });

      expect(app.close).toHaveBeenCalledExactlyOnceWith();
      expect(log.info).toHaveBeenCalledExactlyOnceWith({
        message: `Received ${signal}, shutting down`,
      });
    },
  );

  it('only listens to the configured signals', () => {
    const process = new SignalledProcess();
    const app: Closable = { close: vi.fn(() => Promise.resolve({})) };
    new SignalGracefulShutdown(
      { app, process, log: logOf() },
      { signals: ['SIGTERM'], steps: [] },
    ).install();

    expect(process.listenerCount('SIGTERM')).toBe(1);
    expect(process.listenerCount('SIGINT')).toBe(0);
  });

  it('runs the extra steps in order, then closes the app', async () => {
    const process = new SignalledProcess();
    const order: string[] = [];
    const step = (name: string): ShutdownStep => ({
      name,
      run: vi.fn(() => {
        order.push(name);
        return Promise.resolve({});
      }),
    });
    const app: Closable = {
      close: vi.fn(() => {
        order.push('close');
        return Promise.resolve({});
      }),
    };
    new SignalGracefulShutdown(
      { app, process, log: logOf() },
      { signals: SIGNALS, steps: [step('first'), step('second')] },
    ).install();

    process.emit('SIGTERM');
    await vi.waitFor(() => {
      expect(process.exitCode).toBe(0);
    });

    expect(order).toEqual(['first', 'second', 'close']);
  });

  it('exits with a failure code when closing fails, and logs why', async () => {
    const process = new SignalledProcess();
    const failure = new Error('redis quit failed');
    const app: Closable = { close: vi.fn(() => Promise.reject(failure)) };
    const log = logOf();
    new SignalGracefulShutdown({ app, process, log }, { signals: SIGNALS, steps: [] }).install();

    process.emit('SIGTERM');
    await vi.waitFor(() => {
      expect(process.exitCode).toBe(1);
    });

    expect(log.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: failure, message: expect.any(String) as string }),
    );
  });

  it('exits with a failure code when a step fails, but still closes the app', async () => {
    const process = new SignalledProcess();
    const failure = new Error('flush failed');
    const step: ShutdownStep = { name: 'flush', run: vi.fn(() => Promise.reject(failure)) };
    const app: Closable = { close: vi.fn(() => Promise.resolve({})) };
    const log = logOf();
    new SignalGracefulShutdown(
      { app, process, log },
      { signals: SIGNALS, steps: [step] },
    ).install();

    process.emit('SIGTERM');
    await vi.waitFor(() => {
      expect(process.exitCode).toBe(1);
    });

    expect(app.close).toHaveBeenCalledOnce();
    expect(log.error).toHaveBeenCalledWith(
      expect.objectContaining({
        err: failure,
        message: expect.stringContaining('flush') as string,
      }),
    );
  });

  it('changes nothing when a second signal arrives while stopping', async () => {
    const process = new SignalledProcess();
    let finishClosing: () => void = () => undefined;
    const app: Closable = {
      close: vi.fn(
        () =>
          new Promise<CloseClosableResponse>((resolve) => {
            finishClosing = () => {
              resolve({});
            };
          }),
      ),
    };
    const step: ShutdownStep = { name: 'flush', run: vi.fn(() => Promise.resolve({})) };
    const log = logOf();
    new SignalGracefulShutdown(
      { app, process, log },
      { signals: SIGNALS, steps: [step] },
    ).install();

    process.emit('SIGTERM');
    process.emit('SIGINT');
    await vi.waitFor(() => {
      expect(app.close).toHaveBeenCalledOnce();
    });
    finishClosing();
    await vi.waitFor(() => {
      expect(process.exitCode).toBe(0);
    });

    expect(step.run).toHaveBeenCalledOnce();
    expect(app.close).toHaveBeenCalledOnce();
    expect(log.info).toHaveBeenCalledOnce();
  });
});
