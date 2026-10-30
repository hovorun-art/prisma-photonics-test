import type { JobType } from '@job-queue/contracts';
import { Link2, Mail, Plane } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '@/lib/class-names';
import { en } from '@/locales';

/** The type cards of "1. Job type" (the section names the group): Email, Webhook and Aircraft transit. */
export function JobTypePicker({
  selected,
  onSelect,
}: {
  selected: JobType;
  onSelect: (type: JobType) => void;
}) {
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-2.5">
      <TypeCard
        selected={selected === 'email'}
        onClick={() => {
          onSelect('email');
        }}
        icon={<Mail className="size-4" />}
        name={en.submit.types.email.name}
        description={en.submit.types.email.description}
      />
      <TypeCard
        selected={selected === 'webhook'}
        onClick={() => {
          onSelect('webhook');
        }}
        icon={<Link2 className="size-4" />}
        name={en.submit.types.webhook.name}
        description={en.submit.types.webhook.description}
      />
      <TypeCard
        selected={selected === 'flight-transit'}
        onClick={() => {
          onSelect('flight-transit');
        }}
        icon={<Plane className="size-4" />}
        name={en.submit.types.transit.name}
        description={en.submit.types.transit.description}
      />
    </div>
  );
}

function TypeCard({
  selected = false,
  onClick,
  icon,
  name,
  description,
}: {
  selected?: boolean;
  onClick?: () => void;
  icon: ReactNode;
  name: string;
  description: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        'flex w-full items-start gap-3 rounded-[10px] border bg-card p-3.5 text-left',
        selected ? 'border-[1.5px] border-primary bg-surface-muted' : 'border-border',
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'flex size-8 flex-none items-center justify-center rounded-md',
          selected ? 'bg-primary text-primary-foreground' : 'bg-secondary text-subtle-foreground',
        )}
      >
        {icon}
      </span>
      <span className="flex flex-col gap-0.5">
        <span className="font-semibold">{name}</span>
        <span className="text-[13px] text-muted-foreground">{description}</span>
      </span>
    </button>
  );
}
