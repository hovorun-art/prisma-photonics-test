import { ERROR_CODES } from '@job-queue/kernel';
import { z } from 'zod';

/** Every stable error code the API can return (the kernel's closed list). Clients switch on these, never on messages. */
export const ErrorCode = z.enum(ERROR_CODES);
export type ErrorCode = z.infer<typeof ErrorCode>;

/** The uniform body of every error response. */
export const ErrorBody = z.object({
  code: ErrorCode,
  message: z.string(),
  details: z.record(z.string(), z.unknown()),
});
export type ErrorBody = z.infer<typeof ErrorBody>;

/** One problem in a rejected request: where it is (`['payload', 'to']`) and what is wrong. */
export const ValidationIssue = z.object({
  path: z.array(z.union([z.string(), z.number()])),
  message: z.string(),
});
export type ValidationIssue = z.infer<typeof ValidationIssue>;

/** The `details` of a `VALIDATION_FAILED` error body. */
export const ValidationFailedDetails = z.object({ issues: z.array(ValidationIssue) });
export type ValidationFailedDetails = z.infer<typeof ValidationFailedDetails>;
