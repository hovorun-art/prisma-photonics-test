import type { InstanceId } from './instance-id.js';

/** Gives a starting process its instance id; two processes never share one. */
export interface InstanceIdFactory {
  create(req: CreateInstanceIdFactoryRequest): CreateInstanceIdFactoryResponse;
}

export interface CreateInstanceIdFactoryRequest {
  /** The host name (the container id under Docker). */
  hostname: string;
}

export interface CreateInstanceIdFactoryResponse {
  instanceId: InstanceId;
}
