import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import type { BuildServiceBuildResponse, ServiceBuild } from '../domain/spawned-service.js';

export interface NpmServiceBuildParams {
  /** The repository root, where the root `build:packages` script lives. */
  repoRoot: string;
  /** The npm workspace to build, e.g. `@job-queue/job-service`. */
  workspace: string;
}

/** Builds the shared packages and one workspace with npm, as `npm run build` does. */
export class NpmServiceBuild implements ServiceBuild {
  constructor(private readonly p: NpmServiceBuildParams) {}

  async build(): Promise<BuildServiceBuildResponse> {
    const run = promisify(execFile);
    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    await run(npm, ['run', 'build:packages'], { cwd: this.p.repoRoot });
    await run(npm, ['run', 'build', '-w', this.p.workspace], { cwd: this.p.repoRoot });
    return {};
  }
}
