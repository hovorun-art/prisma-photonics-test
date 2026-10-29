import { DomainError } from '@job-queue/kernel';

/** The request body could not be parsed (for example, it is not valid JSON). */
export class MalformedBodyError extends DomainError<'VALIDATION_FAILED'> {
  constructor() {
    super({ code: 'VALIDATION_FAILED', message: 'Request body is not valid JSON' });
  }
}
