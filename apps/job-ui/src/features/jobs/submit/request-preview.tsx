import type { CreateEmailJobRequest } from '@job-queue/contracts';
import type { z } from 'zod';

import { en } from '@/locales';

import { CopyButton } from '../details/copy-button';
import { useCurl } from '../hooks/use-curl';

type EmailRequest = z.input<typeof CreateEmailJobRequest>;

/** The request the form will send as a curl command, and an example of the API's answer. */
export function RequestPreview({ request }: { request: EmailRequest }) {
  const curl = useCurl();
  const command = curl.submit({ request: { priority: 0, maxAttempts: 0, ...request } }).command;
  const example = {
    id: en.submit.placeholderId,
    type: request.type,
    status: 'pending',
    priority: request.priority,
    attempts: 0,
    maxAttempts: request.maxAttempts,
    payload: request.payload,
    createdAt: en.submit.placeholderTime,
  };
  return (
    <aside className="flex min-w-0 flex-[1_1_360px] flex-col gap-3">
      <section
        aria-label={en.submit.request}
        className="overflow-hidden rounded-xl bg-primary text-[#E8E8E6]"
      >
        <div className="flex items-center justify-between border-b border-[#2E2E33] px-4 py-3">
          <h2 className="m-0 text-[13px] font-medium">{en.submit.request}</h2>
          <CopyButton
            text={command}
            label={en.copy.copyCurl}
            size="sm"
            className="h-[30px] border-[#3A3A40] bg-transparent text-xs text-[#E8E8E6] hover:bg-white/10 hover:text-white"
          />
        </div>
        <pre className="m-0 p-4 font-mono text-xs leading-relaxed break-words whitespace-pre-wrap">
          {command}
        </pre>
      </section>
      <section
        aria-label={en.submit.response}
        className="overflow-hidden rounded-xl border border-border bg-card"
      >
        <div className="flex flex-wrap items-center gap-2 border-b border-border-soft px-4 py-3 text-[13px] font-medium">
          <h2 className="m-0 text-[13px] font-medium">{en.submit.response}</h2>
          <span className="rounded bg-[#E8F5EC] px-1.5 py-0.5 font-mono text-xs text-[#13703A]">
            {en.submit.created}
          </span>
          <span className="rounded bg-secondary px-1.5 py-0.5 text-xs text-subtle-foreground">
            {en.submit.example}
          </span>
        </div>
        <pre className="m-0 p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap">
          {JSON.stringify(example, null, 2)}
        </pre>
      </section>
    </aside>
  );
}
