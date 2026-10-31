# Tasks

## Plan

```
1 (workspace + domain) ──┬── 2 (transcripts: folders, ferry reader, git info)
                         ├── 3 (output: mask, renderer, file)
                         └── 4 (use case + command)
                                   └── 5 (integration: main.ts, npm script, docs, real run, checks)
```

Groups 2, 3 and 4 depend only on group 1's domain interfaces and could run in parallel. Group 5
needs all of them.

All paths below are relative to `tools/ai-chat-export/` unless they start at the repository root
(`/`).

## 1. Workspace and domain

Owns: `/package.json`, `/package-lock.json`, `/vitest.config.ts`, `/tooling/eslint/config.mjs`,
`package.json`, `tsconfig.json`, `tsconfig.build.json`, `vitest.config.ts`, `src/domain/**` ·
Depends on: none · Parallel with: none

- [x] 1.1 Add the `tools/*` workspace group: `/package.json` `workspaces`, the `/vitest.config.ts`
  projects (`tools/*/vitest.config.ts`), and in `/tooling/eslint/config.mjs` the boundary includes,
  the domain framework-free rule and the `main.ts` free-function exemption for `tools/*/src`;
  verify `npm run lint` and `npm run typecheck` still pass.
- [x] 1.2 Create the workspace `@job-queue/ai-chat-export` (`package.json` with `build`,
  `typecheck`, `lint`, `test` scripts; `tsconfig.json` / `tsconfig.build.json` on
  `tooling/tsconfig/library.json`; `vitest.config.ts` with `packageProjects('ai-chat-export')`) and
  add `@kontourai/ferry` at an exact version; verify `npm install` succeeds and
  `npm run build -w @job-queue/ai-chat-export` emits `dist/`.
- [x] 1.3 Write the domain: `ChatSession` and `ChatTurn` types and the ports `RepositoryInfo`,
  `TranscriptFolders`, `SessionReader`, `TextMask`, `ChatRenderer`, `ExportFile` and the use case
  `ChatExport`, each with its Request/Response types (no DI tokens: no container wires this CLI;
  `main.ts` builds the classes, see design.md); verify the
  workspace typechecks and lints.

## 2. Transcripts: project folders, ferry reader, repository info

Owns: `src/infra/transcripts/**`, `src/infra/repository/**` · Depends on: 1 · Parallel with: 3, 4

Tests: an internal tool, so only the transcript adapters (already written) and the masking are
tested; no `test-case-reviewer` runs (user decision, see decisions.md).

- [x] 2.1 Write failing tests for `ClaudeProjectFolders` (temporary folders built by the test): the
  main checkout, a worktree, a removed worktree, another project not exported (including the
  `...-prisma-photonics` sibling and a `--claude-worktrees-` agent folder), and a session's
  subagent files paired with their meta; see them fail.
- [x] 2.2 Implement `ClaudeProjectFolders`; verify 2.1 passes.
- [x] 2.3 Write failing tests for `FerrySessionReader` on JSONL fixtures written by the test:
  empty session left out, prompts and replies in order, tool calls / results / thinking left out,
  injected text removed, slash commands as typed, hook feedback and task notifications left out,
  questions with the picked answer (both result lead-ins, quotes in answers, a note), subagents
  in place with their own turns and their hand-back report, non-English text kept; see them fail.
- [x] 2.4 Implement `FerrySessionReader` (title fallback to the first prompt line, subagent files
  read as a main chain, `SubagentHandback` message as the subagent's reply); verify 2.3 passes.
- [x] 2.5 Implement `GitRepositoryInfo` (main root from `git rev-parse --git-common-dir`, `git
  config user.email`, `os.homedir()`); verify by typecheck and the real run in 5.3.

## 3. Output: masking, Markdown renderer, export file

Owns: `src/infra/masking/**`, `src/infra/render/**`, `src/infra/output/**` · Depends on: 1 ·
Parallel with: 2, 4

- [ ] 3.1 Write failing tests for `PatternTextMask`: home path → `~`, git email → `<email>`,
  secret-shaped text → `<redacted>` (Anthropic, GitHub, AWS key id, JWT, PEM private key), and the
  dev tokens (`change-me-local-dev-token`, `e2e-service-token`) unchanged; see them fail.
  Implement it; verify they pass.
- [ ] 3.2 Implement `MarkdownChatRenderer` (contents with anchor links, `### User` / `### Claude`,
  `### Claude asked`, subagents in `<details>` with the blank lines GitHub needs); verify by the
  real run in 5.3.
- [ ] 3.3 Implement `FsExportFile` (temporary file, then rename); verify by the real run in 5.3.

## 4. Use case and command

Owns: `src/infra/export/**`, `src/app/**` · Depends on: 1 · Parallel with: 2, 3

- [ ] 4.1 Implement `ChatExportImpl` (list, read, drop empty, sort by start time then id, render,
  mask, write `<main root>/AI_CHAT.md`, return the counts); verify by the real run in 5.3.
- [ ] 4.2 Implement `ExportChatsCommand` (`--transcripts <dir>`, default
  `<home>/.claude/projects`, usage message on an unknown option, summary line); verify by the real
  run in 5.3 and by one run with `--transcripts` pointing at a folder with no sessions.

## 5. Integration

Owns: `src/main.ts`, `/package.json` (scripts), `/.claude/flow.conf`, `/CLAUDE.md`,
`/docs/concept.md`, `/docs/roadmap/07-final-polish.md`, `/README.md`, `/AI_CHAT.md` ·
Depends on: 2, 3, 4 · Parallel with: none

- [ ] 5.1 Write `src/main.ts` wiring the classes and add the root script `export:chats` (build the
  workspace, run `node tools/ai-chat-export/dist/main.js`, pass extra arguments through); verify
  `npm run export:chats` runs.
- [ ] 5.2 Set `LANGUAGE_IGNORE` in `/.claude/flow.conf` to `AI_CHAT.md`; replace `docs/ai-chats/`
  with `AI_CHAT.md` in `/CLAUDE.md`, `/docs/concept.md` and the roadmap item; add a short "AI chat
  export" note with the command to `/README.md`; verify `grep -rn "docs/ai-chats"` finds nothing
  outside `openspec/` and the archive.
- [ ] 5.3 Run `npm run export:chats` on the real transcripts and check `AI_CHAT.md`: every
  session of the main checkout and the worktrees is listed, no tool output or system text shows,
  `grep` finds neither the home path nor the git email, questions show their answers, subagents
  sit in collapsed blocks, the contents links jump to their sessions, and a second run leaves the
  file byte for byte the same.
- [ ] 5.4 Run the full checks (`CHECK_CMDS` in `.claude/flow.conf`: typecheck, lint, test) and
  verify they pass.

## Workflow follow-up

- No `change-verifier` run (user decision: internal tool); archive the change right after group 5
  is committed, on the `ai-chat-export` branch.
- Re-run `npm run export:chats` right before the final submission commit, so the last sessions are
  in `AI_CHAT.md`.
