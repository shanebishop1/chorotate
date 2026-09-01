# Core Experience PRDs

Status: Active
Last updated: 2026-08-31
Doc Class: index
Doc Type: prds-index
Authority: authoritative-routing
Canonical Source: docs/epics/INDEX.md
Superseded by: n/a

## Purpose

Index PRDs for the ChoRotate core experience.

## Scope

- Chore-specific Friday/Monday weekly ownership scheduling
- Assignment changes and audit history
- Authentication, access control, and SMS reminders
- Approved Chore Relay frontend contract and gated implementation slices

## PRDs

- [`ChoRotate MVP`](chorotate-mvp.md) — active behavioral source; Chore Relay approved and `G0` closed.
- [`SC-01 Foundation and Shared Contracts`](foundation-and-shared-contracts.md) — `G1` / FDN.
- [`SC-02 Better Auth and Access Feasibility`](better-auth-and-access-feasibility.md) — `G2` / AUTH.
- [`SC-03 D1 Schema, Migrations, and Trigger Proof`](d1-schema-migrations-and-trigger-proof.md) — `G2` / DATA.
- [`SC-04 Chore Relay Frontend System and Shell`](chore-relay-frontend-system-and-shell.md) — `G2` / UI.
- [`SC-05 Week Rotation and Materialization`](week-rotation-and-materialization.md) — `G3` / ROTATION.
- [`SC-06 Audited Assignment Commands`](audited-assignment-commands.md) — `G3` / MUTATION.
- [`SC-07 Schedule and History Read Models`](schedule-and-history-read-models.md) — `G3` / READ.
- [`SC-08 Schedule Viewing Experience`](schedule-viewing-experience.md) — `G4` / PRODUCT.
- [`SC-09 Reassignment, Swap, and History Experience`](reassignment-swap-and-history-experience.md) — `G4` / PRODUCT.
- [`SC-10 Reminder Outbox and SMS`](reminder-outbox-and-sms.md) — `G4` / REMINDER; Textbelt free endpoint and explicit delivery limitations.
- [`SC-11 Release Quality and Operator Readiness`](release-quality-and-operator-readiness.md) — `G5` / QUALITY.

## Execution order

The [MVP milestone](../../../../milestones/mvp/INDEX.md) is authoritative for peer dependencies and gates:

| Child PRD | Gate | Parallel Lane | Depends On |
| --- | --- | --- | --- |
| `SC-01` | `G1` | `FDN` | `G0` (closed) |
| `SC-02` | `G2` | `AUTH` | `SC-01` |
| `SC-03` | `G2` | `DATA` | `SC-01` |
| `SC-04` | `G2` | `UI` | `SC-01` |
| `SC-05` | `G3` | `ROTATION` | `SC-03` |
| `SC-06` | `G3` | `MUTATION` | `SC-02, SC-03, SC-05` |
| `SC-07` | `G3` | `READ` | `SC-02, SC-03, SC-05` |
| `SC-08` | `G4` | `PRODUCT-view` | `SC-04, SC-05, SC-07` |
| `SC-09` | `G4` | `PRODUCT-change` | `SC-04, SC-06, SC-07` |
| `SC-10` | `G4` | `REMINDER` | `SC-02, SC-03, SC-05, SC-07` |
| `SC-11` | `G5` | `QUALITY` | `SC-08, SC-09, SC-10` |

## Next steps

Keep the eleven lower-level PRDs and their Beads Rust items 1:1 with the amended milestone candidates. The approved SMS/chore-period contract reopens focused tasks inside existing slices rather than adding a twelfth slice.
