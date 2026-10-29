/** job-service's internal API, used only by job-execution-service; hidden from public docs. */
export const INTERNAL_API_PREFIX = '/internal/v1';

/** Every internal call sends the shared service token as `Authorization: Bearer <token>`. */
export const SERVICE_TOKEN_SCHEME = 'Bearer';
