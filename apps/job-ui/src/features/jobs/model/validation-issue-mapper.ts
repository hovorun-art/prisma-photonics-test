import { ValidationFailedDetails } from '@job-queue/contracts';

import type {
  FieldIssues,
  JobFormErrors,
  MapFieldIssuesRequest,
  MapFieldIssuesResponse,
} from './job-form-draft';

export interface ValidationIssueMapperParams<Field extends string> {
  /** The form's fields, named by their path in the request. */
  readonly fields: readonly Field[];
}

/** `FieldIssues` for the shared `ValidationFailedDetails` contract: an issue's path names its field. */
export class ValidationIssueMapper<Field extends string> implements FieldIssues<Field> {
  private readonly fields: ReadonlySet<string>;

  constructor(p: ValidationIssueMapperParams<Field>) {
    this.fields = new Set(p.fields);
  }

  map({ details }: MapFieldIssuesRequest): MapFieldIssuesResponse<Field> {
    const parsed = ValidationFailedDetails.safeParse(details);
    const errors: JobFormErrors<Field> = {};
    const unmatched: string[] = [];
    for (const issue of parsed.success ? parsed.data.issues : []) {
      const path = issue.path.join('.');
      if (this.isField(path)) errors[path] ??= issue.message;
      else unmatched.push(issue.message);
    }
    return { errors, unmatched };
  }

  private isField(path: string): path is Field {
    return this.fields.has(path);
  }
}
