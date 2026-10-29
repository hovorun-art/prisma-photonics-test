import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';

import type {
  ServiceLauncher,
  SpawnedService,
  StartServiceLauncherRequest,
  StartServiceLauncherResponse,
} from '../domain/spawned-service.js';
import { ChildProcessService } from './child-process-service.js';

const DEFAULT_STARTUP_TIMEOUT_MS = 30_000;
const DEFAULT_POLL_INTERVAL_MS = 100;

export interface NodeServiceLauncherParams {
  /** The workspace directory: the process runs `node dist/main.js` from here. */
  appRoot: string;
  /** The environment variable the service reads its HTTP port from. */
  portVariable: string;
  /** Name for error messages, e.g. `job-service`. */
  serviceName: string;
  /** The route that answers once the service is up; `/health` when omitted. */
  healthPath?: string;
  /** How long the service may take to answer; 30 seconds when omitted. */
  startupTimeoutMs?: number;
  /** Pause between attempts to reach the service; 100 ms when omitted. */
  pollIntervalMs?: number;
}

/** Starts the compiled service (`node dist/main.js`, as the container does) on a free port. */
export class NodeServiceLauncher implements ServiceLauncher {
  constructor(private readonly p: NodeServiceLauncherParams) {}

  async start(req: StartServiceLauncherRequest): Promise<StartServiceLauncherResponse> {
    const port = await this.freePort();
    const child = spawn(process.execPath, ['dist/main.js'], {
      cwd: this.p.appRoot,
      env: { PATH: process.env.PATH ?? '', ...req.env, [this.p.portVariable]: String(port) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const service = new ChildProcessService({ child }, { baseUrl: `http://127.0.0.1:${port}` });
    try {
      await this.waitUntilAnswering(service);
    } catch (error) {
      service.kill();
      throw new Error(`${this.p.serviceName} did not answer: ${service.stderr}`, {
        cause: error,
      });
    }
    return { service };
  }

  private async freePort(): Promise<number> {
    const server = createServer();
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    server.close();
    if (address === null || typeof address === 'string') {
      throw new TypeError('Expected a TCP address');
    }
    return address.port;
  }

  /** Polls until the health route answers; gives up when the process has died or time is up. */
  private async waitUntilAnswering(service: SpawnedService): Promise<void> {
    const deadline = Date.now() + (this.p.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS);
    for (;;) {
      try {
        await fetch(service.url({ path: this.p.healthPath ?? '/health' }).url);
        return;
      } catch (error) {
        if (!service.running || Date.now() > deadline) {
          throw error;
        }
        await new Promise((resolve) =>
          setTimeout(resolve, this.p.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS),
        );
      }
    }
  }
}
