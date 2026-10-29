import { describe, expect, it } from 'vitest';

import { SystemRandom } from './system-random.js';

describe('SystemRandom', () => {
  it('returns numbers in [0, 1)', () => {
    const random = new SystemRandom();

    for (let i = 0; i < 100; i += 1) {
      const { value } = random.next();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('returns integers within the inclusive range', () => {
    const random = new SystemRandom();

    for (let i = 0; i < 100; i += 1) {
      expect([3, 4, 5]).toContain(random.int({ min: 3, max: 5 }).value);
    }
  });
});
