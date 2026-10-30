/**
 * Images of the containers that integration and e2e tests start. They match the images in
 * `docker-compose.yml`, so the tests run against the same Postgres and Redis versions.
 */
export const CONTAINER_IMAGES = {
  postgres: 'postgres:18-alpine',
  redis: 'redis:8-alpine',
  clickhouse: 'clickhouse/clickhouse-server:26.8-alpine',
} as const;
