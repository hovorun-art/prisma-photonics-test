import type { FlightTransitJobPayload, FlightTransitJobResult } from '@job-queue/contracts';

/**
 * Makes up the report of a flight transit job: the flight, its aircraft and times, and the
 * great-circle path with waypoints between the payload's airports. Every call draws anew.
 */
export interface TransitReportGenerator {
  generate(req: GenerateTransitReportGeneratorRequest): GenerateTransitReportGeneratorResponse;
}

export interface GenerateTransitReportGeneratorRequest {
  payload: FlightTransitJobPayload;
}

export interface GenerateTransitReportGeneratorResponse {
  report: FlightTransitJobResult;
}

/** Token for `TransitReportGenerator`. */
export const TRANSIT_REPORT_GENERATOR = Symbol('TransitReportGenerator');
