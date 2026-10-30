# Milestone 7: Final check and polish

Everything the submission requires is in place and checked against the task: a clean UI, a README a
reviewer can follow, honest `DECISIONS.md` and `AI_USAGE.md`, and the AI chat transcripts.

## Changes

| Change | Intent | Depends on |
|---|---|---|
| `flight-transit-real-data` | Take aircraft transit data from a real external API instead of, or next to, the generated data | `flight-transit-job-execution` |
| `e2e-test-review` | Review the per-app and system e2e suites against the testing rules (one file per spec area, coverage, flakiness) and fix the gaps | all earlier milestones |
| `spec-test-trace` | Check that every spec scenario has a test named after it, and add the missing ones | all earlier milestones |
| `duplication-check` | Find duplicated code across apps and packages and move it to the shared packages | all earlier milestones |
| `dead-code-cleanup` | Find and remove unused exports, files and dependencies | `duplication-check` |
| `dependency-audit` | Check dependencies and Docker base images for vulnerabilities and outdated versions, and update them | `dead-code-cleanup` |
| `demo-seed` | One command that fills a fresh stack with jobs of every type and status for a reviewer | all earlier milestones |
| `requirements-check` | Walk through the task PDF point by point and fix any gap | all earlier milestones |
| `ui-polish` | Consistent, clean UI across all screens | all earlier milestones |
| `live-updates-sse` | Optional: push job updates to the UI with Server-Sent Events instead of polling | `job-ui-crud` |
| `ai-chat-export` | Script that converts Claude Code sessions into Markdown under `docs/ai-chats/` | - |
| `submission-docs` | Final README, DECISIONS.md and AI_USAGE.md | `requirements-check` |

## Open questions

- [ ] Whether `live-updates-sse` fits in the time left.
- [ ] `flight-transit-real-data`: which API; whether it replaces the generator or sits next to it
  with a fallback; what happens when the API is unavailable. Reverses the concept's "no external
  API" decision, so `DECISIONS.md` must say why.
- [ ] Tools for `duplication-check`, `dead-code-cleanup` and `dependency-audit` (chosen in each change).
