import { Link } from 'react-router';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { en } from '@/locales';

/** Shown for an unknown or malformed group id. */
export function GroupNotFound() {
  return (
    <Card className="items-center gap-3 px-5 py-14 text-center shadow-none">
      <h1 className="m-0 text-lg font-semibold">{en.group.notFoundTitle}</h1>
      <p className="m-0 text-[13px] text-muted-foreground">{en.group.notFoundHint}</p>
      <Button asChild variant="outline" className="no-underline">
        <Link to="/groups">{en.group.backToGroups}</Link>
      </Button>
    </Card>
  );
}
