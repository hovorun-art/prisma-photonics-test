import { zodResolver } from '@hookform/resolvers/zod';
import { type CreateJobRequest, JOB_LIMITS, type JobType } from '@job-queue/contracts';
import { Copy } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import {
  type DefaultValues,
  type FieldValues,
  FormProvider,
  type Path,
  useForm,
} from 'react-hook-form';

import { Button } from '@/components/ui/button';
import { en } from '@/locales';

import { useEmailJobDraft } from '../../jobs/hooks/use-email-job-draft';
import { useTransitJobDraft } from '../../jobs/hooks/use-transit-job-draft';
import { useWebhookJobDraft } from '../../jobs/hooks/use-webhook-job-draft';
import type { JobFormDraft, JobFormExecution } from '../../jobs/model/job-form-draft';
import { EmailPayloadFields } from '../../jobs/submit/email-payload-fields';
import { FieldIdPrefixContext } from '../../jobs/submit/field-id-prefix-context';
import {
  API_ERROR,
  type JobFormFields,
  JobFormSections,
} from '../../jobs/submit/job-form-sections';
import { JobTypePicker } from '../../jobs/submit/job-type-picker';
import { TransitPayloadFields } from '../../jobs/submit/transit-payload-fields';
import { WebhookPayloadFields } from '../../jobs/submit/webhook-payload-fields';
import type { GroupJobSeed } from '../model/group-job-tabs';

const DEFAULT_EXECUTION: JobFormExecution = {
  priority: JOB_LIMITS.priority.default,
  maxAttempts: JOB_LIMITS.maxAttempts.default,
};

export interface ValidateGroupJobTabResponse {
  /** The job as the API accepts it, or `null` when a field is invalid (now shown on the form). */
  readonly request: CreateJobRequest | null;
}
export interface ShowApiIssuesGroupJobTabRequest {
  /** This job's part of a bulk `VALIDATION_FAILED` answer, paths relative to the job. */
  readonly details: Readonly<Record<string, unknown>>;
}
export interface ShowApiIssuesGroupJobTabResponse {
  /** How many fields of the form now show an API issue. */
  readonly fieldCount: number;
  /** Messages of the issues that match no field of the form. */
  readonly unmatched: readonly string[];
}

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
    const priority = seed.values?.priority;
    const maxAttempts = seed.values?.maxAttempts;
    return {
      priority: typeof priority === 'number' ? priority : DEFAULT_EXECUTION.priority,
      maxAttempts: typeof maxAttempts === 'number' ? maxAttempts : DEFAULT_EXECUTION.maxAttempts,
    };
  });
  const emailDraft = useEmailJobDraft();
  const webhookDraft = useWebhookJobDraft();
  const transitDraft = useTransitJobDraft();

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
      {type === 'flight-transit' && (
        <TabForm
          key="flight-transit"
          type="flight-transit"
          draft={transitDraft}
          payload={(fields) => <TransitPayloadFields fields={fields} />}
          {...common}
        />
      )}
      {type === 'webhook' && (
        <TabForm
          key="webhook"
          type="webhook"
          draft={webhookDraft}
          payload={(fields) => <WebhookPayloadFields fields={fields} />}
          {...common}
        />
      )}
      {type === 'email' && (
        <TabForm
          key="email"
          type="email"
          draft={emailDraft}
          payload={(fields) => <EmailPayloadFields fields={fields} />}
          {...common}
        />
      )}
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
  // Checked with the type's form schema, built from the contract job-service validates with.
  const [resolver] = useState(() =>
    zodResolver<Values, unknown, CreateJobRequest>(draft.schema().schema),
  );
  const form = useForm<Values, unknown, CreateJobRequest>({
    defaultValues: (initial ?? draft.emptyValues({ execution }).values) as DefaultValues<Values>,
    resolver,
    // The form may be in a hidden tab; the page opens the first invalid tab instead.
    shouldFocusError: false,
  });
  const hasErrors = Object.keys(form.formState.errors).length > 0;

  useEffect(() => {
    onErrorsChange(tabKey, hasErrors);
  }, [tabKey, hasErrors, onErrorsChange]);
  useEffect(
    () =>
      form.subscribe({
        formState: { values: true },
        callback: ({ values: current }) => {
          const { priority, maxAttempts } = current as Partial<JobFormExecution>;
          onExecutionChange({
            priority: priority ?? DEFAULT_EXECUTION.priority,
            maxAttempts: maxAttempts ?? DEFAULT_EXECUTION.maxAttempts,
          });
        },
      }),
    [form, onExecutionChange],
  );
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
      showApiIssues: ({ details }) => {
        const mapped = draft.apiErrors({ details });
        for (const [name, message] of Object.entries(mapped.errors)) {
          form.setError(name as Field, { type: API_ERROR, message: message as string });
        }
        return { fieldCount: Object.keys(mapped.errors).length, unmatched: mapped.unmatched };
      },
    });
    return () => {
      onHandle(tabKey, null);
    };
  }, [tabKey, form, draft, onHandle]);

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
