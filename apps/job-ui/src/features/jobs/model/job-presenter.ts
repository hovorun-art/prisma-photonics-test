import { FINISHED_JOB_STATUSES, type Job, type JobStatus } from '@job-queue/contracts';

import { IntlWholeNumberFormat } from '@/lib/whole-number-format';
import { en } from '@/locales';

import type {
  ActionsJobPresentationRequest,
  ActionsJobPresentationResponse,
  DetailsJobPresentationRequest,
  JobPresentation,
  LifecycleJobPresentationRequest,
  LifecycleJobPresentationResponse,
  LifecycleStep,
  ShortIdJobPresentationRequest,
  TextJobPresentationResponse,
  TimeJobPresentationRequest,
  TotalTimeJobPresentationRequest,
  TotalTimeJobPresentationResponse,
} from './job-presentation';

export interface JobPresenterParams {
  readonly shortIdLength: number;
}

const FINISHED: readonly JobStatus[] = FINISHED_JOB_STATUSES;
const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;

/** `JobPresentation` in the browser's time zone, with the strings from `locales/en.ts`. */
export class JobPresenter implements JobPresentation {
  private readonly time = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  private readonly date = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });
  private readonly day = new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
  private readonly number = new IntlWholeNumberFormat();

  constructor(private readonly p: JobPresenterParams) {}

  shortId(req: ShortIdJobPresentationRequest): TextJobPresentationResponse {
    return { text: req.id.slice(0, this.p.shortIdLength) };
  }

  details(req: DetailsJobPresentationRequest): TextJobPresentationResponse {
    const { job } = req;
    if (job.status === 'failed') return { text: job.error?.message ?? '' };
    switch (job.type) {
      case 'email':
        return job.status === 'completed'
          ? { text: job.result?.messageId ?? '' }
          : { text: en.details.emailWaiting(job.payload.to, job.payload.subject) };
      case 'webhook':
        return job.status === 'completed'
          ? { text: job.result ? en.details.webhookCompleted(job.result.statusCode) : '' }
          : { text: en.details.webhookWaiting(job.payload.method, job.payload.url) };
      case 'flight-transit':
        return job.status === 'completed'
          ? {
              text: job.result
                ? en.details.transitCompleted(
                    job.result.flight,
                    this.number.format({ value: job.result.distanceKm }).text,
                  )
                : '',
            }
          : {
              text: en.details.transitWaiting(
                job.payload.origin,
                job.payload.destination,
                // A calendar day, not an instant: read and shown in UTC so no time zone shifts it.
                this.day.format(new Date(`${job.payload.departureDate}T00:00:00.000Z`)),
              ),
            };
    }
  }

  listTime(req: TimeJobPresentationRequest): TextJobPresentationResponse {
    return { text: this.time.format(new Date(req.at)) };
  }

  dateTime(req: TimeJobPresentationRequest): TextJobPresentationResponse {
    const at = new Date(req.at);
    return { text: `${this.date.format(at)}, ${this.time.format(at)}` };
  }

  totalTime(req: TotalTimeJobPresentationRequest): TotalTimeJobPresentationResponse {
    const { startedAt, completedAt } = req.job;
    if (!startedAt || !completedAt) return { text: null };
    const seconds = (Date.parse(completedAt) - Date.parse(startedAt)) / MS_PER_SECOND;
    if (seconds < SECONDS_PER_MINUTE) return { text: `${seconds.toFixed(1)}s` };
    const whole = Math.round(seconds);
    return {
      text: `${Math.floor(whole / SECONDS_PER_MINUTE)}m ${whole % SECONDS_PER_MINUTE}s`,
    };
  }

  lifecycle(req: LifecycleJobPresentationRequest): LifecycleJobPresentationResponse {
    const { job } = req;
    const finished = FINISHED.includes(job.status);
    const steps: LifecycleStep[] = [
      { status: 'pending', reached: true, at: this.listTime({ at: job.createdAt }).text },
      {
        status: 'processing',
        reached: job.startedAt !== null,
        at: this.optionalTime(job.startedAt),
      },
      {
        status: finished ? job.status : 'completed',
        reached: finished,
        at: finished ? this.optionalTime(job.completedAt) : null,
      },
    ];
    return { steps };
  }

  actions({ job }: ActionsJobPresentationRequest): ActionsJobPresentationResponse {
    return {
      cancel: job.status === 'pending' || job.status === 'scheduled',
      retry: job.status === 'failed',
      delete: FINISHED.includes(job.status),
    };
  }

  private optionalTime(at: Job['startedAt']): string | null {
    return at ? this.listTime({ at }).text : null;
  }
}
