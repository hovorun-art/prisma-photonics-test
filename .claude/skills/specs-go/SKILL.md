---
name: specs-go
description: Approve the decisions of an OpenSpec change and write its specs, design and tasks. Typed by the user as /specs-go <change>; also run after the user picks "Approve decisions" to continue the change. Resolves anything still unchecked in decisions.md first.
argument-hint: <change-name>
---

The user wants the questions of change `$ARGUMENTS` settled and the specs written. Approval itself
is recorded by a hook, never by you: when the user typed this command, or picked "Approve decisions"
in AskUserQuestion, the hook creates `openspec/changes/$ARGUMENTS/.decisions-approved` if
`decisions.md` has no unchecked item left, and tells you the result.

1. Read `openspec/changes/$ARGUMENTS/decisions.md`. If it does not exist, stop and say so.
2. If `.decisions-approved` exists, go to step 5.
3. Otherwise resolve every unchecked item with AskUserQuestion (see "Asking" in CLAUDE.md). If the
   user shared screenshots for this change, run the `ui-from-screenshots` skill first.
   - Open questions first, in batches of up to 4, with "Drop this question" as one option.
   - Then the whole "Assumed" list in one multiSelect question: the user keeps what they accept.
   After each call, move answers and accepted assumptions to "Decided" (with their source) and check
   the items; a rejected assumption becomes an open question.
4. Show the Decided list in one compact block, then ask one question that names the change, for
   example "Approve the decisions of `$ARGUMENTS` and write the specs?", with the options
   "Approve decisions" (first) and "Not yet". The hook records the approval. If the user does not
   approve, stop. Never create `.decisions-approved` yourself; writing it is blocked.
5. Continue the `propose` workflow for this change from the next `ready` artifact: specs,
   then design, then tasks. Every requirement must trace to a line in "Decided". If while writing you
   hit something that is not decided, stop, add it to "Open questions", ask, and get approval again
   (the hook re-checks decisions.md); never fill the gap with an assumption.
