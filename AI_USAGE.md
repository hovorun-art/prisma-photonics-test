# AI Tool Usage

## Tools I Used

- **Claude Design** for the UI: I designed the screens there and passed them to Claude Code, which
  built job-ui from them.
- **Claude Code** in VS Code for everything else. Claude Opus 5.5 did most of the work; Claude
  Fable 5.1 designed the reliability part (see "What I Had to Fix"); Claude Sonnet 5.5 took routine
  work (small fixes, renames, docs), and Haiku 5.5 was tried briefly.
- **Subagents** defined in `.claude/agents/`: `change-verifier` checks a finished change against its
  spec and tasks, and `test-case-reviewer` reviews one test area for missing cases, without seeing
  the main agent's reasoning. Parallel task groups ran as subagents in their own git worktrees.
- **OpenSpec** with a custom schema (`openspec/schemas/spec-flow/`) and project skills
  (`.claude/skills/`): every change goes proposal → decisions → my approval → specs and design →
  tasks → code, test first.
- **Hooks** (`.claude/hooks/`) that enforce the flow instead of trusting the model to: specs and
  tasks are blocked until I approve the decisions, lint runs on every edit, the checks run before
  the agent may stop, a change counts as done only after a verifier PASS, and git commands need my
  approval.
- The chats are exported into [`AI_CHAT.md`](AI_CHAT.md) by a small tool in this repository
  (`npm run export:chats`).

## What Helped Most

**Decisions before code, enforced by hooks.** For each change the agent wrote down what I had
decided, what it assumed and what was still open, and no spec or code could be written until I
approved it. The model asked instead of inventing behaviour, and the verifier found gaps before a
change was merged.

**An independent test reviewer.** The `test-case-reviewer` subagent reviews tests without seeing
the reasoning of the agent that wrote them. It kept finding corner cases the code and its tests had
missed, including a race condition in cancelling a running job, which was then fixed with a test
for that exact interleaving.

**Git worktrees for parallel work.** Each change got its own branch in its own worktree, so several
changes moved forward at the same time in separate Claude Code sessions, and a big change could be
split into task groups that subagents built in parallel, each in its own worktree. That made the
large pieces of the project much faster than working through them one by one.

## What I Had to Fix

**The concurrency design.** The AI did not come up with a clear concurrency design on the first
attempt. So I collected knowledge on the subject from different sources myself, then used Claude
Fable 5.1 to design the reliability part from it (duplicate-free pickup, crash recovery, retry with
backoff, idempotency) and Claude Opus 5.5 to implement that design. The approach is described in
`DECISIONS.md` sections 1 to 4.

## What AI Struggled With

- **Finding the balance on its own.** The setup (parallel agents in worktrees, test levels, which
  tests run where, how much review each change gets) had to be set up and tested over time to find
  the right balance between speed and quality. The AI does not find that balance by itself.
- **What is not put into words.** It follows what is written, but it cannot pick up a feeling or
  context I did not state: how much care a small internal tool deserves, or what I meant when an
  instruction left something open. Whatever mattered had to be said or written into the
  instructions.
- **Consistency across the monorepo.** It wrote the same bootstrap, config, logging and shutdown
  logic in each service until I asked for a duplication check, which produced `packages/kernel` and
  `packages/service-kit` and a duplication check in the verifier. In the same way, code style was
  not consistent across the apps until the rules were written into `CLAUDE.md` and enforced by
  ESLint.
