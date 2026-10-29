# Milestone 7: Final check and polish

Everything the submission requires is in place and checked against the task: a clean UI, a README a
reviewer can follow, honest `DECISIONS.md` and `AI_USAGE.md`, and the AI chat transcripts.

## Changes

| Change | Intent | Depends on |
|---|---|---|
| `requirements-check` | Walk through the task PDF point by point and fix any gap | all earlier milestones |
| `ui-polish` | Consistent, clean UI across all screens | all earlier milestones |
| `live-updates-sse` | Optional: push job updates to the UI with Server-Sent Events instead of polling | `job-ui-crud` |
| `ai-chat-export` | Script that converts Claude Code sessions into Markdown under `docs/ai-chats/` | - |
| `submission-docs` | Final README, DECISIONS.md and AI_USAGE.md | `requirements-check` |

## Open questions

- [ ] Whether `live-updates-sse` fits in the time left.
