import { DomainError } from '@job-queue/kernel';

/** An `/internal` route was called without the configured service token, or with a different one. */
export class UnauthorizedInternalAccessError extends DomainError<'INTERNAL_UNAUTHORIZED'> {
  constructor() {
    super({
      code: 'INTERNAL_UNAUTHORIZED',
      message: 'A valid service token is required for internal routes',
    });
  }
}
