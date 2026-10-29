import type {
  CountPostgresConnectionCounterRequest,
  CountPostgresConnectionCounterResponse,
  PostgresConnectionCounter,
} from '../domain/postgres-connection-counter.js';

/** The part of a Postgres Testcontainers container the counter uses. */
export interface PostgresContainerShell {
  exec(command: string[]): Promise<{ output: string; exitCode: number }>;
  getUsername(): string;
  getDatabase(): string;
}

export interface PgStatActivityConnectionCounterDeps {
  postgres: PostgresContainerShell;
}

/** Counts connections with `pg_stat_activity`, by running `psql` inside the Postgres container. */
export class PgStatActivityConnectionCounter implements PostgresConnectionCounter {
  constructor(private readonly d: PgStatActivityConnectionCounterDeps) {}

  async count(
    req: CountPostgresConnectionCounterRequest,
  ): Promise<CountPostgresConnectionCounterResponse> {
    const { output, exitCode } = await this.d.postgres.exec([
      'psql',
      '-U',
      this.d.postgres.getUsername(),
      '-d',
      this.d.postgres.getDatabase(),
      '-tAc',
      `SELECT count(*) FROM pg_stat_activity WHERE application_name = '${req.name}'`,
    ]);
    if (exitCode !== 0) {
      throw new Error(`psql failed with exit code ${exitCode}: ${output}`);
    }
    return { connections: Number(output.trim()) };
  }
}
