import { execFile } from 'node:child_process';
import { homedir } from 'node:os';
import { dirname } from 'node:path';
import { promisify } from 'node:util';

import type {
  HomeDirRepositoryInfoResponse,
  MainRootRepositoryInfoResponse,
  RepositoryInfo,
  UserEmailRepositoryInfoResponse,
} from '../../domain/repository/repository-info.js';

const run = promisify(execFile);

/** Reads the repository facts from git, run in the current working directory. */
export class GitRepositoryInfo implements RepositoryInfo {
  /** The common git dir is the main checkout's `.git`, also when run from a worktree. */
  async mainRoot(): Promise<MainRootRepositoryInfoResponse> {
    const { stdout } = await run('git', [
      'rev-parse',
      '--path-format=absolute',
      '--git-common-dir',
    ]);
    return { path: dirname(stdout.trim()) };
  }

  async userEmail(): Promise<UserEmailRepositoryInfoResponse> {
    try {
      const { stdout } = await run('git', ['config', 'user.email']);
      return { email: stdout.trim() || undefined };
    } catch {
      return { email: undefined };
    }
  }

  homeDir(): HomeDirRepositoryInfoResponse {
    return { path: homedir() };
  }
}
