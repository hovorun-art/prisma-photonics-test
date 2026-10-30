# One multi-stage file for the whole monorepo. Build a service with `--target <name>`:
# job-service, job-execution-service, job-group-service, migrate, job-group-service-migrate, job-ui.
# docker-compose.yml does this.
FROM node:26-alpine AS base
WORKDIR /app

# All dependencies, dev ones included: `postinstall` runs `prisma generate` (the Prisma CLI is a
# devDependency), and the build needs the TypeScript and Vite toolchains.
FROM base AS build
COPY . .
RUN --mount=type=cache,target=/root/.npm npm ci
RUN npm run build

# Production dependencies only, with the generated Prisma client kept (it lives in the app's dist).
FROM build AS prod-deps
RUN npm prune --omit=dev

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/packages/kernel/package.json ./packages/kernel/package.json
COPY --from=build /app/packages/kernel/dist ./packages/kernel/dist
COPY --from=build /app/packages/contracts/package.json ./packages/contracts/package.json
COPY --from=build /app/packages/contracts/dist ./packages/contracts/dist
COPY --from=build /app/packages/service-kit/package.json ./packages/service-kit/package.json
COPY --from=build /app/packages/service-kit/dist ./packages/service-kit/dist

FROM runtime AS job-service
COPY --from=build /app/apps/job-service/package.json ./apps/job-service/package.json
COPY --from=build /app/apps/job-service/dist ./apps/job-service/dist
WORKDIR /app/apps/job-service
USER node
CMD ["node", "dist/main.js"]

FROM runtime AS job-execution-service
COPY --from=build /app/apps/job-execution-service/package.json ./apps/job-execution-service/package.json
COPY --from=build /app/apps/job-execution-service/dist ./apps/job-execution-service/dist
WORKDIR /app/apps/job-execution-service
USER node
CMD ["node", "dist/main.js"]

FROM runtime AS job-group-service
COPY --from=build /app/apps/job-group-service/package.json ./apps/job-group-service/package.json
COPY --from=build /app/apps/job-group-service/dist ./apps/job-group-service/dist
WORKDIR /app/apps/job-group-service
USER node
CMD ["node", "dist/main.js"]

# One-shot: applies the Prisma migrations. Needs the Prisma CLI, so it is built on the full stage.
FROM build AS migrate
WORKDIR /app/apps/job-service
CMD ["npx", "prisma", "migrate", "deploy"]

# One-shot: applies job-group-service's migrations to its own schema (`?schema=job_groups`).
FROM build AS job-group-service-migrate
WORKDIR /app/apps/job-group-service
CMD ["npx", "prisma", "migrate", "deploy"]

FROM nginx:alpine AS job-ui
# nginx renders templates with the container's environment (JOB_SERVICE_PORT) at start.
COPY apps/job-ui/nginx.conf /etc/nginx/templates/default.conf.template
COPY --from=build /app/apps/job-ui/dist /usr/share/nginx/html
