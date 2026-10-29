import { DomainError } from '@job-queue/kernel';

import { VALIDATION_FAILED_MESSAGE } from '../../http/validation-failed.js';

/** One problem with a reported result, in the shape of a schema issue (path relative to the result). */
export interface JobResultIssue {
  code: string;
  path: PropertyKey[];
  message: string;
}

export interface InvalidJobResultErrorParams {
  issues: readonly JobResultIssue[];
}

/** A completion was reported with a result that does not match the job type's result schema. */
export class InvalidJobResultError extends DomainError<'VALIDATION_FAILED'> {
  constructor(p: InvalidJobResultErrorParams) {
    super({
      code: 'VALIDATION_FAILED',
      message: VALIDATION_FAILED_MESSAGE,
      details: {
        issues: p.issues.map((issue) => ({ ...issue, path: ['result', ...issue.path] })),
      },
    });
  }
}
