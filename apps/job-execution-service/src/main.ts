import { hostname } from 'node:os';

import { ProcessFatalErrorHandler, SystemRandom } from '@job-queue/kernel';
import { NestServiceBootstrap } from '@job-queue/service-kit';

import { AppModule } from './app/app.module.js';
import { ZodExecutionConfigParser } from './infra/config/zod-execution-config-parser.js';
import { HostnameInstanceIdFactory } from './infra/instance/hostname-instance-id-factory.js';

async function main(): Promise<void> {
  const { instanceId } = new HostnameInstanceIdFactory({ random: new SystemRandom() }).create({
    hostname: hostname(),
  });
  await new NestServiceBootstrap(
    { parser: new ZodExecutionConfigParser(), process },
    {
      serviceName: 'job-execution-service',
      env: process.env,
      createModule: ({ config }) => AppModule.forRoot({ config, instanceId }),
      setupSteps: [],
      shutdownSteps: [],
    },
  ).start();
}

main().catch((error: unknown) => {
  new ProcessFatalErrorHandler({ process }).handle({ error });
});
