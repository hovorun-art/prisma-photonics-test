import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ClaudeProjectFolders } from './claude-project-folders.js';

const REPOSITORY_ROOT = '/work/my-repo';
const MAIN_FOLDER = '-work-my-repo';

describe('ClaudeProjectFolders', () => {
  let transcriptsDir: string;
  const folders = new ClaudeProjectFolders();

  beforeEach(async () => {
    transcriptsDir = await mkdtemp(join(tmpdir(), 'ai-chat-export-'));
  });

  afterEach(async () => {
    await rm(transcriptsDir, { recursive: true, force: true });
  });

  async function addSession(folder: string, id: string): Promise<string> {
    await mkdir(join(transcriptsDir, folder), { recursive: true });
    const file = join(transcriptsDir, folder, `${id}.jsonl`);
    await writeFile(file, '{}\n');
    return file;
  }

  async function list() {
    return folders.listSessions({ transcriptsDir, repositoryRoot: REPOSITORY_ROOT });
  }

  it('Session of the main checkout is exported', async () => {
    const file = await addSession(MAIN_FOLDER, randomUUID());

    const { sessions } = await list();

    expect(sessions).toEqual([{ file, worktree: 'main', subagents: [] }]);
  });

  it('Session of a worktree is exported', async () => {
    const file = await addSession(`${MAIN_FOLDER}-job-log-service`, randomUUID());

    const { sessions } = await list();

    expect(sessions).toEqual([{ file, worktree: 'job-log-service', subagents: [] }]);
  });

  it('Session of a removed worktree is exported', async () => {
    // The worktree's directory never existed on disk; only its transcript folder is left.
    const file = await addSession(`${MAIN_FOLDER}-removed-change`, randomUUID());

    const { sessions } = await list();

    expect(sessions).toEqual([{ file, worktree: 'removed-change', subagents: [] }]);
  });

  it('names an agent worktree inside .claude/worktrees after its path', async () => {
    const file = await addSession(`${MAIN_FOLDER}--claude-worktrees-agent-a1`, randomUUID());

    const { sessions } = await list();

    expect(sessions).toEqual([{ file, worktree: 'claude-worktrees-agent-a1', subagents: [] }]);
  });

  it('Session of another project is not exported', async () => {
    await addSession('-work-my', randomUUID());
    await addSession('-work-my-repository', randomUUID());
    await addSession('-work-other-repo', randomUUID());

    const { sessions } = await list();

    expect(sessions).toEqual([]);
  });

  it('lists only session transcripts, sorted by file path', async () => {
    const second = await addSession(`${MAIN_FOLDER}-b`, randomUUID());
    const first = await addSession(`${MAIN_FOLDER}-a`, randomUUID());
    await writeFile(join(transcriptsDir, `${MAIN_FOLDER}-a`, 'notes.md'), '# not a session\n');
    await mkdir(join(transcriptsDir, MAIN_FOLDER, 'memory'), { recursive: true });

    const { sessions } = await list();

    expect(sessions.map((s) => s.file)).toEqual([first, second]);
  });

  it('pairs each subagent transcript of a session with its meta', async () => {
    const sessionId = randomUUID();
    const file = await addSession(MAIN_FOLDER, sessionId);
    const subagentDir = join(transcriptsDir, MAIN_FOLDER, sessionId, 'subagents');
    await mkdir(subagentDir, { recursive: true });
    const toolUseId = `toolu_${randomUUID()}`;
    await writeFile(join(subagentDir, 'agent-a1.jsonl'), '{}\n');
    await writeFile(
      join(subagentDir, 'agent-a1.meta.json'),
      JSON.stringify({
        agentType: 'test-case-reviewer',
        description: 'Review the tests',
        toolUseId,
      }),
    );

    const { sessions } = await list();

    expect(sessions).toEqual([
      {
        file,
        worktree: 'main',
        subagents: [
          {
            file: join(subagentDir, 'agent-a1.jsonl'),
            agentType: 'test-case-reviewer',
            description: 'Review the tests',
            startedBy: toolUseId,
          },
        ],
      },
    ]);
  });

  it('leaves out a subagent transcript without meta, since it cannot be placed', async () => {
    const sessionId = randomUUID();
    const file = await addSession(MAIN_FOLDER, sessionId);
    const subagentDir = join(transcriptsDir, MAIN_FOLDER, sessionId, 'subagents');
    await mkdir(subagentDir, { recursive: true });
    await writeFile(join(subagentDir, 'agent-a1.jsonl'), '{}\n');

    const { sessions } = await list();

    expect(sessions).toEqual([{ file, worktree: 'main', subagents: [] }]);
  });

  it('finds no sessions when the transcript folder does not exist', async () => {
    const { sessions } = await folders.listSessions({
      transcriptsDir: join(transcriptsDir, 'missing'),
      repositoryRoot: REPOSITORY_ROOT,
    });

    expect(sessions).toEqual([]);
  });
});
