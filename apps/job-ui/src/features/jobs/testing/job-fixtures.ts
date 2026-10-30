import { randomUUID } from 'node:crypto';

import {
  type EmailJob,
  FlightTransitJob,
  type FlightTransitJobResult,
  type JobLogEntry,
  type QueueStats,
  type WebhookJob,
} from '@job-queue/contracts';

export type BuildJobFixturesRequest = Partial<EmailJob>;
export type BuildJobFixturesResponse = EmailJob;
export type BuildWebhookJobFixturesRequest = Partial<WebhookJob>;
export type BuildWebhookJobFixturesResponse = WebhookJob;
export type BuildQueueStatsFixturesRequest = Partial<QueueStats>;
export type BuildQueueStatsFixturesResponse = QueueStats;
export type BuildTransitJobFixturesRequest = Partial<FlightTransitJob>;
export type BuildTransitJobFixturesResponse = FlightTransitJob;
export type BuildJobLogEntryFixturesRequest = Partial<JobLogEntry>;
export type BuildJobLogEntryFixturesResponse = JobLogEntry;

/** Builds valid jobs for tests; each test overrides only the fields its scenario is about. */
export interface JobFixtures {
  build(req?: BuildJobFixturesRequest): BuildJobFixturesResponse;
}

/** Builds valid webhook jobs for tests, like `JobFixtures` for email. */
export interface WebhookJobFixtures {
  build(req?: BuildWebhookJobFixturesRequest): BuildWebhookJobFixturesResponse;
}

/** Builds valid queue statistics for tests, with a different value in every field. */
export interface QueueStatsFixtures {
  build(req?: BuildQueueStatsFixturesRequest): BuildQueueStatsFixturesResponse;
}

/** Builds valid flight transit jobs for tests: pending, or completed with a full report. */
export interface TransitJobFixtures {
  /** A pending LHR → JFK job departing 2026-10-28. */
  build(req?: BuildTransitJobFixturesRequest): BuildTransitJobFixturesResponse;
  /** A completed LHR → JFK job with the report of the design's TransitReport screen. */
  completed(req?: BuildTransitJobFixturesRequest): BuildTransitJobFixturesResponse;
  /** A completed NRT → LAX job whose path crosses the 180° meridian. */
  pacific(req?: BuildTransitJobFixturesRequest): BuildTransitJobFixturesResponse;
}

/** The fields every pending job has, whatever its type, as job-service returns them. */
const PENDING_JOB = {
  status: 'pending',
  priority: 5,
  attempts: 0,
  maxAttempts: 3,
  result: null,
  error: null,
  groupId: null,
  scheduledAt: null,
  startedAt: null,
  completedAt: null,
  createdAt: '2026-10-29T21:02:09.000Z',
  updatedAt: '2026-10-29T21:02:09.000Z',
} as const;

/** Test-only: a pending email job with a new id and fixed times, as job-service returns it. */
export class EmailJobFixtures implements JobFixtures {
  build(req: BuildJobFixturesRequest = {}): BuildJobFixturesResponse {
    return {
      id: randomUUID(),
      ...PENDING_JOB,
      type: 'email',
      payload: { to: 'ops@acme.test', subject: 'Weekly digest', body: 'Hi team' },
      ...req,
    };
  }
}

export const jobFixtures: JobFixtures = new EmailJobFixtures();

/** Test-only: a pending webhook job with a fresh id, as job-service returns it. */
export class PendingWebhookJobFixtures implements WebhookJobFixtures {
  build(req: BuildWebhookJobFixturesRequest = {}): BuildWebhookJobFixturesResponse {
    return {
      id: randomUUID(),
      ...PENDING_JOB,
      type: 'webhook',
      payload: {
        method: 'POST',
        url: 'https://hooks.example.com/orders',
        body: { orderId: 'ord_4821', event: 'order.paid' },
      },
      ...req,
    };
  }
}

export const webhookJobFixtures: WebhookJobFixtures = new PendingWebhookJobFixtures();

/** Test-only: statistics as job-service returns them, every value distinct so the cards can be told apart. */
export class DistinctQueueStatsFixtures implements QueueStatsFixtures {
  build(req: BuildQueueStatsFixturesRequest = {}): BuildQueueStatsFixturesResponse {
    return {
      pending: 12,
      processing: 3,
      scheduled: 7,
      recent: { windowMinutes: 1440, completed: 1234, failed: 5 },
      throughput: { windowMinutes: 5, perMinute: 2.4 },
      counts: {
        status: {
          scheduled: 7,
          pending: 12,
          processing: 3,
          completed: 1234,
          failed: 5,
          cancelled: 2,
        },
        type: { email: 1200, webhook: 60, 'flight-transit': 3 },
      },
      ...req,
    };
  }
}

export const queueStatsFixtures: QueueStatsFixtures = new DistinctQueueStatsFixtures();

/** The report of the design's TransitReport screen: LHR → JFK on 28 Oct 2026. */
const ATLANTIC_REPORT: FlightTransitJobResult = {
  flight: 'TX 401',
  aircraft: { model: 'Boeing 777-300ER', registration: 'G-TXAA' },
  origin: {
    iata: 'LHR',
    name: 'London Heathrow',
    city: 'London',
    timeZone: 'Europe/London',
    lat: 51.47,
    lon: -0.4543,
  },
  destination: {
    iata: 'JFK',
    name: 'New York JFK',
    city: 'New York',
    timeZone: 'America/New_York',
    lat: 40.6413,
    lon: -73.7781,
  },
  departureAt: '2026-10-28T10:35:00.000Z',
  arrivalAt: '2026-10-28T18:20:00.000Z',
  distanceKm: 5540,
  durationMin: 465,
  cruiseAltitudeFt: 36000,
  path: [
    [51.47, -0.4543],
    [52.9, -10.2],
    [53.64, -20.7],
    [53.3, -31.0],
    [52.22, -41.3],
    [50.34, -50.39],
    [47.58, -59.32],
    [44.4, -66.9],
    [40.6413, -73.7781],
  ],
  waypoints: [
    {
      name: 'Departure · LHR',
      at: '2026-10-28T10:35:00.000Z',
      lat: 51.47,
      lon: -0.4543,
      altitudeFt: 0,
      groundSpeedKmh: 0,
      distanceFlownKm: 0,
    },
    {
      name: 'Oceanic entry',
      at: '2026-10-28T12:31:00.000Z',
      lat: 53.64,
      lon: -20.7,
      altitudeFt: 35000,
      groundSpeedKmh: 905,
      distanceFlownKm: 1385,
    },
    {
      name: 'Mid-Atlantic',
      at: '2026-10-28T14:27:00.000Z',
      lat: 52.22,
      lon: -41.3,
      altitudeFt: 36000,
      groundSpeedKmh: 880,
      distanceFlownKm: 2770,
    },
    {
      name: 'Cruise',
      at: '2026-10-28T15:23:00.000Z',
      lat: 50.34,
      lon: -50.39,
      altitudeFt: 36000,
      groundSpeedKmh: 872,
      distanceFlownKm: 3435,
    },
    {
      name: 'Oceanic exit · near Gander',
      at: '2026-10-28T16:24:00.000Z',
      lat: 47.58,
      lon: -59.32,
      altitudeFt: 38000,
      groundSpeedKmh: 860,
      distanceFlownKm: 4155,
    },
    {
      name: 'Arrival · JFK',
      at: '2026-10-28T18:20:00.000Z',
      lat: 40.6413,
      lon: -73.7781,
      altitudeFt: 0,
      groundSpeedKmh: 0,
      distanceFlownKm: 5540,
    },
  ],
};

/** NRT → LAX: the path crosses the 180° meridian between its third and fourth points. */
const PACIFIC_REPORT: FlightTransitJobResult = {
  flight: 'TX 102',
  aircraft: { model: 'Boeing 787-9', registration: 'JA-TX02' },
  origin: {
    iata: 'NRT',
    name: 'Tokyo Narita',
    city: 'Tokyo',
    timeZone: 'Asia/Tokyo',
    lat: 35.772,
    lon: 140.3929,
  },
  destination: {
    iata: 'LAX',
    name: 'Los Angeles',
    city: 'Los Angeles',
    timeZone: 'America/Los_Angeles',
    lat: 33.9416,
    lon: -118.4085,
  },
  departureAt: '2026-10-28T08:00:00.000Z',
  arrivalAt: '2026-10-28T18:00:00.000Z',
  distanceKm: 8750,
  durationMin: 600,
  cruiseAltitudeFt: 39000,
  path: [
    [35.772, 140.3929],
    [42.0, 155.0],
    [46.0, 170.0],
    [47.0, -178.0],
    [45.0, -165.0],
    [40.0, -140.0],
    [33.9416, -118.4085],
  ],
  waypoints: [
    {
      name: 'Departure · NRT',
      at: '2026-10-28T08:00:00.000Z',
      lat: 35.772,
      lon: 140.3929,
      altitudeFt: 0,
      groundSpeedKmh: 0,
      distanceFlownKm: 0,
    },
    {
      name: 'Date line',
      at: '2026-10-28T11:30:00.000Z',
      lat: 47.0,
      lon: -178.0,
      altitudeFt: 39000,
      groundSpeedKmh: 910,
      distanceFlownKm: 3200,
    },
    {
      name: 'Arrival · LAX',
      at: '2026-10-28T18:00:00.000Z',
      lat: 33.9416,
      lon: -118.4085,
      altitudeFt: 0,
      groundSpeedKmh: 0,
      distanceFlownKm: 8750,
    },
  ],
};

/** Test-only: flight transit jobs with a fresh id, checked against the shared job schema. */
export class LhrJfkTransitJobFixtures implements TransitJobFixtures {
  build(req: BuildTransitJobFixturesRequest = {}): BuildTransitJobFixturesResponse {
    return FlightTransitJob.parse({
      id: randomUUID(),
      ...PENDING_JOB,
      type: 'flight-transit',
      payload: { origin: 'LHR', destination: 'JFK', departureDate: '2026-10-28' },
      ...req,
    });
  }

  completed(req: BuildTransitJobFixturesRequest = {}): BuildTransitJobFixturesResponse {
    return this.build({
      status: 'completed',
      attempts: 1,
      result: ATLANTIC_REPORT,
      startedAt: '2026-10-29T21:02:10.000Z',
      completedAt: '2026-10-29T21:02:11.900Z',
      updatedAt: '2026-10-29T21:02:11.900Z',
      ...req,
    });
  }

  pacific(req: BuildTransitJobFixturesRequest = {}): BuildTransitJobFixturesResponse {
    return this.completed({
      payload: { origin: 'NRT', destination: 'LAX', departureDate: '2026-10-28' },
      result: PACIFIC_REPORT,
      ...req,
    });
  }
}

export const transitJobFixtures: TransitJobFixtures = new LhrJfkTransitJobFixtures();

/** Builds valid job log entries for tests; each test overrides only the fields its scenario is about. */
export interface JobLogEntryFixtures {
  build(req?: BuildJobLogEntryFixturesRequest): BuildJobLogEntryFixturesResponse;
}

/** Test-only: an info entry of job-service's first attempt with a fresh id. */
export class InfoJobLogEntryFixtures implements JobLogEntryFixtures {
  build(req: BuildJobLogEntryFixturesRequest = {}): BuildJobLogEntryFixturesResponse {
    return {
      id: randomUUID(),
      jobId: randomUUID(),
      attempt: 1,
      level: 'info',
      message: 'Job submitted',
      metadata: {},
      timestamp: '2026-10-29T21:02:10.000Z',
      source: 'job-service',
      instanceId: null,
      ...req,
    };
  }
}

export const jobLogEntryFixtures: JobLogEntryFixtures = new InfoJobLogEntryFixtures();
