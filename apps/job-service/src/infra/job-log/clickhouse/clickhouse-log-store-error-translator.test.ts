import { ClickHouseError } from '@clickhouse/client';
import { describe, expect, it } from 'vitest';

import { LogStoreUnavailableError } from '../../../domain/job-log/errors/log-store-unavailable.error.js';
import { ClickHouseLogStoreErrorTranslator } from './clickhouse-log-store-error-translator.js';

describe('ClickHouseLogStoreErrorTranslator', () => {
  const translator = new ClickHouseLogStoreErrorTranslator();
  const systemError = (code: string): Error => Object.assign(new Error('failed'), { code });

  it.each([
    'ECONNREFUSED',
    'ECONNRESET',
    'ECONNABORTED',
    'ETIMEDOUT',
    'EPIPE',
    'ENOTFOUND',
    'EAI_AGAIN',
    'EHOSTUNREACH',
    'ENETUNREACH',
  ])('a %s network error means the store is unavailable', (code) => {
    const { error } = translator.translate({ error: systemError(code), operation: 'query' });

    expect(error).toBeInstanceOf(LogStoreUnavailableError);
    expect(error).toMatchObject({ details: { operation: 'query' } });
  });

  it('a connection refused on every address (an aggregate error) means the store is unavailable', () => {
    const aggregate = new AggregateError([
      systemError('ECONNREFUSED'),
      systemError('ECONNREFUSED'),
    ]);

    const { error } = translator.translate({ error: aggregate, operation: 'schema' });

    expect(error).toBeInstanceOf(LogStoreUnavailableError);
  });

  it('the client request timeout means the store is unavailable', () => {
    const { error } = translator.translate({
      error: new Error('Timeout error.'),
      operation: 'query',
    });

    expect(error).toBeInstanceOf(LogStoreUnavailableError);
  });

  it('an error the server answered with is returned unchanged', () => {
    const rejected = new ClickHouseError({ message: 'Unknown table', code: '60' });

    const { error } = translator.translate({ error: rejected, operation: 'query' });

    expect(error).toBe(rejected);
  });

  it('any other error is returned unchanged', () => {
    const bug = new TypeError('cannot read properties of undefined');

    const { error } = translator.translate({ error: bug, operation: 'insert' });

    expect(error).toBe(bug);
  });

  it('an aggregate error of only other errors is returned unchanged', () => {
    const aggregate = new AggregateError([new TypeError('bug'), systemError('EACCES')]);

    const { error } = translator.translate({ error: aggregate, operation: 'query' });

    expect(error).toBe(aggregate);
  });

  it('an error that only mentions the timeout text is returned unchanged', () => {
    const other = new Error('Query failed: Timeout error. while parsing');

    const { error } = translator.translate({ error: other, operation: 'query' });

    expect(error).toBe(other);
  });

  it('an error whose code is not a string is returned unchanged', () => {
    const odd = Object.assign(new Error('failed'), { code: 111 });

    const { error } = translator.translate({ error: odd, operation: 'query' });

    expect(error).toBe(odd);
  });

  it('a value that is not an error is returned unchanged', () => {
    const { error } = translator.translate({ error: 'boom', operation: 'insert' });

    expect(error).toBe('boom');
  });
});
