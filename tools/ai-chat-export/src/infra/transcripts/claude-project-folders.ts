import type { Dirent } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type {
  ListSessionsTranscriptFoldersRequest,
  ListSessionsTranscriptFoldersResponse,
  SessionTranscript,
  SubagentTranscript,
  TranscriptFolders,
} from '../../domain/transcripts/transcript-folders.js';

const SESSION_EXTENSION = '.jsonl';
const META_EXTENSION = '.meta.json';

/**
 * Claude Code keeps one project folder per working directory, named after its absolute path with
 * every character that is not a letter or digit replaced by `-`. The main checkout's folder and
 * the folders that extend its name with `-<name>` (sibling worktrees, `.claude/worktrees/<name>`)
 * belong to the repository, also after the worktree itself was removed.
 */
export class ClaudeProjectFolders implements TranscriptFolders {
  async listSessions(
    req: ListSessionsTranscriptFoldersRequest,
  ): Promise<ListSessionsTranscriptFoldersResponse> {
    const mainFolder = req.repositoryRoot.replace(/[^a-zA-Z0-9]/g, '-');
    const sessions: SessionTranscript[] = [];
    for (const folder of await this.entries(req.transcriptsDir)) {
      if (!folder.isDirectory()) continue;
      const worktree = this.worktreeOf({ folder: folder.name, mainFolder });
      if (worktree === undefined) continue;
      sessions.push(...(await this.sessionsIn({ dir: join(req.transcriptsDir, folder.name), worktree })));
    }
    sessions.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
    return { sessions };
  }

  private worktreeOf(req: { folder: string; mainFolder: string }): string | undefined {
    if (req.folder === req.mainFolder) return 'main';
    if (!req.folder.startsWith(`${req.mainFolder}-`)) return undefined;
    return req.folder.slice(req.mainFolder.length).replace(/^-+/, '');
  }

  private async sessionsIn(req: { dir: string; worktree: string }): Promise<SessionTranscript[]> {
    const sessions: SessionTranscript[] = [];
    for (const entry of await this.entries(req.dir)) {
      if (!entry.isFile() || !entry.name.endsWith(SESSION_EXTENSION)) continue;
      const id = entry.name.slice(0, -SESSION_EXTENSION.length);
      sessions.push({
        file: join(req.dir, entry.name),
        worktree: req.worktree,
        subagents: await this.subagentsIn(join(req.dir, id, 'subagents')),
      });
    }
    return sessions;
  }

  private async subagentsIn(dir: string): Promise<SubagentTranscript[]> {
    const subagents: SubagentTranscript[] = [];
    const names = (await this.entries(dir)).filter((e) => e.isFile()).map((e) => e.name);
    for (const name of names.filter((n) => n.endsWith(SESSION_EXTENSION)).sort()) {
      const metaName = `${name.slice(0, -SESSION_EXTENSION.length)}${META_EXTENSION}`;
      if (!names.includes(metaName)) continue;
      const meta = JSON.parse(await readFile(join(dir, metaName), 'utf8')) as Partial<SubagentMeta>;
      subagents.push({
        file: join(dir, name),
        agentType: meta.agentType ?? 'subagent',
        description: meta.description ?? '',
        startedBy: meta.toolUseId ?? '',
      });
    }
    return subagents;
  }

  private async entries(dir: string): Promise<Dirent[]> {
    try {
      return await readdir(dir, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
  }
}

interface SubagentMeta {
  agentType: string;
  description: string;
  toolUseId: string;
}
