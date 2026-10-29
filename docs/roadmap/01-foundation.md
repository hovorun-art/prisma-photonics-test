# Milestone 1: Foundation

`docker compose up` starts every service (database, queue, API, worker, web UI) as a walking
skeleton: the API answers a health check, the worker boots and connects, the UI loads, and the
checks (typecheck, lint, tests) pass locally and in CI.

## Prerequisites (decisions, not changes)

Settled before the first change and recorded in `docs/concept.md`, `CLAUDE.md` and a draft
`DECISIONS.md`:

1. **Scope**: clarify every requirement of the task and what is in or out (job log, live progress,
   map hover bonus, auth, etc.).
2. **Stack and architecture**: languages, frameworks, queue and database technology, repo layout,
   how job pickup, crash recovery, priority and scheduling map onto that stack.
3. **Project setup**: fill the TODOs in `CLAUDE.md` and `.claude/flow.conf` (commands, checks, lint,
   test patterns) for the chosen stack; decide how AI chat transcripts are exported for the
   submission.

## Changes

| Change | Intent | Depends on |
|---|---|---|
| `project-scaffold` | Docker Compose with all services and stub API, worker and UI, green checks and CI | - |

Later milestones (core job flow, failure handling, UI, concurrency, aircraft transit map,
submission docs) are planned in detail after the scaffold.

## Open questions

- [x] Stack, layout, scope extras, data source, transcripts: settled, see `docs/concept.md`
  ("Decided during planning").
- [ ] Queue integration details (BullMQ to Postgres sync, cancel/retry races): decided in the core
  job flow change.
