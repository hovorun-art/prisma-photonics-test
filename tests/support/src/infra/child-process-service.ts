import type { ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';

import type {
  KillSpawnedServiceResponse,
  LogLine,
  SpawnedService,
  StopSpawnedServiceRequest,
  StopSpawnedServiceResponse,
  UrlSpawnedServiceRequest,
  UrlSpawnedServiceResponse,
} from '../domain/spawned-service.js';

export interface ChildProcessServiceDeps {
  child: ChildProcess;
}

export interface ChildProcessServiceParams {
  baseUrl: string;
}

/** A service running as a Node child process: its parsed log lines, stderr and exit. */
export class ChildProcessService implements SpawnedService {
  private readonly lines: LogLine[] = [];
  private readonly errorChunks: string[] = [];
  private readonly exited: Promise<StopSpawnedServiceResponse>;

  constructor(
    private readonly d: ChildProcessServiceDeps,
    private readonly p: ChildProcessServiceParams,
  ) {
    this.exited = new Promise((resolve) => {
      d.child.once('exit', (exitCode, signal) => {
        resolve({ exitCode, signal });
      });
    });
    if (d.child.stdout) {
      createInterface({ input: d.child.stdout }).on('line', (line) => {
        this.lines.push(this.parse(line));
      });
    }
    d.child.stderr?.on('data', (chunk: Buffer) => {
      this.errorChunks.push(chunk.toString());
    });
  }

  get logs(): readonly LogLine[] {
    return this.lines;
  }

  get stderr(): string {
    return this.errorChunks.join('');
  }

  get running(): boolean {
    return this.d.child.exitCode === null && this.d.child.signalCode === null;
  }

  url(req: UrlSpawnedServiceRequest): UrlSpawnedServiceResponse {
    return { url: new URL(req.path, this.p.baseUrl).toString() };
  }

  async stop(req: StopSpawnedServiceRequest): Promise<StopSpawnedServiceResponse> {
    if (this.running) {
      this.d.child.kill(req.signal);
    }
    return this.exited;
  }

  kill(): KillSpawnedServiceResponse {
    if (this.running) {
      this.d.child.kill('SIGKILL');
    }
    return {};
  }

  private parse(line: string): LogLine {
    try {
      return JSON.parse(line) as LogLine;
    } catch {
      return { msg: line };
    }
  }
}
