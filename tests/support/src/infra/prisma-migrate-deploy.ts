import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import type {
  DatabaseMigrator,
  MigrateDatabaseMigratorRequest,
  MigrateDatabaseMigratorResponse,
} from '../domain/database-migrator.js';

export interface PrismaMigrateDeployParams {
  /** The app directory that holds `prisma.config.ts` and its migrations. */
  appDir: string;
}

/** Applies an app's migrations with `prisma migrate deploy`, as the compose `migrate` service does. */
export class PrismaMigrateDeploy implements DatabaseMigrator {
  constructor(private readonly p: PrismaMigrateDeployParams) {}

  async migrate(req: MigrateDatabaseMigratorRequest): Promise<MigrateDatabaseMigratorResponse> {
    const run = promisify(execFile);
    const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
    await run(npx, ['prisma', 'migrate', 'deploy'], {
      cwd: this.p.appDir,
      env: { ...process.env, DATABASE_URL: req.databaseUrl },
    });
    return {};
  }
}
