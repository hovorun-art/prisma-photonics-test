/** How long a failed job waits before its next automatic attempt. */
export interface RetryDelay {
  of(req: OfRetryDelayRequest): OfRetryDelayResponse;
}

export interface OfRetryDelayRequest {
  /** 1 for the wait before the second attempt, 2 before the third, and so on. */
  retry: number;
}

export interface OfRetryDelayResponse {
  delayMs: number;
}

export const RETRY_DELAY = Symbol('RetryDelay');
