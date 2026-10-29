import { z } from 'zod';

export const HEALTH_ROUTE = { method: 'GET', path: '/health' } as const;

/** Body of `GET /health` of both backend services: HTTP 200 while the service is running. */
export const HealthResponse = z.object({ status: z.literal('ok') });
export type HealthResponse = z.infer<typeof HealthResponse>;
