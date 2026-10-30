# Design

## Context

See proposal.md for why and decisions.md for every behaviour choice; the requirements are in
`specs/ai-chat-export/spec.md`.

What the transcripts look like (observed in `~/.claude/projects`, Claude Code 2.1.314):

- One project folder per working directory, named after the directory's absolute path with every
  character that is not a letter or digit replaced by `-`. The main checkout is
  `-Users-<user>-Dev-prisma-photonics-test`; worktrees are siblings
  (`...-prisma-photonics-test-<change>`), and agent worktrees inside `.claude/worktrees/` give
  `...-prisma-photonics-test--claude-worktrees-<name>`. Folders of removed worktrees stay. The
  earlier project `...-prisma-photonics` sits next to them and must not match.
- A session is `<session-id>.jsonl`. Its subagents are `<session-id>/subagents/agent-<id>.jsonl`,
  each with `agent-<id>.meta.json` holding `agentType`, `description` and `toolUseId` (the id of
  the parent's `Agent` tool call that started it).
- `@kontourai/ferry`'s `importThreads(content, 'claude-code')` returns a thread with Claude Code's
  own session title, timestamps and messages: user `text` parts, assistant `text` / `reasoning` /
  `tool_call` parts (`toolCall.id`, `name`, `parsedArguments`), and `tool` messages with
  `toolResults` (`toolCallId`, `content`). It already drops Claude Code's meta records (skill
  bodies, agent messages) but keeps `<task-notification>` turns, hook feedback and the injected
  tags inside prompts. It does not keep the structured `answers` of `AskUserQuestion`; the result
  text does (`... "<question>"="<answer>", ...`, with two observed lead-ins: "Your questions have
  been answered:" and "The user answered:").
- Node 26 strips types but does not transform them, so code with constructor parameter
  properties (the project's style) must be compiled with `tsc` before it runs, like the shared
  packages.
- Conversation-only text of this repository's sessions is about 0.7 MB, plus about 0.2 MB in
  subagents: one file of roughly 1 MB.

## Goals / Non-Goals

**Goals:**
- A small CLI workspace that follows the project's code style (layers, interfaces, deps objects,
  Request/Response), unit-tested without touching the real `~/.claude`.
- Deterministic output: no "generated at" stamp, stable order, stable anchors.

**Non-Goals:**
- Exporting other agents' formats, or other projects.
- Running automatically (hook, CI): the user runs it when they want a fresh export.
- Rendering tool output.

## Decisions

**Workspace `tools/ai-chat-export`.** A new top-level `tools/*` workspace group (added to the root
`workspaces`, the root `vitest.config.ts` projects and the ESLint boundary includes and domain
rules) rather than `packages/` (shared runtime libraries for the apps) or `tooling/` (configs,
exempt from the class rules). Layout as everywhere else: `src/domain`, `src/infra`, `src/app`,
`src/main.ts` (added to the free-function exemptions like `apps/*/src/main.ts`); unit tests
through `packageProjects('ai-chat-export')`. Built by `tsc -p tsconfig.build.json` into `dist/`.
Root script `npm run export:chats` builds the workspace and runs
`node tools/ai-chat-export/dist/main.js`; extra arguments pass through
(`npm run export:chats -- --transcripts <dir>`). Alternative: `tsx` to run the sources directly;
rejected, a new runtime dependency for one script when the packages already build with `tsc`.
`@kontourai/ferry` is pinned to an exact version (0.x).

**Domain (interfaces and types only):**
- `ChatSession` (value type): `id`, `worktree`, `startedAt`, `title`, `turns: ChatTurn[]`.
  `ChatTurn` is a union: `prompt { text }`, `reply { text }`, `questions { items: { question,
  answer }[] }`, `subagent { agentType, description, turns: ChatTurn[] }`.
- `RepositoryInfo` port: `mainRoot()` (the main checkout's path, also when run from a worktree),
  `userEmail()`, `homeDir()`.
- `TranscriptFolders` port: `listSessions({ transcriptsDir, repositoryRoot })` returns the session
  files of the matching project folders, each with its worktree name and its subagent files with
  their meta.
- `SessionReader` port: `read({ session })` returns a `ChatSession`, or none when the session has
  no user prompt.
- `TextMask` port: `mask({ text })`.
- `ChatRenderer` port: `render({ sessions })` returns the whole Markdown document.
- `ExportFile` port: `write({ path, content })`.
- `ChatExport` use case: `run({ transcriptsDir })` returns the counts written.

**Infra:**
- `GitRepositoryInfo`: `git rev-parse --path-format=absolute --git-common-dir` (its parent is the
  main root) and `git config user.email` through `node:child_process` `execFile`; `os.homedir()`.
- `ClaudeProjectFolders` (`node:fs/promises`): encodes the main root the way Claude Code does and
  keeps the folders whose name equals it (worktree `main`) or starts with it followed by `-`
  (worktree = the rest without leading `-`s). So removed worktrees still match and
  `...-prisma-photonics` does not.
- `FerrySessionReader`: `importThreads` on the file content, then maps messages to turns:
  - user `text` → `prompt`, after removing injected blocks (`<system-reminder>`,
    `<ide_selection>`, `<ide_opened_file>`, `<local-command-caveat>`, `<local-command-stdout>`)
    and turning `<command-name>/x</command-name>` with `<command-args>` into `/x args`. A user turn
    that is only a `<task-notification>`, hook feedback (`Stop hook feedback:`,
    `PreToolUse:…hook…`, `PostToolUse:…hook…`) or empty after cleaning is dropped.
  - assistant `text` → `reply`; `reasoning`, other `tool_call`s and `tool` messages are dropped.
  - `AskUserQuestion` call and its result → `questions`: the question texts come from the call's
    `parsedArguments.questions`, and each answer is the text between `"<question>"="` and the next
    question's marker (or the closing quote before the trailing sentence). Matching on the known
    question texts keeps quotes inside answers safe; free-text answers and notes stay as written.
  - `Agent` call whose id is a subagent's `toolUseId` → `subagent`, with the subagent file read
    the same way (its first prompt is the task the main agent gave it).
  - `startedAt` is the thread's `createdAt`; `title` is the thread title, or the first prompt's
    first line when there is none.
- `PatternTextMask` (params: `homeDir`, `email`): replaces the home path with `~`, the email with
  `<email>`, then secret patterns with `<redacted>`: `sk-ant-…`, GitHub tokens (`gh[pousr]_…`,
  `github_pat_…`), AWS access key ids (`AKIA…`, case-sensitive), JWTs (`eyJ….eyJ….…`) and PEM
  private key blocks. The repository's dev/test tokens match none of these and stay.
- `MarkdownChatRenderer`: `# AI chat` and one line on how the file was made, then `## Contents`
  (one list item per session: date, worktree, title linking to `#session-<id>`), then per session
  `<a id="session-<id>"></a>` and `## <title>` with a line of date (UTC), worktree and session id,
  then each turn: `### User` / `### Claude` with the text as written, `### Claude asked` with
  `- **<question>** → <answer>`, and a subagent as
  `<details><summary>Subagent <type>: <description></summary> … </details>` holding its turns
  (`#### User` / `#### Claude`, a blank line around the inner Markdown so GitHub renders it).
  Explicit anchors come from the session id, so a changed title never breaks a link.
- `FsExportFile`: writes `<main root>/AI_CHAT.md` in one go (write to a temporary file in the same
  folder, then rename), so an interrupted run never leaves half a file.
- `ChatExportImpl`: lists, reads, drops empty sessions, sorts by `startedAt` then id, renders,
  masks the rendered document, writes it.

**App:** `ExportChatsCommand` parses `--transcripts <dir>` with `node:util` `parseArgs` (default
`<home>/.claude/projects`), runs `ChatExport` and prints how many sessions and subagents were
written. `main.ts` wires the classes.

**Repository files:** `.claude/flow.conf` `LANGUAGE_IGNORE` becomes `(^|/)AI_CHAT\.md$`;
`.prettierignore` already ignores `*.md`, so no change there; `docs/ai-chats/` becomes
`AI_CHAT.md` in CLAUDE.md, `docs/concept.md` and the roadmap item; README gets a short "AI chat
export" note with the command.

**Tests:** unit tests per class with `mockDeep` ports (`ChatExportImpl`, `ExportChatsCommand`),
`PatternTextMask` and `MarkdownChatRenderer` on plain values; the fs, git and ferry adapters
against temporary folders and small JSONL fixtures written by the test itself (records shaped
like the observed ones: a prompt with injected tags, a slash command, hook feedback, a task
notification, a tool call and result, thinking, an `AskUserQuestion` call and result in both
lead-in formats, an `Agent` call with a subagent file and meta). No real transcripts in tests.

## Risks / Trade-offs

- [Claude Code changes its transcript format or tag names] → ferry absorbs the record format; the
  tag list and the answer format are ours, kept in `FerrySessionReader` and covered by fixture
  tests. A re-run after an update shows the damage at once in the diff of `AI_CHAT.md`.
- [ferry is 0.x] → exact version pinned; only `importThreads` and its thread types are used.
- [A ~1 MB Markdown file may be slow or not rendered in GitHub's file view] → it stays readable
  as raw text and in any editor; subagents are collapsed to keep the rendered view short.
- [Another project whose path starts with the repository path plus `-` would be exported] → none
  exists here; the rule is stated in the README note.
- [A secret in a shape the patterns do not know] → the user reviews the `AI_CHAT.md` diff before
  committing; the scan during planning found no real secrets.
- [Large transcripts (up to ~26 MB per session)] → read one file at a time; only the conversation
  is kept in memory.
