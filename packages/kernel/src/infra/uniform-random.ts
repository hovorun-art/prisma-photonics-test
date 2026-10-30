import type {
  IntRandomRequest,
  IntRandomResponse,
  NextRandomResponse,
  Random,
  UuidRandomResponse,
} from '../domain/random.js';

/** A Random whose integers come from `next()`, split into equal buckets, one per integer. */
export abstract class UniformRandom implements Random {
  abstract next(): NextRandomResponse;

  abstract uuid(): UuidRandomResponse;

  int(req: IntRandomRequest): IntRandomResponse {
    if (!Number.isInteger(req.min) || !Number.isInteger(req.max) || req.min > req.max) {
      throw new RangeError(`Invalid integer range [${req.min}, ${req.max}]`);
    }
    const { value } = this.next();
    return { value: req.min + Math.floor(value * (req.max - req.min + 1)) };
  }
}
