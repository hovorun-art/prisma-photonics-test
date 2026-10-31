/** Finds the Claude Code transcripts of the repository's main checkout and its worktrees. */
export interface TranscriptFolders {
  listSessions(
    req: ListSessionsTranscriptFoldersRequest,
  ): Promise<ListSessionsTranscriptFoldersResponse>;
}

export interface ListSessionsTranscriptFoldersRequest {
  /** Claude Code's projects folder (one subfolder per working directory). */
  transcriptsDir: string;
  /** The main checkout's absolute path. */
  repositoryRoot: string;
}

export interface ListSessionsTranscriptFoldersResponse {
  sessions: SessionTranscript[];
}

/** One session's transcript file and the transcripts of the subagents it started. */
export interface SessionTranscript {
  file: string;
  /** `main` for the main checkout, otherwise the worktree's name. */
  worktree: string;
  subagents: SubagentTranscript[];
}

export interface SubagentTranscript {
  file: string;
  agentType: string;
  description: string;
  /** Id of the parent session's tool call that started the subagent. */
  startedBy: string;
}
