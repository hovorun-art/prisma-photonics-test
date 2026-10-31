import { DomainError } from '@job-queue/kernel';

export interface IdempotencyKeyConflictErrorParams {
  idempotencyKey: string;
  /** The job that already holds the key. */
  existingJobId: string;
}

/** The submission's idempotency key belongs to a job that was submitted with another request. */
export class IdempotencyKeyConflictError extends DomainError<'IDEMPOTENCY_KEY_CONFLICT'> {
  constructor(p: IdempotencyKeyConflictErrorParams) {
    super({
      code: 'IDEMPOTENCY_KEY_CONFLICT',
      message: 'The idempotency key was already used for a different job request',
      details: { idempotencyKey: p.idempotencyKey, existingJobId: p.existingJobId },
    });
  }
}
