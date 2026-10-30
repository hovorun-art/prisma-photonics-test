/** Narrow-body aircraft fly short-haul routes, wide-body aircraft long-haul ones. */
export type AircraftClass = 'narrow-body' | 'wide-body';

/** An aircraft model a generated flight may use, with its typical cruise. */
export interface AircraftModel {
  readonly model: string;
  readonly class: AircraftClass;
  readonly cruiseSpeedKmh: number;
  readonly cruiseAltitudeFt: number;
}

/** The models generated flights use, per class; one is drawn within the flight's class. */
export const AIRCRAFT_MODELS: Readonly<Record<AircraftClass, readonly AircraftModel[]>> = {
  'narrow-body': [
    { model: 'A320neo', class: 'narrow-body', cruiseSpeedKmh: 830, cruiseAltitudeFt: 37_000 },
    { model: 'B737 MAX', class: 'narrow-body', cruiseSpeedKmh: 840, cruiseAltitudeFt: 37_000 },
  ],
  'wide-body': [
    { model: 'A350-900', class: 'wide-body', cruiseSpeedKmh: 905, cruiseAltitudeFt: 39_000 },
    { model: 'B787-9', class: 'wide-body', cruiseSpeedKmh: 905, cruiseAltitudeFt: 40_000 },
    { model: 'B777-300ER', class: 'wide-body', cruiseSpeedKmh: 905, cruiseAltitudeFt: 39_000 },
  ],
};

/** Two-character airline codes a generated flight number starts with. */
export const AIRLINE_CODES = [
  'BA',
  'AF',
  'LH',
  'KL',
  'IB',
  'AZ',
  'TK',
  'EK',
  'QR',
  'SQ',
  'CX',
  'NH',
  'JL',
  'QF',
  'NZ',
  'AA',
  'DL',
  'UA',
  'AC',
  'LA',
  'ET',
  'SA',
] as const;

/** Letter-only registration prefixes, so a registration reads `<prefix>-<four letters>`. */
export const REGISTRATION_PREFIXES = [
  'G',
  'F',
  'D',
  'EI',
  'PH',
  'OE',
  'HB',
  'C',
  'VH',
  'ZK',
  'ZS',
  'CC',
] as const;
