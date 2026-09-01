# Foundation and Shared Contracts PRD

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

Translate milestone candidate `SC-01` into an implementation-ready shared foundation for the accepted React Router Worker architecture and approved Chore Relay frontend direction.

## 2. Goal

Stabilize the runtime boundary, typed environment/binding contract, pinned toolchain, domain vocabulary, and verification shape needed by all later lanes.

## 3. Scope

### In scope

- React Router v8 Framework Mode and one-Worker boundary with `fetch` and `scheduled` ownership.
- Typed bindings/environment shape, fail-closed configuration contract, pinned toolchain, shared domain terms, and test-harness shape, including removal of all Resend configuration and use of Textbelt's public free key without a new secret.
- Chore Relay as the only frontend direction consumed by downstream UI work.

### Out of scope

- Auth feasibility, domain schema implementation, product views, reminders, deployment, or product resource provisioning.

## 4. Acceptance criteria

- A production build shape and Worker type generation are demonstrable.
- Unit-test harness and fail-closed environment contracts are demonstrable.
- Downstream AUTH, DATA, and UI lanes can consume one stable vocabulary and boundary.
- Runtime configuration contains no reminder-email sender/API-key contract; Textbelt's fixed endpoint/public key is bounded in the reminder transport and phone values remain D1 contact data rather than environment variables.

## 5. Stories, Tasks, and Execution Order

ST-1: Establish the shared runtime contract
- T-1.1: Establish the React Router Worker, toolchain, and generated-binding contract. DoD: The one-Worker build boundary, pinned toolchain, type-generation surface, and production build command are defined and demonstrable.

ST-2: Establish shared domain and verification contracts
- T-2.1: Establish typed environment validation, domain vocabulary, and test-harness shape. DoD: Plain and secret configuration fail closed, shared domain terms are defined once, and the unit-test harness proves the contract without tracked-file mutation.

ST-3: Amend the shared runtime contract for the approved SMS-only MVP
- T-3.1: Remove Resend configuration and define the public Textbelt transport boundary. DoD: Generated/runtime environment contracts, examples, doctor/security allowlists, and tests contain no RESEND_* input, introduce no Textbelt secret, keep E.164 member contacts in D1 only, and expose one fixed SMS transport contract for downstream reminder work.

| Child Task | Gate | Parallel Lane | Depends On |
| --- | --- | --- | --- |
| `T-1.1` | `ST-1` | `FDN-runtime` | `none` |
| `T-2.1` | `ST-2` | `FDN-contract` | `T-1.1` |
| `T-3.1` | `ST-3` | `FDN-sms-contract` | `T-2.1` |

## 6. Dependencies

- `G0 -> SC-01`
- This PRD blocks `SC-02`, `SC-03`, and `SC-04` as recorded in the [MVP milestone](../../../../milestones/mvp/INDEX.md).

## 7. Next steps

The Git repository prerequisite is satisfied by `https://github.com/shanebishop1/chorotate.git`. Reopen the foundation only for `T-3.1`; its fixed Textbelt/no-Resend environment contract gates the DATA and REMINDER migration work.
