import type { Random } from '@job-queue/kernel';

import type {
  CreateInstanceIdFactoryRequest,
  CreateInstanceIdFactoryResponse,
  InstanceIdFactory,
} from '../../domain/instance/instance-id-factory.js';
import type { InstanceId } from '../../domain/instance/instance-id.js';

export interface HostnameInstanceIdFactoryDeps {
  random: Random;
}

const SUFFIX_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';
const SUFFIX_LENGTH = 6;
const FALLBACK_PREFIX = 'execution';

/**
 * The host name (the container id under Docker) plus a random suffix, so two processes on one
 * host never share an id.
 */
export class HostnameInstanceIdFactory implements InstanceIdFactory {
  constructor(private readonly d: HostnameInstanceIdFactoryDeps) {}

  create(req: CreateInstanceIdFactoryRequest): CreateInstanceIdFactoryResponse {
    return { instanceId: `${this.prefix(req.hostname)}-${this.suffix()}` as InstanceId };
  }

  /** The host name with every character that is unsafe in logs and keys turned into a dash. */
  private prefix(hostname: string): string {
    return (
      hostname
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, '-')
        .replace(/^-+|-+$/g, '') || FALLBACK_PREFIX
    );
  }

  private suffix(): string {
    let suffix = '';
    for (let i = 0; i < SUFFIX_LENGTH; i += 1) {
      const { value } = this.d.random.int({ min: 0, max: SUFFIX_ALPHABET.length - 1 });
      suffix += SUFFIX_ALPHABET.charAt(value);
    }
    return suffix;
  }
}
