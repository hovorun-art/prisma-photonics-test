# Spec Delta

## Purpose

Exports this project's Claude Code sessions (main checkout, every worktree and their subagents)
into one readable Markdown file, `AI_CHAT.md`, so the AI chat can be submitted with the code.

## ADDED Requirements

### Requirement: The export collects every session of this repository
The export SHALL read the Claude Code project folder of the repository's main checkout and the
project folder of every worktree of the repository, including worktrees that have since been
removed, and SHALL export each session found there together with its subagent transcripts. Project
folders of other projects SHALL NOT be exported.

#### Scenario: Session of the main checkout is exported
- **WHEN** the main checkout's project folder holds a session with a user prompt and the export runs
- **THEN** `AI_CHAT.md` contains that session

#### Scenario: Session of a worktree is exported
- **WHEN** the project folder of a worktree of the repository holds a session and the export runs
- **THEN** `AI_CHAT.md` contains that session, labelled with that worktree

#### Scenario: Session of a removed worktree is exported
- **WHEN** a worktree was removed but its project folder still holds a session and the export runs
- **THEN** `AI_CHAT.md` contains that session

#### Scenario: Session of another project is not exported
- **WHEN** the transcript folder also holds the project folder of another project (one whose path is not the repository or one of its worktrees) and the export runs
- **THEN** `AI_CHAT.md` contains none of that project's sessions

### Requirement: The transcript folder can be chosen
The export SHALL read transcripts from the user's Claude Code projects folder by default and SHALL
read them from another folder when one is given on the command line.

#### Scenario: Transcript folder given on the command line
- **WHEN** the export runs with a transcript folder given on the command line
- **THEN** the exported sessions are those of that folder

### Requirement: Sessions without a user prompt are left out
The export SHALL leave out a session in which the user wrote no message.

#### Scenario: Empty session is left out
- **WHEN** a session holds no message written by the user and the export runs
- **THEN** `AI_CHAT.md` neither shows that session nor lists it in its contents

### Requirement: One file with contents
The export SHALL write all sessions into the single file `AI_CHAT.md` in the repository root,
ordered by start time, oldest first. The file SHALL start with a table of contents that lists
every session with its date, worktree and title and links to that session in the file.

#### Scenario: Contents list every session oldest first
- **WHEN** the export runs on sessions that started at different times
- **THEN** `AI_CHAT.md` starts with contents that list each session with its date, worktree and title, oldest first, and the sessions follow in the same order

#### Scenario: Contents entry links to its session
- **WHEN** a reader follows a session's entry in the contents
- **THEN** the link leads to that session's heading in `AI_CHAT.md`

### Requirement: Each session shows the conversation only
An exported session SHALL show the user's prompts and Claude's text replies in order, each marked
with who wrote it. It SHALL NOT show tool calls, tool results, Claude's thinking or system
messages.

#### Scenario: Prompts and replies are shown in order
- **WHEN** a session with user prompts and Claude's text replies is exported
- **THEN** `AI_CHAT.md` shows each prompt and each reply in the order they were written, each marked as the user's or Claude's

#### Scenario: Tool calls, results and thinking are left out
- **WHEN** a session in which Claude ran tools and thought before replying is exported
- **THEN** `AI_CHAT.md` contains none of the tool calls, tool results or thinking

### Requirement: Prompts show what the user typed
An exported prompt SHALL NOT contain text that Claude Code injected into it (system reminders, IDE
selection notes, command caveats, background task notifications), and a slash command SHALL be
shown as the command the user typed, with its arguments.

#### Scenario: Injected text is removed from a prompt
- **WHEN** a prompt carries a system reminder or an IDE selection note next to the user's text
- **THEN** the exported prompt shows only the user's text

#### Scenario: Slash command is shown as typed
- **WHEN** the user ran a slash command with arguments
- **THEN** the exported prompt shows the command and its arguments as the user typed them

### Requirement: Hook feedback is left out
The export SHALL leave out hook feedback that Claude Code fed back to Claude as a user turn.

#### Scenario: Stop hook feedback is left out
- **WHEN** a session holds hook feedback fed back as a user turn
- **THEN** `AI_CHAT.md` does not show that feedback

### Requirement: Questions show the answers picked
When Claude asked the user questions, the exported session SHALL show each question with the
option the user picked and any note the user added, and SHALL NOT show the options that were not
picked.

#### Scenario: Question with its picked answer
- **WHEN** Claude asked a question with several options and the user picked one
- **THEN** `AI_CHAT.md` shows the question and the picked option, and none of the other options

#### Scenario: Answer with a note
- **WHEN** the user added a note or wrote their own answer
- **THEN** `AI_CHAT.md` shows that text with the answer

### Requirement: Subagents appear inline, collapsed
Where a session started a subagent, the exported session SHALL show, at that point, a collapsed
block titled with the subagent's type and short description that holds the subagent's
conversation, shown the same way as a session's.

#### Scenario: Subagent conversation in a collapsed block
- **WHEN** a session started a subagent whose transcript is stored with the session and the export runs
- **THEN** `AI_CHAT.md` shows, where the subagent was started, a collapsed block titled with the subagent's type and description that holds the subagent's prompt and replies

### Requirement: Personal data and secrets are masked
The export SHALL replace the user's home directory path with `~`, the email address configured as
the repository's git user with `<email>`, and text shaped like a real secret (Anthropic, GitHub or
AWS keys, JSON Web Tokens, private keys) with `<redacted>`. The documented development and test
tokens of the repository SHALL stay as they are.

#### Scenario: Home path is masked
- **WHEN** a message contains a path inside the user's home directory
- **THEN** `AI_CHAT.md` shows the path starting with `~` and never the home directory itself

#### Scenario: Email is masked
- **WHEN** a message contains the git user's email address
- **THEN** `AI_CHAT.md` shows `<email>` in its place

#### Scenario: Secret-shaped text is masked
- **WHEN** a message contains text shaped like an API key, a JSON Web Token or a private key
- **THEN** `AI_CHAT.md` shows `<redacted>` in its place

#### Scenario: Development token stays
- **WHEN** a message contains the repository's documented development service token
- **THEN** `AI_CHAT.md` shows the token unchanged

### Requirement: Messages are exported verbatim
The export SHALL keep each message's text as written, in whatever language it was written; the
headings and labels the export adds SHALL be English.

#### Scenario: Message in another language is kept
- **WHEN** a prompt written in a language other than English is exported
- **THEN** `AI_CHAT.md` shows the prompt's text unchanged, under English labels

### Requirement: A re-run rebuilds the export
Each run SHALL rewrite `AI_CHAT.md` from the current transcripts: the same transcripts SHALL give
the same file, and sessions that are no longer found SHALL disappear from it.

#### Scenario: Same transcripts give the same file
- **WHEN** the export runs twice on the same transcripts
- **THEN** the second run leaves `AI_CHAT.md` byte for byte the same as the first

#### Scenario: Vanished session disappears
- **WHEN** a session exported earlier is no longer in the transcript folder and the export runs again
- **THEN** `AI_CHAT.md` neither shows it nor lists it in its contents
