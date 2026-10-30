/** The compose project name and host ports of one checkout's system e2e stack. */
export interface StackIdentity {
  identity(): IdentityStackIdentityResponse;
}

/** The services of the stack that publish a port on the host. */
export type StackPublishedService =
  'jobService' | 'jobGroupService' | 'jobUi' | 'postgres' | 'redis';

export type StackHostPorts = Record<StackPublishedService, number>;

export interface IdentityStackIdentityResponse {
  /** `docker compose -p <project>`. */
  project: string;
  ports: StackHostPorts;
}
