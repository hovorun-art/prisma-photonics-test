import type {
  LogPolicy,
  ResolveLogPolicyRequest,
  ResolveLogPolicyResponse,
} from '../../domain/logging/log-policy.js';

/** Never log the service token or any other credential sent with a request. */
const REDACTED_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  '*.headers.authorization',
] as const;

/** The configured level, credentials redacted, readable lines only in local development. */
export class LogPolicyImpl implements LogPolicy {
  resolve(req: ResolveLogPolicyRequest): ResolveLogPolicyResponse {
    return {
      level: req.logLevel,
      redactedPaths: REDACTED_PATHS,
      format: req.nodeEnv === 'development' ? 'pretty' : 'json',
    };
  }
}
