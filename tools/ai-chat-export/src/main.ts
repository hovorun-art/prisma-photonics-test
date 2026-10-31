import { ExportChatsCommand } from './app/export/export-chats.command.js';
import { ChatExportImpl } from './infra/export/chat-export.impl.js';
import { PatternTextMask } from './infra/masking/pattern-text-mask.js';
import { FsExportFile } from './infra/output/fs-export-file.js';
import { MarkdownChatRenderer } from './infra/render/markdown-chat-renderer.js';
import { GitRepositoryInfo } from './infra/repository/git-repository-info.js';
import { ClaudeProjectFolders } from './infra/transcripts/claude-project-folders.js';
import { FerrySessionReader } from './infra/transcripts/ferry-session-reader.js';

const repository = new GitRepositoryInfo();
const { email } = await repository.userEmail();
const command = new ExportChatsCommand({
  export: new ChatExportImpl({
    repository,
    folders: new ClaudeProjectFolders(),
    reader: new FerrySessionReader(),
    renderer: new MarkdownChatRenderer(),
    mask: new PatternTextMask({ homeDir: repository.homeDir().path, email }),
    file: new FsExportFile(),
  }),
  repository,
  out: console,
});
const { exitCode } = await command.run({ args: process.argv.slice(2) });
process.exitCode = exitCode;
