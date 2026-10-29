/**
 * Shared Vitest presets. Every workspace's `vitest.config.ts` builds on these, and the root
 * `vitest.config.ts` runs all workspace projects together (`npm test`).
 *
 * Test levels (see design.md, "Testing"):
 * - unit:        `*.test.ts(x)` next to the code, no I/O
 * - integration: `*.int.test.ts`, one adapter against its real dependency (Testcontainers)
 * - e2e:         `test/e2e/*.e2e.test.ts`, a backend app as a black box (Testcontainers)
 * Playwright suites (`*.spec.ts`) are not run by Vitest.
 */
import { fileURLToPath } from 'node:url';

import type { Alias } from 'vite';
import type { TestProjectInlineConfiguration } from 'vitest/config';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));

/** Resolve the shared packages to their TypeScript sources, so tests need no build step. */
export const workspaceSourceAliases: Alias[] = [
  { find: /^@job-queue\/kernel$/, replacement: `${repoRoot}packages/kernel/src/index.ts` },
  { find: /^@job-queue\/contracts$/, replacement: `${repoRoot}packages/contracts/src/index.ts` },
  {
    find: /^@job-queue\/service-kit$/,
    replacement: `${repoRoot}packages/service-kit/src/index.ts`,
  },
  {
    find: /^@job-queue\/test-support$/,
    replacement: `${repoRoot}tests/support/src/index.ts`,
  },
];

const PLAYWRIGHT_SPECS = '**/*.spec.ts';
const UNIT_TESTS = 'src/**/*.test.{ts,tsx}';
const INTEGRATION_TESTS = 'src/**/*.int.test.ts';
const E2E_TESTS = 'test/e2e/**/*.e2e.test.ts';

/** Containers take a while to start on a cold machine. */
const CONTAINER_TIMEOUT_MS = 120_000;

type Plugins = TestProjectInlineConfiguration['plugins'];

/** The unit project of a framework-free package. */
export function packageProjects(name: string): TestProjectInlineConfiguration[] {
  return [
    {
      extends: true,
      resolve: { alias: workspaceSourceAliases },
      test: {
        name: `${name}:unit`,
        include: [UNIT_TESTS],
        exclude: [INTEGRATION_TESTS, PLAYWRIGHT_SPECS],
        environment: 'node',
      },
    },
  ];
}

/**
 * The unit and integration projects of a package that holds NestJS code (decorator metadata
 * through SWC).
 */
export function nestPackageProjects(
  name: string,
  plugins: Plugins,
): TestProjectInlineConfiguration[] {
  const shared = {
    extends: true as const,
    plugins,
    resolve: { alias: workspaceSourceAliases },
  };
  return [
    {
      ...shared,
      test: {
        name: `${name}:unit`,
        include: [UNIT_TESTS],
        exclude: [INTEGRATION_TESTS, PLAYWRIGHT_SPECS],
        environment: 'node',
      },
    },
    {
      ...shared,
      test: {
        name: `${name}:integration`,
        include: [INTEGRATION_TESTS],
        environment: 'node',
        testTimeout: CONTAINER_TIMEOUT_MS,
        hookTimeout: CONTAINER_TIMEOUT_MS,
      },
    },
  ];
}

/**
 * Unit, integration and e2e projects of a NestJS app. Pass the SWC plugin so decorator metadata
 * is emitted (esbuild does not support `emitDecoratorMetadata`).
 */
export function backendProjects(name: string, plugins: Plugins): TestProjectInlineConfiguration[] {
  const shared = {
    extends: true as const,
    plugins,
    resolve: { alias: workspaceSourceAliases },
  };
  return [
    {
      ...shared,
      test: {
        name: `${name}:unit`,
        include: [UNIT_TESTS],
        exclude: [INTEGRATION_TESTS, PLAYWRIGHT_SPECS],
        environment: 'node',
      },
    },
    {
      ...shared,
      test: {
        name: `${name}:integration`,
        include: [INTEGRATION_TESTS],
        environment: 'node',
        testTimeout: CONTAINER_TIMEOUT_MS,
        hookTimeout: CONTAINER_TIMEOUT_MS,
      },
    },
    {
      ...shared,
      test: {
        name: `${name}:e2e`,
        include: [E2E_TESTS],
        environment: 'node',
        testTimeout: CONTAINER_TIMEOUT_MS,
        hookTimeout: CONTAINER_TIMEOUT_MS,
        fileParallelism: false,
      },
    },
  ];
}

/** The unit project of a React app: jsdom, Testing Library, MSW. */
export function uiProjects(
  name: string,
  plugins: Plugins,
  setupFiles: string[] = [],
): TestProjectInlineConfiguration[] {
  return [
    {
      extends: true,
      plugins,
      resolve: { alias: workspaceSourceAliases },
      test: {
        name: `${name}:unit`,
        include: [UNIT_TESTS],
        exclude: [PLAYWRIGHT_SPECS, 'test/e2e/**'],
        environment: 'jsdom',
        setupFiles,
      },
    },
  ];
}
