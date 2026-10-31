import { join } from 'node:path';

import type { ChatSession } from '../../domain/chat/chat-session.js';
import type {
  ChatExport,
  RunChatExportRequest,
  RunChatExportResponse,
} from '../../domain/export/chat-export.js';
import type { TextMask } from '../../domain/masking/text-mask.js';
import type { ExportFile } from '../../domain/output/export-file.js';
import type { ChatRenderer } from '../../domain/render/chat-renderer.js';
import type { RepositoryInfo } from '../../domain/repository/repository-info.js';
import type { SessionReader } from '../../domain/transcripts/session-reader.js';
import type { TranscriptFolders } from '../../domain/transcripts/transcript-folders.js';

export interface ChatExportImplDeps {
  repository: RepositoryInfo;
  folders: TranscriptFolders;
  reader: SessionReader;
  renderer: ChatRenderer;
  mask: TextMask;
  file: ExportFile;
}

const EXPORT_FILE = 'AI_CHAT.md';

export class ChatExportImpl implements ChatExport {
  constructor(private readonly d: ChatExportImplDeps) {}

  async run(req: RunChatExportRequest): Promise<RunChatExportResponse> {
    const { path: root } = await this.d.repository.mainRoot();
    const { sessions: transcripts } = await this.d.folders.listSessions({
      transcriptsDir: req.transcriptsDir,
      repositoryRoot: root,
    });
    const sessions: ChatSession[] = [];
    for (const transcript of transcripts) {
      const { session } = await this.d.reader.read({ transcript });
      if (session !== undefined) sessions.push(session);
    }
    sessions.sort(
      (a, b) => a.startedAt.getTime() - b.startedAt.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
    const { markdown } = this.d.renderer.render({ sessions });
    const file = join(root, EXPORT_FILE);
    await this.d.file.write({ path: file, content: this.d.mask.mask({ text: markdown }).text });
    const subagents = sessions.reduce(
      (count, s) => count + s.turns.filter((t) => t.kind === 'subagent').length,
      0,
    );
    return { file, sessions: sessions.length, subagents };
  }
}
