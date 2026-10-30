import 'leaflet/dist/leaflet.css';

import type { FlightTransitJobResult } from '@job-queue/contracts';
import L from 'leaflet';
import { useMemo } from 'react';
import {
  CircleMarker,
  MapContainer,
  Marker,
  Polyline,
  TileLayer,
  Tooltip,
  ZoomControl,
} from 'react-leaflet';

import { en } from '@/locales';

import type { MapPoint } from './model/route-geometry';
import { useUiConfig } from '../jobs/hooks/use-ui-config';
import { useRouteGeometry, useTransitReportPresenter } from './use-transit-report';
import { WaypointCard } from './waypoint-card';

const INK = '#17171A';
const ACCENT = '#1F3FC4';
const FIT_PADDING: L.PointTuple = [48, 48];

/** A waypoint dot; the marker element itself is the focusable button Leaflet makes of it. */
const WAYPOINT_ICON = L.divIcon({
  className: 'transit-waypoint',
  html: `<span style="display:block;margin:10px;width:12px;height:12px;border-radius:50%;background:#fff;border:2.5px solid ${ACCENT};box-sizing:border-box"></span>`,
  iconSize: [32, 32],
  iconAnchor: [16, 16],
});

/**
 * The route of a transit report on an OpenStreetMap map (design "TransitReport"): the whole path
 * dashed, the flown part solid, airports labelled, a marker per waypoint and the aircraft at the
 * selected one. Hovering, focusing or clicking a waypoint selects it.
 */
export function TransitMap({
  report,
  selected,
  onSelect,
}: {
  report: FlightTransitJobResult;
  selected: number;
  onSelect: (index: number) => void;
}) {
  const { mapTileUrl, mapTileAttribution } = useUiConfig();
  const geometry = useRouteGeometry();
  const presenter = useTransitReportPresenter();
  const route = useMemo(() => geometry.route({ report }), [geometry, report]);
  const point = route.waypoints[selected] ?? route.origin;
  const flown = geometry.flown({ path: route.path, point }).path;
  const heading = geometry.heading({ path: route.path, point }).degrees;
  const waypoint = report.waypoints[selected] ?? report.waypoints[0];
  const bounds = useMemo(() => L.latLngBounds(route.path.map(toLatLng)), [route]);
  const aircraft = useMemo(
    () =>
      L.divIcon({
        className: 'transit-aircraft',
        // The plane points east; the heading is clockwise from north.
        html: `<span role="img" aria-label="${en.report.aircraftIcon}" style="display:flex;width:40px;height:40px;align-items:center;justify-content:center;transform:rotate(${(heading - 90).toFixed(1)}deg);filter:drop-shadow(0 1px 2px rgba(0,0,0,.3))"><svg width="34" height="34" viewBox="0 0 24 24" aria-hidden="true"><path d="M22 12c0-.7-.6-1.1-1.3-1.1H14.5L9.6 3.3H7.7l2.4 7.6H5.2L3.6 8.8H2.2l1 3.2-1 3.2h1.4l1.6-2.1h4.9l-2.4 7.6h1.9l4.9-7.6h6.2c.7 0 1.3-.4 1.3-1.1z" fill="${INK}" stroke="#fff" stroke-width="1"/></svg></span>`,
        iconSize: [40, 40],
        iconAnchor: [20, 20],
      }),
    [heading],
  );

  return (
    <div className="relative aspect-video min-h-[320px] bg-[#EEF1F4]">
      <MapContainer
        bounds={bounds}
        boundsOptions={{ padding: FIT_PADDING }}
        zoomControl={false}
        worldCopyJump={false}
        className="absolute inset-0 h-full w-full"
      >
        <TileLayer url={mapTileUrl} attribution={mapTileAttribution} />
        <ZoomControl position="topright" />
        <Polyline
          positions={route.path.map(toLatLng)}
          pathOptions={{
            color: INK,
            opacity: 0.35,
            weight: 2.5,
            dashArray: '8 8',
            lineCap: 'round',
          }}
        />
        {/* Leaflet draws an empty line as a dot, so nothing flown means no line at all. */}
        {flown.length > 0 && (
          <Polyline
            positions={flown.map(toLatLng)}
            pathOptions={{ color: ACCENT, weight: 3.5, lineCap: 'round', lineJoin: 'round' }}
          />
        )}
        {[
          { at: route.origin, airport: report.origin },
          { at: route.destination, airport: report.destination },
        ].map(({ at, airport }) => (
          <CircleMarker
            key={airport.iata}
            center={toLatLng(at)}
            radius={8}
            interactive={false}
            pathOptions={{ color: INK, weight: 3, fillColor: '#fff', fillOpacity: 1 }}
          >
            <Tooltip
              permanent
              direction="bottom"
              offset={[0, 12]}
              className="transit-airport-label"
            >
              {en.report.airportLabel(airport.iata, airport.city)}
            </Tooltip>
          </CircleMarker>
        ))}
        {report.waypoints.map((wp, index) => (
          <WaypointMarker
            key={`${wp.name}-${wp.at}`}
            at={route.waypoints[index] ?? route.origin}
            label={presenter.waypoint({ report, waypoint: wp }).label}
            onSelect={() => {
              onSelect(index);
            }}
          />
        ))}
        <Marker
          position={toLatLng(point)}
          icon={aircraft}
          interactive={false}
          keyboard={false}
          zIndexOffset={1000}
        />
      </MapContainer>
      <div className="pointer-events-none absolute top-3 left-3 z-[1000] flex items-center gap-3.5 rounded-lg border border-border bg-card/90 px-2.5 py-1.5 text-xs text-subtle-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className="h-[3px] w-[18px] rounded-sm bg-[#1F3FC4]" />
          {en.report.flown}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className="w-[18px] border-t-2 border-dashed border-[#8A8A90]" />
          {en.report.remaining}
        </span>
      </div>
      {waypoint && (
        <WaypointCard
          card={presenter.waypoint({ report, waypoint })}
          className="absolute bottom-8 left-3 z-[1000]"
        />
      )}
    </div>
  );
}

/** A waypoint on the map; hovering, focusing or clicking it selects the waypoint. */
function WaypointMarker({
  at,
  label,
  onSelect,
}: {
  at: MapPoint;
  label: string;
  onSelect: () => void;
}) {
  const handlers = useMemo<L.LeafletEventHandlerFnMap>(
    () => ({
      mouseover: onSelect,
      click: onSelect,
      // Leaflet has no focus event of its own; the marker element is a focusable button.
      add: (event) => {
        (event.target as L.Marker).getElement()?.addEventListener('focus', onSelect);
      },
    }),
    [onSelect],
  );
  return (
    <Marker
      position={toLatLng(at)}
      icon={WAYPOINT_ICON}
      title={label}
      keyboard
      eventHandlers={handlers}
    />
  );
}

function toLatLng(point: MapPoint): L.LatLngTuple {
  return [point[0], point[1]];
}
