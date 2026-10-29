import { Body, Controller, Get, Module, Post } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { ZodValidationPipe } from 'nestjs-zod';
import { z } from 'zod';

/** The body schema of the test-only validation route. */
export const ProbeBody = z.object({
  name: z.string().min(1),
  size: z.number().int().positive(),
});

export const FAILURE_PROBE_PATH = '/test-failure';
export const VALIDATION_PROBE_PATH = '/test-validation';

/** Test-only routes that fail or validate, so the error scenarios run through the real app. */
@ApiExcludeController()
@Controller()
export class ErrorProbeController {
  @Get(FAILURE_PROBE_PATH)
  fail(): never {
    throw new Error('connection pool exhausted: secret internals');
  }

  @Post(VALIDATION_PROBE_PATH)
  validate(@Body(new ZodValidationPipe(ProbeBody)) body: z.infer<typeof ProbeBody>): {
    accepted: z.infer<typeof ProbeBody>;
  } {
    return { accepted: body };
  }
}

/** Registered only by the e2e tests, never by `AppModule`. */
@Module({ controllers: [ErrorProbeController] })
export class ErrorProbeModule {}
