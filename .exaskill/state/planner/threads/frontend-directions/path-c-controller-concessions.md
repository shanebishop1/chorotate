# Direction C Controller Concessions

Lane state: stopped after prototype creation and validation; the Kimi runner did not return its required report after repeated bounded recovery attempts.

## Hardcoded Data

- Jack, Joe, Dylan, Shane, both chores, the Aug 31-Sep 27 four-week rotation, fixed history entries, and Shane's signed-in identity are representative constants.
- Relative time and week labels do not derive from production household configuration.

## Simulated Behavior

- View switching, light/dark preference, reassignment, derived Mine/Household updates, and prepended history entries exist only in browser memory/local storage.
- Refresh resets assignment changes. No API, D1 write, notification, audit transaction, or concurrency check occurs.

## Omitted Production States

- Google authentication, email allowlist enforcement, database sessions, loading/error/offline states, optimistic conflicts, reminders, real immutable audit controls, and server validation are absent.
- The concept tests direct reassignment but does not implement the complete production swap workflow.

## Assets And Workarounds

- CSS, JavaScript, and simple SVG/text marks are embedded in one HTML file with no external requests or build step.
- System font stacks replace production typography decisions.
- Prototype state and accessibility behavior were optimized for current Chromium; Safari and Firefox remain untested.

## Evidence

- The Kimi lane's own Chromium harness reported 41/41 assertions passing across all four views, both themes, theme persistence, current and next assignments, instructions, four-week board/list, grouped swap and direct history, dialog selection/review/confirm, state propagation, touch targets, and zero subresource requests.
- Static checks reported balanced HTML tags, parseable JavaScript, required content present, and no external dependency patterns.
- The controller will repeat equivalent browser and source checks before publication.

This report is controller-derived from the stopped lane's source and captured validation transcript. It is not represented as a successful lane-authored concession report.
