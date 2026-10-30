import type {
  FlownRouteGeometryResponse,
  HeadingRouteGeometryResponse,
  MapPoint,
  PointOnPathRouteGeometryRequest,
  RouteGeometry,
  RouteRouteGeometryRequest,
  RouteRouteGeometryResponse,
} from './route-geometry';

const HALF_TURN = 180;
const FULL_TURN = 360;
const RADIANS_PER_DEGREE = Math.PI / HALF_TURN;

/** A segment of the path: from `path[index]` to `path[index + 1]`. */
interface Segment {
  readonly index: number;
  /** Whether the point is the segment's start itself. */
  readonly atStart: boolean;
}

interface PlaceRequest {
  readonly raw: readonly MapPoint[];
  readonly unwrapped: readonly MapPoint[];
  readonly point: MapPoint;
}

/**
 * `RouteGeometry` for a Web Mercator map such as Leaflet's. A route over the 180° meridian is
 * unwrapped (longitudes continue past ±180°) so it is drawn the short way; headings are measured
 * on the projected map, so the aircraft icon lines up with the drawn path.
 */
export class MercatorRouteGeometry implements RouteGeometry {
  route({ report }: RouteRouteGeometryRequest): RouteRouteGeometryResponse {
    const raw = report.path;
    const unwrapped: MapPoint[] = [];
    for (const [lat, lon] of raw) {
      const previous = unwrapped.at(-1);
      unwrapped.push([lat, previous ? this.near({ lon, anchor: previous[1] }) : lon]);
    }
    const place = (point: MapPoint) => this.place({ raw, unwrapped, point });
    return {
      path: unwrapped,
      waypoints: report.waypoints.map((waypoint) => place([waypoint.lat, waypoint.lon])),
      origin: place([report.origin.lat, report.origin.lon]),
      destination: place([report.destination.lat, report.destination.lon]),
    };
  }

  flown({ path, point }: PointOnPathRouteGeometryRequest): FlownRouteGeometryResponse {
    const { index, atStart } = this.segment({ path, point });
    const flown = atStart ? path.slice(0, index + 1) : [...path.slice(0, index + 1), point];
    return { path: flown.length < 2 ? [] : flown };
  }

  heading({ path, point }: PointOnPathRouteGeometryRequest): HeadingRouteGeometryResponse {
    const { index, atStart } = this.segment({ path, point });
    const last = path.length - 1;
    // On a path point the heading follows its neighbours; between points, the segment's own.
    const from = path[atStart ? Math.max(index - 1, 0) : index] ?? point;
    const to = path[Math.min(index + 1, last)] ?? point;
    const dx = to[1] - from[1];
    const dy = this.mercatorY(to[0]) - this.mercatorY(from[0]);
    const degrees = Math.atan2(dx, dy) / RADIANS_PER_DEGREE;
    return { degrees: (degrees + FULL_TURN) % FULL_TURN };
  }

  /** Moves a point onto the unwrapped copy: next to the nearest point of the reported path. */
  private place({ raw, unwrapped, point }: PlaceRequest): MapPoint {
    let nearest = 0;
    let best = Infinity;
    raw.forEach(([lat, lon], index) => {
      const distance = (lat - point[0]) ** 2 + this.wrap(lon - point[1]) ** 2;
      if (distance < best) {
        best = distance;
        nearest = index;
      }
    });
    const anchor = unwrapped[nearest]?.[1] ?? point[1];
    return [point[0], this.near({ lon: point[1], anchor })];
  }

  /** The segment the point lies on or nearest to; a point on a path point starts that segment. */
  private segment({ path, point }: PointOnPathRouteGeometryRequest): Segment {
    const exact = path.findIndex(([lat, lon]) => lat === point[0] && lon === point[1]);
    if (exact >= 0) return { index: exact, atStart: true };
    let index = 0;
    let best = Infinity;
    path.slice(1).forEach((to, i) => {
      const from = path[i] ?? to;
      const distance = this.distanceToSegment({ point, from, to });
      if (distance < best) {
        best = distance;
        index = i;
      }
    });
    return { index, atStart: false };
  }

  /** Squared distance in degrees from the point to the segment, as on a flat map. */
  private distanceToSegment({
    point,
    from,
    to,
  }: {
    readonly point: MapPoint;
    readonly from: MapPoint;
    readonly to: MapPoint;
  }): number {
    const [px, py] = [point[1], point[0]];
    const [ax, ay] = [from[1], from[0]];
    const [bx, by] = [to[1], to[0]];
    const length = (bx - ax) ** 2 + (by - ay) ** 2;
    const t =
      length === 0
        ? 0
        : Math.min(1, Math.max(0, ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / length));
    return (px - (ax + t * (bx - ax))) ** 2 + (py - (ay + t * (by - ay))) ** 2;
  }

  /** The Web Mercator y of a latitude, in degrees. */
  private mercatorY(lat: number): number {
    return Math.log(Math.tan(Math.PI / 4 + (lat * RADIANS_PER_DEGREE) / 2)) / RADIANS_PER_DEGREE;
  }

  /** The longitude moved by whole turns to within half a turn of the anchor; exact when not moved. */
  private near({ lon, anchor }: { readonly lon: number; readonly anchor: number }): number {
    return lon + FULL_TURN * Math.round((anchor - lon) / FULL_TURN);
  }

  /** A longitude difference brought into (-180, 180]. */
  private wrap(degrees: number): number {
    const turned = ((degrees % FULL_TURN) + FULL_TURN) % FULL_TURN;
    return turned > HALF_TURN ? turned - FULL_TURN : turned;
  }
}
