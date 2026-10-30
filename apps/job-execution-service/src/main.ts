import { hostname } from 'node:os';

import { ProcessFatalErrorHandler, SystemRandom } from '@job-queue/kernel';

import { AppModule } from './app/app.module.js';
import { JobExecutionServiceBootstrap } from './infra/bootstrap/job-execution-service-bootstrap.js';
import { HostnameInstanceIdFactory } from './infra/instance/hostname-instance-id-factory.js';

async function main(): Promise<void> {
  const { instanceId } = new HostnameInstanceIdFactory({ random: new SystemRandom() }).create({
    hostname: hostname(),
  });
  await new JobExecutionServiceBootstrap(
    { process },
    { env: process.env, createModule: ({ config }) => AppModule.forRoot({ config, instanceId }) },
  ).start();
}

main().catch((error: unknown) => {
  new ProcessFatalErrorHandler({ process }).handle({ error });
});
