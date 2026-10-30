import { describe, expect, it } from 'vitest';

import { IntlWholeNumberFormat } from './whole-number-format';

const format = new IntlWholeNumberFormat();

describe('IntlWholeNumberFormat', () => {
  it('groups thousands', () => {
    expect(format.format({ value: 5540 }).text).toBe('5,540');
  });

  it('rounds to a whole number', () => {
    expect(format.format({ value: 714.8 }).text).toBe('715');
    expect(format.format({ value: 8749.4 }).text).toBe('8,749');
  });
});
