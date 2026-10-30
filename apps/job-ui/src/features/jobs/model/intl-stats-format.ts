import type { WholeNumberFormat } from '@/lib/whole-number-format';

import type {
  CountStatsFormatRequest,
  StatsFormat,
  StatsFormatResponse,
  ThroughputStatsFormatRequest,
} from './stats-format';

export interface IntlStatsFormatDeps {
  /** job-ui's shared whole-number format, so counts are grouped like every other number. */
  readonly wholeNumbers: WholeNumberFormat;
}

export interface IntlStatsFormatParams {
  /** Written right after the throughput, e.g. `/min`. */
  readonly perMinuteUnit: string;
}

/** `StatsFormat` with job-ui's whole-number format for counts and one decimal for rates. */
export class IntlStatsFormat implements StatsFormat {
  private readonly rates = new Intl.NumberFormat('en-GB', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });

  constructor(
    private readonly d: IntlStatsFormatDeps,
    private readonly p: IntlStatsFormatParams,
  ) {}

  count(req: CountStatsFormatRequest): StatsFormatResponse {
    return { text: this.d.wholeNumbers.format({ value: req.value }).text };
  }

  throughput(req: ThroughputStatsFormatRequest): StatsFormatResponse {
    return { text: `${this.rates.format(req.value)}${this.p.perMinuteUnit}` };
  }
}
