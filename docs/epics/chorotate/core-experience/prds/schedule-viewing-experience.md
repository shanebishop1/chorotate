# Schedule Viewing Experience PRD

Status: Active
Last updated: 2026-08-31
Doc Class: plan
Doc Type: product-requirements
Plan Type: initiative
Lifecycle: active
Authority: authoritative
Canonical Source: docs/milestones/mvp/INDEX.md
Superseded by: n/a
Parent Artifact: docs/epics/chorotate/core-experience/prds/chorotate-mvp.md

## 1. Summary

Translate milestone candidate `SC-08` into authenticated Chore Relay schedule viewing across Now, Mine, and Household.

## 2. Goal

Make “who has each chore now and next, and when am I up?” answerable in seconds on a phone while providing a purposeful desktop and accessible household multi-week view.

## 3. Scope

### In scope

- Chore Relay Now people-first handoffs, instructions, current/next people, and each chore's own active/next ownership ranges.
- Chronological Mine schedule.
- Household chronological list and useful multi-week schedule, filters, responsive degradation, and explicit loading/empty/unavailable/unauthorized states.
- Complete light/dark modes and approved accessibility/responsive behavior.

### Out of scope

- Reassignment/swap/history interactions, reminder delivery, or A/C visual styling.

## 4. Acceptance criteria

- Phone and desktop journeys show consistent materialized assignments and chore-specific ranges across Now, Mine, and Household without a universal current-week claim.
- Household list and multi-week schedule remain useful and accessible at narrow widths.
- Automated accessibility plus keyboard/manual responsive checks pass in light and dark modes.

## 5. Stories, Tasks, and Execution Order

`ST-1` and `ST-2` record the closed shared-week UI baseline. They do not satisfy the amended range acceptance criteria; `ST-3` owns the visible migration.

ST-1: Integrate schedule views with stable contracts
- T-1.1: Implement Chore Relay Now and Mine experiences against authorized read models. DoD: Now shows every chore's people-first current-to-next handoff and instructions, Mine is chronological, and both share the correct active local week and explicit states.
- T-1.2: Implement Chore Relay Household list and multi-week experiences. DoD: List/calendar-oriented multi-week data, filters, narrow-screen degradation, non-color-only cues, and explicit states match the approved responsive contract.

ST-2: Verify the viewing journey
- T-2.1: Verify schedule consistency, modes, responsiveness, and accessibility. DoD: Browser journeys pass at phone and desktop sizes in light/dark modes with keyboard, semantics, focus, touch-target, and automated accessibility checks.

ST-3: Integrate staggered ownership ranges
- T-3.1: Update Now, Mine, and Household journeys for Friday Trash and Monday Dishwasher periods. DoD: Route/component/browser tests at phone/desktop widths show correct current/next inclusive ranges per chore, remain chronological and accessible in both modes, and remove banners, labels, filters, or assertions that imply one household current week.

| Child Task | Gate | Parallel Lane | Depends On |
| --- | --- | --- | --- |
| `T-1.1` | `ST-1` | `PRODUCT-now-mine` | `none` |
| `T-1.2` | `ST-1` | `PRODUCT-household` | `none` |
| `T-2.1` | `ST-2` | `PRODUCT-view-proof` | `T-1.1, T-1.2` |
| `T-3.1` | `ST-3` | `PRODUCT-chore-periods` | `SC-04/T-3.1, SC-05/T-3.1, SC-07/T-3.1, T-2.1` |

## 6. Dependencies

- `SC-04 -> SC-08`
- `SC-05 -> SC-08`
- `SC-07 -> SC-08`
- This PRD blocks `SC-11` as recorded in the [MVP milestone](../../../../milestones/mvp/INDEX.md).

## 7. Next steps

Reopen `G4` lane PRODUCT-view for `T-3.1` after the UI, rotation, and read-model migration tasks close, in parallel with the interaction and SMS slices.
