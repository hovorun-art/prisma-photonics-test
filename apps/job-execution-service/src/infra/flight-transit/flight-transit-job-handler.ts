import type { FlightTransitJobPayload } from '@job-queue/contracts';
import type { Random, Sleeper } from '@job-queue/kernel';
import type { LoggerService } from '@nestjs/common';

import type {
  JobHandler,
  RunJobHandlerRequest,
  RunJobHandlerResponse,
} from '../../domain/execution/job-handler.js';
import { FLIGHT_TRANSIT_JOB_ERROR_CODES } from '../../domain/flight-transit/flight-transit-job-error-codes.js';
import type { TransitReportGenerator } from '../../domain/flight-transit/transit-report-generator.js';

export interface FlightTransitJobHandlerDeps {
  random: Random;
  sleeper: Sleeper;
  reports: TransitReportGenerator;
  logger: Pick<LoggerService, 'log'>;
}

export interface FlightTransitJobHandlerParams {
  /** How long fetching the (simulated) flight data takes, in milliseconds. */
  generateMs: number;
  /** The share of attempts that fail, in [0, 1]: 0 never fails, 1 always fails. */
  failureRate: number;
}

/**
 * Simulates fetching a flight's data: waits the configured time, then fails at the configured rate
 * as if the data source had nothing for the route, or completes with a freshly generated report.
 */
export class FlightTransitJobHandler implements JobHandler {
  constructor(
    private readonly d: FlightTransitJobHandlerDeps,
    private readonly p: FlightTransitJobHandlerParams,
  ) {}

  async run(req: RunJobHandlerRequest): Promise<RunJobHandlerResponse> {
    await this.d.sleeper.sleep({ ms: this.p.generateMs, signal: req.signal });
    // Only flight transit jobs are routed to this handler.
    const payload = req.job.payload as FlightTransitJobPayload;
    const { origin, destination } = payload;

    if (this.d.random.next().value < this.p.failureRate) {
      return {
        outcome: 'failed',
        error: {
          code: FLIGHT_TRANSIT_JOB_ERROR_CODES.dataUnavailable,
          message: `Flight data for ${origin}-${destination} is unavailable`,
          details: { origin, destination },
        },
      };
    }

    const { report } = this.d.reports.generate({ payload });
    this.d.logger.log(
      {
        jobId: req.job.id,
        attempt: req.attempt,
        flight: report.flight,
        distanceKm: report.distanceKm,
        durationMin: report.durationMin,
      },
      'Transit report generated',
    );
    return { outcome: 'completed', result: report };
  }
}
