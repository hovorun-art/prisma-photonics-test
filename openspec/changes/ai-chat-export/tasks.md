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

- [ ] 1.1 Add the `tools/*` workspace group: `/package.json` `workspaces`, the `/vitest.config.ts`
  projects (`tools/*/vitest.config.ts`), and in `/tooling/eslint/config.mjs` the boundary includes,
  the domain framework-free rule and the `main.ts` free-function exemption for `tools/*/src`;
  verify `npm run lint` and `npm run typecheck` still pass.
- [ ] 1.2 Create the workspace `@job-queue/ai-chat-export` (`package.json` with `build`,
  `typecheck`, `lint`, `test` scripts; `tsconfig.json` / `tsconfig.build.json` on
  `tooling/tsconfig/library.json`; `vitest.config.ts` with `packageProjects('ai-chat-export')`) and
  add `@kontourai/ferry` at an exact version; verify `npm install` succeeds and
  `npm run build -w @job-queue/ai-chat-export` emits `dist/`.
- [ ] 1.3 Write the domain: `ChatSession` and `ChatTurn` types and the ports `RepositoryInfo`,
  `TranscriptFolders`, `SessionReader`, `TextMask`, `ChatRenderer`, `ExportFile` and the use case
  `ChatExport`, each with its Request/Response types and DI-style token (see design.md); verify the
  workspace typechecks and lints.

## 2. Transcripts: project folders, ferry reader, repository info

Owns: `src/infra/transcripts/**`, `src/infra/repository/**` · Depends on: 1 · Parallel with: 3, 4

- [ ] 2.1 Write failing tests for `ClaudeProjectFolders` (temporary folders built by the test) for
  the scenarios "Session of the main checkout is exported", "Session of a worktree is exported",
  "Session of a removed worktree is exported" and "Session of another project is not exported"
  (including the `...-prisma-photonics` sibling and a `--claude-worktrees-` agent folder), plus a
  session's subagent files paired with their meta; see them fail.
- [ ] 2.2 Implement `ClaudeProjectFolders`; verify 2.1 passes.
- [ ] 2.3 Write failing tests for `FerrySessionReader` on JSONL fixtures written by the test, for
  "Empty session is left out", "Prompts and replies are shown in order", "Tool calls, results and
  thinking are left out", "Injected text is removed from a prompt", "Slash command is shown as
  typed", "Stop hook feedback is left out" (also a lone task notification), "Question with its
  picked answer" (both result lead-ins, an answer containing quotes), "Answer with a note",
  "Subagent conversation in a collapsed block" (the `subagent` turn at the `Agent` call's place,
  with the subagent's own turns) and "Message in another language is kept"; see them fail.
- [ ] 2.4 Implement `FerrySessionReader` (title fallback to the first prompt line); verify 2.3
  passes.
- [ ] 2.5 Write failing tests for `GitRepositoryInfo` against a temporary git repository with a
  worktree (main root found from the worktree, `user.email` read); implement it; verify they pass.
- [ ] 2.6 Run the `test-case-reviewer` subagent on `tools/ai-chat-export` unit tests of
  `src/infra/transcripts` and `src/infra/repository`; add the missing cases it reports or note why
  they belong elsewhere.

## 3. Output: masking, Markdown renderer, export file

Owns: `src/infra/masking/**`, `src/infra/render/**`, `src/infra/output/**` · Depends on: 1 ·
Parallel with: 2, 4

- [ ] 3.1 Write failing tests for `PatternTextMask`: "Home path is masked", "Email is masked",
  "Secret-shaped text is masked" (Anthropic, GitHub, AWS key id, JWT, PEM private key) and
  "Development token stays" (`change-me-local-dev-token`, `e2e-service-token`, and a lower-case
  `akia…` look-alike that must stay); see them fail. Implement it; verify they pass.
- [ ] 3.2 Write failing tests for `MarkdownChatRenderer`: "Contents list every session oldest
  first" (renders in the order given, contents first), "Contents entry links to its session"
  (link target equals the session's anchor id), turns rendered as `### User` / `### Claude`,
  "Question with its picked answer" rendering, the subagent `<details>` block with its turns and
  the blank lines GitHub needs, English labels around non-English text, and identical output for
  identical input; see them fail. Implement it; verify they pass.
- [ ] 3.3 Write failing tests for `FsExportFile` in a temporary folder: the file holds exactly the
  given content, an existing file is replaced, and no temporary file is left behind; implement
  it; verify they pass.
- [ ] 3.4 Run the `test-case-reviewer` subagent on `tools/ai-chat-export` unit tests of
  `src/infra/masking`, `src/infra/render` and `src/infra/output`; add the missing cases it reports
  or note why they belong elsewhere.

## 4. Use case and command

Owns: `src/infra/export/**`, `src/app/**` · Depends on: 1 · Parallel with: 2, 3

- [ ] 4.1 Write failing tests for `ChatExportImpl` with `mockDeep` ports: sessions are read for
  every listed folder entry, "Empty session is left out" (reader returns none → not rendered),
  sessions sorted by start time then id before rendering, the rendered document is masked before
  it is written to `<main root>/AI_CHAT.md`, "Same transcripts give the same file" and "Vanished
  session disappears" (the whole file is rewritten from what is listed now), and the counts
  returned; see them fail. Implement it; verify they pass.
- [ ] 4.2 Write failing tests for `ExportChatsCommand`: "Transcript folder given on the command
  line" (`--transcripts <dir>` reaches the use case), the default `<home>/.claude/projects`, an
  unknown option rejected with a usage message, and the summary line printed; see them fail.
  Implement it; verify they pass.
- [ ] 4.3 Run the `test-case-reviewer` subagent on `tools/ai-chat-export` unit tests of
  `src/infra/export` and `src/app`; add the missing cases it reports or note why they belong
  elsewhere.

## 5. Integration

Owns: `src/main.ts`, `/package.json` (scripts), `/.claude/flow.conf`, `/CLAUDE.md`,
`/docs/concept.md`, `/docs/roadmap/07-final-polish.md`, `/README.md`, `/AI_CHAT.md` ·
Depends on: 2, 3, 4 · Parallel with: none

- [ ] 5.1 Write `src/main.ts` wiring the classes and add the root script `export:chats` (build the
  workspace, run `node tools/ai-chat-export/dist/main.js`, pass extra arguments through); verify
  `npm run export:chats -- --transcripts <temp folder with a fixture session>` writes the expected
  `AI_CHAT.md`.
- [ ] 5.2 Set `LANGUAGE_IGNORE` in `/.claude/flow.conf` to `AI_CHAT.md`; replace `docs/ai-chats/`
  with `AI_CHAT.md` in `/CLAUDE.md`, `/docs/concept.md` and the roadmap item; add a short "AI chat
  export" note with the command to `/README.md`; verify `grep -rn "docs/ai-chats"` finds nothing
  outside `openspec/` and the archive.
- [ ] 5.3 Run `npm run export:chats` on the real transcripts and check `AI_CHAT.md`: every
  session of the main checkout and the worktrees is listed, no tool output or system text shows,
  `grep` finds neither the home path nor the git email, and a second run leaves `git diff` of the
  file empty.
- [ ] 5.4 Run the full checks (`CHECK_CMDS` in `.claude/flow.conf`: typecheck, lint, test) and
  verify they pass.

## Workflow follow-up

- Run the `change-verifier` subagent; archive the change after PASS, on the `ai-chat-export`
  branch.
- Re-run `npm run export:chats` right before the final submission commit, so the last sessions are
  in `AI_CHAT.md`.
