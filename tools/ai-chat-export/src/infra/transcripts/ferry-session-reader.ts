import { readFile } from 'node:fs/promises';

import { importThreads } from '@kontourai/ferry';

import type { AnsweredQuestion, ChatTurn } from '../../domain/chat/chat-session.js';
import type {
  ReadSessionReaderRequest,
  ReadSessionReaderResponse,
  SessionReader,
} from '../../domain/transcripts/session-reader.js';
import type { SubagentTranscript } from '../../domain/transcripts/transcript-folders.js';

type Thread = ReturnType<typeof importThreads>[number];
type Message = Thread['messages'][number];

/** Blocks Claude Code adds to a prompt; the user never typed them. */
const INJECTED_BLOCKS =
  /<(system-reminder|ide_opened_file|ide_selection|local-command-caveat|local-command-stdout|local-command-stderr|command-message)>[\s\S]*?<\/\1>/g;
/** Whole user turns that Claude Code writes itself. */
const SYSTEM_TURNS = [/^<task-notification>[\s\S]*<\/task-notification>$/, /^\[Request interrupted by user[^\]]*\]$/];
const COMMAND_NAME = /<command-name>([\s\S]*?)<\/command-name>/;
const COMMAND_ARGS = /<command-args>([\s\S]*?)<\/command-args>/;
/** The sentence Claude Code appends after the answers of `AskUserQuestion`. */
const ANSWERS_TAIL = /\.\s+(You can now continue|Read the answers carefully)[\s\S]*$/;
const SUBAGENT_TOOLS = new Set(['Agent', 'Task']);
/** A subagent hands its final report back to its session through this tool. */
const HANDBACK_TOOL = 'SubagentHandback';
const MAX_TITLE_LENGTH = 80;

/**
 * Reads a Claude Code session with `@kontourai/ferry` and keeps only the conversation: the
 * user's prompts, Claude's text replies, the questions Claude asked with their answers, and the
 * subagents the session started.
 */
export class FerrySessionReader implements SessionReader {
  async read(req: ReadSessionReaderRequest): Promise<ReadSessionReaderResponse> {
    const thread = await this.thread({ file: req.transcript.file, sidechain: false });
    if (thread === undefined) return { session: undefined };
    const turns = await this.turns({ thread, subagents: req.transcript.subagents });
    const firstPrompt = turns.find((turn) => turn.kind === 'prompt');
    if (firstPrompt === undefined) return { session: undefined };
    const title = this.title(thread) ?? this.firstLine(firstPrompt.text);
    return {
      session: {
        id: thread.id,
        worktree: req.transcript.worktree,
        startedAt: new Date(thread.createdAt),
        title,
        turns,
      },
    };
  }

  /**
   * Subagent transcripts mark every record as a side chain, which ferry skips; they are read as
   * a main chain instead. A file without a single user or assistant record gives no thread.
   */
  private async thread(req: { file: string; sidechain: boolean }): Promise<Thread | undefined> {
    const lines = (await readFile(req.file, 'utf8')).split('\n').filter((line) => line.trim() !== '');
    const records = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    if (!records.some((r) => r.type === 'user' || r.type === 'assistant')) return undefined;
    const content = req.sidechain
      ? records.map((r) => JSON.stringify({ ...r, isSidechain: false })).join('\n')
      : lines.join('\n');
    return importThreads(content, 'claude-code')[0];
  }

  private async turns(req: { thread: Thread; subagents: SubagentTranscript[] }): Promise<ChatTurn[]> {
    const results = this.toolResults(req.thread.messages);
    const placed = new Set<SubagentTranscript>();
    const turns: ChatTurn[] = [];
    for (const message of req.thread.messages) {
      if (message.role === 'user') {
        const text = this.promptText(this.text(message));
        if (text !== undefined) turns.push({ kind: 'prompt', text });
      } else if (message.role === 'assistant') {
        for (const part of message.content) {
          if (part.type === 'text') {
            this.addReply({ turns, text: part.text });
          } else if (part.type === 'tool_call' && part.toolCall.name === 'AskUserQuestion') {
            turns.push({
              kind: 'questions',
              items: this.answers({
                input: part.toolCall.parsedArguments,
                result: results.get(part.toolCall.id) ?? '',
              }),
            });
          } else if (part.type === 'tool_call' && part.toolCall.name === HANDBACK_TOOL) {
            this.addReply({ turns, text: this.handbackMessage(part.toolCall.parsedArguments) });
          } else if (part.type === 'tool_call' && SUBAGENT_TOOLS.has(part.toolCall.name)) {
            const subagent = req.subagents.find((s) => s.startedBy === part.toolCall.id);
            if (subagent === undefined) continue;
            placed.add(subagent);
            const turn = await this.subagentTurn(subagent);
            if (turn !== undefined) turns.push(turn);
          }
        }
      }
    }
    for (const subagent of req.subagents.filter((s) => !placed.has(s))) {
      const turn = await this.subagentTurn(subagent);
      if (turn !== undefined) turns.push(turn);
    }
    return turns;
  }

  private async subagentTurn(subagent: SubagentTranscript): Promise<ChatTurn | undefined> {
    const thread = await this.thread({ file: subagent.file, sidechain: true });
    if (thread === undefined) return undefined;
    const turns = await this.turns({ thread, subagents: [] });
    if (!turns.some((turn) => turn.kind === 'prompt')) return undefined;
    return { kind: 'subagent', agentType: subagent.agentType, description: subagent.description, turns };
  }

  /** Consecutive replies (split by tool calls Claude made in between) read as one. */
  private addReply(req: { turns: ChatTurn[]; text: string }): void {
    const text = req.text.trim();
    if (text === '') return;
    const last = req.turns.at(-1);
    if (last?.kind === 'reply') last.text = `${last.text}\n\n${text}`;
    else req.turns.push({ kind: 'reply', text });
  }

  /** What the user typed, or undefined for a turn Claude Code wrote itself. */
  private promptText(raw: string): string | undefined {
    const trimmed = raw.trim();
    if (SYSTEM_TURNS.some((pattern) => pattern.test(trimmed))) return undefined;
    const command = COMMAND_NAME.exec(trimmed);
    if (command?.[1] !== undefined) {
      const args = COMMAND_ARGS.exec(trimmed)?.[1]?.trim() ?? '';
      return args === '' ? command[1].trim() : `${command[1].trim()} ${args}`;
    }
    const text = trimmed.replace(INJECTED_BLOCKS, '').trim();
    return text === '' ? undefined : text;
  }

  /**
   * The result text lists the answers as `"<question>"="<answer>"`, in the order of the
   * questions. Cutting at the known question texts keeps quotes inside answers intact.
   */
  private answers(req: { input: unknown; result: string }): AnsweredQuestion[] {
    const questions = this.questions(req.input);
    const result = req.result.replace(ANSWERS_TAIL, '');
    return questions.map((question, index) => {
      const marker = `"${question}"="`;
      const start = result.indexOf(marker);
      if (start === -1) return { question, answer: '' };
      const next = questions[index + 1];
      const nextStart = next === undefined ? -1 : result.indexOf(`"${next}"="`, start);
      const segment = result
        .slice(start + marker.length, nextStart === -1 ? undefined : nextStart)
        .replace(/,\s*$/, '');
      return { question, answer: this.unquote(segment) };
    });
  }

  /** Drops the quote that closes the answer; text after it (a note) is kept. */
  private unquote(segment: string): string {
    const close = segment.lastIndexOf('"');
    if (close === -1) return segment.trim();
    const rest = segment.slice(close + 1).trim();
    const answer = segment.slice(0, close);
    return rest === '' ? answer : `${answer} ${rest}`;
  }

  private handbackMessage(input: unknown): string {
    if (typeof input !== 'object' || input === null || !('message' in input)) return '';
    return typeof input.message === 'string' ? input.message : '';
  }

  private questions(input: unknown): string[] {
    if (typeof input !== 'object' || input === null || !('questions' in input)) return [];
    const { questions } = input;
    if (!Array.isArray(questions)) return [];
    return questions.flatMap((q: unknown) =>
      typeof q === 'object' && q !== null && 'question' in q && typeof q.question === 'string'
        ? [q.question]
        : [],
    );
  }

  private toolResults(messages: Message[]): Map<string, string> {
    const results = new Map<string, string>();
    for (const message of messages) {
      if (message.role !== 'tool') continue;
      for (const result of message.toolResults) {
        results.set(
          result.toolCallId,
          result.content.map((part) => (part.type === 'text' ? part.text : '')).join(''),
        );
      }
    }
    return results;
  }

  private text(message: Message & { role: 'user' }): string {
    return message.content.map((part) => (part.type === 'text' ? part.text : '')).join('');
  }

  private title(thread: Thread): string | undefined {
    const title = thread.metadata?.title;
    return typeof title === 'string' && title.trim() !== '' ? title.trim() : undefined;
  }

  private firstLine(text: string): string {
    const line = text.split('\n')[0]?.trim() ?? '';
    return line.length > MAX_TITLE_LENGTH ? `${line.slice(0, MAX_TITLE_LENGTH - 1)}…` : line;
  }
}
