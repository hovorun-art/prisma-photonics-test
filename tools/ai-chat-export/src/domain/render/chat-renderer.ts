import type { ChatSession } from '../chat/chat-session.js';

/** Renders the exported sessions as one Markdown document. */
export interface ChatRenderer {
  render(req: RenderChatRendererRequest): RenderChatRendererResponse;
}

export interface RenderChatRendererRequest {
  /** In the order they appear in the document. */
  sessions: ChatSession[];
}

export interface RenderChatRendererResponse {
  markdown: string;
}
