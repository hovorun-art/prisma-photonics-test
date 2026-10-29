import { ComposeStack } from './compose-stack.js';
import { COMPOSE_PROJECT, REPO_ROOT, STACK_ENV } from './stack-settings.js';

/** The suite's stack: the real compose file under its own project name, ports and token. */
export const stack = new ComposeStack({
  project: COMPOSE_PROJECT,
  cwd: REPO_ROOT,
  env: STACK_ENV,
});
