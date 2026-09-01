# Reassignment, Swap, and History Experience PRD

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

Translate milestone candidate `SC-09` into clear Chore Relay direct-reassignment, atomic-swap, stale-recovery, and grouped-history journeys.

## 2. Goal

Let any active member confidently review and confirm assignment changes and then see exactly who changed what and when.

## 3. Scope

### In scope

- Current/future assignment selection, active-member selection, explicit before/after confirmation, and fitted controls.
- Two-assignment swap selection and atomic confirmation, including different chores/ownership periods.
- Stale-conflict current values and intentional retry; no-op/ended/unauthorized/error feedback.
- Chore Relay History with actor, local timestamp, chore-specific range, before/after, and both swap legs grouped.
- Responsive, light/dark, keyboard, touch, semantic, focus, and reduced-motion behavior.

### Out of scope

- Drag-only interaction, editable history, admin privileges, reminders, or A/C visual styling.

## 4. Acceptance criteria

- Multi-user browser journeys prove direct reassignment and atomic swap confirmation with accurate before/after details.
- Stale conflicts never silently overwrite and expose current values for intentional retry.
- Successful changes appear once in grouped visible history with complete actor/time/chore-period semantics.

## 5. Stories, Tasks, and Execution Order

ST-1: Integrate assignment-change journeys
- T-1.1: Implement the Chore Relay direct-reassignment journey. DoD: An active member can select a current/future assignment and active recipient, review complete before/after details, confirm once, and receive explicit no-op/ended/unauthorized/error states.
- T-1.2: Implement the Chore Relay atomic-swap journey. DoD: An active member can select two eligible assignments across chores/weeks, review both legs, confirm one atomic operation, and never observe a partial swap.

ST-2: Integrate conflict recovery and visible history
- T-2.1: Implement stale recovery and grouped History, then verify multi-user journeys. DoD: A stale loser sees current values and retries intentionally; successful direct/swap operations appear once with actor, local time, full before/after details, and both swap legs grouped across responsive light/dark accessible journeys.

ST-3: Apply chore-specific periods and correction visibility to change journeys
- T-3.1: Update reassignment, swap, stale recovery, and History labels for actual ownership ranges. DoD: Component/browser tests show complete Friday Trash/Monday Dishwasher ranges in selection/review/history, reject each ended period correctly, and surface post-send correction-needed status proportionally without offering or promising an immediate correction SMS.

| Child Task | Gate | Parallel Lane | Depends On |
| --- | --- | --- | --- |
| `T-1.1` | `ST-1` | `PRODUCT-reassign` | `none` |
| `T-1.2` | `ST-1` | `PRODUCT-swap` | `none` |
| `T-2.1` | `ST-2` | `PRODUCT-history` | `T-1.1, T-1.2` |
| `T-3.1` | `ST-3` | `PRODUCT-change-periods` | `SC-04/T-3.1, SC-06/T-3.1, SC-07/T-3.1, T-2.1` |

## 6. Dependencies

- `SC-04 -> SC-09`
- `SC-06 -> SC-09`
- `SC-07 -> SC-09`
- This PRD blocks `SC-11` as recorded in the [MVP milestone](../../../../milestones/mvp/INDEX.md).

## 7. Next steps

Reopen `G4` lane PRODUCT-change for `T-3.1` after UI, mutation, and read-model migration tasks close, in parallel with viewing and SMS slices.
