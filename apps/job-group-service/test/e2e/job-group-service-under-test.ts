import { fileURLToPath } from 'node:url';

import {
  ErrorBody,
  JOB_GROUPS_ROUTE,
  JobGroup,
  type JobGroupStatus,
  QueryJobGroupsResponse,
} from '@job-queue/contracts';
import type { Closable, CloseClosableResponse } from '@job-queue/kernel';
import {
  CONTAINER_IMAGES,
  PrismaMigrateDeploy,
  UNREACHABLE_HTTP_URL,
} from '@job-queue/test-support';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { expect } from 'vitest';
import { type DeepMockProxy, mockDeep, mockReset } from 'vitest-mock-extended';

import { AppModule } from '../../src/app/app.module.js';
import { GROUP_CHILD_JOBS, type GroupChildJobs } from '../../src/domain/groups/group-child-jobs.js';
import {
  JOB_GROUP_REPOSITORY,
  type JobGroupRepository,
} from '../../src/domain/groups/job-group-repository.js';
import {
  type CheckRunningJobGroupTrackerResponse,
  JOB_GROUP_TRACKER,
  type JobGroupTracker,
} from '../../src/domain/groups/job-group-tracker.js';
import {
  JOB_GROUP_SERVICE_BODY_PARSER,
  JOB_GROUP_SERVICE_SETUP_STEPS,
} from '../../src/infra/bootstrap/job-group-service-bootstrap.js';
import { ZodJobGroupServiceConfigParser } from '../../src/infra/config/zod-job-group-service-config-parser.js';
import { PrismaDatabase } from '../../src/infra/prisma/prisma-database.js';

const JOB_GROUP_SERVICE_DIR = fileURLToPath(new URL('../..', import.meta.url));
const DATABASE_SCHEMA = 'job_groups';

/** The configured values the e2e tests depend on. */
export const TEST_CONFIG = {
  /**
   * Long enough that the timer never fires during a test: a test runs a poll itself with `poll()`,
   * so every call to the job-service mock is one the test stubbed (the timer is unit-tested).
   */
  pollIntervalMs: 3_600_000,
  queryDefaultLimit: 3,
  queryMaxLimit: 10,
} as const;

export interface ErrorBodyRequest {
  response: Response;
  status: number;
  code: string;
}

export interface SeedRequest {
  status: JobGroupStatus;
  total: number;
  completed: number;
  failed: number;
}

interface JobGroupServiceUnderTestDeps {
  postgres: StartedPostgreSqlContainer;
  app: INestApplication;
  baseUrl: string;
  childJobs: DeepMockProxy<GroupChildJobs>;
}

/**
 * job-group-service for the e2e tests: the real `AppModule`, set up with the same steps and body
 * parser setting as `main.ts`, over HTTP against its own Postgres schema (a migrated Testcontainer).
 * job-service is mocked at its port, `GroupChildJobs`. Holds the HTTP calls and checks the test
 * files share.
 */
export class JobGroupServiceUnderTest implements Closable {
  readonly app: INestApplication;
  readonly childJobs: DeepMockProxy<GroupChildJobs>;

  private constructor(private readonly d: JobGroupServiceUnderTestDeps) {
    this.app = d.app;
    this.childJobs = d.childJobs;
  }

  static async start(): Promise<JobGroupServiceUnderTest> {
    const postgres = await new PostgreSqlContainer(CONTAINER_IMAGES.postgres).start();
    const databaseUrl = `${postgres.getConnectionUri()}?schema=${DATABASE_SCHEMA}`;
    await new PrismaMigrateDeploy({ appDir: JOB_GROUP_SERVICE_DIR }).migrate({ databaseUrl });
    const parsed = new ZodJobGroupServiceConfigParser().parse({
      env: {
        NODE_ENV: 'test',
        LOG_LEVEL: 'fatal',
        JOB_GROUP_SERVICE_PORT: '0',
        JOB_GROUP_SERVICE_DATABASE_URL: databaseUrl,
        // Never called: job-service is mocked at `GroupChildJobs`.
        JOB_SERVICE_URL: UNREACHABLE_HTTP_URL,
        JOB_GROUP_POLL_INTERVAL_MS: String(TEST_CONFIG.pollIntervalMs),
        JOB_GROUP_QUERY_DEFAULT_LIMIT: String(TEST_CONFIG.queryDefaultLimit),
        JOB_GROUP_QUERY_MAX_LIMIT: String(TEST_CONFIG.queryMaxLimit),
      },
    });
    if (!parsed.ok) throw new Error(parsed.problems);
    const childJobs = mockDeep<GroupChildJobs>();
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule.forRoot({ config: parsed.config })],
    })
      .overrideProvider(GROUP_CHILD_JOBS)
      .useValue(childJobs)
      .compile();
    const app = moduleRef.createNestApplication({
      logger: false,
      bodyParser: JOB_GROUP_SERVICE_BODY_PARSER,
    });
    for (const step of JOB_GROUP_SERVICE_SETUP_STEPS) step.apply({ app });
    await app.listen(0, '127.0.0.1');
    return new JobGroupServiceUnderTest({ postgres, app, baseUrl: await app.getUrl(), childJobs });
  }

  /** Before each test: no groups, and a job-service mock that remembers no calls and answers nothing. */
  async clear(): Promise<void> {
    mockReset(this.childJobs);
    await this.app.get(PrismaDatabase).jobGroup.deleteMany();
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

  create(): Promise<Response> {
    return fetch(this.url(JOB_GROUPS_ROUTE), { method: 'POST' });
  }

  async created(): Promise<JobGroup> {
    const response = await this.create();
    expect(response.status).toBe(201);
    return JobGroup.parse(await response.json());
  }

  get(id: string): Promise<Response> {
    return fetch(this.url(`${JOB_GROUPS_ROUTE}/${id}`));
  }

  async group(id: string): Promise<JobGroup> {
    const response = await this.get(id);
    expect(response.status).toBe(200);
    return JobGroup.parse(await response.json());
  }

  /** `query` is appended as it is, e.g. `limit=2&offset=1`. */
  list(query = ''): Promise<Response> {
    return fetch(this.url(`${JOB_GROUPS_ROUTE}${query === '' ? '' : `?${query}`}`));
  }

  async listed(query = ''): Promise<QueryJobGroupsResponse> {
    const response = await this.list(query);
    expect(response.status).toBe(200);
    return QueryJobGroupsResponse.parse(await response.json());
  }

  remove(id: string): Promise<Response> {
    return fetch(this.url(`${JOB_GROUPS_ROUTE}/${id}`), { method: 'DELETE' });
  }

  // --- The poll ---------------------------------------------------------------------------------

  /** One poll of the running groups, as the app's timer runs it, taken from the DI container. */
  poll(): Promise<CheckRunningJobGroupTrackerResponse> {
    return this.app.get<JobGroupTracker>(JOB_GROUP_TRACKER).checkRunning();
  }

  /** Lets the clock move on, so groups created one after another get different creation times. */
  nextMillisecond(): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, 5);
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

  // --- Data in states no route can create in one step ------------------------------------------

  /** Stores a group with the given stats through the app's own repository. */
  async seed(req: SeedRequest): Promise<JobGroup> {
    const repository = this.app.get<JobGroupRepository>(JOB_GROUP_REPOSITORY);
    const { group } = await repository.create();
    const now = new Date().toISOString();
    await repository.recordCheck({
      id: group.id,
      ...req,
      checkedAt: now,
      finishedAt: req.status === 'running' ? null : now,
    });
    return this.group(group.id);
  }
}
