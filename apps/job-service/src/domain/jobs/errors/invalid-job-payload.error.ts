import { InvalidJobFieldError, type JobFieldIssue } from './invalid-job-field.error.js';

export interface InvalidJobPayloadErrorParams {
  /** Paths relative to the payload. */
  issues: readonly JobFieldIssue[];
}

/**
 * A submitted payload breaks a rule its schema cannot check, such as a flight transit's departure
 * day being over already (that needs job-service's clock).
 */
export class InvalidJobPayloadError extends InvalidJobFieldError {
  constructor(p: InvalidJobPayloadErrorParams) {
    super({ field: ['payload'], issues: p.issues });
  }
}
