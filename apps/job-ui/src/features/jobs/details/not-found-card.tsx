import { Link } from 'react-router';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

/** A page's "not found" state: a title, a hint and a link back to its list. */
export function NotFoundCard({
  title,
  hint,
  to,
  linkLabel,
}: {
  title: string;
  hint: string;
  to: string;
  linkLabel: string;
}) {
  return (
    <Card className="items-center gap-3 px-5 py-14 text-center shadow-none">
      <h1 className="m-0 text-lg font-semibold">{title}</h1>
      <p className="m-0 text-[13px] text-muted-foreground">{hint}</p>
      <Button asChild variant="outline" className="no-underline">
        <Link to={to}>{linkLabel}</Link>
      </Button>
    </Card>
  );
}
