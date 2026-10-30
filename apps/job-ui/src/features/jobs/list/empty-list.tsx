import type { ReactNode } from 'react';

/** A list with nothing to show: a title, a hint and an optional action below them. */
export function EmptyList({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-5 py-14 text-center">
      <div className="font-medium">{title}</div>
      <div className="text-[13px] text-muted-foreground">{hint}</div>
      {children}
    </div>
  );
}
