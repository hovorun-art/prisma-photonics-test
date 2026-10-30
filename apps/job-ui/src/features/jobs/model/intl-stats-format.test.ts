import { describe, expect, it } from 'vitest';

import { IntlWholeNumberFormat } from '@/lib/whole-number-format';

import { IntlStatsFormat } from './intl-stats-format';

const format = new IntlStatsFormat(
  { wholeNumbers: new IntlWholeNumberFormat() },
  { perMinuteUnit: '/min' },
);

describe('IntlStatsFormat', () => {
  it.each([
    [0, '0'],
    [999, '999'],
    [1234, '1,234'],
    [1234567, '1,234,567'],
  ])('Large count: %d is shown as %s', (value, text) => {
    expect(format.count({ value }).text).toBe(text);
  });

  it.each([
    [2.4, '2.4/min'],
    [0, '0.0/min'],
    [1 / 3, '0.3/min'],
    [2.45, '2.5/min'],
    [1234.5, '1,234.5/min'],
  ])('Throughput value: %s is shown as %s', (value, text) => {
    expect(format.throughput({ value }).text).toBe(text);
  });
});
