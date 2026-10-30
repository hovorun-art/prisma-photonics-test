import type { CreateJobRequest, JobType } from '@job-queue/contracts';
import { Copy } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import { type FieldValues, FormProvider, type Path } from 'react-hook-form';

import { Button } from '@/components/ui/button';
import { en } from '@/locales';

import { type ApplyApiIssuesResponse, useApiIssues } from '../../jobs/hooks/use-api-issues';
import { useTypedJobForm } from '../../jobs/hooks/use-typed-job-form';
import { DEFAULT_JOB_FORM_EXECUTION } from '../../jobs/model/default-job-form-execution';
import type { JobFormDraft, JobFormExecution } from '../../jobs/model/job-form-draft';
import { FieldIdPrefixContext } from '../../jobs/submit/field-id-prefix-context';
import { type JobFormFields, JobFormSections } from '../../jobs/submit/job-form-sections';
import { JobTypeForms } from '../../jobs/submit/job-type-forms';
import { JobTypePicker } from '../../jobs/submit/job-type-picker';
import type { GroupJobSeed } from '../model/group-job-tabs';

export interface ValidateGroupJobTabResponse {
  /** The job as the API accepts it, or `null` when a field is invalid (now shown on the form). */
  readonly request: CreateJobRequest | null;
}
export interface ShowApiIssuesGroupJobTabRequest {
  /** This job's part of a bulk `VALIDATION_FAILED` answer, paths relative to the job. */
  readonly details: Readonly<Record<string, unknown>>;
}
export type ShowApiIssuesGroupJobTabResponse = ApplyApiIssuesResponse;

/** What the new group page asks of a tab's form when the group is created. */
export interface GroupJobTabHandle {
  validate(): Promise<ValidateGroupJobTabResponse>;
  showApiIssues(req: ShowApiIssuesGroupJobTabRequest): ShowApiIssuesGroupJobTabResponse;
}

/**
 * One job of the new group page: the submit page's job form, with the type kept in the tab (not
 * the URL) and a Duplicate button. Stays mounted while hidden, so values and errors survive.
 */
export function GroupJobTab({
  tabKey,
  seed,
  canDuplicate,
  onDuplicate,
  onTypeChange,
  onErrorsChange,
  onHandle,
}: {
  tabKey: number;
  seed: GroupJobSeed;
  canDuplicate: boolean;
  onDuplicate: (tabKey: number, seed: GroupJobSeed) => void;
  onTypeChange: (tabKey: number, type: JobType) => void;
  onErrorsChange: (tabKey: number, hasErrors: boolean) => void;
  onHandle: (tabKey: number, handle: GroupJobTabHandle | null) => void;
}) {
  const [type, setType] = useState(seed.type);
  // A duplicate's values apply to the type it was copied with; a type switch starts fresh.
  const [initial, setInitial] = useState(seed.values);
  const [execution, setExecution] = useState<JobFormExecution>(() => {
    const values = seed.values ?? {};
    return {
      priority:
        typeof values.priority === 'number' ? values.priority : DEFAULT_JOB_FORM_EXECUTION.priority,
      maxAttempts:
        typeof values.maxAttempts === 'number'
          ? values.maxAttempts
          : DEFAULT_JOB_FORM_EXECUTION.maxAttempts,
      run: values.run === 'later' ? 'later' : DEFAULT_JOB_FORM_EXECUTION.run,
      scheduledAt:
        typeof values.scheduledAt === 'string'
          ? values.scheduledAt
          : DEFAULT_JOB_FORM_EXECUTION.scheduledAt,
    };
  });

  const choose = (next: JobType) => {
    if (next === type) return;
    setInitial(undefined);
    setType(next);
    onTypeChange(tabKey, next);
  };
  const common = {
    tabKey,
    initial,
    execution,
    canDuplicate,
    onExecutionChange: setExecution,
    onChoose: choose,
    onDuplicate,
    onErrorsChange,
    onHandle,
  };

  return (
    <FieldIdPrefixContext value={`job-${tabKey}`}>
      {/* Keyed by type: a switch starts a fresh form, so the payload fields start empty. */}
      <JobTypeForms
        type={type}
        render={(parts) => <TabForm key={parts.type} {...parts} {...common} />}
      />
    </FieldIdPrefixContext>
  );
}

/** The form of one job type in a tab, with the handle the page validates and submits through. */
function TabForm<Values extends FieldValues, Field extends Path<Values>>({
  tabKey,
  type,
  draft,
  payload,
  initial,
  execution,
  canDuplicate,
  onExecutionChange,
  onChoose,
  onDuplicate,
  onErrorsChange,
  onHandle,
}: {
  tabKey: number;
  type: JobType;
  draft: JobFormDraft<Values, Field>;
  payload: (fields: JobFormFields<Field>) => ReactNode;
  initial: Readonly<Record<string, unknown>> | undefined;
  execution: JobFormExecution;
  canDuplicate: boolean;
  onExecutionChange: (execution: JobFormExecution) => void;
  onChoose: (type: JobType) => void;
  onDuplicate: (tabKey: number, seed: GroupJobSeed) => void;
  onErrorsChange: (tabKey: number, hasErrors: boolean) => void;
  onHandle: (tabKey: number, handle: GroupJobTabHandle | null) => void;
}) {
  const form = useTypedJobForm({
    draft,
    initialValues: initial,
    execution,
    onExecutionChange,
    // The form may be in a hidden tab; the page opens the first invalid tab instead.
    shouldFocusError: false,
  });
  const applyIssues = useApiIssues({ form, draft });
  const hasErrors = Object.keys(form.formState.errors).length > 0;

  useEffect(() => {
    onErrorsChange(tabKey, hasErrors);
  }, [tabKey, hasErrors, onErrorsChange]);
  useEffect(() => {
    onHandle(tabKey, {
      validate: () =>
        new Promise((resolve) => {
          void form.handleSubmit(
            (request) => {
              resolve({ request });
            },
            () => {
              resolve({ request: null });
            },
          )();
        }),
      showApiIssues: applyIssues,
    });
    return () => {
      onHandle(tabKey, null);
    };
  }, [tabKey, form, applyIssues, onHandle]);

  return (
    <FormProvider {...form}>
      <div className="flex justify-end border-b border-border-soft px-6 pt-4 pb-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!canDuplicate}
          onClick={() => {
            onDuplicate(tabKey, { type, values: form.getValues() });
          }}
        >
          <Copy className="size-3.5" aria-hidden="true" />
          {en.newGroup.duplicate}
        </Button>
      </div>
      <JobFormSections
        draft={draft}
        picker={<JobTypePicker selected={type} onSelect={onChoose} />}
        payload={payload}
      />
    </FormProvider>
  );
}
