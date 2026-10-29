import { DomainError } from '@job-queue/kernel';

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
      message: 'Request validation failed',
      details: {
        issues: p.issues.map((issue) => ({ ...issue, path: ['result', ...issue.path] })),
      },
    });
  }
}
