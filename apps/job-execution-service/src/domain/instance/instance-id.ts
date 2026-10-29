declare const instanceIdBrand: unique symbol;

/** Identifies one running job-execution-service instance (on every log line). */
export type InstanceId = string & { readonly [instanceIdBrand]: true };
