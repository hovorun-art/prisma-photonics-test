import { fileURLToPath } from 'node:url';

import {
  ErrorBody,
  FINISHED_JOB_STATUSES,
  type FlightTransitJobResult,
  CreateJobsBulkResponse,
  INTERNAL_JOBS_ROUTE,
  JOBS_BULK_ROUTE,
  JOBS_ROUTE,
  Job,
  type JobStatus,
  type JobType,
  QueryJobsResponse,
  SERVICE_TOKEN_SCHEME,
} from '@job-queue/contracts';
import type { Closable, CloseClosableResponse } from '@job-queue/kernel';
import { REDIS_CONNECTION, type RedisConnection } from '@job-queue/service-kit';
import { CONTAINER_IMAGES, PrismaMigrateDeploy } from '@job-queue/test-support';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { expect } from 'vitest';
import { type DeepMockProxy, mockDeep, mockReset } from 'vitest-mock-extended';

import { AppModule } from '../../src/app/app.module.js';
import { JOB_QUEUE, type JobQueue } from '../../src/domain/jobs/job-queue.js';
import { JOB_REPOSITORY, type JobRepository } from '../../src/domain/jobs/job-repository.js';
import { JOB_SERVICE_SETUP_STEPS } from '../../src/infra/bootstrap/job-service-bootstrap.js';
import { ZodJobServiceConfigParser } from '../../src/infra/config/zod-job-service-config-parser.js';
import { PrismaDatabase } from '../../src/infra/prisma/prisma-database.js';

const JOB_SERVICE_DIR = fileURLToPath(new URL('../..', import.meta.url));

/** The configured values the e2e tests depend on. */
export const TEST_CONFIG = {
  serviceToken: 'e2e-service-token',
  queryDefaultLimit: 3,
  queryMaxLimit: 10,
  /** Above the largest valid email body, so only the oversized-body tests hit it. */
  bodyLimitBytes: 32_768,
  bulkMaxJobs: 3,
} as const;

export const AUTHORIZATION = `${SERVICE_TOKEN_SCHEME} ${TEST_CONFIG.serviceToken}`;

const MS_PER_DAY = 86_400_000;

/** A well-formed report of a flight transit job, for the route `LHR` to `JFK`. */
export const TRANSIT_REPORT: FlightTransitJobResult = {
  flight: 'BA117',
  aircraft: { model: 'Boeing 777-300ER', registration: 'G-STBA' },
  origin: {
    iata: 'LHR',
    name: 'Heathrow Airport',
    city: 'London',
    timeZone: 'Europe/London',
    lat: 51.47,
    lon: -0.4543,
  },
  destination: {
    iata: 'JFK',
    name: 'John F. Kennedy International Airport',
    city: 'New York',
    timeZone: 'America/New_York',
    lat: 40.6413,
    lon: -73.7781,
  },
  departureAt: '2030-06-15T08:20:00.000Z',
  arrivalAt: '2030-06-15T16:05:00.000Z',
  distanceKm: 5555,
  durationMin: 465,
  cruiseAltitudeFt: 37_000,
  path: [
    [51.47, -0.4543],
    [52.1, -40.5],
    [40.6413, -73.7781],
  ],
  waypoints: [
    {
      name: 'Departure',
      at: '2030-06-15T08:20:00.000Z',
      lat: 51.47,
      lon: -0.4543,
      altitudeFt: 0,
      groundSpeedKmh: 0,
      distanceFlownKm: 0,
    },
    {
      name: 'Arrival',
      at: '2030-06-15T16:05:00.000Z',
      lat: 40.6413,
      lon: -73.7781,
      altitudeFt: 0,
      groundSpeedKmh: 0,
      distanceFlownKm: 5555,
    },
  ],
};

export interface SeedRequest {
  status: JobStatus;
  type?: JobType;
  attempts?: number;
  maxAttempts?: number;
}

export interface CallRequest {
  id: string;
  /** The `authorization` header; `null` leaves it out altogether. Defaults to the valid token. */
  authorization?: string | null;
}

export interface ReportRequest extends CallRequest {
  /** A string is sent as it is, so malformed JSON can be sent too. */
  body: unknown;
}

export interface ErrorBodyRequest {
  response: Response;
  status: number;
  code: string;
}

export interface ConflictRequest {
  response: Response;
  /** The job's current status, expected in the error's details. */
  status: JobStatus;
}

interface TypedFieldsRequest {
  type: JobType;
  completed: boolean;
}

/** Per job type, so `type`, `payload` and `result` stay matched. */
type TypedFields = Job extends infer J
  ? J extends Job
    ? Pick<J, 'type' | 'payload' | 'result'>
    : never
  : never;

interface JobServiceUnderTestDeps {
  postgres: StartedPostgreSqlContainer;
  app: INestApplication;
  baseUrl: string;
  queue: DeepMockProxy<JobQueue>;
  redis: DeepMockProxy<RedisConnection>;
}

/**
 * job-service for the e2e tests: the real `AppModule`, set up with the same steps as `main.ts`,
 * over HTTP against its own Postgres (a migrated Testcontainer). The services around it are mocked
 * at their ports: the job queue and the Redis connection. Holds the HTTP calls and checks the test
 * files share.
 */
export class JobServiceUnderTest implements Closable {
  readonly app: INestApplication;
  readonly queue: DeepMockProxy<JobQueue>;
  readonly redis: DeepMockProxy<RedisConnection>;

  private constructor(private readonly d: JobServiceUnderTestDeps) {
    this.app = d.app;
    this.queue = d.queue;
    this.redis = d.redis;
  }

  static async start(): Promise<JobServiceUnderTest> {
    const postgres = await new PostgreSqlContainer(CONTAINER_IMAGES.postgres).start();
    await new PrismaMigrateDeploy({ appDir: JOB_SERVICE_DIR }).migrate({
      databaseUrl: postgres.getConnectionUri(),
    });
    const parsed = new ZodJobServiceConfigParser().parse({
      env: {
        NODE_ENV: 'test',
        LOG_LEVEL: 'fatal',
        JOB_SERVICE_PORT: '0',
        INTERNAL_SERVICE_TOKEN: TEST_CONFIG.serviceToken,
        DATABASE_URL: postgres.getConnectionUri(),
        // Never connected to: the queue and the Redis connection are mocked.
        REDIS_URL: 'redis://127.0.0.1:1',
        JOB_SERVICE_QUERY_DEFAULT_LIMIT: String(TEST_CONFIG.queryDefaultLimit),
        JOB_SERVICE_QUERY_MAX_LIMIT: String(TEST_CONFIG.queryMaxLimit),
        JOB_SERVICE_BODY_LIMIT_BYTES: String(TEST_CONFIG.bodyLimitBytes),
        JOB_SERVICE_BULK_MAX_JOBS: String(TEST_CONFIG.bulkMaxJobs),
      },
    });
    if (!parsed.ok) throw new Error(parsed.problems);
    const queue = mockDeep<JobQueue>();
    const redis = mockDeep<RedisConnection>();
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule.forRoot({ config: parsed.config })],
    })
      .overrideProvider(JOB_QUEUE)
      .useValue(queue)
      .overrideProvider(REDIS_CONNECTION)
      .useValue(redis)
      .compile();
    const app = moduleRef.createNestApplication({ logger: false });
    for (const step of JOB_SERVICE_SETUP_STEPS) step.apply({ app });
    await app.listen(0, '127.0.0.1');
    return new JobServiceUnderTest({ postgres, app, baseUrl: await app.getUrl(), queue, redis });
  }

  /** Before each test: no jobs, and mocks that remember no calls and answer nothing. */
  async clear(): Promise<void> {
    mockReset(this.queue);
    mockReset(this.redis);
    await this.app.get(PrismaDatabase).job.deleteMany();
  }

  /** Closes the app (as a shutdown would), then removes its database. */
  async close(): Promise<CloseClosableResponse> {
    await this.app.close();
    await this.d.postgres.stop();
    return {};
  }

  // --- HTTP calls -------------------------------------------------------------------------------

  url(path: string): string {
    return new URL(path, this.d.baseUrl).toString();
  }

  /** A string body is sent as it is, so malformed JSON can be sent too. */
  submit(body: unknown): Promise<Response> {
    return fetch(this.url(JOBS_ROUTE), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });
  }

  async submitted(body: unknown): Promise<Job> {
    const response = await this.submit(body);
    expect(response.status).toBe(201);
    return Job.parse(await response.json());
  }

  /** `POST /v1/jobs/bulk`; a string body is sent as it is. */
  submitBulk(body: unknown): Promise<Response> {
    return fetch(this.url(JOBS_BULK_ROUTE), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });
  }

  /** The jobs a bulk created, in request order. */
  async submittedBulk(jobs: unknown[]): Promise<Job[]> {
    const response = await this.submitBulk({ jobs });
    expect(response.status).toBe(201);
    return CreateJobsBulkResponse.parse(await response.json()).items;
  }

  get(id: string): Promise<Response> {
    return fetch(this.url(`${JOBS_ROUTE}/${id}`));
  }

  remove(id: string): Promise<Response> {
    return fetch(this.url(`${JOBS_ROUTE}/${id}`), { method: 'DELETE' });
  }

  async total(): Promise<number> {
    return QueryJobsResponse.parse(await (await fetch(this.url(JOBS_ROUTE))).json()).total;
  }

  read(req: CallRequest): Promise<Response> {
    return fetch(this.url(`${INTERNAL_JOBS_ROUTE}/${req.id}`), {
      headers: this.authorized(req.authorization),
    });
  }

  async stored(id: string): Promise<Job> {
    const response = await this.read({ id });
    expect(response.status).toBe(200);
    return Job.parse(await response.json());
  }

  report(req: ReportRequest): Promise<Response> {
    return fetch(this.url(`${INTERNAL_JOBS_ROUTE}/${req.id}`), {
      method: 'PATCH',
      headers: { ...this.authorized(req.authorization), 'content-type': 'application/json' },
      body: typeof req.body === 'string' ? req.body : JSON.stringify(req.body),
    });
  }

  // --- Checks -----------------------------------------------------------------------------------

  /** The uniform error body, with nothing else (no framework error body) in it. */
  async errorBody({ response, status, code }: ErrorBodyRequest): Promise<ErrorBody> {
    expect(response.status).toBe(status);
    const raw = (await response.json()) as Record<string, unknown>;
    expect(Object.keys(raw).sort()).toEqual(['code', 'details', 'message']);
    const body = ErrorBody.parse(raw);
    expect(body.code).toBe(code);
    expect(body.message).not.toBe('');
    return body;
  }

  /** The fields of a `VALIDATION_FAILED` answer's issues. */
  async issuePaths(response: Response): Promise<unknown[]> {
    const body = await this.errorBody({ response, status: 400, code: 'VALIDATION_FAILED' });
    const issues = body.details.issues as { path: unknown[] }[];
    return issues.map((issue) => issue.path);
  }

  async expectConflict({ response, status }: ConflictRequest): Promise<void> {
    const body = await this.errorBody({ response, status: 409, code: 'JOB_STATUS_CONFLICT' });
    expect(body.details).toMatchObject({ status });
  }

  /** The UTC date `days` days from now (negative for the past), as a flight transit's `departureDate`. */
  utcDate(days: number): string {
    return new Date(Date.now() + days * MS_PER_DAY).toISOString().slice(0, 10);
  }

  // --- Data in states no route can create in one step ------------------------------------------

  /** Stores a job in the given state through the app's own repository. */
  async seed({ status, ...options }: SeedRequest): Promise<Job> {
    const now = new Date().toISOString();
    const finished = (FINISHED_JOB_STATUSES as readonly JobStatus[]).includes(status);
    const completed = status === 'completed';
    const notStarted = status === 'pending' || status === 'scheduled';
    const typed = this.typedFields({ type: options.type ?? 'email', completed });
    const { job } = await this.app.get<JobRepository>(JOB_REPOSITORY).create({
      job: {
        ...typed,
        status,
        priority: 5,
        attempts: options.attempts ?? (notStarted ? 0 : 1),
        maxAttempts: options.maxAttempts ?? 3,
        error: null,
        scheduledAt: status === 'scheduled' ? new Date(Date.now() + 3_600_000).toISOString() : null,
        startedAt: notStarted ? null : now,
        completedAt: finished ? now : null,
      },
    });
    return job;
  }

  /** The type, a valid payload and (when completed) a valid result of a seeded job. */
  private typedFields({ type, completed }: TypedFieldsRequest): TypedFields {
    switch (type) {
      case 'webhook':
        return {
          type,
          payload: { method: 'POST', url: 'https://hooks.example.com/seeded' },
          result: completed ? { statusCode: 200, responseBody: { seeded: true } } : null,
        };
      case 'flight-transit':
        return {
          type,
          payload: { origin: 'LHR', destination: 'JFK', departureDate: this.utcDate(1) },
          result: completed ? TRANSIT_REPORT : null,
        };
      case 'email':
        return {
          type,
          payload: { to: 'ada@example.com', subject: 'Seeded', body: 'Hi' },
          result: completed ? { messageId: 'seeded-message' } : null,
        };
    }
  }

  private authorized(authorization: string | null = AUTHORIZATION): Record<string, string> {
    return authorization === null ? {} : { authorization };
  }
}
