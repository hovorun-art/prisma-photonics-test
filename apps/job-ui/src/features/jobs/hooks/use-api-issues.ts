import type { CreateJobRequest } from '@job-queue/contracts';
import { useCallback } from 'react';
import type { FieldValues, Path, UseFormReturn } from 'react-hook-form';

import type { JobFormDraft } from '../model/job-form-draft';
import { API_ERROR } from '../submit/job-form-sections';

export interface ApplyApiIssuesRequest {
  /** The `details` of a `VALIDATION_FAILED` answer, paths relative to this job. */
  readonly details: Readonly<Record<string, unknown>>;
}
export interface ApplyApiIssuesResponse {
  /** How many fields of the form now show an API issue. */
  readonly fieldCount: number;
  /** Messages of the issues that match no field of the form. */
  readonly unmatched: readonly string[];
}

/**
 * Shows an API `VALIDATION_FAILED` answer on a job form: each issue for a field under that field,
 * with the API's own message; the rest is returned for the alert (see `RejectionAlert`).
 */
export function useApiIssues<Values extends FieldValues, Field extends Path<Values>>({
  form,
  draft,
}: {
  form: UseFormReturn<Values, unknown, CreateJobRequest>;
  draft: JobFormDraft<Values, Field>;
}): (req: ApplyApiIssuesRequest) => ApplyApiIssuesResponse {
  return useCallback(
    ({ details }: ApplyApiIssuesRequest) => {
      const mapped = draft.apiErrors({ details });
      for (const [name, message] of Object.entries(mapped.errors)) {
        form.setError(name as Field, { type: API_ERROR, message: message as string });
      }
      return { fieldCount: Object.keys(mapped.errors).length, unmatched: mapped.unmatched };
    },
    [form, draft],
  );
}
