import type { Airport } from '@job-queue/contracts';

export interface SubstringAirportSearchParams {
  /** The airports to search, in the order results keep. */
  readonly airports: readonly Airport[];
}

export interface FindAirportSearchRequest {
  /** What the user typed. */
  readonly text: string;
}
export interface FindAirportSearchResponse {
  readonly airports: readonly Airport[];
}

/** Finds the airports the transit form's airport fields offer for the typed text. */
export interface AirportSearch {
  find(req: FindAirportSearchRequest): FindAirportSearchResponse;
}

/**
 * Matches the typed text, ignoring case and surrounding spaces, as a plain substring of an
 * airport's code, name, city or country; blank text lists every airport.
 */
export class SubstringAirportSearch implements AirportSearch {
  constructor(private readonly p: SubstringAirportSearchParams) {}

  find({ text }: FindAirportSearchRequest): FindAirportSearchResponse {
    const needle = text.trim().toLowerCase();
    if (needle === '') return { airports: this.p.airports };
    return {
      airports: this.p.airports.filter((airport) =>
        [airport.iata, airport.name, airport.city, airport.country].some((value) =>
          value.toLowerCase().includes(needle),
        ),
      ),
    };
  }
}
