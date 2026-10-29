import { INTERNAL_JOBS_ROUTE, type Job, UpdateJobRequest } from '@job-queue/contracts';
import { Body, Controller, Get, Inject, Param, Patch, UseGuards } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { ZodValidationPipe } from 'nestjs-zod';

import { JOB_SERVICE, type JobService } from '../../domain/jobs/job-service.js';
import { ServiceTokenGuard } from '../internal-access/service-token.guard.js';
import { JobIdParamsDto } from './job.dto.js';

/** The internal job routes job-execution-service calls: read a job and report its lifecycle. */
@ApiExcludeController()
@Controller(INTERNAL_JOBS_ROUTE)
@UseGuards(ServiceTokenGuard)
export class InternalJobsController {
  constructor(@Inject(JOB_SERVICE) private readonly jobs: JobService) {}

  @Get(':id')
  async get(@Param() params: JobIdParamsDto): Promise<Job> {
    return (await this.jobs.get({ id: params.id })).job;
  }

  @Patch(':id')
  async update(
    @Param() params: JobIdParamsDto,
    @Body(new ZodValidationPipe(UpdateJobRequest)) body: UpdateJobRequest,
  ): Promise<Job> {
    return (await this.jobs.update({ id: params.id, update: body })).job;
  }
}
