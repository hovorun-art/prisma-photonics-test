import { describe, expect, it } from 'vitest';

import { transitJobFixtures } from '../../jobs/testing/job-fixtures';
import { MercatorRouteGeometry } from './mercator-route-geometry';

const geometry = new MercatorRouteGeometry();
const atlantic = transitJobFixtures.completed().result!;
const pacific = transitJobFixtures.pacific().result!;

describe('MercatorRouteGeometry', () => {
  it('a route that does not cross the 180° meridian is drawn as reported', () => {
    const route = geometry.route({ report: atlantic });

    expect(route.path).toEqual(atlantic.path);
    expect(route.waypoints).toEqual(atlantic.waypoints.map((w) => [w.lat, w.lon]));
    expect(route.origin).toEqual([atlantic.origin.lat, atlantic.origin.lon]);
    expect(route.destination).toEqual([atlantic.destination.lat, atlantic.destination.lon]);
  });

  it('Route across the antimeridian: no step between path points is longer than 180° of longitude', () => {
    const { path } = geometry.route({ report: pacific });

    const steps = path.slice(1).map(([, lon], i) => Math.abs(lon - path[i]![1]));
    expect(Math.max(...steps)).toBeLessThanOrEqual(180);
    expect(path[0]).toEqual([35.772, 140.3929]);
    expect(path[3]).toEqual([47, 182]);
    expect(path.at(-1)![1]).toBeCloseTo(241.5915, 4);
  });

  it('Route across the antimeridian: waypoints and the destination move onto the same side as the path', () => {
    const route = geometry.route({ report: pacific });

    expect(route.waypoints[1]).toEqual([47, 182]);
    expect(route.waypoints[2]![1]).toBeCloseTo(241.5915, 4);
    expect(route.destination[1]).toBeCloseTo(241.5915, 4);
    expect(route.origin).toEqual([35.772, 140.3929]);
  });

  it('Departure selected at first: nothing is flown at the departure', () => {
    const route = geometry.route({ report: atlantic });

    expect(geometry.flown({ path: route.path, point: route.waypoints[0]! }).path).toEqual([]);
  });

  it('Select from the strip: at the arrival the whole path is flown', () => {
    const route = geometry.route({ report: atlantic });

    expect(geometry.flown({ path: route.path, point: route.waypoints[5]! }).path).toEqual(
      route.path,
    );
  });

  it('a waypoint on a path point: the path up to that point is flown', () => {
    const route = geometry.route({ report: atlantic });

    expect(geometry.flown({ path: route.path, point: [52.22, -41.3] }).path).toEqual(
      route.path.slice(0, 5),
    );
  });

  it('a waypoint between path points: the path before it is flown, ending at the waypoint', () => {
    const route = geometry.route({ report: atlantic });

    expect(geometry.flown({ path: route.path, point: [53.5, -25] }).path).toEqual([
      ...route.path.slice(0, 3),
      [53.5, -25],
    ]);
  });

  it('Hover a waypoint: the aircraft over the Atlantic heads west', () => {
    const route = geometry.route({ report: atlantic });

    const { degrees } = geometry.heading({ path: route.path, point: route.waypoints[2]! });

    expect(degrees).toBeGreaterThan(225);
    expect(degrees).toBeLessThan(315);
  });

  it('Route across the antimeridian: the aircraft at the date line heads east, not back west', () => {
    const route = geometry.route({ report: pacific });

    const { degrees } = geometry.heading({ path: route.path, point: route.waypoints[1]! });

    expect(degrees).toBeGreaterThan(45);
    expect(degrees).toBeLessThan(135);
  });

  it('Departure selected at first: the aircraft at the departure points along the first leg', () => {
    const route = geometry.route({ report: pacific });

    const { degrees } = geometry.heading({ path: route.path, point: route.waypoints[0]! });

    expect(degrees).toBeGreaterThan(0);
    expect(degrees).toBeLessThan(90);
  });

  it('heading is measured on the Mercator map: a high-latitude leg turns more to the north', () => {
    // From 60° N to 70° N, 10° east. On flat degrees that is 45°; on Mercator the 10° of latitude
    // stretch to about 23.97 projected degrees, so atan2(10, 23.97) ≈ 22.65°.
    const { degrees } = geometry.heading({
      path: [
        [60, 0],
        [70, 10],
      ],
      point: [60, 0],
    });

    expect(degrees).toBeCloseTo(22.65, 1);
  });

  it('heading between path points follows that segment', () => {
    const route = geometry.route({ report: atlantic });
    const segment = { path: [route.path[2]!, route.path[3]!], point: route.path[2]! };

    expect(geometry.heading({ path: route.path, point: [53.5, -25] }).degrees).toBe(
      geometry.heading(segment).degrees,
    );
  });

  it('heading at the arrival follows the last leg', () => {
    const route = geometry.route({ report: atlantic });
    const lastLeg = { path: route.path.slice(-2), point: route.path.at(-2)! };

    const { degrees } = geometry.heading({ path: route.path, point: route.waypoints[5]! });

    expect(degrees).toBe(geometry.heading(lastLeg).degrees);
    expect(Number.isNaN(degrees)).toBe(false);
  });

  it('Route across the antimeridian: the flown part follows the unwrapped path', () => {
    const route = geometry.route({ report: pacific });

    expect(geometry.flown({ path: route.path, point: route.waypoints[1]! }).path).toEqual(
      route.path.slice(0, 4),
    );
    expect(geometry.flown({ path: route.path, point: route.waypoints[2]! }).path).toEqual(
      route.path,
    );
  });

  it('a route of only its two airports: flown is empty at the departure and the whole leg at the arrival', () => {
    const report = {
      ...atlantic,
      path: [atlantic.path[0]!, atlantic.path.at(-1)!],
      waypoints: [atlantic.waypoints[0]!, atlantic.waypoints.at(-1)!],
    };
    const route = geometry.route({ report });

    expect(geometry.flown({ path: route.path, point: route.waypoints[0]! }).path).toEqual([]);
    expect(geometry.flown({ path: route.path, point: route.waypoints[1]! }).path).toEqual(
      route.path,
    );
    const { degrees } = geometry.heading({ path: route.path, point: route.waypoints[1]! });
    expect(degrees).toBeGreaterThan(180);
    expect(degrees).toBeLessThan(360);
  });
});
