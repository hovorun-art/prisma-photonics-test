import { en } from '@/locales';

/** The page job-ui shows until the job features arrive: it only states that the UI has started. */
export function AppShell() {
  return (
    <main className="p-6">
      <h1 className="text-2xl font-semibold">{en.appShell.name}</h1>
      <p className="mt-2 text-muted-foreground">{en.appShell.started}</p>
    </main>
  );
}
