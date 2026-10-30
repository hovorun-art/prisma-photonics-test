import { ProcessFatalErrorHandler } from '@job-queue/kernel';

import { AppModule } from './app/app.module.js';
import { JobGroupServiceBootstrap } from './infra/bootstrap/job-group-service-bootstrap.js';

async function main(): Promise<void> {
  await new JobGroupServiceBootstrap(
    { process },
    { env: process.env, createModule: ({ config }) => AppModule.forRoot({ config }) },
  ).start();
}

main().catch((error: unknown) => {
  new ProcessFatalErrorHandler({ process }).handle({ error });
});
