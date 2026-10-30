import type { EmailJobResult } from '@job-queue/contracts';
import type { Random, Sleeper } from '@job-queue/kernel';

import type {
  JobHandler,
  RunJobHandlerRequest,
  RunJobHandlerResponse,
} from '../../domain/execution/job-handler.js';

export interface EmailJobHandlerDeps {
  random: Random;
  sleeper: Sleeper;
}

export interface EmailJobHandlerParams {
  /** The simulated send takes a random time in [min, max] milliseconds. */
  sendMinMs: number;
  sendMaxMs: number;
}

/** Simulates sending an email: waits a random, configured time and returns a mock message id. */
export class EmailJobHandler implements JobHandler {
  constructor(
    private readonly d: EmailJobHandlerDeps,
    private readonly p: EmailJobHandlerParams,
  ) {}

  async run(req: RunJobHandlerRequest): Promise<RunJobHandlerResponse> {
    const { value: ms } = this.d.random.int({ min: this.p.sendMinMs, max: this.p.sendMaxMs });
    await this.d.sleeper.sleep({ ms, signal: req.signal });
    const result: EmailJobResult = { messageId: this.d.random.uuid().value };
    return { outcome: 'completed', result };
  }
}
