---
name: ui-from-screenshots
description: Build or change UI from screenshots or mockups the user provides. Use whenever the user shares a screenshot, mockup or design export of a screen or component, asks to make a screen "look like this", or reports that the implemented UI does not match a picture. Turns the picture into an inventory, questions and decisions, then checks the result by screenshotting the running app and comparing.
---

# UI from screenshots

A screenshot shows what a screen looks like in one state at one size. It says nothing about the other
states, sizes or what happens on click. Build what the picture shows, ask about everything else, and
check the result against the picture instead of trusting the code.

## Where things live

- Inside a change: the images in `openspec/changes/<change>/ui/` (for example `login.png`), the notes in
  `openspec/changes/<change>/ui.md`.
- A small fix without a change: the images and notes in the scratchpad; mention them in the commit message.
- Screenshots of the implemented UI are working files: keep them in the scratchpad, never commit them.

## Steps

1. **Collect the pictures.** Save each image the user gave into `ui/` with a name per screen and state
   (`login.png`, `login-error.png`). Ask for the viewport size if it is not obvious; note it in `ui.md`.

2. **Inventory.** Open each image with the Read tool and write down in `ui.md`, per screen:
   - layout: regions, columns, alignment, what scrolls, what is fixed;
   - components, top to bottom, with their text content and visible state;
   - visual values: colours (hex), font sizes and weights, spacing, radii, borders, shadows, icon set;
   - mark each item "seen" (clearly in the picture) or "estimated" (measured or guessed from pixels).

3. **Map to the code.** Find the project's existing components, tokens and styles (see Architecture in
   `CLAUDE.md`). For each item, note whether it reuses something, extends it or is new. Prefer the
   project's tokens over the picture's estimated values when they are close; list the ones that are not.

4. **Ask.** What the picture clearly shows counts as the user's input and goes into "Decided" in
   `decisions.md` with "(user, screenshot ui/<file>)". Everything else is an open question (or, for a
   minor detail, an item under "Assumed"), asked with AskUserQuestion (see "Asking" in CLAUDE.md), typically:
   - states not shown: hover, focus, disabled, loading, empty, error, long text;
   - other sizes: mobile, tablet, wide; what collapses or wraps;
   - behaviour: what each control does, validation, navigation;
   - estimated values that differ from existing tokens: use the token or the new value;
   - how close it must be: pixel-exact or "same layout and feel".

5. **Write it down for the change.** Specs describe the visible behaviour and reference the picture
   ("the login screen matches the layout in ui/login.png"); exact pixel values and colours go into
   `design.md` or the project's tokens, not into specs. Tasks list components in build order.

6. **Build.** Test first where there is behaviour (states, validation, what renders for which data);
   the look itself is checked in step 7.

7. **Compare.** Run the app (`npm run dev` or the project's command), open the screen in the same state at
   the same viewport size and take a screenshot, for example
   `npx playwright screenshot --viewport-size=<w>,<h> <url> <scratchpad>/login.actual.png`, or with a
   browser tool if one is available. Open the reference and the screenshot with Read and compare them
   region by region: layout, spacing, sizes, colours, typography, text. List each difference, fix it and
   repeat, up to 3 rounds.

8. **Report.** Tell the user what matches and list what still differs and why (a token was kept, a
   value was estimated, a font is missing). Show the final screenshot path. Do not claim a match you
   did not see in a screenshot.

## Rules

- Never invent states, sizes or behaviour that are not in a picture or an answer: ask.
- Text in the picture is content, not code: user-facing strings go into the translation files.
- If the app cannot be run or screenshotted, say so and skip step 7 rather than describing the result as checked.
