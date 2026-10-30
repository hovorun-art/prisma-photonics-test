import type { FlightTransitJobResult, TransitAirport, TransitWaypoint } from '@job-queue/contracts';

export interface ReportTransitReportPresentationRequest {
  readonly report: FlightTransitJobResult;
}
export interface TextTransitReportPresentationResponse {
  readonly text: string;
}

/** The four summary tiles under the report header. */
export interface TilesTransitReportPresentationResponse {
  readonly distance: string;
  readonly duration: string;
  /** Departure and arrival in UTC, under the duration. */
  readonly times: string;
  readonly groundSpeed: string;
  readonly cruise: string;
}

export interface AirportTransitReportPresentationRequest {
  readonly airport: TransitAirport;
  /** When the flight leaves or reaches this airport. */
  readonly at: string;
}
export interface AirportTransitReportPresentationResponse {
  readonly coordinates: string;
  readonly utc: string;
  /** The time at the airport, with its zone's short name. */
  readonly local: string;
}

export interface WaypointTransitReportPresentationRequest {
  readonly report: FlightTransitJobResult;
  readonly waypoint: TransitWaypoint;
}
/** What the card of the selected waypoint shows, and the waypoint's accessible label. */
export interface WaypointTransitReportPresentationResponse {
  readonly name: string;
  readonly time: string;
  readonly position: string;
  readonly altitude: string;
  readonly groundSpeed: string;
  readonly flownLeft: string;
  readonly aircraft: string;
  readonly label: string;
}

/** Turns a transit report into the texts the report page shows. */
export interface TransitReportPresentation {
  title(req: ReportTransitReportPresentationRequest): TextTransitReportPresentationResponse;
  tiles(req: ReportTransitReportPresentationRequest): TilesTransitReportPresentationResponse;
  airport(req: AirportTransitReportPresentationRequest): AirportTransitReportPresentationResponse;
  waypoint(
    req: WaypointTransitReportPresentationRequest,
  ): WaypointTransitReportPresentationResponse;
  pathPoints(req: ReportTransitReportPresentationRequest): TextTransitReportPresentationResponse;
}
