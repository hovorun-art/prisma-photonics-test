import type { FlightTransitJob } from '@job-queue/contracts';
import { act, render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { Route, Routes } from 'react-router';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { en } from '@/locales';

import { transitJobFixtures } from '../jobs/testing/job-fixtures';
import { CurrentPath, TEST_API_BASE, TestProviders } from '../jobs/testing/test-providers';
import { TransitReport } from './transit-report';

const server = setupServer();

beforeAll(() => {
  server.listen({ onUnhandledFrame: 'error' });
});
afterEach(() => {
  server.resetHandlers();
  vi.restoreAllMocks();
});
afterAll(() => {
  server.close();
});

function renderReport(job: FlightTransitJob) {
  return render(
    <TestProviders path={`/jobs/${job.id}`}>
      <Routes>
        <Route
          path="/jobs/:id"
          element={<TransitReport job={{ ...job, result: job.result! }} connectionLost={false} />}
        />
        <Route path="*" element={<CurrentPath />} />
      </Routes>
    </TestProviders>,
  );
}

/** The map's own markers, not the buttons in the strip under it. */
function mapMarker(name: string) {
  const map = screen.getByRole('region', { name: en.report.mapLabel });
  const strip = within(map).getByRole('group', { name: en.report.waypointsLabel });
  const markers = within(map)
    .getAllByRole('button', { name })
    .filter((button) => !strip.contains(button));
  expect(markers).toHaveLength(1);
  return markers[0]!;
}

function stripButton(name: RegExp) {
  return within(screen.getByRole('group', { name: en.report.waypointsLabel })).getByRole('button', {
    name,
  });
}

/** The rotation of the aircraft icon, in degrees (the icon's plane points east unrotated). */
function rotationOfAircraft() {
  const icon = screen.getByRole('img', { name: en.report.aircraftIcon });
  const match = /rotate\((-?[\d.]+)deg\)/.exec(icon.style.transform);
  expect(match).not.toBeNull();
  return Number(match![1]);
}

/** Where Leaflet placed a marker on the map; without 3D transforms (jsdom) it sets left and top. */
function placeOf(element: Element) {
  const style = element.closest<HTMLElement>('.leaflet-marker-icon')?.style;
  return `${style?.left ?? ''} ${style?.top ?? ''}`;
}

describe('TransitReport', () => {
  const job = transitJobFixtures.completed();

  it('Report header: the route as title, status and type badges, the id and the total time', () => {
    renderReport(job);

    const title = screen.getByRole('heading', { level: 1, name: 'LHR → JFK' });
    const header = title.closest('header')!;
    expect(within(header).getByText(en.statuses.completed)).toBeVisible();
    expect(within(header).getByText(en.jobTypes['flight-transit'])).toBeVisible();
    expect(header).toHaveTextContent(en.report.subtitle);
    expect(header).toHaveTextContent(job.id);
    expect(header).toHaveTextContent(en.report.generatedIn('1.9s'));
  });

  it('Download the report: saves transit-<job id>.json holding the report', async () => {
    const user = userEvent.setup();
    const saved: { blob?: Blob; name?: string; href?: string } = {};
    vi.spyOn(URL, 'createObjectURL').mockImplementationOnce((blob) => {
      saved.blob = blob as Blob;
      return 'blob:report';
    });
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementationOnce(() => undefined);
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementationOnce(function (
      this: HTMLAnchorElement,
    ) {
      saved.name = this.download;
      saved.href = this.href;
    });
    renderReport(job);

    await user.click(screen.getByRole('button', { name: en.report.downloadJson }));

    expect(saved.name).toBe(`transit-${job.id}.json`);
    expect(saved.href).toBe('blob:report');
    expect(JSON.parse(await saved.blob!.text())).toEqual(job.result);
    expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:report');
  });

  it('Delete from the report: confirming deletes the job and opens the jobs list', async () => {
    const user = userEvent.setup();
    const deleted: string[] = [];
    server.use(
      http.delete(`${TEST_API_BASE}/v1/jobs/${job.id}`, () => {
        deleted.push(job.id);
        return new HttpResponse(null, { status: 204 });
      }),
    );
    renderReport(job);

    await user.click(screen.getByRole('button', { name: en.job.deleteJob }));
    const dialog = screen.getByRole('dialog', { name: en.job.deleteTitle });
    await user.click(within(dialog).getByRole('button', { name: en.job.deleteConfirm }));

    expect(await screen.findByRole('status', { name: 'current path' })).toHaveTextContent('/jobs');
    expect(deleted).toEqual([job.id]);
  });

  it('Report header: Copy as cURL copies the command that gets this job', async () => {
    const user = userEvent.setup();
    renderReport(job);

    await user.click(screen.getByRole('button', { name: en.copy.copyAsCurl }));

    expect(await navigator.clipboard.readText()).toBe(`curl ${TEST_API_BASE}/v1/jobs/${job.id}`);
  });

  it('Run again is disabled: hovering it shows "Coming soon"', async () => {
    const user = userEvent.setup();
    renderReport(job);

    const runAgain = screen.getByRole('button', { name: en.report.runAgain });
    expect(runAgain).toBeDisabled();
    await user.hover(runAgain.parentElement!);

    // The map's airport labels are tooltips too; the Coming soon one is among them.
    const tooltips = await screen.findAllByRole('tooltip');
    expect(tooltips.map((tooltip) => tooltip.textContent)).toContain(en.comingSoon);
  });

  it('Summary tiles: distance, duration with UTC times, average speed and cruise level', () => {
    renderReport(job);

    const tiles = screen.getByRole('region', { name: en.report.summaryLabel });
    expect(tiles).toHaveTextContent(`${en.report.tiles.distance}5,540 km`);
    expect(tiles).toHaveTextContent(`${en.report.tiles.duration}7h 45m10:35 → 18:20 UTC`);
    expect(tiles).toHaveTextContent(`${en.report.tiles.speed}715 km/h`);
    expect(tiles).toHaveTextContent(`${en.report.tiles.cruise}FL360`);
  });

  it('Airport cards: code, name, coordinates, UTC time and local time', () => {
    renderReport(job);

    const origin = screen.getByRole('region', { name: en.report.origin });
    expect(origin).toHaveTextContent('LHR');
    expect(origin).toHaveTextContent('London Heathrow');
    expect(origin).toHaveTextContent('51.4700° N, 0.4543° W');
    expect(origin).toHaveTextContent(`${en.report.departure}28 Oct 2026, 10:35 UTC`);
    expect(origin).toHaveTextContent(`${en.report.localTime}10:35 GMT`);
    const destination = screen.getByRole('region', { name: en.report.destination });
    expect(destination).toHaveTextContent(`${en.report.arrival}28 Oct 2026, 18:20 UTC`);
    expect(destination).toHaveTextContent(`${en.report.localTime}14:20 EDT`);
  });

  it('Aircraft card: flight, type, registration and the mock data source', () => {
    renderReport(job);

    const aircraft = screen.getByRole('region', { name: en.report.aircraft });
    expect(aircraft).toHaveTextContent(`${en.report.aircraftFields.flight}TX 401`);
    expect(aircraft).toHaveTextContent(`${en.report.aircraftFields.type}Boeing 777-300ER`);
    expect(aircraft).toHaveTextContent(`${en.report.aircraftFields.registration}G-TXAA`);
    expect(aircraft).toHaveTextContent(
      `${en.report.aircraftFields.dataSource}${en.report.dataSource}`,
    );
  });

  it('Job card: priority, attempts and the times of the job', () => {
    renderReport(job);

    const card = screen.getByRole('region', { name: en.report.job });
    expect(card).toHaveTextContent(`${en.report.jobFields.priority}5`);
    expect(card).toHaveTextContent(`${en.report.jobFields.attempts}1 / 3`);
    expect(card).toHaveTextContent(`${en.report.jobFields.created}29 Oct, 21:02:09`);
    expect(card).toHaveTextContent(`${en.report.jobFields.started}29 Oct, 21:02:10`);
    expect(card).toHaveTextContent(`${en.report.jobFields.completed}29 Oct, 21:02:11`);
  });

  it('Copy the report: the Result card copies the report JSON and reads Copied', async () => {
    const user = userEvent.setup();
    renderReport(job);
    const result = screen.getByRole('region', { name: en.job.result });
    expect(result).toHaveTextContent('result · 9 path points');

    await user.click(within(result).getByRole('button', { name: en.copy.copy }));

    expect(await navigator.clipboard.readText()).toBe(JSON.stringify(job.result, null, 2));
    expect(within(result).getByRole('button', { name: en.copy.copied })).toBeVisible();
  });

  it('Route on the map: airport labels, a marker per waypoint, the aircraft, the legend and the attribution', () => {
    renderReport(job);

    const map = screen.getByRole('region', { name: en.report.mapLabel });
    expect(within(map).getByText(en.report.airportLabel('LHR', 'London'))).toBeInTheDocument();
    expect(within(map).getByText(en.report.airportLabel('JFK', 'New York'))).toBeInTheDocument();
    for (const waypoint of job.result!.waypoints) {
      const time = waypoint.at.slice(11, 16);
      expect(mapMarker(en.report.waypointLabel(waypoint.name, `${time} UTC`))).toBeInTheDocument();
    }
    expect(within(map).getByRole('img', { name: en.report.aircraftIcon })).toBeInTheDocument();
    expect(map).toHaveTextContent(en.report.flown);
    expect(map).toHaveTextContent(en.report.remaining);
    expect(map).toHaveTextContent('OpenStreetMap');
    expect(within(map).getByRole('button', { name: 'Zoom in' })).toBeInTheDocument();
    expect(within(map).getByRole('button', { name: 'Zoom out' })).toBeInTheDocument();
  });

  it('Route on the map: the aircraft is turned along the path, north-east out of Tokyo', () => {
    renderReport(transitJobFixtures.pacific());

    // Heading about 50° (north-east); the east-pointing icon turns by heading − 90.
    const rotation = rotationOfAircraft();
    expect(rotation).toBeGreaterThan(-90);
    expect(rotation).toBeLessThan(0);
  });

  it('Departure selected at first: its strip button is pressed, its card reads Ground, the aircraft is at the departure', () => {
    renderReport(job);

    expect(stripButton(/Departure · LHR/)).toHaveAttribute('aria-pressed', 'true');
    const card = screen.getByRole('status', { name: en.report.selectedWaypoint });
    expect(card).toHaveTextContent('Departure · LHR');
    expect(card).toHaveTextContent(`${en.report.waypoint.altitude}${en.report.waypoint.ground}`);
    expect(card).toHaveTextContent('TX 401 · Boeing 777-300ER');
    const aircraft = screen.getByRole('img', { name: en.report.aircraftIcon });
    expect(placeOf(aircraft)).toMatch(/^-?\d+(\.\d+)?px -?\d+(\.\d+)?px$/);
    expect(placeOf(aircraft)).toBe(placeOf(mapMarker('Departure · LHR, 10:35 UTC')));
  });

  it('Hover a waypoint: the hovered marker is selected, its card shows its details, the aircraft moves to it', async () => {
    const user = userEvent.setup();
    renderReport(job);
    const marker = mapMarker('Oceanic entry, 12:31 UTC');

    await user.hover(marker);

    const card = screen.getByRole('status', { name: en.report.selectedWaypoint });
    expect(card).toHaveTextContent('Oceanic entry');
    expect(card).toHaveTextContent('12:31 UTC');
    expect(card).toHaveTextContent(`${en.report.waypoint.position}53.64° N, 20.70° W`);
    expect(card).toHaveTextContent(`${en.report.waypoint.altitude}FL350`);
    expect(card).toHaveTextContent(`${en.report.waypoint.groundSpeed}905 km/h`);
    expect(card).toHaveTextContent(`${en.report.waypoint.flownLeft}1,385 / 4,155 km`);
    expect(stripButton(/Oceanic entry/)).toHaveAttribute('aria-pressed', 'true');
    expect(stripButton(/Departure · LHR/)).toHaveAttribute('aria-pressed', 'false');
    const aircraft = screen.getByRole('img', { name: en.report.aircraftIcon });
    expect(placeOf(aircraft)).toBe(placeOf(marker));
    expect(placeOf(aircraft)).not.toBe(placeOf(mapMarker('Departure · LHR, 10:35 UTC')));
    // Over the Atlantic the aircraft heads west: the east-pointing icon is turned about half a turn.
    expect(rotationOfAircraft()).toBeGreaterThan(135);
    expect(rotationOfAircraft()).toBeLessThan(225);
  });

  it('Hover a waypoint: clicking a marker selects it too', async () => {
    const user = userEvent.setup();
    renderReport(job);

    await user.click(mapMarker('Oceanic exit · near Gander, 16:24 UTC'));

    expect(screen.getByRole('status', { name: en.report.selectedWaypoint })).toHaveTextContent(
      'Oceanic exit · near Gander',
    );
    expect(stripButton(/Oceanic exit/)).toHaveAttribute('aria-pressed', 'true');
  });

  it('Hover a waypoint: focusing a marker with the keyboard selects it too', () => {
    renderReport(job);

    act(() => {
      mapMarker('Mid-Atlantic, 14:27 UTC').focus();
    });

    expect(screen.getByRole('status', { name: en.report.selectedWaypoint })).toHaveTextContent(
      'Mid-Atlantic',
    );
  });

  it('Select from the strip: clicking the arrival presses its button and shows its card', async () => {
    const user = userEvent.setup();
    renderReport(job);

    await user.click(stripButton(/Arrival · JFK/));

    expect(stripButton(/Arrival · JFK/)).toHaveAttribute('aria-pressed', 'true');
    const card = screen.getByRole('status', { name: en.report.selectedWaypoint });
    expect(card).toHaveTextContent('Arrival · JFK');
    expect(card).toHaveTextContent(`${en.report.waypoint.flownLeft}5,540 / 0 km`);
  });

  it('Select from the strip: focusing a strip button selects its waypoint', () => {
    renderReport(job);

    act(() => {
      stripButton(/Cruise/).focus();
    });

    expect(stripButton(/Cruise/)).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('status', { name: en.report.selectedWaypoint })).toHaveTextContent(
      'Cruise',
    );
  });

  it('Select from the strip: hovering a strip button selects its waypoint', async () => {
    const user = userEvent.setup();
    renderReport(job);

    await user.hover(stripButton(/Mid-Atlantic/));

    expect(stripButton(/Mid-Atlantic/)).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('status', { name: en.report.selectedWaypoint })).toHaveTextContent(
      'Mid-Atlantic',
    );
  });
});
