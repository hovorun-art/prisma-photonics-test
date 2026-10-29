import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SystemClock } from './system-clock.js';

describe('SystemClock', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: new Date('2026-03-04T05:06:07.000Z') });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns the current system time', () => {
    expect(new SystemClock().now().now.toISOString()).toBe('2026-03-04T05:06:07.000Z');
  });
});
