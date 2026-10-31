/** One exported Claude Code session: the conversation only, in the order it happened. */
export interface ChatSession {
  id: string;
  /** `main` for the main checkout, otherwise the worktree's name. */
  worktree: string;
  startedAt: Date;
  title: string;
  turns: ChatTurn[];
}

export type ChatTurn = PromptTurn | ReplyTurn | QuestionsTurn | SubagentTurn;

/** What the user typed, without the text Claude Code injected into it. */
export interface PromptTurn {
  kind: 'prompt';
  text: string;
}

/** Claude's text reply. */
export interface ReplyTurn {
  kind: 'reply';
  text: string;
}

/** Questions Claude asked, each with the answer the user gave. */
export interface QuestionsTurn {
  kind: 'questions';
  items: AnsweredQuestion[];
}

export interface AnsweredQuestion {
  question: string;
  answer: string;
}

/** A subagent the session started, with the subagent's own conversation. */
export interface SubagentTurn {
  kind: 'subagent';
  agentType: string;
  description: string;
  turns: ChatTurn[];
}
