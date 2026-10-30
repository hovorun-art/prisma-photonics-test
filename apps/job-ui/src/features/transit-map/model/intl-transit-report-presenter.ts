import { IntlWholeNumberFormat } from '@/lib/whole-number-format';
import { en } from '@/locales';

import type {
  AirportTransitReportPresentationRequest,
  AirportTransitReportPresentationResponse,
  ReportTransitReportPresentationRequest,
  TextTransitReportPresentationResponse,
  TilesTransitReportPresentationResponse,
  TransitReportPresentation,
  WaypointTransitReportPresentationRequest,
  WaypointTransitReportPresentationResponse,
} from './transit-report-presentation';

const MINUTES_PER_HOUR = 60;
const FEET_PER_FLIGHT_LEVEL = 100;
const FLIGHT_LEVEL_DIGITS = 3;
const AIRPORT_DECIMALS = 4;
const WAYPOINT_DECIMALS = 2;

interface PositionRequest {
  readonly lat: number;
  readonly lon: number;
  readonly decimals: number;
}

/** `TransitReportPresentation` with `Intl` formats and the strings from `locales/en.ts`. */
export class IntlTransitReportPresenter implements TransitReportPresentation {
  private readonly number = new IntlWholeNumberFormat();
  private readonly utcTime = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: 'UTC',
  });
  private readonly utcDateTime = new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: 'UTC',
  });

  title({ report }: ReportTransitReportPresentationRequest): TextTransitReportPresentationResponse {
    return { text: en.report.title(report.origin.iata, report.destination.iata) };
  }

  tiles({
    report,
  }: ReportTransitReportPresentationRequest): TilesTransitReportPresentationResponse {
    const hours = report.durationMin / MINUTES_PER_HOUR;
    const whole = Math.round(report.durationMin);
    return {
      distance: en.report.tiles.distanceValue(this.km(report.distanceKm)),
      duration: en.report.tiles.durationValue(
        Math.floor(whole / MINUTES_PER_HOUR),
        whole % MINUTES_PER_HOUR,
      ),
      times: en.report.tiles.durationHint(
        this.utcTime.format(new Date(report.departureAt)),
        this.utcTime.format(new Date(report.arrivalAt)),
      ),
      groundSpeed:
        hours > 0 ? en.report.tiles.speedValue(this.km(report.distanceKm / hours)) : en.job.notYet,
      cruise: this.flightLevel(report.cruiseAltitudeFt),
    };
  }

  airport({
    airport,
    at,
  }: AirportTransitReportPresentationRequest): AirportTransitReportPresentationResponse {
    const instant = new Date(at);
    const local = new Intl.DateTimeFormat('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
      timeZone: airport.timeZone,
      timeZoneName: 'short',
    });
    return {
      coordinates: this.position({
        lat: airport.lat,
        lon: airport.lon,
        decimals: AIRPORT_DECIMALS,
      }),
      utc: en.report.utcTime(this.utcDateTime.format(instant)),
      local: local.format(instant),
    };
  }

  waypoint({
    report,
    waypoint,
  }: WaypointTransitReportPresentationRequest): WaypointTransitReportPresentationResponse {
    const time = en.report.utcTime(this.utcTime.format(new Date(waypoint.at)));
    const left = Math.max(0, report.distanceKm - waypoint.distanceFlownKm);
    return {
      name: waypoint.name,
      time,
      position: this.position({
        lat: waypoint.lat,
        lon: waypoint.lon,
        decimals: WAYPOINT_DECIMALS,
      }),
      altitude:
        waypoint.altitudeFt === 0
          ? en.report.waypoint.ground
          : this.flightLevel(waypoint.altitudeFt),
      groundSpeed: en.report.waypoint.groundSpeedValue(this.km(waypoint.groundSpeedKmh)),
      flownLeft: en.report.waypoint.flownLeftValue(
        this.km(waypoint.distanceFlownKm),
        this.km(left),
      ),
      aircraft: en.report.waypoint.aircraft(report.flight, report.aircraft.model),
      label: en.report.waypointLabel(waypoint.name, time),
    };
  }

  pathPoints({
    report,
  }: ReportTransitReportPresentationRequest): TextTransitReportPresentationResponse {
    return { text: en.report.pathPoints(report.path.length) };
  }

  /** A whole number with thousands grouped, e.g. `5,540`. */
  private km(value: number): string {
    return this.number.format({ value }).text;
  }

  /** `FL360` for 36,000 ft: hundreds of feet, three digits. */
  private flightLevel(feet: number): string {
    const level = Math.round(feet / FEET_PER_FLIGHT_LEVEL);
    return en.report.flightLevel(String(level).padStart(FLIGHT_LEVEL_DIGITS, '0'));
  }

  /** `51.4700° N, 0.4543° W`. */
  private position({ lat, lon, decimals }: PositionRequest): string {
    const ns = lat < 0 ? 'S' : 'N';
    const ew = lon < 0 ? 'W' : 'E';
    return `${Math.abs(lat).toFixed(decimals)}° ${ns}, ${Math.abs(lon).toFixed(decimals)}° ${ew}`;
  }
}
