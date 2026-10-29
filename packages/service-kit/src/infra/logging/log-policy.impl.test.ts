import { Writable } from 'node:stream';

import { pino } from 'pino';
import { describe, expect, it } from 'vitest';

import { LogPolicyImpl } from './log-policy.impl.js';

describe('LogPolicyImpl', () => {
  const policy = new LogPolicyImpl();

  it('redacts the authorization header of logged requests', () => {
    const { redactedPaths } = policy.resolve({ nodeEnv: 'production', logLevel: 'info' });
    const lines: string[] = [];
    const stream = new Writable({
      write(chunk: Buffer, _encoding, done): void {
        lines.push(chunk.toString());
        done();
      },
    });
    const logger = pino({ redact: [...redactedPaths] }, stream);

    logger.info({ req: { headers: { authorization: 'Bearer secret-token' } } }, 'request');

    expect(lines.join('')).not.toContain('secret-token');
    expect(lines.join('')).toContain('[Redacted]');
  });

  it('uses the configured log level', () => {
    expect(policy.resolve({ nodeEnv: 'production', logLevel: 'warn' }).level).toBe('warn');
  });

  it('writes JSON in production and tests, and readable lines only in development', () => {
    expect(policy.resolve({ nodeEnv: 'production', logLevel: 'info' }).format).toBe('json');
    expect(policy.resolve({ nodeEnv: 'test', logLevel: 'info' }).format).toBe('json');
    expect(policy.resolve({ nodeEnv: 'development', logLevel: 'info' }).format).toBe('pretty');
  });
});
