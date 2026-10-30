import type { FlightTransitJobResult } from '@job-queue/contracts';

/** A map position, `[lat, lon]` in degrees; a longitude may lie outside ±180 after unwrapping. */
export type MapPoint = readonly [number, number];

export interface RouteRouteGeometryRequest {
  readonly report: FlightTransitJobResult;
}
/** Everything the map draws, moved onto one continuous copy of the world. */
export interface RouteRouteGeometryResponse {
  readonly path: readonly MapPoint[];
  /** In the report's waypoint order. */
  readonly waypoints: readonly MapPoint[];
  readonly origin: MapPoint;
  readonly destination: MapPoint;
}

export interface PointOnPathRouteGeometryRequest {
  /** A path from `route`. */
  readonly path: readonly MapPoint[];
  /** A point on or near that path, from `route`. */
  readonly point: MapPoint;
}
export interface FlownRouteGeometryResponse {
  /** The path from the departure up to the point; empty while nothing is flown. */
  readonly path: readonly MapPoint[];
}
export interface HeadingRouteGeometryResponse {
  /** Direction of travel on the map, clockwise from north, in [0, 360). */
  readonly degrees: number;
}

/** Where the report's route, the flown part and the aircraft go on the map. */
export interface RouteGeometry {
  route(req: RouteRouteGeometryRequest): RouteRouteGeometryResponse;
  flown(req: PointOnPathRouteGeometryRequest): FlownRouteGeometryResponse;
  heading(req: PointOnPathRouteGeometryRequest): HeadingRouteGeometryResponse;
}
