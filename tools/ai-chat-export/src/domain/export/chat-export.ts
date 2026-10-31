/** Use case: export the repository's Claude Code sessions into `AI_CHAT.md`. */
export interface ChatExport {
  run(req: RunChatExportRequest): Promise<RunChatExportResponse>;
}

export interface RunChatExportRequest {
  /** Claude Code's projects folder. */
  transcriptsDir: string;
}

export interface RunChatExportResponse {
  /** Absolute path of the written file. */
  file: string;
  sessions: number;
  subagents: number;
}
