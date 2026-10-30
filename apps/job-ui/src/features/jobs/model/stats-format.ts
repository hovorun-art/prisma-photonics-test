export interface CountStatsFormatRequest {
  readonly value: number;
}
export interface ThroughputStatsFormatRequest {
  readonly value: number;
}
export interface StatsFormatResponse {
  readonly text: string;
}

/** How the queue statistics cards write their values. */
export interface StatsFormat {
  /** A job count, with thousands separators. */
  count(req: CountStatsFormatRequest): StatsFormatResponse;
  /** Jobs per minute, with one decimal and the per-minute unit. */
  throughput(req: ThroughputStatsFormatRequest): StatsFormatResponse;
}
