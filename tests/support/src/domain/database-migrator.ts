/** Brings a test database to the latest schema before a test uses it. */
export interface DatabaseMigrator {
  migrate(req: MigrateDatabaseMigratorRequest): Promise<MigrateDatabaseMigratorResponse>;
}

export interface MigrateDatabaseMigratorRequest {
  databaseUrl: string;
}

export type MigrateDatabaseMigratorResponse = Record<string, never>;
