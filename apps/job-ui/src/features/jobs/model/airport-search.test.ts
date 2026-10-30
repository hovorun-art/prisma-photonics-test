import { AIRPORTS } from '@job-queue/contracts';
import { describe, expect, it } from 'vitest';

import { SubstringAirportSearch } from './airport-search';

const search = new SubstringAirportSearch({ airports: AIRPORTS });

describe('SubstringAirportSearch', () => {
  it('Search by city: `london` finds the bundled London airports and no others', () => {
    const { airports } = search.find({ text: 'london' });

    expect(airports.map((airport) => airport.iata)).toEqual(
      AIRPORTS.filter((airport) => airport.city === 'London').map((airport) => airport.iata),
    );
  });

  it('Search by code ignores case: `jfk` finds JFK only', () => {
    expect(search.find({ text: 'jfk' }).airports.map((airport) => airport.iata)).toEqual(['JFK']);
  });

  it('matches part of the name', () => {
    expect(search.find({ text: 'heathrow' }).airports.map((airport) => airport.iata)).toEqual([
      'LHR',
    ]);
  });

  it('matches the country', () => {
    const { airports } = search.find({ text: 'JAPAN' });

    expect(airports.length).toBeGreaterThan(0);
    expect(airports.every((airport) => airport.country === 'Japan')).toBe(true);
  });

  it('Nothing matches: text no airport contains finds nothing', () => {
    expect(search.find({ text: 'zzqx' }).airports).toEqual([]);
  });

  it('blank text, after trimming, lists every airport in the bundled order', () => {
    expect(search.find({ text: '  ' }).airports).toEqual(AIRPORTS);
  });

  it('ignores spaces around the text', () => {
    expect(search.find({ text: ' jfk ' }).airports.map((airport) => airport.iata)).toEqual(['JFK']);
  });
});
