import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { SubagentTranscript } from '../../domain/transcripts/transcript-folders.js';
import { FerrySessionReader } from './ferry-session-reader.js';

const STARTED_AT = '2026-10-30T20:54:36.035Z';

interface TranscriptBuilder {
  readonly sessionId: string;
  title(aiTitle: string): TranscriptBuilder;
  prompt(content: string): TranscriptBuilder;
  meta(content: string): TranscriptBuilder;
  reply(text: string): TranscriptBuilder;
  thinking(thinking: string): TranscriptBuilder;
  toolCall(call: { id: string; name: string; input: unknown }): TranscriptBuilder;
  toolResult(result: { toolUseId: string; content: string }): TranscriptBuilder;
  text(): string;
}

describe('FerrySessionReader', () => {
  let dir: string;
  const reader = new FerrySessionReader();

  /**
   * Builds transcript records shaped like the ones Claude Code 2.1 writes (only the fields the
   * reader depends on), chained through `parentUuid` like the real ones.
   */
  const transcript = (sidechain = false): TranscriptBuilder => {
    const sessionId = randomUUID();
    const lines: string[] = [];
    let parent: string | null = null;
    let seconds = 0;
    const record = (fields: Record<string, unknown>): TranscriptBuilder => {
      const uuid = randomUUID();
      const timestamp = new Date(Date.parse(STARTED_AT) + seconds * 1000).toISOString();
      seconds += 1;
      lines.push(
        JSON.stringify({
          parentUuid: parent,
          isSidechain: sidechain,
          uuid,
          timestamp,
          sessionId,
          cwd: '/work/my-repo',
          version: '2.1.314',
          ...fields,
        }),
      );
      parent = uuid;
      return builder;
    };
    const assistant = (content: unknown[]): TranscriptBuilder =>
      record({
        type: 'assistant',
        message: {
          id: `msg_${randomUUID()}`,
          type: 'message',
          role: 'assistant',
          model: 'claude-opus-5-5',
          content,
        },
      });
    const builder: TranscriptBuilder = {
      sessionId,
      title: (aiTitle) => {
        lines.push(JSON.stringify({ type: 'ai-title', aiTitle, sessionId }));
        return builder;
      },
      prompt: (content) => record({ type: 'user', message: { role: 'user', content } }),
      meta: (content) => record({ type: 'user', message: { role: 'user', content }, isMeta: true }),
      reply: (text) => assistant([{ type: 'text', text }]),
      thinking: (thinking) => assistant([{ type: 'thinking', thinking, signature: 'sig' }]),
      toolCall: ({ id, name, input }) => assistant([{ type: 'tool_use', id, name, input }]),
      toolResult: ({ toolUseId, content }) =>
        record({
          type: 'user',
          message: {
            role: 'user',
            content: [{ type: 'tool_result', tool_use_id: toolUseId, content }],
          },
        }),
      text: () => `${lines.join('\n')}\n`,
    };
    return builder;
  };

  const askUserQuestion = (questions: string[]) => ({
    questions: questions.map((question) => ({
      question,
      header: 'Question',
      multiSelect: false,
      options: [
        { label: 'First option', description: 'One way' },
        { label: 'Second option', description: 'Another way' },
      ],
    })),
  });

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'ai-chat-export-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const save = async (builder: TranscriptBuilder): Promise<string> => {
    const file = join(dir, `${randomUUID()}.jsonl`);
    await writeFile(file, builder.text());
    return file;
  };

  const read = async (builder: TranscriptBuilder, subagents: SubagentTranscript[] = []) => {
    const file = await save(builder);
    const { session } = await reader.read({ transcript: { file, worktree: 'job-api', subagents } });
    return session;
  };

  it('reads the id, worktree, start time and title of a session', async () => {
    const builder = transcript().title('Job API').prompt('build the job api');

    const session = await read(builder);

    expect(session).toMatchObject({
      id: builder.sessionId,
      worktree: 'job-api',
      startedAt: new Date(STARTED_AT),
      title: 'Job API',
    });
  });

  it('takes the first line of the first prompt as the title when there is none', async () => {
    const session = await read(transcript().prompt('build the job api\nwith tests'));

    expect(session?.title).toBe('build the job api');
  });

  it('Empty session is left out', async () => {
    const session = await read(
      transcript().title('Nothing').meta('Base directory for this skill: /x').reply('Hi'),
    );

    expect(session).toBeUndefined();
  });

  it('leaves out a transcript that holds no conversation at all', async () => {
    const session = await read(transcript().title('Only a title'));

    expect(session).toBeUndefined();
  });

  it('Prompts and replies are shown in order', async () => {
    const session = await read(
      transcript()
        .prompt('first prompt')
        .reply('first reply')
        .prompt('second prompt')
        .reply('second reply'),
    );

    expect(session?.turns).toEqual([
      { kind: 'prompt', text: 'first prompt' },
      { kind: 'reply', text: 'first reply' },
      { kind: 'prompt', text: 'second prompt' },
      { kind: 'reply', text: 'second reply' },
    ]);
  });

  it('joins consecutive replies between two prompts into one reply', async () => {
    const id = `toolu_${randomUUID()}`;
    const session = await read(
      transcript()
        .prompt('check it')
        .reply('Looking.')
        .toolCall({ id, name: 'Bash', input: { command: 'ls' } })
        .toolResult({ toolUseId: id, content: 'a.ts' })
        .reply('Found it.'),
    );

    expect(session?.turns).toEqual([
      { kind: 'prompt', text: 'check it' },
      { kind: 'reply', text: 'Looking.\n\nFound it.' },
    ]);
  });

  it('Tool calls, results and thinking are left out', async () => {
    const id = `toolu_${randomUUID()}`;
    const session = await read(
      transcript()
        .prompt('run the tests')
        .thinking('secret plan')
        .toolCall({ id, name: 'Bash', input: { command: 'npm test' } })
        .toolResult({ toolUseId: id, content: '42 tests passed' })
        .reply('All green.'),
    );

    expect(session?.turns).toEqual([
      { kind: 'prompt', text: 'run the tests' },
      { kind: 'reply', text: 'All green.' },
    ]);
  });

  it('Injected text is removed from a prompt', async () => {
    const session = await read(
      transcript().prompt(
        '<system-reminder>\nCodebase instructions\n</system-reminder>' +
          '<ide_opened_file>The user opened a.ts in the IDE.</ide_opened_file>' +
          '<ide_selection>const a = 1;</ide_selection>' +
          'add logs to the job page',
      ),
    );

    expect(session?.turns).toEqual([{ kind: 'prompt', text: 'add logs to the job page' }]);
  });

  it('Slash command is shown as typed', async () => {
    const session = await read(
      transcript()
        .prompt(
          '<command-message>archive</command-message>\n<command-name>/archive</command-name>\n' +
            '<command-args>job-group-create-ui</command-args>',
        )
        .prompt('<command-name>/model</command-name>\n<command-message>model</command-message>')
        .prompt(
          '<local-command-caveat>The command below was run directly in Claude Code.</local-command-caveat>',
        )
        .prompt('<local-command-stdout>Set model to `claude-fable-5-1`</local-command-stdout>'),
    );

    expect(session?.turns).toEqual([
      { kind: 'prompt', text: '/archive job-group-create-ui' },
      { kind: 'prompt', text: '/model' },
    ]);
  });

  it('Stop hook feedback is left out', async () => {
    const session = await read(
      transcript()
        .prompt('fix the build')
        .reply('Done.')
        .meta('Stop hook feedback:\nTypecheck, lint or tests are failing (round 1 of 3).')
        .reply('Fixed the lint error.'),
    );

    expect(session?.turns).toEqual([
      { kind: 'prompt', text: 'fix the build' },
      { kind: 'reply', text: 'Done.\n\nFixed the lint error.' },
    ]);
  });

  it('leaves out background task notifications and interruption notes', async () => {
    const session = await read(
      transcript()
        .prompt('start the stack')
        .reply('Started.')
        .prompt(
          '<task-notification>\n<task-id>b1</task-id>\n<status>completed</status>\n</task-notification>',
        )
        .prompt('[Request interrupted by user for tool use]')
        .reply('The stack is up.'),
    );

    expect(session?.turns).toEqual([
      { kind: 'prompt', text: 'start the stack' },
      { kind: 'reply', text: 'Started.\n\nThe stack is up.' },
    ]);
  });

  it('Question with its picked answer', async () => {
    const id = `toolu_${randomUUID()}`;
    const first = 'Which date input should the "At a specific time" field use?';
    const second = 'Where does the scheduled time show?';
    const session = await read(
      transcript()
        .prompt('plan the ui')
        .toolCall({ id, name: 'AskUserQuestion', input: askUserQuestion([first, second]) })
        .toolResult({
          toolUseId: id,
          content:
            `Your questions have been answered: "${first}"="Native "datetime-local" (Recommended)", ` +
            `"${second}"="Under the status". You can now continue with these answers in mind.`,
        }),
    );

    expect(session?.turns).toEqual([
      { kind: 'prompt', text: 'plan the ui' },
      {
        kind: 'questions',
        items: [
          { question: first, answer: 'Native "datetime-local" (Recommended)' },
          { question: second, answer: 'Under the status' },
        ],
      },
    ]);
  });

  it('reads answers given in the "The user answered" form', async () => {
    const id = `toolu_${randomUUID()}`;
    const question = 'What do you need?';
    const session = await read(
      transcript()
        .prompt('add logs')
        .toolCall({ id, name: 'AskUserQuestion', input: askUserQuestion([question]) })
        .toolResult({
          toolUseId: id,
          content:
            `The user answered: "${question}"="It exists. I just thought that it's missed". ` +
            'Read the answers carefully — they may request clarification, changes, or that you not proceed.',
        }),
    );

    expect(session?.turns[1]).toEqual({
      kind: 'questions',
      items: [{ question, answer: "It exists. I just thought that it's missed" }],
    });
  });

  it('Answer with a note', async () => {
    const id = `toolu_${randomUUID()}`;
    const question = 'Which layout?';
    const session = await read(
      transcript()
        .prompt('plan it')
        .toolCall({ id, name: 'AskUserQuestion', input: askUserQuestion([question]) })
        .toolResult({
          toolUseId: id,
          content:
            `Your questions have been answered: "${question}"="One file" user notes: keep it short. ` +
            'You can now continue with these answers in mind.',
        }),
    );

    expect(session?.turns[1]).toEqual({
      kind: 'questions',
      items: [{ question, answer: 'One file user notes: keep it short' }],
    });
  });

  it('shows a question without an answer when the user gave none', async () => {
    const id = `toolu_${randomUUID()}`;
    const question = 'Approve?';
    const session = await read(
      transcript()
        .prompt('plan it')
        .toolCall({ id, name: 'AskUserQuestion', input: askUserQuestion([question]) })
        .toolResult({ toolUseId: id, content: "The user doesn't want to proceed with this tool use." }),
    );

    expect(session?.turns[1]).toEqual({ kind: 'questions', items: [{ question, answer: '' }] });
  });

  it('Subagent conversation in a collapsed block', async () => {
    const id = `toolu_${randomUUID()}`;
    const subagentFile = await save(
      transcript(true).prompt('Review the tests of job-ui').thinking('reading').reply('Verdict: OK'),
    );

    const session = await read(
      transcript()
        .prompt('review it')
        .toolCall({
          id,
          name: 'Agent',
          input: { description: 'Review tests', subagent_type: 'test-case-reviewer' },
        })
        .toolResult({ toolUseId: id, content: 'Async agent launched successfully.' })
        .reply('The reviewer is running.'),
      [
        {
          file: subagentFile,
          agentType: 'test-case-reviewer',
          description: 'Review tests',
          startedBy: id,
        },
      ],
    );

    expect(session?.turns).toEqual([
      { kind: 'prompt', text: 'review it' },
      {
        kind: 'subagent',
        agentType: 'test-case-reviewer',
        description: 'Review tests',
        turns: [
          { kind: 'prompt', text: 'Review the tests of job-ui' },
          { kind: 'reply', text: 'Verdict: OK' },
        ],
      },
      { kind: 'reply', text: 'The reviewer is running.' },
    ]);
  });

  it("shows a subagent's hand-back report as its reply", async () => {
    const id = `toolu_${randomUUID()}`;
    const handback = `toolu_${randomUUID()}`;
    const subagentFile = await save(
      transcript(true)
        .prompt('Review the tests of job-ui')
        .toolCall({ id: handback, name: 'SubagentHandback', input: { message: '**Verdict:** GAPS' } })
        .toolResult({ toolUseId: handback, content: 'Delivered.' }),
    );

    const session = await read(
      transcript()
        .prompt('review it')
        .toolCall({ id, name: 'Agent', input: { description: 'Review tests' } }),
      [{ file: subagentFile, agentType: 'test-case-reviewer', description: 'Review tests', startedBy: id }],
    );

    expect(session?.turns[1]).toEqual({
      kind: 'subagent',
      agentType: 'test-case-reviewer',
      description: 'Review tests',
      turns: [
        { kind: 'prompt', text: 'Review the tests of job-ui' },
        { kind: 'reply', text: '**Verdict:** GAPS' },
      ],
    });
  });

  it('adds a subagent whose start is not found at the end of its session', async () => {
    const subagentFile = await save(transcript(true).prompt('Verify the change').reply('PASS'));

    const session = await read(transcript().prompt('verify').reply('Started.'), [
      {
        file: subagentFile,
        agentType: 'change-verifier',
        description: 'Verify change',
        startedBy: `toolu_${randomUUID()}`,
      },
    ]);

    expect(session?.turns.at(-1)).toEqual({
      kind: 'subagent',
      agentType: 'change-verifier',
      description: 'Verify change',
      turns: [
        { kind: 'prompt', text: 'Verify the change' },
        { kind: 'reply', text: 'PASS' },
      ],
    });
  });

  it('leaves out a subagent that holds no prompt', async () => {
    const id = `toolu_${randomUUID()}`;
    const subagentFile = await save(transcript(true).title('Nothing'));

    const session = await read(
      transcript()
        .prompt('review it')
        .toolCall({ id, name: 'Agent', input: { description: 'x' } }),
      [{ file: subagentFile, agentType: 'test-case-reviewer', description: 'x', startedBy: id }],
    );

    expect(session?.turns).toEqual([{ kind: 'prompt', text: 'review it' }]);
  });

  it('Message in another language is kept', async () => {
    const prompt = 'Додай логи на сторінку задачі'; // allow-non-english

    const session = await read(transcript().prompt(prompt).reply('Done.'));

    expect(session?.turns[0]).toEqual({ kind: 'prompt', text: prompt });
  });
});
