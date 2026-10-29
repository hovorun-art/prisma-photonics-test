import { Module } from '@nestjs/common';

import { HealthController } from './health.controller.js';

/** `GET /health`: answers 200 while the service is running (documented where docs are published). */
@Module({ controllers: [HealthController] })
export class HealthModule {}
