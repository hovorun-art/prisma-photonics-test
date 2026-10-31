import type { ChatSession } from '../chat/chat-session.js';
import type { SessionTranscript } from './transcript-folders.js';

/** Reads one session transcript into its conversation. */
export interface SessionReader {
  read(req: ReadSessionReaderRequest): Promise<ReadSessionReaderResponse>;
}

export interface ReadSessionReaderRequest {
  transcript: SessionTranscript;
}

export interface ReadSessionReaderResponse {
  /** Undefined when the user wrote no message in the session. */
  session: ChatSession | undefined;
}
