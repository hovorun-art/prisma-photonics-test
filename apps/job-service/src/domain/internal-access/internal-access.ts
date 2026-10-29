/**
 * Decides whether a call may use job-service's internal API (`/internal`), which only
 * job-execution-service calls, with the shared service token.
 */
export interface InternalAccess {
  /** Throws `UnauthorizedInternalAccessError` unless the call carries the configured token. */
  authorize(req: AuthorizeInternalAccessRequest): AuthorizeInternalAccessResponse;
}

export interface AuthorizeInternalAccessRequest {
  /** The `Authorization` header as received, if any. */
  authorization: string | undefined;
}

export type AuthorizeInternalAccessResponse = Record<string, never>;

export const INTERNAL_ACCESS = Symbol('InternalAccess');
