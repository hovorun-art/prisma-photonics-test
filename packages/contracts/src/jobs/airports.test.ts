import { describe, expect, it } from 'vitest';

import { AIRPORT_CODES, AIRPORTS, Airport } from './airports.js';

const NORTH_AMERICA = ['United States', 'Canada', 'Mexico'];
const SOUTH_AMERICA = ['Brazil', 'Argentina', 'Chile', 'Colombia', 'Peru'];

describe('AIRPORTS', () => {
  it('Bundled airports cover the inhabited continents', () => {
    for (const airport of AIRPORTS) {
      expect(Airport.parse(airport)).toEqual(airport);
      expect(airport.iata).toMatch(/^[A-Z]{3}$/);
      expect(() => new Intl.DateTimeFormat('en', { timeZone: airport.timeZone })).not.toThrow();
    }
    expect(new Set(AIRPORT_CODES).size).toBe(AIRPORTS.length);
    expect(AIRPORT_CODES).toEqual(expect.arrayContaining(['LHR', 'JFK']));

    const zones = AIRPORTS.map((airport) => airport.timeZone);
    for (const prefix of ['Europe/', 'Asia/', 'Africa/']) {
      expect(zones.some((zone) => zone.startsWith(prefix))).toBe(true);
    }
    expect(zones.some((zone) => /^(Australia|Pacific)\//.test(zone))).toBe(true);
    const countries = AIRPORTS.map((airport) => airport.country);
    expect(countries.some((country) => NORTH_AMERICA.includes(country))).toBe(true);
    expect(countries.some((country) => SOUTH_AMERICA.includes(country))).toBe(true);
  });
});

describe('Airport', () => {
  const lhr = {
    iata: 'LHR',
    name: 'Heathrow Airport',
    city: 'London',
    country: 'United Kingdom',
    lat: 51.47,
    lon: -0.4543,
    timeZone: 'Europe/London',
  };

  it('rejects coordinates outside the globe', () => {
    for (const coordinates of [{ lat: 90.1 }, { lat: -90.1 }, { lon: 180.1 }, { lon: -180.1 }]) {
      expect(Airport.safeParse({ ...lhr, ...coordinates }).success).toBe(false);
    }
  });

  it('accepts coordinates on the limits', () => {
    expect(Airport.safeParse({ ...lhr, lat: 90, lon: -180 }).success).toBe(true);
    expect(Airport.safeParse({ ...lhr, lat: -90, lon: 180 }).success).toBe(true);
  });
});
