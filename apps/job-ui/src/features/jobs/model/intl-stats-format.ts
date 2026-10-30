import type {
  CountStatsFormatRequest,
  StatsFormat,
  StatsFormatResponse,
  ThroughputStatsFormatRequest,
} from './stats-format';

export interface IntlStatsFormatParams {
  /** Written right after the throughput, e.g. `/min`. */
  readonly perMinuteUnit: string;
}

/** `StatsFormat` with `Intl.NumberFormat` in English (`1,234`, `2.4/min`). */
export class IntlStatsFormat implements StatsFormat {
  private readonly counts = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
  private readonly rates = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });

  constructor(private readonly p: IntlStatsFormatParams) {}

  count(req: CountStatsFormatRequest): StatsFormatResponse {
    return { text: this.counts.format(req.value) };
  }

  throughput(req: ThroughputStatsFormatRequest): StatsFormatResponse {
    return { text: `${this.rates.format(req.value)}${this.p.perMinuteUnit}` };
  }
}
