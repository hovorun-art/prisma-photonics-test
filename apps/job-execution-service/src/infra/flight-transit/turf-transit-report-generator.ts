import { TZDate } from '@date-fns/tz';
import {
  AIRPORTS,
  type Airport,
  type FlightTransitJobResult,
  type TransitAirport,
  type TransitWaypoint,
} from '@job-queue/contracts';
import type { Random } from '@job-queue/kernel';
import along from '@turf/along';
import distance from '@turf/distance';
import { lineString, point } from '@turf/helpers';

import type {
  GenerateTransitReportGeneratorRequest,
  GenerateTransitReportGeneratorResponse,
  TransitReportGenerator,
} from '../../domain/flight-transit/transit-report-generator.js';
import {
  AIRCRAFT_MODELS,
  AIRLINE_CODES,
  REGISTRATION_PREFIXES,
  type AircraftModel,
} from './flight-data.js';

export interface TurfTransitReportGeneratorDeps {
  random: Random;
}

export interface TurfTransitReportGeneratorParams {
  /** Points on the great-circle path, both airports included (at least 2). */
  pathPoints: number;
  /** Cruise waypoints between top of climb and top of descent on a long enough flight. */
  cruiseWaypoints: number;
  /** From this distance on a wide-body flies the route, below it a narrow-body. */
  longHaulKm: number;
  /** Over how many kilometres the aircraft climbs to and descends from cruise altitude. */
  climbKm: number;
  descentKm: number;
  /** Ground speed at the departure and arrival waypoints. */
  taxiSpeedKmh: number;
}

/** The sphere the report's distances are measured on. */
const EARTH_RADIUS_KM = 6371;
/** A departure is drawn among the whole five minutes of the local day: 00:00 to 23:55. */
const DEPARTURE_SLOT_MINUTES = 5;
const DEPARTURE_SLOTS = (24 * 60) / DEPARTURE_SLOT_MINUTES;
const MAX_FLIGHT_NUMBER = 9999;
const REGISTRATION_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const COORDINATE_DECIMALS = 5;
const MINUTE_MS = 60_000;
const SECOND_MS = 1_000;

/** A point of the flight profile: where it is on the route and how high and fast it flies. */
interface ProfileFix {
  name: string;
  km: number;
  altitudeFt: number;
  speedKmh: number;
}

/**
 * Makes up a transit report between two bundled airports: the great-circle route measured and
 * sampled with turf on a 6371 km sphere, a departure on the payload's date in the origin's time zone,
 * an aircraft fitting the distance and a climb-cruise-descent profile for the waypoints.
 */
export class TurfTransitReportGenerator implements TransitReportGenerator {
  private readonly airports = new Map<string, Airport>(
    AIRPORTS.map((airport) => [airport.iata, airport]),
  );

  constructor(
    private readonly d: TurfTransitReportGeneratorDeps,
    private readonly p: TurfTransitReportGeneratorParams,
  ) {}

  generate(req: GenerateTransitReportGeneratorRequest): GenerateTransitReportGeneratorResponse {
    const origin = this.airport(req.payload.origin);
    const destination = this.airport(req.payload.destination);
    const totalKm =
      distance(point([origin.lon, origin.lat]), point([destination.lon, destination.lat]), {
        units: 'radians',
      }) * EARTH_RADIUS_KM;
    const distanceKm = Math.round(totalKm);

    const departureAt = this.departureAt({ origin, departureDate: req.payload.departureDate });
    const flight = `${this.pick(AIRLINE_CODES)} ${String(this.draw({ min: 1, max: MAX_FLIGHT_NUMBER }))}`;
    const model = this.pick(
      AIRCRAFT_MODELS[distanceKm < this.p.longHaulKm ? 'narrow-body' : 'wide-body'],
    );
    const registration = `${this.pick(REGISTRATION_PREFIXES)}-${this.registrationLetters()}`;

    const fixes = this.profile({ origin, destination, totalKm, model });
    const hours = this.elapsedHours(fixes);
    const totalHours = hours.at(-1) ?? 0;
    const durationMin = Math.round(totalHours * 60);
    const departureMs = Date.parse(departureAt);
    const durationMs = durationMin * MINUTE_MS;

    const waypoints = fixes.map((fix, i): TransitWaypoint => {
      const [lat, lon] = this.positionAt({ origin, destination, km: fix.km, totalKm });
      const share = totalHours === 0 ? 0 : (hours[i] ?? 0) / totalHours;
      const atMs = Math.round((departureMs + durationMs * share) / SECOND_MS) * SECOND_MS;
      return {
        name: fix.name,
        at: new Date(atMs).toISOString(),
        lat,
        lon,
        altitudeFt: Math.round(fix.altitudeFt),
        groundSpeedKmh: Math.round(fix.speedKmh),
        distanceFlownKm: i === fixes.length - 1 ? distanceKm : Math.round(fix.km),
      };
    });

    const path = Array.from({ length: this.p.pathPoints }, (_, i) =>
      this.positionAt({
        origin,
        destination,
        km: (i * totalKm) / (this.p.pathPoints - 1),
        totalKm,
      }),
    );

    const report: FlightTransitJobResult = {
      flight,
      aircraft: { model: model.model, registration },
      origin: this.card(origin),
      destination: this.card(destination),
      departureAt,
      arrivalAt: new Date(departureMs + durationMs).toISOString(),
      distanceKm,
      durationMin,
      cruiseAltitudeFt: model.cruiseAltitudeFt,
      path,
      waypoints,
    };
    return { report };
  }

  private airport(iata: string): Airport {
    const airport = this.airports.get(iata);
    // The payload was checked against the bundled list at the edge; a miss is a bug.
    if (airport === undefined) throw new Error(`Airport ${iata} is not in the bundled list`);
    return airport;
  }

  private card(airport: Airport): TransitAirport {
    const { iata, name, city, timeZone, lat, lon } = airport;
    return { iata, name, city, timeZone, lat, lon };
  }

  /** A random whole five minutes of the departure date in the origin's time zone, as UTC ISO. */
  private departureAt({
    origin,
    departureDate,
  }: {
    origin: Airport;
    departureDate: string;
  }): string {
    const [year = 0, month = 1, day = 1] = departureDate.split('-').map(Number);
    const slot = this.draw({ min: 0, max: DEPARTURE_SLOTS - 1 });
    const local = new TZDate(
      year,
      month - 1,
      day,
      0,
      slot * DEPARTURE_SLOT_MINUTES,
      origin.timeZone,
    );
    return new Date(local.getTime()).toISOString();
  }

  private registrationLetters(): string {
    return Array.from(
      { length: 4 },
      () =>
        REGISTRATION_LETTERS[this.draw({ min: 0, max: REGISTRATION_LETTERS.length - 1 })] ?? 'A',
    ).join('');
  }

  /**
   * The waypoints' phase points: climb, evenly spaced cruise points and descent on a long enough
   * flight; on a shorter one a single lower peak at the midpoint.
   */
  private profile({
    origin,
    destination,
    totalKm,
    model,
  }: {
    origin: Airport;
    destination: Airport;
    totalKm: number;
    model: AircraftModel;
  }): ProfileFix[] {
    const ground = { altitudeFt: 0, speedKmh: this.p.taxiSpeedKmh };
    const departure: ProfileFix = { name: origin.iata, km: 0, ...ground };
    const arrival: ProfileFix = { name: destination.iata, km: totalKm, ...ground };
    const climbAndDescentKm = this.p.climbKm + this.p.descentKm;

    if (totalKm < climbAndDescentKm) {
      const share = totalKm / climbAndDescentKm;
      const peak: ProfileFix = {
        name: 'Peak',
        km: totalKm / 2,
        altitudeFt: model.cruiseAltitudeFt * share,
        speedKmh: this.p.taxiSpeedKmh + (model.cruiseSpeedKmh - this.p.taxiSpeedKmh) * share,
      };
      return [departure, peak, arrival];
    }

    const cruise = { altitudeFt: model.cruiseAltitudeFt, speedKmh: model.cruiseSpeedKmh };
    const topOfClimbKm = this.p.climbKm;
    const topOfDescentKm = totalKm - this.p.descentKm;
    const cruiseStepKm = (topOfDescentKm - topOfClimbKm) / (this.p.cruiseWaypoints + 1);
    const cruisePoints = Array.from({ length: this.p.cruiseWaypoints }, (_, i): ProfileFix => ({
      name: `Cruise ${String(i + 1)}`,
      km: topOfClimbKm + (i + 1) * cruiseStepKm,
      ...cruise,
    }));
    return [
      departure,
      { name: 'Top of climb', km: topOfClimbKm, ...cruise },
      ...cruisePoints,
      { name: 'Top of descent', km: topOfDescentKm, ...cruise },
      arrival,
    ];
  }

  /** Hours flown at each fix; the speed changes linearly between two fixes. */
  private elapsedHours(fixes: readonly ProfileFix[]): number[] {
    let hours = 0;
    return fixes.map((fix, i) => {
      const previous = fixes[i - 1];
      if (previous !== undefined) {
        hours += (fix.km - previous.km) / ((previous.speedKmh + fix.speedKmh) / 2);
      }
      return hours;
    });
  }

  /** The `[lat, lon]` point `km` along the great circle; the airports themselves exactly. */
  private positionAt({
    origin,
    destination,
    km,
    totalKm,
  }: {
    origin: Airport;
    destination: Airport;
    km: number;
    totalKm: number;
  }): [number, number] {
    if (km <= 0) return [origin.lat, origin.lon];
    if (km >= totalKm) return [destination.lat, destination.lon];
    const route = lineString([
      [origin.lon, origin.lat],
      [destination.lon, destination.lat],
    ]);
    const [lon = 0, lat = 0] = along(route, km / EARTH_RADIUS_KM, { units: 'radians' }).geometry
      .coordinates;
    return [this.round(lat), this.round(this.wrapLongitude(lon))];
  }

  /** Turf can return longitudes beyond ±180 on routes across the antimeridian. */
  private wrapLongitude(lon: number): number {
    return ((((lon + 180) % 360) + 360) % 360) - 180;
  }

  private round(value: number): number {
    const factor = 10 ** COORDINATE_DECIMALS;
    return Math.round(value * factor) / factor;
  }

  private pick<T>(values: readonly T[]): T {
    const value = values[this.draw({ min: 0, max: values.length - 1 })];
    if (value === undefined) throw new Error('Cannot pick from an empty list');
    return value;
  }

  private draw(range: { min: number; max: number }): number {
    return this.d.random.int(range).value;
  }
}
