# Schedule and History Read Models PRD

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

Translate milestone candidate `SC-07` into consistent authorized projections for current/next, personal, household list/calendar, and grouped history data.

## 2. Goal

Give every approved frontend view one coherent read contract over D1 while preserving chore-specific period boundaries, filters, inactive historical names, correction-needed evidence, and fail-closed access.

## 3. Scope

### In scope

- Current/next chore projection with instructions and each assignment's local ownership range.
- Signed-in member schedule and household chronological list/multi-period calendar projections with member/chore filters.
- Grouped direct/swap audit history with actor, local time, before/after, chore-specific range, and inactive-member history.
- Authorized, redacted reminder/correction-needed status sufficient for the UI/operator to surface missed, suppressed, accepted, or ambiguous contact without exposing full phone data broadly.
- Route-local authorization and explicit empty/unavailable/denial contracts.

### Out of scope

- Frontend rendering, assignment writes, reminder dispatch, or client-side assignment authority.

## 4. Acceptance criteria

- Every projection returns consistent materialized assignments and Friday Trash/Monday Dishwasher period semantics without a universal week field.
- Household filters do not mutate authoritative state and grouped swaps expose both legs.
- Contract tests cover boundaries, inactive history, empty/unavailable states, and denial.

## 5. Stories, Tasks, and Execution Order

`ST-1` and `ST-2` record the closed shared-week projection baseline. Their week wording is historical; `ST-3` replaces that external contract with chore-specific ranges.

ST-1: Build authorized read projections
- T-1.1: Implement current/next and signed-in personal schedule projections. DoD: Authorized contracts return consistent local week ranges, chores/instructions, current/next assignees, and chronological personal assignments.
- T-1.2: Implement household list and multi-week calendar projections. DoD: Authorized contracts return week/chore/assignee data with stable boundaries and non-mutating member/chore filters.
- T-1.3: Implement grouped immutable history projection. DoD: Direct and swap operations return actor/local-time/before-after/week/chore details, preserve inactive historical names, and group both swap legs.

ST-2: Converge read contracts
- T-2.1: Verify consistency, boundaries, state variants, and denial across all projections. DoD: Route/data contract tests prove cross-view assignment/week consistency, empty/unavailable behavior, filter behavior, inactive history, and fail-closed access.

ST-3: Migrate projections to chore periods and correction evidence
- T-3.1: Expose chore-specific ranges and safe reminder/correction status across authorized projections. DoD: Contract tests prove Now/Mine/Household/History use Friday-Thursday Trash and Monday-Sunday Dishwasher ranges, remove universal current-week claims, preserve chronological/filter/history behavior, and surface redacted pending/accepted/missed/delivery-unknown/correction-needed states without returning full phone values to ordinary schedule views.

| Child Task | Gate | Parallel Lane | Depends On |
| --- | --- | --- | --- |
| `T-1.1` | `ST-1` | `READ-now-mine` | `none` |
| `T-1.2` | `ST-1` | `READ-household` | `none` |
| `T-1.3` | `ST-1` | `READ-history` | `none` |
| `T-2.1` | `ST-2` | `READ-converge` | `T-1.1, T-1.2, T-1.3` |
| `T-3.1` | `ST-3` | `READ-chore-periods-sms` | `SC-03/T-3.1, SC-05/T-3.1, T-2.1` |

## 6. Dependencies

- `SC-02 -> SC-07`
- `SC-03 -> SC-07`
- `SC-05 -> SC-07`
- This PRD blocks `SC-08` and `SC-09` as recorded in the [MVP milestone](../../../../milestones/mvp/INDEX.md).

## 7. Next steps

Reopen `G3` lane READ for `T-3.1` after the DATA and chore-period migration tasks close. This contract gates schedule/reassignment labels and final SMS correction proof.
