# Decisions: ai-chat-export

## Decided

- The export is a script we write that converts Claude Code sessions into Markdown, and it collects the transcripts of every worktree's project folder, not only the main checkout's. (user, roadmap item `ai-chat-export`)
- Transcript reader: `@kontourai/ferry` (~13.3k weekly downloads, v0.6.0 of 2026-08-25, ESM, bundled TypeScript types, Apache-2.0; reads Claude Code transcripts into its thread model and streams large files). Chosen over `cc-session-io` (~36.7k weekly, v0.4.0, reads records only) and a hand-written JSONL reader. Its own Markdown export prints every tool call and result in full (about 400 KB for one session), so the script renders the thread itself. (user)
- Sessions exported: this repository's main checkout and every other worktree's project folder (`prisma-photonics-test-*`), with their subagent transcripts (verifier, test reviewer, parallel group workers). The earlier `prisma-photonics` project folder is not exported. (user)
- Each session shows the conversation only: the user's prompts, Claude's text replies, and the questions Claude asked with the answers picked; no tool calls, tool results, thinking or system messages. (user)
- ~~Layout: one Markdown file per session plus an index in `docs/ai-chats/`~~ - replaced: the export is one single file, `AI_CHAT.md` in the repository root, next to `AI_USAGE.md` (the task asks for "Text / MD file/s containing your chat with the AI tool"); no folder. (user)
- The file starts with a table of contents (date, worktree, title per session, oldest first) linking to each session's heading. (user)
- A subagent's conversation appears inline where its session started it, in a collapsed `<details>` block titled with the subagent's type and short description. (user)
- Masking: the home directory path becomes `~`, the user's email address becomes `<email>`, and anything shaped like a real secret (Anthropic, GitHub and AWS keys, JWTs, private keys) becomes `<redacted>`. The documented dev and test tokens stay, since they are in the repository anyway. (user)
- Running the export again rewrites `AI_CHAT.md` from scratch: the same transcripts give the same file, and sessions that no longer exist disappear from it (user confirmed assumption, adapted to the single file)
- Sessions are ordered by their start time, oldest first, in the contents and in the file (user confirmed assumption, adapted to the single file)
- Messages are exported verbatim, in whatever language they were written; the headings and labels the script adds are English (user confirmed assumption)
- A session with no message from the user (an empty or immediately aborted session) is left out (user confirmed assumption)
- The transcript folder defaults to `~/.claude/projects` and can be overridden by a command-line option (user confirmed assumption)
- Text that Claude Code injects into a prompt (system reminders, IDE selection notes, command caveats) is removed, and a slash command is shown as the command the user typed (`/apply job-api`) (user confirmed assumption)
- Hook feedback that Claude Code feeds back as a user turn (e.g. "Stop hook feedback: ...") is left out, like other system messages (user confirmed assumption)
- A question Claude asked is shown as each question with the option the user picked and any note they added; the options not picked are left out (user confirmed assumption)
- The email address to mask is read from the repository's git `user.email`, and the home path from the operating system (user confirmed assumption)
- ~~The change has a spec~~ - replaced: the export is an internal tool kept as simple as possible; the change has no spec (`skip_specs`), and tests are limited to the transcript adapters already written and the masking; no `test-case-reviewer` runs and no `change-verifier` run. (user)
- ~~Title slug in file names: `@sindresorhus/slugify`~~ - chosen by the user (~6.3M weekly, v3.0.1), then made unnecessary by the single file; see Assumed. (user)
- `@sindresorhus/slugify` is dropped: with one file there are no file names to build, and the contents link to explicit anchors (`<a id="...">` from the session id) instead of GitHub's generated heading ids (user confirmed assumption)
- `AI_CHAT.md` is added to the English-only check's `LANGUAGE_IGNORE` (in place of `docs/ai-chats/`) and to `.prettierignore`, and `docs/ai-chats/` is replaced by `AI_CHAT.md` in CLAUDE.md, the concept and the roadmap (user confirmed assumption)

## Assumed

- [x] Running the export again rebuilds the export from scratch: the same transcripts give the same files, and files of sessions that no longer exist are removed - a re-run must never leave stale or duplicated files.
- [x] Sessions are ordered by their start time, oldest first, in the contents and in the file - the reader follows the project in the order it was built.
- [x] Messages are exported verbatim, in whatever language they were written; the headings and labels the script adds are English - the export file is exempt from the English-only check.
- [x] A session with no message from the user (an empty or immediately aborted session) is left out - it carries nothing for the reader.
- [x] The transcript folder defaults to `~/.claude/projects` and can be overridden by a command-line option - so tests and other machines can point it elsewhere.
- [x] Text that Claude Code injects into a prompt (system reminders, IDE selection notes, command caveats) is removed, and a slash command is shown as the command the user typed (`/apply job-api`) - the reader sees what the user wrote.
- [x] Hook feedback that Claude Code feeds back as a user turn (e.g. "Stop hook feedback: ...") is left out, like other system messages - it is not something the user wrote.
- [x] A question Claude asked is shown as each question with the option the user picked and any note they added; the options not picked are left out - keeps the decision readable.
- [x] ~~Where a session started a subagent, its file shows one line with the agent type, its short description and a link to the subagent's file~~ - replaced by the inline collapsed block (single file).
- [x] The email address to mask is read from the repository's git `user.email`, and the home path from the operating system - nothing personal is written into the script or its config.
- [x] The change has a spec (`ai-chat-export`), since the export's output is observable and every scenario gets a test named after it.
- [x] `@sindresorhus/slugify` is dropped: with one file there are no file names to build, and the contents link to explicit anchors (`<a id="...">` from the session id) instead of GitHub's generated heading ids - no dependency for nothing, and links that do not break when a title changes.
- [x] `AI_CHAT.md` is added to the English-only check's `LANGUAGE_IGNORE` (in place of `docs/ai-chats/`) and to `.prettierignore`, and `docs/ai-chats/` is replaced by `AI_CHAT.md` in CLAUDE.md, the concept and the roadmap - the generated file holds messages in other languages, and Prettier must not reformat the output (`npm run format:check` would fail on it).

## Open questions

- [x] Transcript reader: which library, or none (see the candidates in the question)?
- [x] Which sessions go in: only this repository's folders (main checkout and every `prisma-photonics-test-*` worktree), or also the earlier `prisma-photonics` project folder (8 sessions, 2026-10-23 to 26)? Are subagent transcripts (verifier, test reviewer, parallel group workers) exported too?
- [x] What each exported session shows: user prompts and Claude's replies for sure; what about tool calls, tool results, thinking, and hook feedback / system messages?
- [x] Output layout: one file per session, plus an index? Where do subagent transcripts go? (answered, then changed by the user to one single file)
- [x] What is masked: the home directory path, the user's email address, tokens and keys?
