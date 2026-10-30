import { Link2, Mail, Plane } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '@/lib/class-names';
import { en } from '@/locales';

import { ComingSoon } from '../../app-frame/coming-soon';

/** The type cards of "1. Job type" (the section names the group): Email is the only type built yet; the others are shown disabled. */
export function JobTypePicker() {
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-2.5">
      <TypeCard
        selected
        icon={<Mail className="size-4" />}
        name={en.submit.types.email.name}
        description={en.submit.types.email.description}
      />
      <ComingSoon className="w-full">
        <TypeCard
          icon={<Link2 className="size-4" />}
          name={en.submit.types.webhook.name}
          description={en.submit.types.webhook.description}
        />
      </ComingSoon>
      <ComingSoon className="w-full">
        <TypeCard
          icon={<Plane className="size-4" />}
          name={en.submit.types.transit.name}
          description={en.submit.types.transit.description}
        />
      </ComingSoon>
    </div>
  );
}

function TypeCard({
  selected = false,
  icon,
  name,
  description,
}: {
  selected?: boolean;
  icon: ReactNode;
  name: string;
  description: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
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
