import { ValidationFailedDetails, type ValidationIssue } from '@job-queue/contracts';

import type { BulkIssues, SplitBulkIssuesRequest, SplitBulkIssuesResponse } from './bulk-issues';

/** The request field that holds the bulk's jobs. */
const JOBS_FIELD = 'jobs';

/** `BulkIssues` for the shared `ValidationFailedDetails` contract. */
export class BulkIssueSplitter implements BulkIssues {
  split(req: SplitBulkIssuesRequest): SplitBulkIssuesResponse {
    const parsed = ValidationFailedDetails.safeParse(req.details);
    const jobs: ValidationIssue[][] = Array.from({ length: req.jobCount }, () => []);
    const unmatched: string[] = [];
    for (const issue of parsed.success ? parsed.data.issues : []) {
      const [field, index, ...rest] = issue.path;
      const job = field === JOBS_FIELD && rest.length > 0 ? this.jobOf({ jobs, index }) : undefined;
      if (job) job.push({ path: rest, message: issue.message });
      else unmatched.push(issue.message);
    }
    return { jobs: jobs.map((issues) => ({ issues })), unmatched };
  }

  /** The job at a path segment that is a whole index, as a number or its digits. */
  private jobOf<T>(req: { jobs: readonly T[]; index: string | number | undefined }): T | undefined {
    const { index } = req;
    const number = typeof index === 'string' && /^\d+$/.test(index) ? Number(index) : index;
    return typeof number === 'number' && Number.isInteger(number) ? req.jobs[number] : undefined;
  }
}
