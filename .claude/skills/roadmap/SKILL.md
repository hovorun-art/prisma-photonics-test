---
name: roadmap
description: Build, update or show the project roadmap (docs/roadmap/, one file per milestone) from docs/concept.md - milestones and the ordered changes to propose. Use at the start of a project before the first /propose, when the user asks what to build next or where the project stands, or when the concept changes.
---

# Roadmap

The roadmap turns the concept into an ordered list of changes, so each `/propose` starts from a
known place instead of from scratch. It decides scope and order only, never behaviour: how each item
works is decided later, inside its own change, through `decisions.md`.

## Layout

- `docs/roadmap/NN-<slug>.md`, one file per milestone; the two-digit prefix sets the order. Separate files
  keep people who plan different milestones out of each other's way.
- Each file: the milestone's user-visible outcome, a table of its changes (name, one line of intent,
  "Depends on") and the milestone's open questions.
- No statuses in the files. Status comes from OpenSpec: no folder for the change means `planned`,
  `openspec/changes/<name>/` means `in progress`, `openspec/changes/archive/*-<name>/` means `done`.
  So archiving a change never edits the roadmap.

## When

- At the start of a project, before the first change (the files under `docs/roadmap/` still have a TODO).
- When the user asks what to build next or where the project stands: show the status (step 6) and stop
  there unless they want changes.
- When the concept changes or a milestone needs to be added, split or reordered.

## Steps

1. **Read what exists.** `docs/concept.md`, every file in `docs/roadmap/`, `openspec/specs/`, active changes
   in `openspec/changes/` and archived ones in `openspec/changes/archive/`.
2. **Draft milestones.** Each milestone is a user-visible outcome ("a user can ..."), in the order that
   gives something usable earliest. The first milestone is the smallest end-to-end slice.
3. **Split into changes.** Each change adds one capability, is small enough to review in one sitting and
   has a kebab-case name, unique across the roadmap (the future change and branch name). Note what each
   one depends on, also across milestones.
4. **Ask.** Scope, order and cuts are the user's call. Put the milestones and the doubtful items to the user
   with AskUserQuestion (see "Asking" in CLAUDE.md):
   what is in the first milestone, what can wait, which order. Anything the concept does not settle stays
   an open question in that milestone's file, not an assumption.
5. **Write the files** (English), keeping the template's layout. Edit only the milestones that change;
   to insert a milestone between two others, pick a free number or renumber only when the user agrees.
   Remove the template's TODO.
6. **Show the status.** One compact block: per milestone, its changes with the status derived from
   `openspec/changes/`, and the next candidates (`planned` changes whose dependencies are `done`).
7. **Offer the next step.** Through AskUserQuestion: `/propose <name>` for a next candidate, or other
   options that fit.

## Rules

- No requirements, numbers or behaviour in the roadmap: one line of intent per change.
- Never write statuses into the files.
- Never reorder, move or drop items on your own; propose it and ask.
