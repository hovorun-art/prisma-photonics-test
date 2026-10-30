import { InvalidJobFieldError, type JobFieldIssue } from './invalid-job-field.error.js';

export interface InvalidJobResultErrorParams {
  /** Paths relative to the result. */
  issues: readonly JobFieldIssue[];
}

/** A completion was reported with a result that does not match the job type's result schema. */
export class InvalidJobResultError extends InvalidJobFieldError {
  constructor(p: InvalidJobResultErrorParams) {
    super({ field: 'result', issues: p.issues });
  }
}
