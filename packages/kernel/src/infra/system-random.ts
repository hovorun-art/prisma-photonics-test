import type { NextRandomResponse } from '../domain/random.js';
import { UniformRandom } from './uniform-random.js';

export class SystemRandom extends UniformRandom {
  next(): NextRandomResponse {
    return { value: Math.random() };
  }
}
