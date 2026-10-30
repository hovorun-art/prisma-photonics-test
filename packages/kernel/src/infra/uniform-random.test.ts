import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import type { NextRandomResponse, UuidRandomResponse } from '../domain/random.js';
import { UniformRandom } from './uniform-random.js';

/** Returns one fixed value, to check how UniformRandom maps it onto integer ranges. */
interface FixedRandomDeps {
  value: number;
}

class FixedRandom extends UniformRandom {
  constructor(private readonly d: FixedRandomDeps) {
    super();
  }

  next(): NextRandomResponse {
    return { value: this.d.value };
  }

  uuid(): UuidRandomResponse {
    return { value: randomUUID() };
  }
}

describe('UniformRandom', () => {
  it('maps 0 to the minimum and values just below 1 to the maximum', () => {
    expect(new FixedRandom({ value: 0 }).int({ min: 3, max: 5 }).value).toBe(3);
    expect(new FixedRandom({ value: 0.999_999 }).int({ min: 3, max: 5 }).value).toBe(5);
  });

  it('splits [0, 1) into equal buckets, one per integer', () => {
    expect(new FixedRandom({ value: 0.33 }).int({ min: 3, max: 5 }).value).toBe(3);
    expect(new FixedRandom({ value: 0.34 }).int({ min: 3, max: 5 }).value).toBe(4);
    expect(new FixedRandom({ value: 0.67 }).int({ min: 3, max: 5 }).value).toBe(5);
  });

  it('returns the only value of a single-value range', () => {
    expect(new FixedRandom({ value: 0.5 }).int({ min: 7, max: 7 }).value).toBe(7);
  });

  it('rejects a reversed or non-integer range', () => {
    expect(() => new FixedRandom({ value: 0.5 }).int({ min: 5, max: 3 }).value).toThrow(RangeError);
    expect(() => new FixedRandom({ value: 0.5 }).int({ min: 1.5, max: 3 }).value).toThrow(
      RangeError,
    );
  });
});
