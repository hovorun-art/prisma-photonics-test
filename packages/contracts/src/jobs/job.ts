import { z } from 'zod';

import { INTERNAL_API_PREFIX } from '../internal.js';
import { AIRPORT_CODES, IataCode, Latitude, Longitude } from './airports.js';

/** Public job routes of job-service. */
export const JOBS_ROUTE = '/v1/jobs';

/** Bulk submit: many jobs in one request, stored all or nothing. */
export const JOBS_BULK_ROUTE = `${JOBS_ROUTE}/bulk`;

/** Internal job routes of job-service, used only by job-execution-service. */
export const INTERNAL_JOBS_ROUTE = `${INTERNAL_API_PREFIX}/jobs`;

/** Lifecycle of a job: `scheduled` and `pending` wait, `processing` runs, the last three are final. */
export const JobStatus = z.enum([
  'scheduled',
  'pending',
  'processing',
  'completed',
  'failed',
  'cancelled',
]);
export type JobStatus = z.infer<typeof JobStatus>;

/** Statuses a job never leaves; only jobs in one of them can be deleted. */
export const FINISHED_JOB_STATUSES = [
  'completed',
  'failed',
  'cancelled',
] as const satisfies readonly JobStatus[];

/** Statuses a worker may start a job from; a `scheduled` job's entry only arrives when it is due. */
export const STARTABLE_JOB_STATUSES = [
  'scheduled',
  'pending',
] as const satisfies readonly JobStatus[];

/** Statuses a client may cancel a job from: it waits or it runs. */
export const CANCELLABLE_JOB_STATUSES = [
  'scheduled',
  'pending',
  'processing',
] as const satisfies readonly JobStatus[];

/**
 * Ranges and defaults of a job's priority (higher = more urgent) and max attempts, and how far ahead
 * a job may be scheduled.
 */
export const JOB_LIMITS = {
  priority: { min: 1, max: 10, default: 5 },
  maxAttempts: { min: 1, max: 10, default: 3 },
  scheduledAt: { maxAheadDays: 30 },
} as const;

/** Length limits of an email job, shared by job-service validation and the job-ui form. */
export const EMAIL_LIMITS = {
  subjectMaxLength: 200,
  bodyMaxLength: 10_000,
} as const;

/** HTTP methods a webhook job may call with, and its URL length limit, shared with the job-ui form. */
export const WEBHOOK_METHODS = ['POST', 'PUT', 'GET'] as const;

export const WEBHOOK_LIMITS = {
  urlMaxLength: 2048,
} as const;

export const JobPriority = z
  .number()
  .int()
  .min(JOB_LIMITS.priority.min)
  .max(JOB_LIMITS.priority.max);

export const JobMaxAttempts = z
  .number()
  .int()
  .min(JOB_LIMITS.maxAttempts.min)
  .max(JOB_LIMITS.maxAttempts.max);

/** Why a job attempt failed, as reported by job-execution-service. */
export const JobError = z.object({
  code: z.string().min(1),
  message: z.string(),
  details: z.record(z.string(), z.unknown()).optional(),
});
export type JobError = z.infer<typeof JobError>;

/** What an email job sends. */
export const EmailJobPayload = z.object({
  to: z.email(),
  subject: z.string().min(1).max(EMAIL_LIMITS.subjectMaxLength),
  body: z.string().max(EMAIL_LIMITS.bodyMaxLength),
});
export type EmailJobPayload = z.infer<typeof EmailJobPayload>;

/** What a completed email job returns: the (mock) id of the sent message. */
export const EmailJobResult = z.object({ messageId: z.string().min(1) });
export type EmailJobResult = z.infer<typeof EmailJobResult>;

/** A JSON object with any JSON values: a webhook's request and response body. */
export const JsonObject = z.record(z.string(), z.json());
export type JsonObject = z.infer<typeof JsonObject>;

/** The call a webhook job makes: method, absolute http(s) URL and an optional JSON object body. */
export const WebhookJobPayload = z.object({
  method: z.enum(WEBHOOK_METHODS),
  url: z.url({ protocol: /^https?$/ }).max(WEBHOOK_LIMITS.urlMaxLength),
  body: JsonObject.optional(),
});
export type WebhookJobPayload = z.infer<typeof WebhookJobPayload>;

/** What a completed webhook job returns: the (simulated) 2xx status and response body. */
export const WebhookJobResult = z.object({
  statusCode: z.number().int().min(200).max(299),
  responseBody: JsonObject,
});
export type WebhookJobResult = z.infer<typeof WebhookJobResult>;

/** An IATA code of an airport in the bundled list (upper case only). */
export const AirportCode = z.enum(AIRPORT_CODES);
export type AirportCode = z.infer<typeof AirportCode>;

/**
 * The flight a transit job describes: two different bundled airports and a calendar day. Whether
 * that day is already over is checked by job-service against its clock, not here.
 */
export const FlightTransitJobPayload = z
  .object({
    origin: AirportCode,
    destination: AirportCode,
    departureDate: z.iso.date(),
  })
  .refine((payload) => payload.origin !== payload.destination, {
    path: ['destination'],
    message: 'Destination must differ from origin',
  });
export type FlightTransitJobPayload = z.infer<typeof FlightTransitJobPayload>;

const NonNegative = z.number().min(0);

/** An airport card of a transit report; not checked against the bundled list. */
export const TransitAirport = z.object({
  iata: IataCode,
  name: z.string().min(1),
  city: z.string().min(1),
  timeZone: z.string().min(1),
  lat: Latitude,
  lon: Longitude,
});
export type TransitAirport = z.infer<typeof TransitAirport>;

/** A point of the route the aircraft passes, with what the map shows on hover. */
export const TransitWaypoint = z.object({
  name: z.string().min(1),
  at: z.iso.datetime(),
  lat: Latitude,
  lon: Longitude,
  altitudeFt: NonNegative,
  groundSpeedKmh: NonNegative,
  distanceFlownKm: NonNegative,
});
export type TransitWaypoint = z.infer<typeof TransitWaypoint>;

/**
 * What a completed transit job returns: the generated flight, its airports and times, and the
 * great-circle path (`[lat, lon]` pairs) with its waypoints (at least departure and arrival).
 */
export const FlightTransitJobResult = z.object({
  flight: z.string().min(1),
  aircraft: z.object({ model: z.string().min(1), registration: z.string().min(1) }),
  origin: TransitAirport,
  destination: TransitAirport,
  departureAt: z.iso.datetime(),
  arrivalAt: z.iso.datetime(),
  distanceKm: NonNegative,
  durationMin: NonNegative,
  cruiseAltitudeFt: NonNegative,
  path: z.array(z.tuple([Latitude, Longitude])).min(2),
  waypoints: z.array(TransitWaypoint).min(2),
});
export type FlightTransitJobResult = z.infer<typeof FlightTransitJobResult>;

/** The closed list of job types; each later job type adds itself here. */
export const JobType = z.enum(['email', 'webhook', 'flight-transit']);
export type JobType = z.infer<typeof JobType>;

/** The result schema of each job type, checked when job-execution-service reports a completion. */
export const JOB_RESULT_SCHEMAS: Readonly<Record<JobType, z.ZodType>> = {
  email: EmailJobResult,
  webhook: WebhookJobResult,
  'flight-transit': FlightTransitJobResult,
};

const Timestamp = z.iso.datetime();

/** Fields every job has, whatever its type. */
const JobBase = z.object({
  id: z.uuid(),
  status: JobStatus,
  priority: JobPriority,
  attempts: z.number().int().min(0),
  maxAttempts: JobMaxAttempts,
  error: JobError.nullable(),
  /** The group the job was submitted in; job-service gives it no other meaning. */
  groupId: z.uuid().nullable(),
  scheduledAt: Timestamp.nullable(),
  startedAt: Timestamp.nullable(),
  completedAt: Timestamp.nullable(),
  createdAt: Timestamp,
  updatedAt: Timestamp,
});

export const EmailJob = JobBase.extend({
  type: z.literal('email'),
  payload: EmailJobPayload,
  result: EmailJobResult.nullable(),
});
export type EmailJob = z.infer<typeof EmailJob>;

export const WebhookJob = JobBase.extend({
  type: z.literal('webhook'),
  payload: WebhookJobPayload,
  result: WebhookJobResult.nullable(),
});
export type WebhookJob = z.infer<typeof WebhookJob>;

export const FlightTransitJob = JobBase.extend({
  type: z.literal('flight-transit'),
  payload: FlightTransitJobPayload,
  result: FlightTransitJobResult.nullable(),
});
export type FlightTransitJob = z.infer<typeof FlightTransitJob>;

/** A job as every job route returns it; the type decides the payload and result shapes. */
export const Job = z.discriminatedUnion('type', [EmailJob, WebhookJob, FlightTransitJob]);
export type Job = z.infer<typeof Job>;

/** Options every job type accepts on submit; omitted ones get the defaults of `JOB_LIMITS`. */
const CreateJobOptions = z.object({
  priority: JobPriority.default(JOB_LIMITS.priority.default),
  maxAttempts: JobMaxAttempts.default(JOB_LIMITS.maxAttempts.default),
  /** Ties the job to a group (e.g. one campaign); stored and returned as given. */
  groupId: z.uuid().optional(),
  /**
   * When the job may run, with a time zone (`Z` or an offset). A future time makes the job
   * `scheduled`; how far ahead is checked by job-service against its clock.
   */
  scheduledAt: z.iso.datetime({ offset: true }).optional(),
});

export const CreateEmailJobRequest = CreateJobOptions.extend({
  type: z.literal('email'),
  payload: EmailJobPayload,
});

export const CreateWebhookJobRequest = CreateJobOptions.extend({
  type: z.literal('webhook'),
  payload: WebhookJobPayload,
});

export const CreateFlightTransitJobRequest = CreateJobOptions.extend({
  type: z.literal('flight-transit'),
  payload: FlightTransitJobPayload,
});

/** Body of `POST /v1/jobs`: one branch per job type. */
export const CreateJobRequest = z.discriminatedUnion('type', [
  CreateEmailJobRequest,
  CreateWebhookJobRequest,
  CreateFlightTransitJobRequest,
]);
export type CreateJobRequest = z.infer<typeof CreateJobRequest>;

/**
 * Body of `POST /v1/jobs/bulk`: ordinary job submissions of any types. The configured maximum
 * number of jobs is checked by job-service, since it is runtime config; issue paths carry each
 * item's position (`jobs.3.payload.to`).
 */
export const CreateJobsBulkRequest = z.object({ jobs: z.array(CreateJobRequest).min(1) });
export type CreateJobsBulkRequest = z.infer<typeof CreateJobsBulkRequest>;

/** Answer of `POST /v1/jobs/bulk`: the created jobs in the order of the request. */
export const CreateJobsBulkResponse = z.object({ items: z.array(Job) });
export type CreateJobsBulkResponse = z.infer<typeof CreateJobsBulkResponse>;

/** Path parameters of the routes that address one job. */
export const JobIdParams = z.object({ id: z.uuid() });
export type JobIdParams = z.infer<typeof JobIdParams>;

/**
 * A query parameter that may be repeated (`?status=a&status=b`): the query parser gives a string
 * for one occurrence and an array for several, so both become one list without duplicates. As a
 * leading transform it leaves the docs to the list schema piped after it.
 */
export const RepeatedQueryParam = z.transform((value: unknown) => [...new Set([value].flat())]);

/**
 * The `groupId` filter of a query string: a group's id for that group's jobs, or `null` for the
 * jobs submitted without a group.
 */
export const GroupIdFilter = z.union([z.uuid(), z.literal('null').transform(() => null)]);
export type GroupIdFilter = z.infer<typeof GroupIdFilter>;

/**
 * Query string of `GET /v1/jobs`. Without `limit` job-service uses its configured default page
 * size; the configured maximum is checked by job-service, since it is runtime config. `status` and
 * `type` filters and `groupId` combine with AND, the values of one filter with OR; without a filter
 * it is not applied.
 */
export const QueryJobsRequest = z.object({
  limit: z.coerce.number().int().positive().optional(),
  offset: z.coerce.number().int().min(0).default(0),
  status: RepeatedQueryParam.pipe(z.array(JobStatus).min(1)).optional(),
  type: RepeatedQueryParam.pipe(z.array(JobType).min(1)).optional(),
  /** One group at a time, or `null` for the jobs without a group. */
  groupId: GroupIdFilter.optional(),
});
export type QueryJobsRequest = z.infer<typeof QueryJobsRequest>;

/** One page of jobs, newest first, and the number of all jobs. */
export const QueryJobsResponse = z.object({
  items: z.array(Job),
  total: z.number().int().min(0),
});
export type QueryJobsResponse = z.infer<typeof QueryJobsResponse>;

/**
 * Body of `PATCH /internal/v1/jobs/:id`: the status job-execution-service moves a job to, with what
 * that status needs. `result` is checked against the job type's result schema by job-service.
 */
export const UpdateJobRequest = z.discriminatedUnion('status', [
  z.object({ status: z.literal('processing') }),
  z.object({ status: z.literal('completed'), result: z.unknown() }),
  z.object({ status: z.literal('failed'), error: JobError }),
]);
export type UpdateJobRequest = z.infer<typeof UpdateJobRequest>;

/**
 * Body of `PATCH /v1/jobs/:id`: the status a client moves a job to by hand. `cancelled` cancels a
 * job that has not finished; `pending` retries a failed job from its first attempt.
 */
export const ChangeJobStatusRequest = z.discriminatedUnion('status', [
  z.object({ status: z.literal('cancelled') }),
  z.object({ status: z.literal('pending') }),
]);
export type ChangeJobStatusRequest = z.infer<typeof ChangeJobStatusRequest>;
