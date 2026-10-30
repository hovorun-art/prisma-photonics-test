import type { AirportCode } from '@job-queue/contracts';

/**
 * What the transit form holds: the request it sends, except that an airport not chosen yet is
 * empty. Field names are request paths.
 */
export interface TransitFormValues {
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
] as const;
export type TransitFormField = (typeof TRANSIT_FORM_FIELDS)[number];
