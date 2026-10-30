# Milestone 7: Final check and polish

Everything the submission requires is in place and checked against the task: a clean UI, a README a
reviewer can follow, honest `DECISIONS.md` and `AI_USAGE.md`, and the AI chat transcripts.

## Changes

| Change | Intent | Depends on |
|---|---|---|
| `ai-chat-export` | Script that converts Claude Code sessions into Markdown under `docs/ai-chats/`. Collects the transcripts of every worktree's project folder, not only the main checkout's. Done early, so no session is lost before the end | - |
| `ai-usage-notes` | Not a change but a running log, started now: concrete cases for `AI_USAGE.md` (what helped, what had to be fixed, especially around concurrency, what AI struggled with), written down as they happen | - |
| `concurrency-proof` | System-level stress and chaos test: several workers, a few hundred jobs of mixed priority, workers killed mid-job (`docker kill`) and stopped (`docker stop`); asserts every job finishes and none runs twice. Its numbers back `DECISIONS.md` sections 1 and 2 | milestone 5 |
| `test-review` | Review the per-app and system e2e suites against the testing rules (one file per spec area, coverage, flakiness) and check across all merged changes that every spec scenario has a test named after it; fix the gaps | all earlier milestones |
| `fix/job-execution-branch-tests` | Small fix: unit tests for the branches of `JobExecutionImpl` found untested in the `priority-scheduling` review: a read that fails with an unexpected error, an abort while reading, a start report given up after its retries, a handler that resolves after the abort, a completion or failure report refused with a conflict or not found, and the outcome of "Handler throws an unexpected error" | - |
| `fix/system-e2e-compose-project` | Small fix: a compose project name per worktree in `tests/system-e2e` (today every worktree uses `scaffold-e2e`), so parallel sessions running the system e2e do not collide and one session's teardown cannot remove another's stack | - |
| `duplication-check` | Find duplicated code across apps and packages and move it to the shared packages | all earlier milestones |
| `dead-code-cleanup` | Find and remove unused exports, files and dependencies | `duplication-check` |
| `dependency-audit` | Check dependencies and Docker base images for vulnerabilities and outdated versions, and update them | `dead-code-cleanup` |
| `security-pass` | Review the internal service token (documented dev default in compose), CORS, payload size limits and log redaction of secrets; fix the gaps | all earlier milestones |
| `demo-seed` | One command that fills a fresh stack with jobs of every type and status for a reviewer, plus a volume mode (thousands of jobs) to check list pagination and the indexes behind the pickup and list queries | all earlier milestones |
| `requirements-check` | Walk through the task PDF point by point, including its tips (small clean commits, the worker tested on its own), and fix any gap | all earlier milestones |
| `ui-polish` | Consistent, clean UI across all screens, including keyboard access, contrast and narrow screens | all earlier milestones |
| `job-list-more-filters` | Optional: more job list filters (e.g. priority, creation date range) in API and UI | `job-list-filters-ui` |
| `job-list-sort-order` | Optional: choose the job list's sort order in API and UI | `job-list-filters-ui` |
| `job-list-cursor-paging` | Optional: cursor-based paging of the job list, stable while jobs change, in API and UI | `job-list-sort-order` |
| `live-updates-sse` | Optional: push job updates to the UI with Server-Sent Events instead of polling | `job-ui-crud` |
| `flight-transit-real-data` | Optional, last: take aircraft transit data from a real external API next to the generated data; the generator stays the default and the fallback, and the API key is optional | `flight-transit-job-execution` |
| `submission-docs` | Final README, DECISIONS.md and AI_USAGE.md: Swagger examples for every job type, a green CI run on the final commit, and the `.claude/` spec-driven flow (hooks, verifier, TDD gate) presented in `AI_USAGE.md` | `requirements-check`, `concurrency-proof` |
| `fresh-clone-check` | Clone the repository into an empty folder and follow only the README: no `.env`, no cached images, default ports. Fix anything that needs knowledge the README does not give | `submission-docs` |

## Open questions

- [ ] Whether `live-updates-sse` fits in the time left (proposed: only if milestone 5 is done with
  time to spare; polling meets the task).
- [ ] `flight-transit-real-data`: which API; what happens when the API is unavailable; whether it is
  worth the risk for a reviewer running the stack without a key. Reverses the concept's "no external
  API" decision, so `DECISIONS.md` must say why.
- [ ] Tools for `duplication-check`, `dead-code-cleanup` and `dependency-audit` (chosen in each
  change; candidates: jscpd, knip, `npm audit` with Trivy).
- [ ] Tool for `concurrency-proof` (Playwright system e2e, a k6 script or a plain Node script).
- [ ] Job list extras: which further filters and sort keys; whether cursor paging replaces offset paging or sits next to it.
