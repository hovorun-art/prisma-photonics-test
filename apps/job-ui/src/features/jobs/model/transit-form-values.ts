import type { AirportCode } from '@job-queue/contracts';

import type { RunScheduleValues } from './run-schedule';

/**
 * What the transit form holds: the request it sends, except that an airport not chosen yet is
 * empty and the time to run is the run choice and its local text. Field names are request paths.
 */
export interface TransitFormValues extends RunScheduleValues {
  type: 'flight-transit';
  payload: { origin: AirportCode | ''; destination: AirportCode | ''; departureDate: string };
  priority?: number;
  maxAttempts?: number;
}

export const TRANSIT_FORM_FIELDS = [
  'payload.origin',
  'payload.destination',
  'payload.departureDate',
  'priority',
  'maxAttempts',
  'scheduledAt',
] as const;
export type TransitFormField = (typeof TRANSIT_FORM_FIELDS)[number];
