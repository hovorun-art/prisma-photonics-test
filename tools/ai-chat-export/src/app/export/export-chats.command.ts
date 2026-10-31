import { join } from 'node:path';
import { parseArgs } from 'node:util';

import type { Command, RunCommandRequest, RunCommandResponse } from '../../domain/cli/command.js';
import type { ChatExport } from '../../domain/export/chat-export.js';
import type { RepositoryInfo } from '../../domain/repository/repository-info.js';

export interface ExportChatsCommandDeps {
  export: ChatExport;
  repository: RepositoryInfo;
  out: { log(message: string): void; error(message: string): void };
}

const USAGE = 'Usage: npm run export:chats [-- --transcripts <Claude Code projects folder>]';

/** `npm run export:chats`: writes AI_CHAT.md from the Claude Code transcripts. */
export class ExportChatsCommand implements Command {
  constructor(private readonly d: ExportChatsCommandDeps) {}

  async run(req: RunCommandRequest): Promise<RunCommandResponse> {
    let transcripts: string | undefined;
    try {
      transcripts = parseArgs({ args: req.args, options: { transcripts: { type: 'string' } } }).values
        .transcripts;
    } catch {
      this.d.out.error(USAGE);
      return { exitCode: 2 };
    }
    const transcriptsDir = transcripts ?? join(this.d.repository.homeDir().path, '.claude', 'projects');
    const result = await this.d.export.run({ transcriptsDir });
    this.d.out.log(`Wrote ${result.file}: ${result.sessions} sessions, ${result.subagents} subagents.`);
    return { exitCode: 0 };
  }
}
