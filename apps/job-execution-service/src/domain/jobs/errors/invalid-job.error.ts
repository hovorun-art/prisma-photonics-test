import { DomainError } from '@job-queue/kernel';

/** One problem with a job read from job-service, in the shape of a schema issue. */
export interface InvalidJobIssue {
  code: string;
  path: PropertyKey[];
  message: string;
}

export interface InvalidJobErrorParams {
  id: string;
  issues: readonly InvalidJobIssue[];
}

/** A job read from job-service does not match the shared job contract, so it cannot run. */
export class InvalidJobError extends DomainError<'VALIDATION_FAILED'> {
  constructor(p: InvalidJobErrorParams) {
    super({
      code: 'VALIDATION_FAILED',
      message: 'Job does not match the job contract',
      details: { id: p.id, issues: p.issues },
    });
  }
}
