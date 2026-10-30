import type { WebhookJobPayload, WebhookJobResult } from '@job-queue/contracts';
import type { Random, Sleeper } from '@job-queue/kernel';

import type {
  JobHandler,
  RunJobHandlerRequest,
  RunJobHandlerResponse,
} from '../../domain/execution/job-handler.js';
import { WEBHOOK_JOB_ERROR_CODES } from '../../domain/webhooks/webhook-job-error-codes.js';

export interface WebhookJobHandlerDeps {
  random: Random;
  sleeper: Sleeper;
}

export interface WebhookJobHandlerParams {
  /** How long the simulated call takes, in milliseconds. */
  callMs: number;
  /** The share of attempts that fail, in [0, 1]: 0 never fails, 1 always fails. */
  failureRate: number;
}

/** The statuses a failed simulated call answers with, one picked at random. */
const FAILURE_STATUSES = [500, 502, 503, 504] as const;

/**
 * Simulates calling a webhook without calling it: waits the configured time, then fails at the
 * configured rate with a random 5xx status, or answers 200 with an acknowledgement.
 */
export class WebhookJobHandler implements JobHandler {
  constructor(
    private readonly d: WebhookJobHandlerDeps,
    private readonly p: WebhookJobHandlerParams,
  ) {}

  async run(req: RunJobHandlerRequest): Promise<RunJobHandlerResponse> {
    await this.d.sleeper.sleep({ ms: this.p.callMs, signal: req.signal });
    // Only webhook jobs are routed to this handler.
    const { method, url } = req.job.payload as WebhookJobPayload;

    if (this.d.random.next().value < this.p.failureRate) {
      const { value: index } = this.d.random.int({ min: 0, max: FAILURE_STATUSES.length - 1 });
      const statusCode = FAILURE_STATUSES[index] ?? FAILURE_STATUSES[0];
      return {
        outcome: 'failed',
        error: {
          code: WEBHOOK_JOB_ERROR_CODES.httpError,
          message: `Webhook ${method} ${url} answered ${String(statusCode)}`,
          details: { statusCode },
        },
      };
    }

    const result: WebhookJobResult = {
      statusCode: 200,
      responseBody: { received: true, requestId: this.d.random.uuid().value },
    };
    return { outcome: 'completed', result };
  }
}
