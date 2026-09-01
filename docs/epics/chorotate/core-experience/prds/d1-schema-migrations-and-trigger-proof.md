# D1 Schema, Migrations, and Trigger Proof PRD

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

Translate milestone candidate `SC-03` into the authoritative D1 schema, migration, audit-trigger, swap-transaction, and outbox-lease proof.

## 2. Goal

Prove locally and remotely that D1 can enforce the accepted data invariants without introducing another state authority.

## 3. Scope

### In scope

- Household, identity/member, chore/configuration, assignment/version, audit, auth/session, and reminder/outbox schema boundaries, including protected E.164 member contact/consent/suppression fields and chore-specific period identity.
- Constraints, migrations, assignment audit triggers, audit update/delete rejection, atomic swap rollback, and outbox lease model.
- Local/remote D1 parity evidence.

### Out of scope

- Rotation services, authenticated commands, user-facing views, reminder transport, or a non-D1 authority.

## 4. Acceptance criteria

- Migrations and constraints pass locally and remotely.
- Assignment changes append complete audit rows; audit update/delete and partial swap outcomes fail.
- Outbox uniqueness and lease recovery schema behavior pass parity checks, including occurrence phase, quota/result evidence, and terminal ambiguous-delivery state without a provider idempotency key.

## 5. Stories, Tasks, and Execution Order

ST-1: Establish authoritative schema and migrations
- T-1.1: Define and migrate the authoritative D1 tables and constraints. DoD: Forward migrations establish all accepted domain/auth/outbox boundaries and assignment uniqueness/version constraints in local and remote D1.

ST-2: Prove transaction and durability controls
- T-2.1: Prove assignment audit triggers, audit immutability, and atomic swap rollback. DoD: Local and remote suites show complete trigger-produced context, rejected audit update/delete, and all-or-nothing swap behavior.
- T-2.2: Prove reminder outbox uniqueness and expiring lease behavior. DoD: Local and remote suites show one logical event/version and recoverable claims without duplicate authority.

ST-3: Migrate D1 for chore periods and SMS evidence
- T-3.1: Migrate member contact, chore-period, and quota-safe SMS outbox contracts. DoD: Forward/local/remote-parity tests prove normalized E.164 plus consent/suppression storage, per-chore start-day/period identity, unique assignment-version/phase/recipient occurrences, accepted/failed/delivery-unknown and Textbelt evidence fields, and migration away from email-specific assumptions without exposing phone values in logs or source.

| Child Task | Gate | Parallel Lane | Depends On |
| --- | --- | --- | --- |
| `T-1.1` | `ST-1` | `DATA-schema` | `none` |
| `T-2.1` | `ST-2` | `DATA-audit` | `T-1.1` |
| `T-2.2` | `ST-2` | `DATA-outbox` | `T-1.1` |
| `T-3.1` | `ST-3` | `DATA-sms-period-schema` | `SC-01/T-3.1, T-2.2` |

## 6. Dependencies

- `SC-01 -> SC-03`
- This PRD blocks `SC-05`, `SC-06`, `SC-07`, and `SC-10` as recorded in the [MVP milestone](../../../../milestones/mvp/INDEX.md).

## 7. Next steps

Reopen `G2` lane DATA for `T-3.1` after the amended foundation closes; keep D1 as sole contact, assignment-period, correction-state, and reminder-evidence authority.
