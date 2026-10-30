import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { transitJobFixtures } from '../../jobs/testing/job-fixtures';
import { IntlTransitReportPresenter } from './intl-transit-report-presenter';

const job = transitJobFixtures.completed();
const report = job.result!;

describe('IntlTransitReportPresenter', () => {
  // Built in a zone far from UTC, so a format that forgets to pin UTC shows the wrong times.
  let presenter: IntlTransitReportPresenter;
  beforeAll(() => {
    process.env.TZ = 'Asia/Tokyo';
    presenter = new IntlTransitReportPresenter();
  });
  afterAll(() => {
    process.env.TZ = 'UTC';
  });

  it('Report header: the title is "<origin> → <destination>"', () => {
    expect(presenter.title({ report }).text).toBe('LHR → JFK');
  });

  it('Summary tiles: distance, duration with UTC times, average ground speed and cruise level', () => {
    expect(presenter.tiles({ report })).toEqual({
      distance: '5,540 km',
      duration: '7h 45m',
      times: '10:35 → 18:20 UTC',
      groundSpeed: '715 km/h',
      cruise: 'FL360',
    });
  });

  it('Summary tiles: a cruise below 10,000 ft keeps three digits, a zero duration has no speed', () => {
    const tiles = presenter.tiles({
      report: { ...report, cruiseAltitudeFt: 9000, durationMin: 0 },
    });

    expect(tiles.cruise).toBe('FL090');
    expect(tiles.groundSpeed).toBe('—');
  });

  it('Summary tiles: the duration is rounded to whole minutes and never reads 60m', () => {
    expect(presenter.tiles({ report: { ...report, durationMin: 464.6 } }).duration).toBe('7h 45m');
    expect(presenter.tiles({ report: { ...report, durationMin: 119.6 } }).duration).toBe('2h 0m');
  });

  it('Airport cards: coordinates to four decimals, departure in UTC and the local time with its zone', () => {
    expect(presenter.airport({ airport: report.origin, at: report.departureAt })).toEqual({
      coordinates: '51.4700° N, 0.4543° W',
      utc: '28 Oct 2026, 10:35 UTC',
      local: '10:35 GMT',
    });
  });

  it('Airport cards: arrival in New York shows the local summer time zone', () => {
    expect(presenter.airport({ airport: report.destination, at: report.arrivalAt })).toEqual({
      coordinates: '40.6413° N, 73.7781° W',
      utc: '28 Oct 2026, 18:20 UTC',
      local: '14:20 EDT',
    });
  });

  it('Airport cards: southern and eastern coordinates read S and E', () => {
    const sydney = { ...report.origin, lat: -33.9399, lon: 151.1753, timeZone: 'Australia/Sydney' };

    expect(presenter.airport({ airport: sydney, at: report.departureAt }).coordinates).toBe(
      '33.9399° S, 151.1753° E',
    );
  });

  it('Departure selected at first: the departure card reads Ground, 0 km/h and nothing flown', () => {
    expect(presenter.waypoint({ report, waypoint: report.waypoints[0]! })).toEqual({
      name: 'Departure · LHR',
      time: '10:35 UTC',
      position: '51.47° N, 0.45° W',
      altitude: 'Ground',
      groundSpeed: '0 km/h',
      flownLeft: '0 / 5,540 km',
      aircraft: 'TX 401 · Boeing 777-300ER',
      label: 'Departure · LHR, 10:35 UTC',
    });
  });

  it('Hover a waypoint: a cruise waypoint shows its time, position, flight level, speed and flown / left', () => {
    expect(presenter.waypoint({ report, waypoint: report.waypoints[1]! })).toEqual({
      name: 'Oceanic entry',
      time: '12:31 UTC',
      position: '53.64° N, 20.70° W',
      altitude: 'FL350',
      groundSpeed: '905 km/h',
      flownLeft: '1,385 / 4,155 km',
      aircraft: 'TX 401 · Boeing 777-300ER',
      label: 'Oceanic entry, 12:31 UTC',
    });
  });

  it('a waypoint past the reported distance has nothing left, not a negative distance', () => {
    const beyond = { ...report.waypoints[5]!, distanceFlownKm: 5600 };

    expect(presenter.waypoint({ report, waypoint: beyond }).flownLeft).toBe('5,600 / 0 km');
  });

  it('the Result card heading counts the path points', () => {
    expect(presenter.pathPoints({ report }).text).toBe('result · 9 path points');
  });
});
