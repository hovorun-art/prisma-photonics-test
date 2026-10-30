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
5. Run the checks (`CHECK_CMDS` in `.claude/flow.conf`) until they pass. Do not commit and do not run change-verifier: the main agent brings the groups together and verifies the whole change.
6. Report: the worktree path, the files you changed, the tasks you checked off, the check results, the test areas you wrote or changed tests in (so the main agent runs the `test-case-reviewer` on them after merging), and anything left open.
