import { defineConfig } from 'prisma/config';

// The connection string comes from the environment (.env.example), never from the schema.
// `prisma generate` and `prisma validate` need no database, so an unset URL is allowed here.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: process.env.DATABASE_URL ?? '' },
});
