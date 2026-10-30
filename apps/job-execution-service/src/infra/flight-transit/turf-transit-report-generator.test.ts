import { TZDate } from '@date-fns/tz';
import {
  AIRPORTS,
  FlightTransitJobResult,
  type Airport,
  type FlightTransitJobPayload,
} from '@job-queue/contracts';
import type { Random } from '@job-queue/kernel';
import distance from '@turf/distance';
import { point } from '@turf/helpers';
import { beforeEach, describe, expect, it } from 'vitest';
import { mockDeep, type DeepMockProxy } from 'vitest-mock-extended';

import { AIRLINE_CODES, REGISTRATION_PREFIXES } from './flight-data.js';
import { TurfTransitReportGenerator } from './turf-transit-report-generator.js';

const PARAMS = {
  pathPoints: 64,
  cruiseWaypoints: 4,
  longHaulKm: 4000,
  climbKm: 200,
  descentKm: 250,
  taxiSpeedKmh: 30,
};
const EARTH_RADIUS_KM = 6371;
const MINUTE_MS = 60_000;
/** 01:00 local on 2027-03-28 does not exist in London; the library moves it forward an hour. */
const SPRING_FORWARD_DEPARTURE = '2027-03-28T01:00:00.000Z';

const LHR_JFK: FlightTransitJobPayload = {
  origin: 'LHR',
  destination: 'JFK',
  departureDate: '2026-11-02',
};
const LHR_CDG: FlightTransitJobPayload = { ...LHR_JFK, destination: 'CDG' };

/** The random values one report draws, in the generator's draw order. */
interface Draws {
  slot: number;
  airline: number;
  number: number;
  model: number;
  prefix: number;
  letters: [number, number, number, number];
}

const DRAWS: Draws = {
  slot: 0,
  airline: 0,
  number: 117,
  model: 0,
  prefix: 0,
  letters: [0, 0, 0, 0],
};

describe('TurfTransitReportGenerator', () => {
  let random: DeepMockProxy<Random>;

  const airport = (iata: string): Airport => {
    const found = AIRPORTS.find((entry) => entry.iata === iata);
    if (found === undefined) throw new Error(`No bundled airport ${iata}`);
    return found;
  };

  /** Great-circle distance in km on the spec's 6371 km sphere, `[lat, lon]` in. */
  const kmBetween = (a: readonly [number, number], b: readonly [number, number]): number =>
    distance(point([a[1], a[0]]), point([b[1], b[0]]), { units: 'radians' }) * EARTH_RADIUS_KM;

  const coordinates = (iata: string): [number, number] => [airport(iata).lat, airport(iata).lon];

  const generator = (params: Partial<typeof PARAMS> = {}): TurfTransitReportGenerator =>
    new TurfTransitReportGenerator({ random }, { ...PARAMS, ...params });

  const stub = (draws: Partial<Draws> = {}): void => {
    const all = { ...DRAWS, ...draws };
    for (const value of [
      all.slot,
      all.airline,
      all.number,
      all.model,
      all.prefix,
      ...all.letters,
    ]) {
      random.int.mockReturnValueOnce({ value });
    }
  };

  const generate = (
    payload: FlightTransitJobPayload,
    draws: Partial<Draws> = {},
    params: Partial<typeof PARAMS> = {},
  ): FlightTransitJobResult => {
    stub(draws);
    const before = random.int.mock.calls.length;
    const { report } = generator(params).generate({ payload });
    // Every report makes exactly the nine draws of the fixed draw order.
    expect(random.int.mock.calls.length - before).toBe(9);
    expect(FlightTransitJobResult.parse(report)).toEqual(report);
    return report;
  };

  beforeEach(() => {
    random = mockDeep<Random>();
  });

  it("Report airports are the payload's airports", () => {
    const report = generate(LHR_JFK);

    for (const [card, iata] of [
      [report.origin, 'LHR'],
      [report.destination, 'JFK'],
    ] as const) {
      const { name, city, timeZone, lat, lon } = airport(iata);
      expect(card).toEqual({ iata, name, city, timeZone, lat, lon });
    }
  });

  it('Report distance is the great-circle distance', () => {
    const report = generate(LHR_JFK);

    expect(report.distanceKm).toBe(Math.round(kmBetween(coordinates('LHR'), coordinates('JFK'))));
  });

  it('Path runs from origin to destination', () => {
    const { path } = generate(LHR_JFK);
    const total = kmBetween(coordinates('LHR'), coordinates('JFK'));
    const step = total / (PARAMS.pathPoints - 1);

    expect(path).toHaveLength(PARAMS.pathPoints);
    expect(path[0]).toEqual(coordinates('LHR'));
    expect(path.at(-1)).toEqual(coordinates('JFK'));
    path.forEach((p, i) => {
      // On the great circle: the distances to both ends add up to the whole route.
      expect(kmBetween(coordinates('LHR'), p)).toBeCloseTo(i * step, 1);
      expect(kmBetween(p, coordinates('JFK'))).toBeCloseTo(total - i * step, 1);
    });
  });

  it('Path across the antimeridian stays in range', () => {
    const report = generate({ origin: 'NRT', destination: 'LAX', departureDate: '2026-11-02' });
    const longitudes = [
      ...report.path.map(([, lon]) => lon),
      ...report.waypoints.map((waypoint) => waypoint.lon),
    ];

    for (const lon of longitudes) {
      expect(lon).toBeGreaterThanOrEqual(-180);
      expect(lon).toBeLessThanOrEqual(180);
    }
    // The route crosses the 180th meridian instead of going round the other way.
    expect(longitudes.some((lon) => lon > 170)).toBe(true);
    expect(longitudes.some((lon) => lon < -170)).toBe(true);
    report.path.slice(1).forEach((p, i) => {
      const previous = report.path[i];
      if (previous !== undefined) expect(kmBetween(previous, p)).toBeLessThan(200);
    });
  });

  it("Departure lies within the date in the origin's time zone", () => {
    const payload: FlightTransitJobPayload = {
      origin: 'SYD',
      destination: 'LAX',
      departureDate: '2026-11-02',
    };
    const first = generate(payload, { slot: 0 });
    const last = generate(payload, { slot: 287 });

    expect(first.departureAt).toBe('2026-11-01T13:00:00.000Z');
    for (const { departureAt } of [first, last]) {
      const local = new TZDate(departureAt, 'Australia/Sydney');
      expect([local.getFullYear(), local.getMonth() + 1, local.getDate()]).toEqual([2026, 11, 2]);
    }
    expect(random.int).toHaveBeenNthCalledWith(1, { min: 0, max: 287 });
  });

  it('Departure is on a whole five minutes', () => {
    const { departureAt } = generate(LHR_JFK, { slot: 7 });
    const at = new Date(departureAt);

    expect(at.getUTCMinutes() % 5).toBe(0);
    expect([at.getUTCSeconds(), at.getUTCMilliseconds()]).toEqual([0, 0]);
    // LHR is on GMT in November, so slot 7 is 00:35 UTC.
    expect(departureAt).toBe('2026-11-02T00:35:00.000Z');
  });

  it('Arrival is departure plus duration', () => {
    const report = generate(LHR_JFK, { slot: 150 });

    expect(Date.parse(report.arrivalAt) - Date.parse(report.departureAt)).toBe(
      report.durationMin * MINUTE_MS,
    );
  });

  it('Short-haul flight gets a narrow-body aircraft', () => {
    const report = generate(LHR_CDG, { model: 1 });

    expect(report.aircraft.model).toBe('B737 MAX');
    expect(report.cruiseAltitudeFt).toBe(37_000);
    expect(random.int).toHaveBeenNthCalledWith(4, { min: 0, max: 1 });
  });

  it('Long-haul flight gets a wide-body aircraft', () => {
    const report = generate(LHR_JFK, { model: 1 });

    expect(report.aircraft.model).toBe('B787-9');
    expect(report.cruiseAltitudeFt).toBe(40_000);
    expect(random.int).toHaveBeenNthCalledWith(4, { min: 0, max: 2 });
  });

  it('Flight number and registration have their formats', () => {
    const short = generate(LHR_JFK, {
      airline: 0,
      number: 117,
      prefix: 0,
      letters: [23, 22, 1, 0],
    });
    const long = generate(LHR_JFK, {
      airline: AIRLINE_CODES.length - 1,
      number: 9999,
      prefix: 3,
      letters: [25, 25, 25, 25],
    });

    expect(short.flight).toBe('BA 117');
    expect(short.aircraft.registration).toBe('G-XWBA');
    expect(long.flight).toBe('SA 9999');
    expect(long.aircraft.registration).toBe('EI-ZZZZ');
    for (const report of [short, long]) {
      expect(report.flight).toMatch(/^[A-Z0-9]{2} [1-9]\d{0,3}$/);
      expect(AIRLINE_CODES).toContain(report.flight.slice(0, 2));
      expect(report.aircraft.registration).toMatch(/^[A-Z]{1,2}-[A-Z]{4}$/);
    }
    expect(random.int).toHaveBeenNthCalledWith(2, { min: 0, max: AIRLINE_CODES.length - 1 });
    expect(random.int).toHaveBeenNthCalledWith(3, { min: 1, max: 9999 });
    expect(random.int).toHaveBeenNthCalledWith(5, {
      min: 0,
      max: REGISTRATION_PREFIXES.length - 1,
    });
    expect(random.int).toHaveBeenNthCalledWith(6, { min: 0, max: 25 });
  });

  it('Long flight waypoints in phase order', () => {
    const report = generate(LHR_JFK);
    const { waypoints } = report;
    const first = waypoints[0];
    const last = waypoints.at(-1);

    expect(waypoints.map((waypoint) => waypoint.name)).toEqual([
      'LHR',
      'Top of climb',
      'Cruise 1',
      'Cruise 2',
      'Cruise 3',
      'Cruise 4',
      'Top of descent',
      'JFK',
    ]);
    expect([first?.lat, first?.lon]).toEqual(coordinates('LHR'));
    expect([last?.lat, last?.lon]).toEqual(coordinates('JFK'));
    const flown = waypoints.map((waypoint) => waypoint.distanceFlownKm);
    expect(flown[1]).toBe(PARAMS.climbKm);
    expect(flown[6]).toBe(report.distanceKm - PARAMS.descentKm);
    // Cruise points are evenly spaced between top of climb and top of descent.
    const gaps = flown.slice(2, 7).map((km, i) => km - (flown[i + 1] ?? 0));
    for (const gap of gaps) expect(Math.abs(gap - (gaps[0] ?? 0))).toBeLessThanOrEqual(1);
    // Each waypoint lies on the route at its distance flown.
    for (const waypoint of waypoints) {
      expect(
        Math.abs(
          kmBetween(coordinates('LHR'), [waypoint.lat, waypoint.lon]) - waypoint.distanceFlownKm,
        ),
      ).toBeLessThanOrEqual(1);
    }
  });

  it('Long flight altitude and speed profile', () => {
    const report = generate(LHR_JFK, { model: 0 });
    const { waypoints } = report;
    const ends = [waypoints[0], waypoints.at(-1)];
    const cruise = waypoints.slice(1, -1);

    for (const end of ends) {
      expect([end?.altitudeFt, end?.groundSpeedKmh]).toEqual([0, PARAMS.taxiSpeedKmh]);
    }
    for (const waypoint of cruise) {
      expect([waypoint.altitudeFt, waypoint.groundSpeedKmh]).toEqual([39_000, 905]);
    }
    // Climb and descent at their average speed, cruise at cruise speed.
    const total = kmBetween(coordinates('LHR'), coordinates('JFK'));
    const average = (PARAMS.taxiSpeedKmh + 905) / 2;
    const hours =
      PARAMS.climbKm / average +
      (total - PARAMS.climbKm - PARAMS.descentKm) / 905 +
      PARAMS.descentKm / average;
    expect(report.durationMin).toBe(Math.round(hours * 60));
  });

  it('Short flight has a single peak waypoint', () => {
    const report = generate(LHR_CDG, { model: 0 });
    const { waypoints } = report;
    const peak = waypoints[1];

    expect(waypoints.map((waypoint) => waypoint.name)).toEqual(['LHR', 'Peak', 'CDG']);
    expect(report.distanceKm).toBeLessThan(PARAMS.climbKm + PARAMS.descentKm);
    expect(Math.abs((peak?.distanceFlownKm ?? 0) - report.distanceKm / 2)).toBeLessThanOrEqual(1);
    expect(peak?.altitudeFt).toBeGreaterThan(0);
    expect(peak?.altitudeFt).toBeLessThan(37_000);
    expect(peak?.groundSpeedKmh).toBeGreaterThanOrEqual(PARAMS.taxiSpeedKmh);
    expect(peak?.groundSpeedKmh).toBeLessThan(830);
    expect([waypoints[0]?.altitudeFt, waypoints[2]?.altitudeFt]).toEqual([0, 0]);
    const total = kmBetween(coordinates('LHR'), coordinates('CDG'));
    expect(
      Math.abs(kmBetween(coordinates('LHR'), [peak?.lat ?? 0, peak?.lon ?? 0]) - total / 2),
    ).toBeLessThanOrEqual(1);
    // Speed changes linearly from taxi to the lower peak speed and back.
    const share = total / (PARAMS.climbKm + PARAMS.descentKm);
    const peakSpeed = PARAMS.taxiSpeedKmh + (830 - PARAMS.taxiSpeedKmh) * share;
    const hours = total / ((PARAMS.taxiSpeedKmh + peakSpeed) / 2);
    expect(report.durationMin).toBe(Math.round(hours * 60));
  });

  it('Waypoint distance and time run from departure to arrival', () => {
    for (const payload of [LHR_JFK, LHR_CDG]) {
      const report = generate(payload, { slot: 100 });
      const { waypoints } = report;
      const first = waypoints[0];
      const last = waypoints.at(-1);

      expect([first?.distanceFlownKm, first?.at]).toEqual([0, report.departureAt]);
      expect([last?.distanceFlownKm, last?.at]).toEqual([report.distanceKm, report.arrivalAt]);
      waypoints.slice(1).forEach((waypoint, i) => {
        const previous = waypoints[i];
        expect(waypoint.distanceFlownKm).toBeGreaterThanOrEqual(previous?.distanceFlownKm ?? 0);
        expect(Date.parse(waypoint.at)).toBeGreaterThanOrEqual(Date.parse(previous?.at ?? ''));
      });
    }
  });

  it('Path of the smallest configured size is just the two airports', () => {
    const { path } = generate(LHR_JFK, {}, { pathPoints: 2 });

    expect(path).toEqual([coordinates('LHR'), coordinates('JFK')]);
  });

  it('Departure in a spring-forward gap stays on the date and a whole five minutes', () => {
    // 01:00 to 01:59 does not exist in London on 2027-03-28; slot 12 is 01:00 local.
    const { departureAt } = generate({ ...LHR_JFK, departureDate: '2027-03-28' }, { slot: 12 });
    const local = new TZDate(departureAt, 'Europe/London');

    expect([local.getFullYear(), local.getMonth() + 1, local.getDate()]).toEqual([2027, 3, 28]);
    expect(new Date(departureAt).getUTCMinutes() % 5).toBe(0);
    expect(departureAt).toBe(SPRING_FORWARD_DEPARTURE);
  });

  it('Flight at exactly the long-haul distance gets a wide-body aircraft', () => {
    const { distanceKm } = generate(LHR_JFK);

    generate(LHR_JFK, { model: 0 }, { longHaulKm: distanceKm });
    expect(random.int).toHaveBeenNthCalledWith(13, { min: 0, max: 2 });
    generate(LHR_JFK, { model: 0 }, { longHaulKm: distanceKm + 1 });
    expect(random.int).toHaveBeenNthCalledWith(22, { min: 0, max: 1 });
  });

  it('Long narrow-body flight cruises at its own speed and altitude', () => {
    const report = generate({ ...LHR_JFK, destination: 'MAD' }, { model: 1 });
    const total = kmBetween(coordinates('LHR'), coordinates('MAD'));
    const cruise = report.waypoints.slice(1, -1);

    expect(report.aircraft.model).toBe('B737 MAX');
    expect(total).toBeGreaterThan(PARAMS.climbKm + PARAMS.descentKm);
    for (const waypoint of cruise) {
      expect([waypoint.altitudeFt, waypoint.groundSpeedKmh]).toEqual([37_000, 840]);
    }
    const average = (PARAMS.taxiSpeedKmh + 840) / 2;
    const hours =
      PARAMS.climbKm / average +
      (total - PARAMS.climbKm - PARAMS.descentKm) / 840 +
      PARAMS.descentKm / average;
    expect(report.durationMin).toBe(Math.round(hours * 60));
  });

  it('Long flight without configured cruise waypoints', () => {
    const report = generate(LHR_JFK, { model: 0 }, { cruiseWaypoints: 0 });

    expect(report.waypoints.map((waypoint) => waypoint.name)).toEqual([
      'LHR',
      'Top of climb',
      'Top of descent',
      'JFK',
    ]);
  });

  it('Flight just longer than climb plus descent has the flight phases', () => {
    const { distanceKm } = generate(LHR_CDG);
    const total = kmBetween(coordinates('LHR'), coordinates('CDG'));
    const climbKm = 100;

    const atLength = generate(LHR_CDG, {}, { climbKm, descentKm: total - climbKm - 0.001 });
    const longer = generate(LHR_CDG, {}, { climbKm, descentKm: distanceKm - climbKm + 1 });

    expect(atLength.waypoints.map((waypoint) => waypoint.name)).toContain('Top of climb');
    expect(longer.waypoints.map((waypoint) => waypoint.name)).toEqual(['LHR', 'Peak', 'CDG']);
  });

  it('Waypoint times follow the speed profile', () => {
    const report = generate(LHR_JFK, { model: 0 });
    const total = kmBetween(coordinates('LHR'), coordinates('JFK'));
    const average = (PARAMS.taxiSpeedKmh + 905) / 2;
    const climbHours = PARAMS.climbKm / average;
    const rawHours =
      climbHours + (total - PARAMS.climbKm - PARAMS.descentKm) / 905 + PARAMS.descentKm / average;
    const durationMs = report.durationMin * MINUTE_MS;
    const expectedMs = Date.parse(report.departureAt) + (durationMs * climbHours) / rawHours;

    expect(report.waypoints[1]?.at).toBe(
      new Date(Math.round(expectedMs / 1000) * 1000).toISOString(),
    );
  });

  it('Each attempt generates a new report', () => {
    const first = generate(LHR_JFK, { slot: 10, airline: 1, number: 12 });
    const second = generate(LHR_JFK, { slot: 200, airline: 2, number: 3456 });

    expect(first.flight).toBe('AF 12');
    expect(second.flight).toBe('LH 3456');
    expect(first.departureAt).not.toBe(second.departureAt);
  });
});
