# Project

Job Queue Service: an interview task (Senior AI-Integrated Full Stack Engineer). Clients submit
background jobs (email, webhook, aircraft transit report, batch) through an API; workers pull them
from a Redis queue (BullMQ) and execute them, with job state, results and logs in Postgres; a web UI lists,
inspects, cancels and retries jobs and shows aircraft transits on a map. The reviewers assess
concurrency, failure handling and state management (duplicate-free pickup, crash recovery, retry
with backoff, priority, scheduled jobs, idempotency) and the honesty of `DECISIONS.md`. Spec-driven with OpenSpec; the flow's hooks, skills and verifier agent live in `.claude/`.
The full concept is in `docs/concept.md` (a source for decisions; each point is decided in a change).

## Language

English only: specs, design, tasks, code, comments, identifiers, UI strings in code, commit
messages and docs. Other languages only inside dedicated translation files (e.g. `locales/`);
text shown to users must come from those files, never be hardcoded in code.
Chat with the user and AskUserQuestion questions/options may be in the user's language; files stay
English. Deliberate exceptions (e.g. a test for Cyrillic input) carry `allow-non-english` on the line
or match `LANGUAGE_IGNORE` in `.claude/flow.conf`.

## Git

- Never commit, amend, push, merge, rebase or reset without the user's explicit approval. When work
  is ready to commit, show what will go in and the message; a hook makes Claude Code ask before each
  such git command. One approval covers one command, not later ones. Never route around the prompt
  (other tools, `--no-verify`, scripts).
- New features are built on their own branch, never on the main branch (`MAIN_BRANCH` in
  `.claude/flow.conf`): one branch per change, named after the change (`<change>`). Only planning
  artifacts (`openspec/changes/<change>/`) go on the main branch; the change is archived on its own
  branch, so the merge brings the code and the updated main specs together.

## Testing (TDD)

- Tests come first. For each task: write the test, run it and see it fail for the expected reason,
  write the least code that makes it pass, then refactor with the tests green.
- Every spec scenario (WHEN/THEN) has at least one test that sets up its WHEN and asserts its THEN;
  name the test after the scenario so the verifier can trace it.
- Fix the code, not the test. Change a test only when it contradicts the spec, and then say so.
- Tests are deterministic: time, randomness and I/O come in through parameters or fakes.
- With `TDD_STRICT=1` in `.claude/flow.conf`, a hook blocks edits to source files until a test file
  has changed on the branch.

## Commands

Keep in sync with `CHECK_CMDS` in `.claude/flow.conf`. Root scripts run across all workspaces;
exact names are fixed by the `project-scaffold` change.
- `docker compose up --build` (whole stack), `docker compose up --scale worker=N` (several workers)
- `npm run dev` / `npm run build`
- `npm run typecheck`, `npm run lint`, `npm test` (all three run by the Stop hook)

## Purpose and decisions

A take-home assessment, built to production-like standards but scoped to the task. The full list
of planning decisions is in `docs/concept.md` ("Decided during planning"); design trade-offs for the
reviewers go into `DECISIONS.md` as they are made, not at the end.

- Node 26, TypeScript, npm workspaces monorepo.
- API and worker: NestJS. Database: Postgres via Prisma (raw SQL via `$queryRaw` where
  concurrency-critical queries need locking). Queue: BullMQ on Redis behind our own queue interface
  (enqueue, claim, complete, fail, cancel), so its internals can be replaced later; what BullMQ does
  and what we own is in `DECISIONS.md`.
- Web: React + Vite, Tailwind + shadcn/ui, Leaflet + react-leaflet (OpenStreetMap tiles). Updates by
  polling first; Server-Sent Events later if time allows.
- API docs: Swagger/OpenAPI from NestJS.
- Tests: Vitest in every workspace; integration tests run against real Postgres and Redis.
- Aircraft data: generated from a bundled static airport list, no external API.
- Submission files: `README.md`, `DECISIONS.md`, `AI_USAGE.md`, `docs/ai-chats/` (Markdown exported
  from Claude Code sessions by a script at the end), `Dockerfile`, `docker-compose.yml`.

Specs must describe user-visible behaviour, not implementation details, so they stay reusable if
the stack changes.

## Architecture

Planned layout; `project-scaffold` makes it real and this section is updated when it changes.
```
apps/api       NestJS HTTP API: submit, get, list, cancel, retry, health; Swagger
apps/worker    NestJS worker process: takes jobs from the queue, runs handlers, writes state to Postgres;
               scaled with `docker compose up --scale worker=N` plus in-process concurrency
apps/web       React + Vite UI: job list and details, logs, transit map
packages/shared  job types, payload/result schemas, status lifecycle, shared contracts
packages/db      Prisma schema, migrations, client
docker-compose.yml  postgres, redis, api, worker, web
```
- Postgres is the source of truth for job state; Redis only holds the queue. Status transitions
  follow the lifecycle in `docs/concept.md` and are pure, unit-testable functions.
- Time (clock), randomness (webhook failure rate, sleep durations, generated flight data) and
  sleeping come in through injected providers, so the worker and job handlers test deterministically.
- BullMQ is used only through the queue interface; how it maps to Postgres state is decided in the
  core job flow change.

## Asking

- Ask through the AskUserQuestion tool, never as a plain-text list in chat. Batch related questions:
  up to 4 per call (each one is a tab), more calls if there are more, blocking questions first.
- Each question has prepared answer options (2-4, recommended one first) plus the built-in "Other";
  single choice by default, multiSelect when several answers can apply together.
- Record the answers in the change's `decisions.md` after each call.
- Next steps: when a step ends and the next one is a command (`/apply <change>`,
  `/archive <change>`, a commit...), offer the likely next steps as options instead of
  telling the user to type them, and run the one they pick yourself (skills through the Skill tool).

## Workflow

0. Roadmap first: at the start of the project (while `docs/roadmap/` still has its TODO), run the
   `roadmap` skill to turn `docs/concept.md` into milestones and an ordered list of changes.
   Take each new change from it, and update it when the concept changes.
1. `/explore` to clarify, then `/propose "idea"`. The `spec-flow` schema
   (`openspec/schemas/spec-flow/`) orders the artifacts: proposal → `decisions.md` → the user's
   approval → specs, design → tasks.
   - `decisions.md` has "Decided" (only what the user said or confirmed), "Assumed" (minor defaults
     you propose, confirmed by the user in one batch) and "Open questions" (everything else).
     Never invent behaviour: anything bigger than a minor default is a question.
   - Approval comes only from the user: they type `/specs-go <change>` or pick
     "Approve decisions" when you offer it. A hook then writes `.decisions-approved`, and only when
     nothing in `decisions.md` is unchecked. Until then hooks block specs, design and tasks, and no
     agent may write the marker.
   - UI from screenshots: when the user shares a screenshot or mockup, run the
     `ui-from-screenshots` skill.
   - No numbers in specs: tunable values (speeds, timings, limits, sizes) live in config and may be
     recorded in `decisions.md`, `design.md`, `tasks.md` and `ui.md`; specs say "the configured ...".
2. Commit the planning artifacts on the main branch (with the user's approval), then implement on the
   change's own branch with `/apply`, test first. Sequential by default; parallel groups
   only if the user chooses it (the apply skill describes how).
3. Hooks enforce the loop (settings in `.claude/flow.conf`): lint on each edit, full checks at the
   end, then the `change-verifier` subagent must return PASS before the work is done. Run it
   in the foreground and wait for it. Its verdict is recorded by a hook from its final message; no
   agent writes `.verdict`.
4. `/archive` after PASS, on the change branch.

Small fixes: a bug fix or change that adds no new behaviour may skip OpenSpec. It still gets its own
branch (`fix/<name>`), a test that reproduces the bug and fails first, then the fix and green checks.
If it turns out to change what the user sees, stop and start a change instead. When it is unclear
which path fits, ask the user.

## Models

- Main agent: Opus by default (`"model": "opus"` in `.claude/settings.json`), since most tasks
  are non-trivial (new features, architecture, multi-file).
- For purely routine work (small fixes, renames, boilerplate, docs) switch with `/model sonnet`
  at medium effort.
- `change-verifier`: Opus (set in its frontmatter). A false PASS costs more than the extra tokens.
- Choose by measured cost per task, not by price per token.
