import type { ErrorCode } from '@job-queue/contracts';

import type { ApiErrorShape } from './jobs-api';

export interface ApiErrorParams {
  readonly status: number | null;
  readonly code: ErrorCode | null;
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
}

/** Thrown by `JobsApi` when a call fails; the UI switches on `code`, never on `message`. */
export class ApiError extends Error implements ApiErrorShape {
  readonly status: number | null;
  readonly code: ErrorCode | null;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(p: ApiErrorParams) {
    super(p.message);
    this.name = 'ApiError';
    this.status = p.status;
    this.code = p.code;
    this.details = p.details ?? {};
  }
}
