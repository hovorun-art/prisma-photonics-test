# Milestone 1: Foundation

`docker compose up` starts every service (Postgres, Redis, job-service, job-execution-service, web UI) as a walking
skeleton: job-service answers a health check, job-execution-service boots and connects, the UI loads, and the
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
| `project-scaffold` | Docker Compose with all services and stub job-service, job-execution-service and web UI, green checks and CI | - |

## Open questions

- [x] Stack, layout, scope extras, data source, transcripts: settled, see `docs/concept.md`
  ("Decided during planning").
