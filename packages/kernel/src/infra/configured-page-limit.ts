import type {
  PageLimit,
  ResolvePageLimitRequest,
  ResolvePageLimitResponse,
} from '../domain/validation/page-limit.js';
import { QueryLimitExceededError } from '../domain/validation/query-limit-exceeded.error.js';

export interface ConfiguredPageLimitParams {
  /** Page size when the query asks for none. */
  defaultLimit: number;
  /** Largest page size a query may ask for. */
  maxLimit: number;
}

/** The page size rule with the default and maximum from a service's configuration. */
export class ConfiguredPageLimit implements PageLimit {
  constructor(private readonly p: ConfiguredPageLimitParams) {}

  resolve(req: ResolvePageLimitRequest): ResolvePageLimitResponse {
    const limit = req.limit ?? this.p.defaultLimit;
    if (limit > this.p.maxLimit) throw new QueryLimitExceededError({ maxLimit: this.p.maxLimit });
    return { limit };
  }
}
