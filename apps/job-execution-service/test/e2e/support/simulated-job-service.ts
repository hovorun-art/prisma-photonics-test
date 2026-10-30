import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import {
  INTERNAL_JOBS_ROUTE,
  type Job,
  SERVICE_TOKEN_SCHEME,
  UpdateJobRequest,
} from '@job-queue/contracts';
import type { Closable, CloseClosableResponse } from '@job-queue/kernel';

/** job-service's internal job API as job-execution-service sees it, simulated for e2e tests. */
export interface SimulatedJobService extends Closable {
  readonly url: string;
  /** Serves this job (any value: an invalid one tests contract checks) under its id. */
  serve(req: ServeSimulatedJobServiceRequest): ServeSimulatedJobServiceResponse;
  /** Answers the next `times` reports with this target status with `httpStatus` instead. */
  refuse(req: RefuseSimulatedJobServiceRequest): RefuseSimulatedJobServiceResponse;
  /** Every state report received for a job, in order (contract-valid bodies only). */
  reports(req: ReportsSimulatedJobServiceRequest): ReportsSimulatedJobServiceResponse;
}

export interface ServeSimulatedJobServiceRequest {
  id: string;
  job: Job | Record<string, unknown>;
}

export type ServeSimulatedJobServiceResponse = Record<string, never>;

export interface RefuseSimulatedJobServiceRequest {
  status: UpdateJobRequest['status'];
  httpStatus: number;
  times: number;
}

export type RefuseSimulatedJobServiceResponse = Record<string, never>;

export interface ReportsSimulatedJobServiceRequest {
  id: string;
}

export interface ReportsSimulatedJobServiceResponse {
  reports: UpdateJobRequest[];
}

export interface StartHttpSimulatedJobServiceRequest {
  serviceToken: string;
}

export interface StartHttpSimulatedJobServiceResponse {
  service: HttpSimulatedJobService;
}

export interface HttpSimulatedJobServiceParams {
  serviceToken: string;
}

interface HandleRequest {
  req: IncomingMessage;
  res: ServerResponse;
  raw: string;
}

interface SendRequest {
  res: ServerResponse;
  status: number;
  body: unknown;
}

interface Refusal {
  status: UpdateJobRequest['status'];
  httpStatus: number;
  left: number;
}

/**
 * A local HTTP server in place of job-service: it checks the service token, validates every report
 * against the shared `UpdateJobRequest` schema, records it and applies job-service's transition
 * rules (start only from pending, complete or fail only from processing; otherwise 409). Unknown ids
 * answer 404. Failures are not retried here: a failed job simply becomes `failed`.
 */
export class HttpSimulatedJobService implements SimulatedJobService {
  private readonly jobs = new Map<string, Record<string, unknown>>();
  private readonly received = new Map<string, UpdateJobRequest[]>();
  private readonly refusals: Refusal[] = [];
  private server: Server | undefined;
  private port = 0;

  constructor(private readonly p: HttpSimulatedJobServiceParams) {}

  static async start(
    req: StartHttpSimulatedJobServiceRequest,
  ): Promise<StartHttpSimulatedJobServiceResponse> {
    const service = new HttpSimulatedJobService(req);
    await service.listen();
    return { service };
  }

  get url(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  serve(req: ServeSimulatedJobServiceRequest): ServeSimulatedJobServiceResponse {
    this.jobs.set(req.id, { ...req.job });
    return {};
  }

  refuse(req: RefuseSimulatedJobServiceRequest): RefuseSimulatedJobServiceResponse {
    this.refusals.push({ status: req.status, httpStatus: req.httpStatus, left: req.times });
    return {};
  }

  reports(req: ReportsSimulatedJobServiceRequest): ReportsSimulatedJobServiceResponse {
    return { reports: [...(this.received.get(req.id) ?? [])] };
  }

  async close(): Promise<CloseClosableResponse> {
    await new Promise((resolve) => this.server?.close(resolve));
    return {};
  }

  private async listen(): Promise<void> {
    this.server = createServer((req, res) => {
      let raw = '';
      req.on('data', (chunk: Buffer) => (raw += chunk.toString()));
      req.on('end', () => {
        this.handle({ req, res, raw });
      });
    });
    await new Promise<void>((resolve) => this.server?.listen(0, '127.0.0.1', resolve));
    this.port = (this.server.address() as AddressInfo).port;
  }

  private handle({ req, res, raw }: HandleRequest): void {
    if (req.headers.authorization !== `${SERVICE_TOKEN_SCHEME} ${this.p.serviceToken}`) {
      this.send({
        res,
        status: 401,
        body: { code: 'INTERNAL_UNAUTHORIZED', message: 'x', details: {} },
      });
      return;
    }
    const id = (req.url ?? '').slice(`${INTERNAL_JOBS_ROUTE}/`.length);
    const job = this.jobs.get(id);
    if (job === undefined) {
      this.send({
        res,
        status: 404,
        body: { code: 'JOB_NOT_FOUND', message: 'Job not found', details: {} },
      });
      return;
    }
    if (req.method === 'GET') {
      this.send({ res, status: 200, body: job });
      return;
    }

    const update = UpdateJobRequest.parse(JSON.parse(raw));
    this.received.set(id, [...(this.received.get(id) ?? []), update]);
    const refusal = this.refusals.find((r) => r.status === update.status && r.left > 0);
    if (refusal !== undefined) {
      refusal.left -= 1;
      this.send({
        res,
        status: refusal.httpStatus,
        body: { code: 'INTERNAL_ERROR', message: 'x', details: {} },
      });
      return;
    }
    // The job-state-reporting rules: start only a pending job, finish only a processing one.
    const allowedFrom = update.status === 'processing' ? 'pending' : 'processing';
    if (job.status !== allowedFrom) {
      this.send({
        res,
        status: 409,
        body: { code: 'JOB_STATUS_CONFLICT', message: 'x', details: { status: job.status } },
      });
      return;
    }
    const updated = { ...job, status: update.status };
    this.jobs.set(id, updated);
    this.send({ res, status: 200, body: updated });
  }

  private send({ res, status, body }: SendRequest): void {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  }
}
