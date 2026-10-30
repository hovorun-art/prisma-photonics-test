/** Token for the page size rule of a paged query. */
export const PAGE_LIMIT = Symbol('PageLimit');

/** The page size of a paged query: the configured default, or the asked one up to the maximum. */
export interface PageLimit {
  /** Throws `QueryLimitExceededError` for a limit above the configured maximum. */
  resolve(req: ResolvePageLimitRequest): ResolvePageLimitResponse;
}

export interface ResolvePageLimitRequest {
  limit?: number | undefined;
}

export interface ResolvePageLimitResponse {
  limit: number;
}
