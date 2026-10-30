import type { FlightTransitJob, FlightTransitJobResult } from '@job-queue/contracts';
import { Download, RotateCw } from 'lucide-react';
import { type ReactNode, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { en } from '@/locales';

import { ComingSoon } from '../app-frame/coming-soon';
import { CopyButton } from '../jobs/details/copy-button';
import { DeleteJobDialog } from '../jobs/details/delete-job-dialog';
import { JsonCard } from '../jobs/details/json-card';
import { useCurl } from '../jobs/hooks/use-curl';
import { useJobPresenter } from '../jobs/hooks/use-job-presenter';
import { LiveIndicator } from '../jobs/list/live-indicator';
import { StatusBadge } from '../jobs/list/status-badge';
import { TransitMap } from './transit-map';
import { useTransitReportPresenter } from './use-transit-report';
import { WaypointStrip } from './waypoint-strip';

/** A completed transit job: the one the report is shown for. */
export type ReportedTransitJob = FlightTransitJob & { result: FlightTransitJobResult };

/**
 * The page of a completed flight transit job (design "TransitReport"): the route as title, summary
 * tiles, the map with its waypoints, airport, aircraft and job cards, and the report JSON.
 */
export function TransitReport({
  job,
  connectionLost,
}: {
  job: ReportedTransitJob;
  connectionLost: boolean;
}) {
  const report = job.result;
  const presenter = useTransitReportPresenter();
  const jobPresenter = useJobPresenter();
  const curl = useCurl();
  const [selected, setSelected] = useState(0);
  const tiles = presenter.tiles({ report });
  const origin = presenter.airport({ airport: report.origin, at: report.departureAt });
  const destination = presenter.airport({ airport: report.destination, at: report.arrivalAt });
  const totalTime = jobPresenter.totalTime({ job }).text;
  const dateTime = (at: string | null) => (at ? jobPresenter.dateTime({ at }).text : en.job.notYet);
  const download = () => {
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = en.report.fileName(job.id);
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="m-0 text-2xl font-semibold tracking-tight">
              {presenter.title({ report }).text}
            </h1>
            <StatusBadge status={job.status} className="h-[26px] px-2.5 text-[13px]" />
            <span className="inline-flex h-[26px] items-center rounded-[6px] bg-secondary px-2.5 font-mono text-xs text-subtle-foreground">
              {en.jobTypes[job.type]}
            </span>
          </div>
          <div className="text-[13px] text-muted-foreground">
            {en.report.subtitle} · <span className="font-mono text-xs">{job.id}</span>
            {totalTime && <> · {en.report.generatedIn(totalTime)}</>}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <LiveIndicator connectionLost={connectionLost} />
          <Button variant="outline" className="h-10" onClick={download}>
            <Download aria-hidden="true" />
            {en.report.downloadJson}
          </Button>
          <ComingSoon>
            <Button variant="outline" className="h-10">
              <RotateCw aria-hidden="true" />
              {en.report.runAgain}
            </Button>
          </ComingSoon>
          <CopyButton
            text={curl.get({ id: job.id }).command}
            label={en.copy.copyAsCurl}
            className="h-10"
          />
          <DeleteJobDialog id={job.id} />
        </div>
      </header>

      <section
        aria-label={en.report.summaryLabel}
        className="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-3"
      >
        <Tile
          label={en.report.tiles.distance}
          value={tiles.distance}
          hint={en.report.tiles.distanceHint}
        />
        <Tile label={en.report.tiles.duration} value={tiles.duration} hint={tiles.times} />
        <Tile
          label={en.report.tiles.speed}
          value={tiles.groundSpeed}
          hint={en.report.tiles.speedHint}
        />
        <Tile label={en.report.tiles.cruise} value={tiles.cruise} />
      </section>

      <section
        aria-label={en.report.mapLabel}
        className="overflow-hidden rounded-xl border border-border bg-card"
      >
        <TransitMap report={report} selected={selected} onSelect={setSelected} />
        <WaypointStrip
          waypoints={report.waypoints.map((waypoint) => {
            const card = presenter.waypoint({ report, waypoint });
            return { name: card.name, time: card.time };
          })}
          selected={selected}
          onSelect={setSelected}
        />
      </section>

      <div className="flex flex-wrap items-start gap-5">
        <div className="grid min-w-0 flex-[999_1_560px] grid-cols-[repeat(auto-fit,minmax(260px,1fr))] gap-5">
          <InfoCard title={en.report.origin} eyebrow>
            <AirportHeading iata={report.origin.iata} name={report.origin.name} />
            <Rows
              rows={[
                [en.report.coordinates, origin.coordinates],
                [en.report.departure, origin.utc],
                [en.report.localTime, origin.local],
              ]}
            />
          </InfoCard>
          <InfoCard title={en.report.destination} eyebrow>
            <AirportHeading iata={report.destination.iata} name={report.destination.name} />
            <Rows
              rows={[
                [en.report.coordinates, destination.coordinates],
                [en.report.arrival, destination.utc],
                [en.report.localTime, destination.local],
              ]}
            />
          </InfoCard>
          {/* The path makes the report long; it scrolls inside the card, as the design keeps it short. */}
          <div className="col-span-full [&_pre]:max-h-96 [&_pre]:overflow-auto">
            <JsonCard
              title={en.job.result}
              value={report}
              note={presenter.pathPoints({ report }).text}
            />
          </div>
        </div>
        <aside className="flex min-w-0 flex-[1_1_300px] flex-col gap-5">
          <InfoCard title={en.report.aircraft}>
            <Rows
              rows={[
                [en.report.aircraftFields.flight, report.flight],
                [en.report.aircraftFields.type, report.aircraft.model],
                [en.report.aircraftFields.registration, report.aircraft.registration],
                [en.report.aircraftFields.dataSource, en.report.dataSource],
              ]}
            />
          </InfoCard>
          <InfoCard title={en.report.job}>
            <Rows
              rows={[
                [en.report.jobFields.priority, String(job.priority)],
                [en.report.jobFields.attempts, `${job.attempts} / ${job.maxAttempts}`],
                [en.report.jobFields.created, dateTime(job.createdAt)],
                [en.report.jobFields.started, dateTime(job.startedAt)],
                [en.report.jobFields.completed, dateTime(job.completedAt)],
              ]}
            />
          </InfoCard>
        </aside>
      </div>
    </>
  );
}

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-border bg-card px-4 py-3.5">
      <span className="text-[13px] text-muted-foreground">{label}</span>
      <span className="font-mono text-[22px] font-medium">{value}</span>
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </div>
  );
}

function InfoCard({
  title,
  eyebrow = false,
  children,
}: {
  title: string;
  eyebrow?: boolean;
  children: ReactNode;
}) {
  return (
    <Card role="region" aria-label={title} className="gap-2.5 px-5 py-4 shadow-none">
      {eyebrow ? (
        <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          {title}
        </span>
      ) : (
        <h2 className="m-0 text-[15px] font-semibold">{title}</h2>
      )}
      {children}
    </Card>
  );
}

function AirportHeading({ iata, name }: { iata: string; name: string }) {
  return (
    <div className="flex items-baseline gap-2.5">
      <span className="font-mono text-[22px] font-medium">{iata}</span>
      <span className="font-medium">{name}</span>
    </div>
  );
}

function Rows({ rows }: { rows: [string, string][] }) {
  return (
    <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[13px]">
      {rows.map(([key, value]) => (
        <div key={key} className="contents">
          <dt className="text-muted-foreground">{key}</dt>
          <dd className="m-0 text-right font-mono text-xs">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
