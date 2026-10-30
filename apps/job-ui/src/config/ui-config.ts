/** Tunable values of job-ui. Components read them through `useUiConfig`, so tests can shorten them. */
export interface UiConfig {
  /** How often the jobs list and the job page fetch their data again. */
  readonly pollIntervalMs: number;
  /** How long a copy button reads "Copied". */
  readonly copiedFeedbackMs: number;
  /** How many leading characters of a job id the list shows. */
  readonly shortIdLength: number;
  /**
   * Page size of the calls that load a group's jobs, all pages of them; job-service's maximum
   * (`JOB_SERVICE_QUERY_MAX_LIMIT`, default 100) or less.
   */
  readonly groupJobsPageSize: number;
  /** Map tile URL template of the transit report (`{z}`, `{x}`, `{y}`). */
  readonly mapTileUrl: string;
  /** Attribution the tile server requires, as HTML. */
  readonly mapTileAttribution: string;
}

export const UI_CONFIG: UiConfig = {
  pollIntervalMs: 2000,
  copiedFeedbackMs: 1500,
  shortIdLength: 8,
  groupJobsPageSize: 100,
  mapTileUrl: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  mapTileAttribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
};
