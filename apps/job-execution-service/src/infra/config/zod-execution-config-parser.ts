import { ZodBaseEnvSchema, ZodConfigParser } from '@job-queue/service-kit';
import { z } from 'zod';

import type { ExecutionConfig } from '../../domain/config/execution-config.js';

/** Defaults of the execution settings; `.env.example` lists them commented out. */
const DEFAULTS = {
  concurrency: 5,
  emailSendMinMs: 1_000,
  emailSendMaxMs: 3_000,
  webhookCallMs: 1_500,
  webhookFailureRate: 0.2,
  flightTransitGenerateMs: 2_000,
  flightTransitFailureRate: 0.1,
  flightTransitPathPoints: 64,
  flightTransitCruiseWaypoints: 4,
  flightTransitLongHaulKm: 4_000,
  flightTransitClimbKm: 200,
  flightTransitDescentKm: 250,
  flightTransitTaxiSpeedKmh: 30,
  reportRetries: 3,
  reportRetryDelayMs: 500,
  reportRetryMaxDelayMs: 5_000,
  jobServiceTimeoutMs: 5_000,
  shutdownGraceMs: 10_000,
  lockDurationMs: 30_000,
  stalledIntervalMs: 30_000,
} as const;

const baseEnv = new ZodBaseEnvSchema({
  defaultNodeEnv: 'production',
  portVariable: 'JOB_EXECUTION_SERVICE_PORT',
});

/** The environment of job-execution-service (names as in `.env.example`). */
const ExecutionEnv = baseEnv
  .create()
  .schema.extend({
    JOB_SERVICE_URL: z.url({ protocol: /^https?$/ }),
    JOB_EXECUTION_CONCURRENCY: z.coerce.number().int().positive().default(DEFAULTS.concurrency),
    EMAIL_SEND_MIN_MS: z.coerce.number().int().min(0).default(DEFAULTS.emailSendMinMs),
    EMAIL_SEND_MAX_MS: z.coerce.number().int().positive().default(DEFAULTS.emailSendMaxMs),
    WEBHOOK_CALL_MS: z.coerce.number().int().min(0).default(DEFAULTS.webhookCallMs),
    WEBHOOK_FAILURE_RATE: z.coerce.number().min(0).max(1).default(DEFAULTS.webhookFailureRate),
    FLIGHT_TRANSIT_GENERATE_MS: z.coerce
      .number()
      .int()
      .min(0)
      .default(DEFAULTS.flightTransitGenerateMs),
    FLIGHT_TRANSIT_FAILURE_RATE: z.coerce
      .number()
      .min(0)
      .max(1)
      .default(DEFAULTS.flightTransitFailureRate),
    FLIGHT_TRANSIT_PATH_POINTS: z.coerce
      .number()
      .int()
      .min(2)
      .default(DEFAULTS.flightTransitPathPoints),
    FLIGHT_TRANSIT_CRUISE_WAYPOINTS: z.coerce
      .number()
      .int()
      .min(0)
      .default(DEFAULTS.flightTransitCruiseWaypoints),
    FLIGHT_TRANSIT_LONG_HAUL_KM: z.coerce
      .number()
      .positive()
      .default(DEFAULTS.flightTransitLongHaulKm),
    FLIGHT_TRANSIT_CLIMB_KM: z.coerce.number().positive().default(DEFAULTS.flightTransitClimbKm),
    FLIGHT_TRANSIT_DESCENT_KM: z.coerce
      .number()
      .positive()
      .default(DEFAULTS.flightTransitDescentKm),
    FLIGHT_TRANSIT_TAXI_SPEED_KMH: z.coerce
      .number()
      .positive()
      .default(DEFAULTS.flightTransitTaxiSpeedKmh),
    JOB_REPORT_RETRIES: z.coerce.number().int().min(0).default(DEFAULTS.reportRetries),
    JOB_REPORT_RETRY_DELAY_MS: z.coerce.number().int().min(0).default(DEFAULTS.reportRetryDelayMs),
    JOB_REPORT_RETRY_MAX_DELAY_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(DEFAULTS.reportRetryMaxDelayMs),
    JOB_SERVICE_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(DEFAULTS.jobServiceTimeoutMs),
    JOB_EXECUTION_SHUTDOWN_GRACE_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(DEFAULTS.shutdownGraceMs),
    JOB_QUEUE_LOCK_DURATION_MS: z.coerce.number().int().positive().default(DEFAULTS.lockDurationMs),
    JOB_QUEUE_STALLED_INTERVAL_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(DEFAULTS.stalledIntervalMs),
  })
  .refine((env) => env.EMAIL_SEND_MIN_MS <= env.EMAIL_SEND_MAX_MS, {
    path: ['EMAIL_SEND_MIN_MS'],
    message: 'must not be above EMAIL_SEND_MAX_MS',
  })
  .refine((env) => env.JOB_REPORT_RETRY_DELAY_MS <= env.JOB_REPORT_RETRY_MAX_DELAY_MS, {
    path: ['JOB_REPORT_RETRY_DELAY_MS'],
    message: 'must not be above JOB_REPORT_RETRY_MAX_DELAY_MS',
  })
  .transform((env): ExecutionConfig => ({
    ...baseEnv.toConfig({ env }).config,
    jobServiceUrl: env.JOB_SERVICE_URL,
    concurrency: env.JOB_EXECUTION_CONCURRENCY,
    emailSendMinMs: env.EMAIL_SEND_MIN_MS,
    emailSendMaxMs: env.EMAIL_SEND_MAX_MS,
    webhookCallMs: env.WEBHOOK_CALL_MS,
    webhookFailureRate: env.WEBHOOK_FAILURE_RATE,
    flightTransitGenerateMs: env.FLIGHT_TRANSIT_GENERATE_MS,
    flightTransitFailureRate: env.FLIGHT_TRANSIT_FAILURE_RATE,
    flightTransitPathPoints: env.FLIGHT_TRANSIT_PATH_POINTS,
    flightTransitCruiseWaypoints: env.FLIGHT_TRANSIT_CRUISE_WAYPOINTS,
    flightTransitLongHaulKm: env.FLIGHT_TRANSIT_LONG_HAUL_KM,
    flightTransitClimbKm: env.FLIGHT_TRANSIT_CLIMB_KM,
    flightTransitDescentKm: env.FLIGHT_TRANSIT_DESCENT_KM,
    flightTransitTaxiSpeedKmh: env.FLIGHT_TRANSIT_TAXI_SPEED_KMH,
    reportRetries: env.JOB_REPORT_RETRIES,
    reportRetryDelayMs: env.JOB_REPORT_RETRY_DELAY_MS,
    reportRetryMaxDelayMs: env.JOB_REPORT_RETRY_MAX_DELAY_MS,
    jobServiceTimeoutMs: env.JOB_SERVICE_TIMEOUT_MS,
    shutdownGraceMs: env.JOB_EXECUTION_SHUTDOWN_GRACE_MS,
    lockDurationMs: env.JOB_QUEUE_LOCK_DURATION_MS,
    stalledIntervalMs: env.JOB_QUEUE_STALLED_INTERVAL_MS,
  }));

/** Validates the environment with the shared base schema extended by the service's own fields. */
export class ZodExecutionConfigParser extends ZodConfigParser<ExecutionConfig> {
  constructor() {
    super({ schema: ExecutionEnv });
  }
}
