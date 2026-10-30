import { Link } from 'react-router';

/** "<list> / <id>" above a details page (designs "JobDetail", "BatchJob"); the list part links back. */
export function Breadcrumb({
  label,
  parent,
  to,
  id,
}: {
  label: string;
  parent: string;
  to: string;
  id: string;
}) {
  return (
    <nav aria-label={label} className="flex gap-2 text-[13px] text-muted-foreground">
      <Link to={to} className="text-muted-foreground">
        {parent}
      </Link>
      <span aria-hidden="true">/</span>
      <span className="font-mono text-xs text-foreground">{id}</span>
    </nav>
  );
}
