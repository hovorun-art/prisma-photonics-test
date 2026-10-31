# Proposal

## Why

The submission must include "Text / MD file/s containing your chat with the AI tool". The work
happened in many Claude Code sessions spread over the main checkout and one worktree per change,
and each of them keeps its transcript in its own Claude Code project folder. Today nothing collects
them. (Retention is not a risk: the user's Claude Code settings keep transcripts for 365 days.)

## What Changes

- A command, run from the repository root, that reads this project's Claude Code transcripts and
  writes them as one readable Markdown file, `AI_CHAT.md`, next to `AI_USAGE.md`. This replaces
  the folder `docs/ai-chats/` planned in the concept.
- It collects the transcripts of every worktree's project folder, not only the main checkout's.
- Running it again refreshes the export from the current transcripts.

## Capabilities

### New Capabilities
- None: an internal tool, so the change has no spec (`skip_specs: true`, user decision in
  decisions.md).

### Modified Capabilities
- None.

## Impact

- A new workspace for the script and its tests, and an npm script in the root `package.json`.
- New generated file `AI_CHAT.md`, excluded from the English-only check and from Prettier;
  `docs/ai-chats/` is replaced by `AI_CHAT.md` in CLAUDE.md, the concept and the roadmap.
- One new dev dependency: `@kontourai/ferry` (transcript reader).
- No change to the apps, the contracts or the running stack.
