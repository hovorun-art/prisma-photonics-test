import { JOB_LIMITS } from '@job-queue/contracts';
import { describe, expect, it } from 'vitest';

import { en } from '@/locales';

import { LocaleExecutionFieldMessages } from './execution-field-messages';

const messages = new LocaleExecutionFieldMessages();

describe('LocaleExecutionFieldMessages', () => {
  it('Priority out of range: names the allowed range', () => {
    expect(messages.message({ field: 'priority' })).toEqual({
      message: en.submit.errors.priority(JOB_LIMITS.priority.min, JOB_LIMITS.priority.max),
    });
  });

  it('Max attempts out of range: names the allowed range', () => {
    expect(messages.message({ field: 'maxAttempts' })).toEqual({
      message: en.submit.errors.maxAttempts(JOB_LIMITS.maxAttempts.min, JOB_LIMITS.maxAttempts.max),
    });
  });
});
