import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import type {
  ContainersStackRequest,
  ContainersStackResponse,
  DownStackResponse,
  LogsStackRequest,
  LogsStackResponse,
  Stack,
  StackContainer,
  StartStackRequest,
  StartStackResponse,
  StopStackRequest,
  StopStackResponse,
  UpStackRequest,
  UpStackResponse,
} from './stack.js';

const run = promisify(execFile);

export interface ComposeStackParams {
  /** `docker compose -p <project>`. */
  project: string;
  /** Where docker-compose.yml is. */
  cwd: string;
  /** Added to the environment of every compose call. */
  env: Readonly<Record<string, string>>;
}

interface ComposePsEntry {
  Name: string;
  State: string;
  Health?: string;
}

/** The stack run by the `docker compose` CLI. */
export class ComposeStack implements Stack {
  constructor(private readonly p: ComposeStackParams) {}

  async up(req: UpStackRequest): Promise<UpStackResponse> {
    const scale = Object.entries(req.scale).flatMap(([service, count]) => [
      '--scale',
      `${service}=${count}`,
    ]);
    await this.compose(['up', '-d', '--build', '--wait', ...scale]);
    return {};
  }

  async down(): Promise<DownStackResponse> {
    await this.compose(['down', '-v', '--remove-orphans']);
    return {};
  }

  async containers(req: ContainersStackRequest): Promise<ContainersStackResponse> {
    const stdout = await this.compose(['ps', '--all', '--format', 'json', req.service]);
    const containers = stdout
      .split('\n')
      .filter((line) => line.trim() !== '')
      .map((line): StackContainer => {
        const entry = JSON.parse(line) as ComposePsEntry;
        return { name: entry.Name, state: entry.State, health: entry.Health ?? '' };
      });
    return { containers };
  }

  async logs(req: LogsStackRequest): Promise<LogsStackResponse> {
    const stdout = await this.compose(['logs', '--no-log-prefix', req.service]);
    return { lines: stdout.split('\n').filter((line) => line.trim() !== '') };
  }

  async stop(req: StopStackRequest): Promise<StopStackResponse> {
    await this.compose(['stop', req.service]);
    return {};
  }

  async start(req: StartStackRequest): Promise<StartStackResponse> {
    await this.compose(['start', '--wait', req.service]);
    return {};
  }

  private async compose(args: string[]): Promise<string> {
    const { stdout } = await run('docker', ['compose', '-p', this.p.project, ...args], {
      cwd: this.p.cwd,
      env: { ...process.env, ...this.p.env },
      maxBuffer: 64 * 1024 * 1024,
    });
    return stdout;
  }
}
