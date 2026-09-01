# Week Rotation and Materialization PRD

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

Translate milestone candidate `SC-05` into deterministic chore-specific ownership periods, offset rotation, effective configuration, and assignment-materialization behavior.

## 2. Goal

Materialize correct, idempotent Trash Friday–Thursday and Dishwasher Monday–Sunday schedules across timezone and daylight-saving boundaries without overwriting human overrides or reinterpreting history.

## 3. Scope

### In scope

- Household-local chore-period keys and boundaries, inclusive display ranges, DST behavior, baseline offset cycle, and initial four-period sequence.
- Future-effective configuration and preview semantics.
- Idempotent horizon extension, authoritative materialized assignments, override preservation, and historical stability.

### Out of scope

- Auth, mutation UI, read views, reminder dispatch, or user-facing configuration administration.

## 4. Acceptance criteria

- Deterministic, DST, and property tests pass for Friday–Thursday Trash and Monday–Sunday Dishwasher period/offset semantics.
- Four consecutive periods of each chore exactly match the MVP acceptance sequence.
- Re-materialization extends each chore's horizon without replacing overrides or changing ended/in-progress periods.

## 5. Stories, Tasks, and Execution Order

`ST-1` and `ST-2` record the closed shared-week baseline. They remain historical prerequisites, not acceptance of a universal week; `ST-3` owns the amended period contract.

ST-1: Prove local week and rotation semantics
- T-1.1: Implement household-local week boundaries and DST-safe week identity. DoD: Boundary and DST tests prove every tested instant maps to the correct local current/next week and inclusive display range.
- T-1.2: Implement offset rotation and future-effective configuration preview. DoD: Property tests and the initial four-week acceptance table pass, including equivalent-offset validation and stable historical semantics.

ST-2: Materialize authoritative assignments
- T-2.1: Implement idempotent rolling-horizon materialization with override preservation. DoD: Repeated and concurrent-safe extension creates missing assignments only, preserves human edits and historical weeks, and covers current/next plus required future views/reminders.

ST-3: Migrate from one household week to chore-specific periods
- T-3.1: Implement independent Friday Trash and Monday Dishwasher period sequences while preserving offset fairness. DoD: Boundary/DST/property/materialization tests prove each chore advances through consecutive seven-day periods from its own anchor, retains (periodIndex + offset) mod N, preserves overrides/history, renders inclusive ranges, and exposes no universal current-week identity.

| Child Task | Gate | Parallel Lane | Depends On |
| --- | --- | --- | --- |
| `T-1.1` | `ST-1` | `ROTATION-week` | `none` |
| `T-1.2` | `ST-1` | `ROTATION-cycle` | `none` |
| `T-2.1` | `ST-2` | `ROTATION-materialize` | `T-1.1, T-1.2` |
| `T-3.1` | `ST-3` | `ROTATION-chore-periods` | `SC-03/T-3.1, T-1.1, T-1.2, T-2.1` |

## 6. Dependencies

- `SC-03 -> SC-05`
- This PRD blocks `SC-08` and `SC-10` as recorded in the [MVP milestone](../../../../milestones/mvp/INDEX.md).

## 7. Next steps

Reopen `G3` lane ROTATION for `T-3.1` after the SMS/period schema migration. Its chore-period contract gates the mutation, read, product, and reminder migration tasks.
