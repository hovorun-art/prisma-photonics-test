import { zodResolver } from '@hookform/resolvers/zod';
import type { CreateJobRequest } from '@job-queue/contracts';
import { useEffect, useState } from 'react';
import { type DefaultValues, type FieldValues, type Path, useForm } from 'react-hook-form';

import { DEFAULT_JOB_FORM_EXECUTION } from '../model/default-job-form-execution';
import type { JobFormDraft, JobFormExecution } from '../model/job-form-draft';

/**
 * The form of one job type: checked with the type's form schema (built from the contract
 * job-service validates with), started at `initialValues` or the type's initial values, and
 * reporting the execution settings (Priority, Max attempts, the run choice) as they change, so a type switch can keep them.
 */
export function useTypedJobForm<Values extends FieldValues, Field extends Path<Values>>({
  draft,
  initialValues,
  execution,
  onExecutionChange,
  shouldFocusError = true,
}: {
  draft: JobFormDraft<Values, Field>;
  /** Values to start with instead of the type's initial values (a duplicated job's). */
  initialValues?: Readonly<Record<string, unknown>>;
  execution: JobFormExecution;
  onExecutionChange: (execution: JobFormExecution) => void;
  /** Off where the form may be hidden (a tab that is not open). */
  shouldFocusError?: boolean;
}) {
  const [resolver] = useState(() =>
    zodResolver<Values, unknown, CreateJobRequest>(draft.schema().schema),
  );
  const form = useForm<Values, unknown, CreateJobRequest>({
    defaultValues: (initialValues ??
      draft.emptyValues({ execution }).values) as DefaultValues<Values>,
    resolver,
    shouldFocusError,
  });
  useEffect(
    () =>
      form.subscribe({
        formState: { values: true },
        callback: ({ values: current }) => {
          const { priority, maxAttempts, run, scheduledAt } = current as Partial<JobFormExecution>;
          onExecutionChange({
            priority: priority ?? DEFAULT_JOB_FORM_EXECUTION.priority,
            maxAttempts: maxAttempts ?? DEFAULT_JOB_FORM_EXECUTION.maxAttempts,
            run: run ?? DEFAULT_JOB_FORM_EXECUTION.run,
            scheduledAt: scheduledAt ?? DEFAULT_JOB_FORM_EXECUTION.scheduledAt,
          });
        },
      }),
    [form, onExecutionChange],
  );
  return form;
}
