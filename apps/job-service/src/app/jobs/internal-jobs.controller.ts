import {
  INTERNAL_JOBS_ROUTE,
  type InternalJob,
  type Job,
  UpdateJobRequest,
} from '@job-queue/contracts';
import { Body, Controller, Get, Inject, Param, Patch, UseGuards } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { ZodValidationPipe } from 'nestjs-zod';

import {
  JOB_SERVICE_CONFIG,
  type JobServiceConfig,
} from '../../domain/config/job-service-config.js';
import { JOB_SERVICE, type JobService } from '../../domain/jobs/job-service.js';
import { ServiceTokenGuard } from '../internal-access/service-token.guard.js';
import { JobIdParamsDto } from './job.dto.js';

/** The internal job routes job-execution-service calls: read a job and report its lifecycle. */
@ApiExcludeController()
@Controller(INTERNAL_JOBS_ROUTE)
@UseGuards(ServiceTokenGuard)
export class InternalJobsController {
  constructor(
    @Inject(JOB_SERVICE) private readonly jobs: JobService,
    @Inject(JOB_SERVICE_CONFIG) private readonly config: JobServiceConfig,
  ) {}

  /** The job with the time limit of its type, so the worker and job-service use the same one. */
  @Get(':id')
  async get(@Param() params: JobIdParamsDto): Promise<InternalJob> {
    const { job } = await this.jobs.get({ id: params.id });
    return { ...job, maxProcessingMs: this.config.maxProcessingMs[job.type] };
  }

  @Patch(':id')
  async update(
    @Param() params: JobIdParamsDto,
    @Body(new ZodValidationPipe(UpdateJobRequest)) body: UpdateJobRequest,
  ): Promise<Job> {
    return (await this.jobs.update({ id: params.id, update: body })).job;
  }
}
