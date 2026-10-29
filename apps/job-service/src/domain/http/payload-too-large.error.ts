import { DomainError } from '@job-queue/kernel';

export interface PayloadTooLargeErrorParams {
  /** The configured body limit in bytes. */
  limitBytes: number;
}

/** The request body is larger than the configured limit. */
export class PayloadTooLargeError extends DomainError<'PAYLOAD_TOO_LARGE'> {
  constructor(p: PayloadTooLargeErrorParams) {
    super({
      code: 'PAYLOAD_TOO_LARGE',
      message: 'Request body is too large',
      details: { limitBytes: p.limitBytes },
    });
  }
}
