// Shared ESLint flat config for the whole monorepo (used by the root eslint.config.mjs).
//
// Architecture rules (CLAUDE.md, "Code style"; design.md, "Onion layers and DI"):
// - Layers first: apps/<app>/src/ has domain/ (interfaces and types only), infra/ (every
//   implementation) and app/ (NestJS entry points and wiring); features are subfolders inside each
//   layer. Dependencies:
//     domain -> kernel, contracts, domain
//     infra  -> domain, infra, kernel, contracts
//     app    -> domain, app, kernel, contracts (only *.module.ts may import infra, to wire it)
// - Class rules (CLAUDE.md): no free functions, every class implements an interface or extends a
//   base class, constructors and methods take at most one (object) parameter.
// - No imports across apps: they talk over HTTP, not through code.
// - The composition root (main.ts and *.module.ts files) wires everything and is exempt.
import { fileURLToPath } from 'node:url';

import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import boundaries from 'eslint-plugin-boundaries';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));

const LAYERS = ['domain', 'infra', 'app'];
const COMPOSITION_ROOT = [
  'apps/*/src/main.ts',
  'apps/*/src/**/*.module.ts',
  'packages/service-kit/src/**/*.module.ts',
  'tools/*/src/main.ts',
];

/**
 * Files where free functions are allowed: React components and hooks, shadcn's `cn`, the
 * composition root and tool configs.
 */
const FREE_FUNCTIONS_ALLOWED = [
  '**/*.tsx',
  'apps/job-ui/src/**/use-*.ts',
  'apps/job-ui/src/lib/class-names.ts',
  'apps/*/src/main.ts',
  'tools/*/src/main.ts',
  '**/*.config.ts',
  '**/*.config.mjs',
  'tooling/**',
  'eslint.config.mjs',
];

const NO_FREE_FUNCTIONS = [
  'Program > FunctionDeclaration',
  'Program > ExportNamedDeclaration > FunctionDeclaration',
  'Program > ExportDefaultDeclaration > FunctionDeclaration',
  'Program > VariableDeclaration > VariableDeclarator > :matches(ArrowFunctionExpression, FunctionExpression)',
  'Program > ExportNamedDeclaration > VariableDeclaration > VariableDeclarator > :matches(ArrowFunctionExpression, FunctionExpression)',
].map((selector) => ({
  selector,
  message:
    'No free functions: put the logic in a class method (private if only that class uses it).',
}));

const CLASS_SHAPE = [
  {
    selector:
      ':matches(ClassDeclaration, ClassExpression)[implements.length=0][superClass=null]:not(:has(Decorator > CallExpression > Identifier[name=/^(Controller|Module)$/]))',
    message: 'Every class implements an interface (or extends a base class that does).',
  },
  {
    selector: "MethodDefinition[kind!='constructor'] > FunctionExpression[params.length>1]",
    message: 'Methods take one request object: `req: <Method><Interface>Request`.',
  },
  {
    selector: "MethodDefinition[kind='constructor'] > FunctionExpression[params.length>2]",
    message: 'Constructors take at most `d: <Class>Deps` and `p: <Class>Params`.',
  },
  {
    selector: ':matches(TSMethodSignature, TSPropertySignature > TSFunctionType)[params.length>1]',
    message: 'Interface methods take one request object: `req: <Method><Interface>Request`.',
  },
];

/** Persistent mock stubs; tests use their `...Once` forms instead. */
const MOCK_ONCE_ONLY = [
  'mockResolvedValue',
  'mockRejectedValue',
  'mockReturnValue',
  'mockImplementation',
];

const THROW_RULE = {
  selector: 'ThrowStatement > Literal',
  message: 'Throw a DomainError subclass with a code, never a string.',
};

/** Libraries the domain layer must never touch (it stays framework-free). */
const FRAMEWORK_IMPORTS = [
  '@nestjs/*',
  '@prisma/*',
  'prisma',
  'bullmq',
  'ioredis',
  'nestjs-*',
  'pino',
  'pino-*',
];

const boundariesConfig = {
  files: ['apps/*/src/**/*.{ts,tsx}', 'packages/*/src/**/*.ts', 'tools/*/src/**/*.ts'],
  plugins: { boundaries },
  settings: {
    'boundaries/root-path': repoRoot,
    'boundaries/legacy-templates': false,
    'boundaries/include': ['apps/*/src/**/*', 'packages/*/src/**/*', 'tools/*/src/**/*'],
    'boundaries/ignore': COMPOSITION_ROOT,
    'import/resolver': {
      typescript: {
        alwaysTryTypes: true,
        noWarnOnMultipleProjects: true,
        conditionNames: ['@job-queue/source', 'types', 'import', 'require', 'node', 'default'],
        project: [
          `${repoRoot}packages/*/tsconfig.json`,
          `${repoRoot}apps/*/tsconfig.json`,
          `${repoRoot}tools/*/tsconfig.json`,
        ],
      },
    },
    'boundaries/elements': [
      { type: 'kernel', pattern: 'packages/kernel', partialMatch: false },
      { type: 'contracts', pattern: 'packages/contracts', partialMatch: false },
      // Layers of the apps, of packages/service-kit and of the tools (same domain/infra/app layout).
      ...LAYERS.map((layer) => ({
        type: layer,
        pattern: [`apps/*/src/${layer}`, `packages/*/src/${layer}`, `tools/*/src/${layer}`],
        capture: ['app'],
        partialMatch: false,
      })),
    ],
  },
  rules: {
    'boundaries/dependencies': [
      'error',
      {
        default: 'allow',
        checkInternals: false,
        policies: [
          // Inner layers never depend on outer ones.
          {
            from: { element: { type: 'domain' } },
            disallow: { to: { element: { type: ['infra', 'app'] } } },
            message: 'domain/ may import only domain/, packages/kernel and contracts.',
          },
          {
            from: { element: { type: 'infra' } },
            disallow: { to: { element: { type: 'app' } } },
            message: 'infra/ may not import app/.',
          },
          {
            from: { element: { type: 'app' } },
            disallow: { to: { element: { type: 'infra' } } },
            message:
              'app/ calls domain/ interfaces through DI tokens; only *.module.ts files import infra/.',
          },
          // Never import code from another app: apps talk over HTTP.
          {
            from: { element: { type: LAYERS } },
            disallow: {
              to: {
                element: {
                  type: LAYERS,
                  captured: { app: '!{{ from.element.captured.app }}' },
                },
              },
            },
            message: 'Never import code from another app.',
          },
          // Shared packages stay independent of the apps.
          {
            from: { element: { type: ['kernel', 'contracts'] } },
            disallow: { to: { element: { type: LAYERS } } },
            message: 'Shared packages may not import application code.',
          },
          {
            from: { element: { type: 'kernel' } },
            disallow: { to: { element: { type: 'contracts' } } },
            message: 'packages/kernel depends on nothing.',
          },
        ],
      },
    ],
  },
};

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/coverage/**',
      '**/playwright-report/**',
      '**/test-results/**',
      '**/generated/**',
      '.claude/**',
      'openspec/**',
      'docs/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.node },
      parserOptions: {
        projectService: {
          allowDefaultProject: ['*.mjs', 'tooling/*/*.mjs', 'vitest.config.ts'],
        },
        tsconfigRootDir: repoRoot,
      },
    },
    linterOptions: { reportUnusedDisableDirectives: 'error' },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'separate-type-imports' },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      'no-restricted-syntax': ['error', THROW_RULE, ...NO_FREE_FUNCTIONS, ...CLASS_SHAPE],
    },
  },
  {
    // NestJS injects through constructor parameter types: the imports must stay value imports,
    // and classes with only decorators are normal.
    files: [
      'apps/job-service/**/*.ts',
      'apps/job-execution-service/**/*.ts',
      'apps/job-group-service/**/*.ts',
      'packages/service-kit/**/*.ts',
    ],
    rules: {
      '@typescript-eslint/consistent-type-imports': 'off',
      '@typescript-eslint/no-extraneous-class': ['error', { allowWithDecorator: true }],
    },
  },
  {
    files: [
      'apps/*/src/domain/**/*.ts',
      'packages/kernel/src/domain/**/*.ts',
      'packages/service-kit/src/domain/**/*.ts',
      'tools/*/src/domain/**/*.ts',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: FRAMEWORK_IMPORTS,
              message: 'The domain layer is framework-free: no NestJS, Prisma, Redis or logging.',
            },
          ],
        },
      ],
    },
  },
  {
    // Framework-owned shapes: Nest builds app/ classes and module wiring itself (per-parameter
    // injection, `catch(exception, host)`), so only the throw rule applies there.
    files: ['apps/*/src/app/**/*.ts', 'packages/service-kit/src/app/**/*.ts'],
    rules: { 'no-restricted-syntax': ['error', THROW_RULE, ...NO_FREE_FUNCTIONS] },
  },
  {
    files: FREE_FUNCTIONS_ALLOWED,
    rules: { 'no-restricted-syntax': ['error', THROW_RULE] },
  },
  boundariesConfig,
  {
    files: ['apps/job-ui/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },
  {
    // shadcn/ui components come from its CLI and export their variant helpers next to them.
    files: ['apps/job-ui/src/components/ui/**/*.tsx'],
    rules: { 'react-refresh/only-export-components': 'off' },
  },
  {
    files: ['**/*.test.{ts,tsx}', '**/*.spec.ts', '**/test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/unbound-method': 'off',
      // A stub answers only the calls a test expects; an unexpected extra call gets nothing and fails.
      'no-restricted-properties': [
        'error',
        ...MOCK_ONCE_ONLY.map((property) => ({
          property,
          message: `Use ${property}Once: stub each expected call, so an unexpected call fails.`,
        })),
      ],
    },
  },
  {
    files: ['**/*.mjs'],
    ...tseslint.configs.disableTypeChecked,
  },
  prettier,
);
