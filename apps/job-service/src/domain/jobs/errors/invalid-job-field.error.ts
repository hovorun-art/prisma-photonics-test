import { DomainError } from '@job-queue/kernel';

import { VALIDATION_FAILED_MESSAGE } from '../../http/validation-failed.js';

/** One problem with a job field, in the shape of a schema issue (path relative to the field). */
export interface JobFieldIssue {
  code: string;
  path: PropertyKey[];
  message: string;
}

export interface InvalidJobFieldErrorParams {
  /** The request field the issues are about; it is put in front of each issue path. */
  field: 'payload' | 'result';
  issues: readonly JobFieldIssue[];
}

/**
 * A job field broke a rule job-service checks itself, after the request schema: a `VALIDATION_FAILED`
 * answer that looks like any schema failure, with the issue paths given from the request's root.
 */
export class InvalidJobFieldError extends DomainError<'VALIDATION_FAILED'> {
  constructor(p: InvalidJobFieldErrorParams) {
    super({
      code: 'VALIDATION_FAILED',
      message: VALIDATION_FAILED_MESSAGE,
      details: {
        issues: p.issues.map((issue) => ({ ...issue, path: [p.field, ...issue.path] })),
      },
    });
  }
}
