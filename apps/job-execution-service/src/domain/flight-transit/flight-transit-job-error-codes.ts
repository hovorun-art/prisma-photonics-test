/**
 * Codes the flight-transit module puts into a job's stored error (`JobError.code`). Like
 * `JOB_ERROR_CODES` they describe a job's failure, not an API error, so they are not in `ERROR_CODES`.
 */
export const FLIGHT_TRANSIT_JOB_ERROR_CODES = {
  /** The (simulated) flight data source could not provide the route; details name the airports. */
  dataUnavailable: 'FLIGHT_TRANSIT_DATA_UNAVAILABLE',
} as const;
