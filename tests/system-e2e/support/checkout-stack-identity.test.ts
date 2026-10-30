import { describe, expect, it } from 'vitest';

import { CheckoutStackIdentity } from './checkout-stack-identity.js';
import type { StackHostPorts } from './stack-identity.js';

const MAIN_CHECKOUT = '/work/job-queue/';
const WORKTREE = '/work/job-queue-feature/';

/** Two checkout paths found offline whose hashes land in the same port slot. */
const SAME_SLOT_CHECKOUTS = ['/work/checkout-17/', '/work/checkout-32/'] as const;

/** Enough checkouts to reach the lowest and highest port slots. */
const MANY_CHECKOUTS = Array.from({ length: 5_000 }, (_, i) => `/work/checkout-${i}/`);

/** Below the ephemeral range macOS and Linux hand out to outgoing connections. */
const FIRST_EPHEMERAL_PORT = 32_768;

/** The host ports of a developer's own stack (`.env.example`). */
const DEFAULT_PORTS = [3_000, 3_001, 3_002, 5_173, 5_432, 6_379, 8_080];

describe('CheckoutStackIdentity', () => {
  it('gives the same checkout the same project and ports every time', () => {
    const first = new CheckoutStackIdentity({ checkoutPath: MAIN_CHECKOUT }).identity();
    const second = new CheckoutStackIdentity({ checkoutPath: MAIN_CHECKOUT }).identity();

    expect(second).toEqual(first);
  });

  it('gives two checkouts different projects and no shared host port', () => {
    const main = new CheckoutStackIdentity({ checkoutPath: MAIN_CHECKOUT }).identity();
    const worktree = new CheckoutStackIdentity({ checkoutPath: WORKTREE }).identity();

    expect(worktree.project).not.toBe(main.project);
    const mainPorts = new Set(Object.values(main.ports));
    expect(Object.values(worktree.ports).filter((port) => mainPorts.has(port))).toEqual([]);
  });

  it('keeps the projects apart when two checkouts land in the same port slot', () => {
    const [first, second] = SAME_SLOT_CHECKOUTS.map((checkoutPath) =>
      new CheckoutStackIdentity({ checkoutPath }).identity(),
    );

    expect(second?.ports).toEqual(first?.ports);
    expect(second?.project).not.toBe(first?.project);
  });

  it('names the project after a 12-character hash of the checkout', () => {
    const { project } = new CheckoutStackIdentity({ checkoutPath: WORKTREE }).identity();

    expect(project).toMatch(/^system-e2e-[0-9a-f]{12}$/);
  });

  it('gives each service its own port', () => {
    const values = Object.values(
      new CheckoutStackIdentity({ checkoutPath: MAIN_CHECKOUT }).identity().ports,
    );

    expect(new Set(values).size).toBe(values.length);
  });

  it('shares either all or none of its ports with any other checkout', () => {
    const ownerOfPort = new Map<number, StackHostPorts>();
    const partialOverlaps: string[] = [];
    for (const checkoutPath of MANY_CHECKOUTS) {
      const ports = new CheckoutStackIdentity({ checkoutPath: checkoutPath }).identity().ports;
      for (const port of Object.values(ports)) {
        const owner = ownerOfPort.get(port);
        if (owner === undefined) ownerOfPort.set(port, ports);
        else if (JSON.stringify(owner) !== JSON.stringify(ports))
          partialOverlaps.push(checkoutPath);
      }
    }

    expect(partialOverlaps).toEqual([]);
  });

  it('keeps every port between the privileged and the ephemeral range, off the default ports', () => {
    const ports = MANY_CHECKOUTS.flatMap((checkoutPath) =>
      Object.values(new CheckoutStackIdentity({ checkoutPath: checkoutPath }).identity().ports),
    );

    expect(Math.min(...ports)).toBeGreaterThan(1_023);
    expect(Math.max(...ports)).toBeLessThan(FIRST_EPHEMERAL_PORT);
    expect(ports.filter((port) => DEFAULT_PORTS.includes(port))).toEqual([]);
  });
});
