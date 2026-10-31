import { createHash } from 'node:crypto';

import type { IdentityStackIdentityResponse, StackIdentity } from './stack-identity.js';

export interface CheckoutStackIdentityParams {
  /** The checkout (main folder or a git worktree) the suite runs from. */
  checkoutPath: string;
}

/** One block of host ports per slot, starting here. */
const FIRST_PORT = 10_000;
const PORTS_PER_SLOT = 10;
/** Keeps the last block below 32768, where the ephemeral ports of Linux and macOS begin. */
const SLOTS = 2_000;

/**
 * Derives the stack's project name and host ports from the checkout's path, so suites running in
 * different worktrees at the same time neither share a stack nor fight over ports, and one
 * suite's teardown never removes another's stack. Two checkouts may still land on the same port
 * slot (about one pair in two thousand); their project names stay different, so the later `up`
 * fails on the busy port instead of touching the other stack.
 */
export class CheckoutStackIdentity implements StackIdentity {
  constructor(private readonly p: CheckoutStackIdentityParams) {}

  identity(): IdentityStackIdentityResponse {
    const digest = createHash('sha256').update(this.p.checkoutPath).digest('hex');
    const firstPort =
      FIRST_PORT + (Number.parseInt(digest.slice(0, 8), 16) % SLOTS) * PORTS_PER_SLOT;
    return {
      project: `system-e2e-${digest.slice(0, 12)}`,
      ports: {
        jobService: firstPort,
        jobGroupService: firstPort + 1,
        jobUi: firstPort + 2,
      },
    };
  }
}
