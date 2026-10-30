import { JOB_LIMITS } from '@job-queue/contracts';

import { en } from '@/locales';

/** The execution fields every job type's form has. */
export type ExecutionField = 'priority' | 'maxAttempts';

export interface MessageExecutionFieldMessagesRequest {
  readonly field: ExecutionField;
}
export interface MessageExecutionFieldMessagesResponse {
  readonly message: string;
}

/** job-ui's messages for a rejected execution field, shared by every job type's form. */
export interface ExecutionFieldMessages {
  message(req: MessageExecutionFieldMessagesRequest): MessageExecutionFieldMessagesResponse;
}

/** `ExecutionFieldMessages` with the strings from `locales/en.ts` and the contract's limits. */
export class LocaleExecutionFieldMessages implements ExecutionFieldMessages {
  message({ field }: MessageExecutionFieldMessagesRequest): MessageExecutionFieldMessagesResponse {
    switch (field) {
      case 'priority':
        return {
          message: en.submit.errors.priority(JOB_LIMITS.priority.min, JOB_LIMITS.priority.max),
        };
      case 'maxAttempts':
        return {
          message: en.submit.errors.maxAttempts(
            JOB_LIMITS.maxAttempts.min,
            JOB_LIMITS.maxAttempts.max,
          ),
        };
    }
  }
}
