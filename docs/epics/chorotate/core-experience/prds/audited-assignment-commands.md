# Audited Assignment Commands PRD

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

Translate milestone candidate `SC-06` into authorized, optimistic direct-reassignment and atomic-swap command contracts with trusted actor/request context and immutable audit output.

## 2. Goal

Allow any active member to change current/future assignments safely while rejecting ended-period, stale, unauthorized, and no-op mutations without false history.

## 3. Scope

### In scope

- Direct reassignment and two-assignment atomic swap commands.
- Expected assignment versions, client request IDs, operation IDs, authenticated actor context, and same-origin authorization use.
- Chore-specific ended-period/no-op rejection, stale current-value response, transaction rollback, grouped audit, and idempotent retry behavior.

### Out of scope

- Mutation screens, schedule read projections, reminder correction dispatch, or editable audit history.

## 4. Acceptance criteria

- Any active allowlisted member can perform authorized current/future changes.
- Stale, ended-period, no-op, and unauthorized attempts do not overwrite or emit false audit events.
- Both swap legs and their linked audit rows commit together or not at all, with one operation group.

## 5. Stories, Tasks, and Execution Order

ST-1: Establish assignment command contracts
- T-1.1: Implement versioned direct-reassignment and atomic-swap command boundaries. DoD: Commands require request/version context, authorize active members, reject ended/no-op inputs, and return explicit stale current values.

ST-2: Prove trusted audit and transaction behavior
- T-2.1: Carry authenticated actor, request, operation, and change context through assignment transactions. DoD: Successful direct and swap commands produce complete immutable audit events, with both swap legs grouped and committed atomically.
- T-2.2: Verify conflict, rollback, authorization, immutability, and retry behavior. DoD: Contract/integration suites prove stale losers never overwrite, failures roll back fully, unauthorized writes fail closed, audit mutation fails, and retries do not duplicate logical changes.

ST-3: Apply chore-specific ownership boundaries to mutations
- T-3.1: Enforce assignment eligibility and audit context against each chore's actual period. DoD: Command/integration tests accept current/future Friday Trash and Monday Dishwasher assignments, reject each chore immediately after its own inclusive end, preserve atomic/versioned behavior, and stamp the correct chore-specific period identity into audit/reminder-planning context.

| Child Task | Gate | Parallel Lane | Depends On |
| --- | --- | --- | --- |
| `T-1.1` | `ST-1` | `MUTATION-command` | `none` |
| `T-2.1` | `ST-2` | `MUTATION-audit` | `T-1.1` |
| `T-2.2` | `ST-2` | `MUTATION-proof` | `T-1.1` |
| `T-3.1` | `ST-3` | `MUTATION-chore-periods` | `SC-03/T-3.1, SC-05/T-3.1, T-2.2` |

## 6. Dependencies

- `SC-02 -> SC-06`
- `SC-03 -> SC-06`
- `SC-05 -> SC-06`
- This PRD blocks `SC-09` as recorded in the [MVP milestone](../../../../milestones/mvp/INDEX.md).

## 7. Next steps

Reopen `G3` lane MUTATION for `T-3.1` after the DATA and chore-period migration tasks close; no permission or transaction model changes are authorized.
