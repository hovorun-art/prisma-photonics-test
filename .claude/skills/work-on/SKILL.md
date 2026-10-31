---
name: work-on
description: Build one task group of an OpenSpec change in an isolated git worktree. Followed by the parallel subagents that apply starts when the user chose parallel groups; not for the main agent.
argument-hint: <change-name> <group-number>
---

Arguments: `$ARGUMENTS` = `<change-name> <group-number>`.

1. Read `openspec/changes/<change-name>/` (proposal, decisions, design, specs, tasks). If `tasks.md` has no numbered `## N.` groups, stop and report it.
2. Make sure this is a separate git worktree, not the main checkout (`git rev-parse --git-common-dir` differs from `--git-dir`). If it is not, stop and report it: parallel groups must never share a checkout.
3. If the worktree has no dependencies yet, run `INSTALL_CMD` from `.claude/flow.conf` (skip it when `DEPS_DIR` already exists).
4. Implement only the tasks under group `<group-number>`, test first (see "Testing" in `CLAUDE.md`). Do not touch other groups' tasks or checkboxes, and stay inside the files the group lists under "Owns". If you need something owned by another group, or a behaviour that is not under "Decided" in `decisions.md`, stop and report it instead of building it.
5. Run typecheck, lint and the unit and integration tests related to your changes, including every test that imports a changed file (`npx vitest related --run --project <app>:unit --project <app>:integration <changed files>...` from the workspace) until they pass; not `npm test` or a whole app. Never run e2e tests (per-app `*.e2e.test.ts`, Playwright, `tests/system-e2e`): list the e2e files that need running in your report, and the main agent runs them. Do not run change-verifier: the main agent brings the groups together and verifies the whole change.
6. Commit the group in the worktree: one commit with every file you changed (including `tasks.md` with your group's boxes checked) and a Conventional Commits message for the group (`type(scope): summary`). The worktree is never on the main branch, so the hook allows it; never commit elsewhere.
7. Report: the worktree path, the commit hash and message, the files you changed, the tasks you checked off, the check results, the test areas you wrote or changed tests in (so the main agent runs the `test-case-reviewer` on them after merging), and anything left open.
