import { DomainError } from '@job-queue/kernel';

/**
 * Storing a job lost a race for its idempotency key: a concurrent submission stored a job with the
 * same key first. `JobService` catches it and reads the winner's job; it only reaches a client when
 * a bulk keeps losing, and then as the generic 500 without details.
 */
export class IdempotencyKeyTakenError extends DomainError<'INTERNAL_ERROR'> {
  constructor() {
    super({ code: 'INTERNAL_ERROR', message: 'Internal server error' });
  }
}
