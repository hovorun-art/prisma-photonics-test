# UI: job-group-ui

## Sources

- Group details page (`/groups/:id`): design artifact "Job Queue — UI"
  (claude.ai artifact `2c72083e-7fe0-4c29-a748-b0672b62866e`), file `project/BatchJob.dc.html`. It
  is HTML with inline styles, so its values are exact ("seen"), not measured from pixels. Preview
  size 1440×1280.
- Groups list page (`/groups`): no own design; it follows the jobs list page (`project/Main.dc.html`,
  already built in `features/jobs/list`).
- The design shows one batch job; this page adapts it to a group. Parts with no counterpart for a
  group are dropped (see "Mapping").

## Inventory: BatchJob (group details)

Layout (seen): the app frame header; `main` max width 1280px, padding 24px 24px 56px, column with
20px gap. Below the title row, two columns that wrap: main `flex: 999 1 560px`, aside
`flex: 1 1 300px`, gap 20px. Page background `#F7F7F5`, text `#17171A`, Inter 14px/1.45; numbers
and ids in JetBrains Mono.

Top to bottom (seen):
1. Breadcrumb: "Jobs / j_8h1q7z", 13px `#5C5C63`, id in mono 12px `#17171A`.
2. Title row: H1 id mono 22px weight 500; status badge (pill, 26px high, `#EBEFFD` / `#1F3FC4`
   for processing); type badge "batch"; on the right "Running jobs can't be cancelled" and a
   disabled Cancel button.
3. Progress card (white, border `#E6E6E3`, radius 12px, padding 24px, gap 18px):
   - "64%" mono 44px weight 500; "160 of 250 items" with the numbers in mono;
   - right: "Rate 12.4/s · Elapsed 13s · ETA ~7s", 13px;
   - progress bar 8px high, radius 4px, track `#EBEFFD`, fill `#1F3FC4`, `role="progressbar"`;
   - three tiles in a 3-column grid (gap 12px, background `#F7F7F5`, radius 10px, padding
     12px 14px): label 13px `#5C5C63` with an 8px square swatch, value mono 20px weight 500:
     Succeeded `#1F3FC4`, Failed items `#B42121`, Remaining `#DADAD6`;
   - grid header 12px `#5C5C63`: "Items 1–250" left, "checkpoint every 10 items · last: 160" right;
   - cell grid: 25 equal columns, gap 3px, square cells radius 2px: done `#1F3FC4`, failed
     `#B42121`, remaining `#E6E6E3`; `aria-hidden`.
4. Result card (dashed border `#D4D4D0`): placeholder text.
5. Aside: Worker lease card (alive, worker, heartbeat, lease bar, note); Details card (key/value:
   Priority, Attempts, Items, Created, Started, Idempotency key; keys 13px `#5C5C63`, values mono
   12px right-aligned); Payload card (JSON).

## Mapping to the group page and the code

| Design part | Group page | Code |
|---|---|---|
| Breadcrumb "Jobs / id" | "Groups / <id>" | same markup as `JobPage` breadcrumb |
| H1 id + status badge | full group id + group status (running, completed, failed) | `StatusBadge` extended or a group status badge with the same look |
| Type badge, Cancel + note | dropped (groups have no type; pages are read only) | — |
| Live indicator (not in this design; on the job page header) | right side of the title row | reuse `LiveIndicator` |
| % and "X of Y items" | finished (completed + failed) of total jobs | new `GroupProgress` card (`Card`) |
| Rate · Elapsed · ETA | dropped | — |
| Progress bar | finished / total | new, design values; tokens where they exist |
| Tiles Succeeded / Failed items / Remaining | Completed / Failed / Remaining (total − completed − failed) | new |
| Grid header | "Jobs 1–N"; no checkpoint text | new |
| Cell grid | one cell per child job (all of them), 3 colours, link + tooltip | new `GroupJobCells`; `Tooltip` from `components/ui` |
| Result card | dropped | — |
| Worker lease card | dropped | — |
| Details card | Created, Updated, Last checked, Finished | key/value list like `JobDetailsList` |
| Payload card | dropped | — |

Tokens: the job details page already uses this design's palette (`text-muted-foreground`,
`bg-secondary`, `Card`, `border-[#F3F3F1]`); the group page reuses those. Fidelity is "same layout
and feel" with the project's tokens (decided), not pixel-exact.

## Comparison with the built page

Done in task 4.6: the built app (`vite preview`) at 1440×1280 with mocked APIs, a running group of
250 jobs (158 completed, 2 failed), screenshot compared region by region with `BatchJob`. The
screenshots are working files and are not committed.

- Match: breadcrumb "Groups / <id>"; mono id with the status pill; the two columns (main and
  Details aside) and their wrapping; the progress card with the 44px percentage, "160 of 250 jobs",
  the 8px bar on the light blue track, three tiles with swatches and mono values, "Jobs 1–250" and
  the 25-column grid of square cells (blue, red, grey); the Details card's key/value rows.
- Differs, on purpose: no type badge, Cancel, Rate/Elapsed/ETA, checkpoint text, Result, Worker
  lease or Payload (decided); the live indicator on the title row (decided); the Remaining swatch
  and remaining cells use the `border` token (`#E6E6E3`) for the design's `#DADAD6` swatch
  (project tokens, decided "same layout and feel").
- The groups list has no design of its own; it matches the jobs list's table, pager and header.
