import { defineConfig } from 'prisma/config';

// The connection string comes from the environment (.env.example), never from the schema; its
// `?schema=job_groups` keeps this app's tables and migration history in its own Postgres schema.
// `JOB_GROUP_SERVICE_DATABASE_URL` wins, since under `npm run dev` `DATABASE_URL` is job-service's;
// `DATABASE_URL` is what the test helper that migrates a fresh database sets.
// `prisma generate` and `prisma validate` need no database, so an unset URL is allowed here.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: {
    url: process.env.JOB_GROUP_SERVICE_DATABASE_URL ?? process.env.DATABASE_URL ?? '',
  },
});
