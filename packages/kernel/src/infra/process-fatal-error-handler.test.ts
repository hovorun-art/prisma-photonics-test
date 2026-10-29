import { describe, expect, it, vi, type Mock } from 'vitest';

import { ProcessFatalErrorHandler } from './process-fatal-error-handler.js';

describe('ProcessFatalErrorHandler', () => {
  const processOf = (): {
    stderr: { write: Mock<(chunk: string) => unknown> };
    exitCode?: number;
  } => ({
    stderr: { write: vi.fn<(chunk: string) => unknown>() },
  });

  it('prints the stack of an Error to stderr and fails the process', () => {
    const process = processOf();
    const error = new Error('boom');

    new ProcessFatalErrorHandler({ process }).handle({ error });

    expect(process.stderr.write).toHaveBeenCalledExactlyOnceWith(`${error.stack}\n`);
    expect(process.exitCode).toBe(1);
  });

  it('falls back to the message of an Error without a stack', () => {
    const process = processOf();
    const error = new Error('no stack');
    error.stack = undefined;

    new ProcessFatalErrorHandler({ process }).handle({ error });

    expect(process.stderr.write).toHaveBeenCalledExactlyOnceWith('no stack\n');
  });

  it('prints anything else that was thrown as text', () => {
    const process = processOf();

    new ProcessFatalErrorHandler({ process }).handle({ error: 'plain string' });

    expect(process.stderr.write).toHaveBeenCalledExactlyOnceWith('plain string\n');
    expect(process.exitCode).toBe(1);
  });
});
