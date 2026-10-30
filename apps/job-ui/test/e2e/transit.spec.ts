import type { Job } from '@job-queue/contracts';
import { expect, type Locator, type Page, test } from '@playwright/test';

import { API_BASE_PATH } from '../../src/config/api-base-path';
import { transitJobFixtures } from '../../src/features/jobs/testing/job-fixtures';
import { en } from '../../src/locales/en';

/** A 1×1 transparent PNG: every map tile, so the test needs no network. */
const BLANK_TILE = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

interface MockTransitBackend {
  /** Answers job-ui's call for the job, and every tile request with a blank tile. */
  install(req: { page: Page; job: Job }): Promise<void>;
}

/** job-service's GET of one job and the tile server, behind `page.route`. */
class RoutedTransitBackend implements MockTransitBackend {
  async install({ page, job }: { page: Page; job: Job }): Promise<void> {
    await page.route(`**${API_BASE_PATH}/v1/jobs/${job.id}`, (route) =>
      route.fulfill({ json: job }),
    );
    await page.route('**/tile.openstreetmap.org/**', (route) =>
      route.fulfill({ contentType: 'image/png', body: BLANK_TILE }),
    );
  }
}

const backend: MockTransitBackend = new RoutedTransitBackend();

interface PageLayout {
  /** The centre of an element on the page, in page pixels. */
  centre(req: { locator: Locator }): Promise<{ x: number; y: number }>;
}

/** `PageLayout` from the elements' bounding boxes as the browser lays them out. */
class BoundingBoxLayout implements PageLayout {
  async centre({ locator }: { locator: Locator }): Promise<{ x: number; y: number }> {
    const box = await locator.boundingBox();
    if (!box) throw new Error('element has no box');
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  }
}

const layout: PageLayout = new BoundingBoxLayout();

/** The dashed whole path and the solid flown part, as the browser draws them. */
const WHOLE = 'path.transit-route';
const FLOWN = 'path.transit-flown';

test('Route on the map: the dashed path fits the map, both airports in view, nothing flown at the departure', async ({
  page,
}) => {
  const job = transitJobFixtures.completed();
  await backend.install({ page, job });

  await page.goto(`/jobs/${job.id}`);

  const map = page.getByRole('region', { name: en.report.mapLabel });
  await expect(map.locator(WHOLE)).toHaveCount(1);
  const container = (await map.locator('.leaflet-container').boundingBox())!;
  const whole = (await map.locator(WHOLE).boundingBox())!;
  expect(whole.width).toBeGreaterThan(container.width / 3);
  for (const label of [
    en.report.airportLabel('LHR', 'London'),
    en.report.airportLabel('JFK', 'New York'),
  ]) {
    const box = (await map.getByText(label).boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(container.x);
    expect(box.x + box.width).toBeLessThanOrEqual(container.x + container.width);
    expect(box.y).toBeGreaterThanOrEqual(container.y);
    expect(box.y + box.height).toBeLessThanOrEqual(container.y + container.height);
  }
  await expect(map.locator(FLOWN)).toHaveCount(0);
});

test('Hover a waypoint: the aircraft moves to it and the path is drawn flown from the departure up to it', async ({
  page,
}) => {
  const job = transitJobFixtures.completed();
  await backend.install({ page, job });
  await page.goto(`/jobs/${job.id}`);
  const map = page.getByRole('region', { name: en.report.mapLabel });
  const marker = map.getByRole('button', { name: 'Mid-Atlantic, 14:27 UTC', exact: true });

  await marker.hover();

  await expect(page.getByRole('status', { name: en.report.selectedWaypoint })).toContainText(
    'Mid-Atlantic',
  );
  const [plane, point] = [
    await layout.centre({ locator: map.getByRole('img', { name: en.report.aircraftIcon }) }),
    await layout.centre({ locator: marker }),
  ];
  expect(Math.abs(plane.x - point.x)).toBeLessThan(2);
  expect(Math.abs(plane.y - point.y)).toBeLessThan(2);
  // Westbound: the flown part runs from London (east) to the hovered marker, not further.
  const flown = (await map.locator(FLOWN).boundingBox())!;
  const whole = (await map.locator(WHOLE).boundingBox())!;
  expect(flown.width).toBeLessThan(whole.width - 50);
  expect(Math.abs(flown.x - point.x)).toBeLessThan(4);
});

test('Select from the strip: at the arrival the whole path is drawn as flown', async ({ page }) => {
  const job = transitJobFixtures.completed();
  await backend.install({ page, job });
  await page.goto(`/jobs/${job.id}`);
  const map = page.getByRole('region', { name: en.report.mapLabel });

  await page
    .getByRole('group', { name: en.report.waypointsLabel })
    .getByRole('button', { name: /Arrival · JFK/ })
    .click();

  const flown = (await map.locator(FLOWN).boundingBox())!;
  const whole = (await map.locator(WHOLE).boundingBox())!;
  expect(Math.abs(flown.x - whole.x)).toBeLessThan(3);
  expect(Math.abs(flown.width - whole.width)).toBeLessThan(3);
});

test('Route across the antimeridian: the Pacific route is drawn the short way, east from Tokyo to Los Angeles', async ({
  page,
}) => {
  const job = transitJobFixtures.pacific();
  await backend.install({ page, job });

  await page.goto(`/jobs/${job.id}`);

  const map = page.getByRole('region', { name: en.report.mapLabel });
  const tokyo = await layout.centre({
    locator: map.getByText(en.report.airportLabel('NRT', 'Tokyo')),
  });
  const losAngeles = await layout.centre({
    locator: map.getByText(en.report.airportLabel('LAX', 'Los Angeles')),
  });
  const mapBox = await map.locator('.leaflet-container').boundingBox();
  const path = await map.locator(WHOLE).boundingBox();
  // Drawn the long way, Los Angeles would sit west of Tokyo and the line would cross the world.
  expect(losAngeles.x).toBeGreaterThan(tokyo.x);
  expect(path!.width).toBeLessThan(mapBox!.width);
  expect(path!.x).toBeGreaterThanOrEqual(mapBox!.x);
});
