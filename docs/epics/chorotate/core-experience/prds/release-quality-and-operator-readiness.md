# Release Quality and Operator Readiness PRD

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

Translate milestone candidate `SC-11` into the final CI, doctor, security, accessibility, production-configuration, remote-D1 smoke, and operator setup convergence slice.

## 2. Goal

Prove the complete MVP from a clean checkout without tracked-file mutation, secret leakage, unauthorized resource creation, or drift from accepted product, architecture, and Chore Relay contracts.

## 3. Scope

### In scope

- Non-mutating format/lint/type/build/test checks, CI, generated bindings, dependency audit, secret scan, and doctor.
- End-to-end auth, chore-specific schedule, reassign, swap, conflict, history, SMS reminder, responsive, and accessibility evidence.
- Typed/fail-closed production config, secret-name allowlist, redacted logs/contact data, remote D1 smoke, and setup/deployment documentation using supplied deferred E.164/consent values.

### Out of scope

- Additional repository setup, commits or pushes during planning; product resource provisioning; unapproved infrastructure; or new MVP behavior.

## 4. Acceptance criteria

- All required checks pass from a clean checkout and validation does not mutate tracked files.
- Security, redaction, accessibility, responsive, auth/denial, D1, audit, mutation, staggered-period, and Textbelt reminder evidence passes.
- Supplied production/deferred values validate, remote D1 smoke passes, and the operator runbook is complete without secrets in source control.

## 5. Stories, Tasks, and Execution Order

ST-1: Establish release verification surfaces
- T-1.1: Establish non-mutating CI, doctor, quality, security, contact-redaction, deploy-output suppression, and removed-Resend checks. DoD: A clean checkout runs the complete quality/security surface without tracked-file mutation or secret/contact exposure, proves provider/build output cannot cross the production deploy boundary (including abbreviated identities and arbitrary payloads), emits only fixed deployment evidence, contains no Resend config/transport claim, and treats Textbelt public key as non-secret fixed configuration.
- T-1.2: Run end-to-end staggered-period, SMS, responsive, and accessibility verification. DoD: Auth/denial, Friday Trash/Monday Dishwasher Now/Mine/Household/History, direct/swap/conflict, correction-needed surfacing, Sunday/Monday/Thursday/Friday SMS cadence, phone/desktop, light/dark, keyboard, and automated accessibility journeys pass.
- T-1.3: Validate production E.164/contact configuration, remote D1 smoke, and operator setup documentation. DoD: Missing/invalid/unconsented/suppressed phone contacts fail safely, remote period/outbox migrations and quota-safe smoke pass without duplicate live sends, no Resend input remains, contact values stay out of source/logs, and operator guidance covers Textbelt free-key/STOP/reply/quota/ambiguous-timeout limitations without provisioning paid services.

ST-2: Close release convergence
- T-2.1: Reconcile final evidence against every amended MVP acceptance criterion and accepted contract. DoD: Each criterion maps to passing evidence; D1 remains sole assignment/contact/outbox authority; audit is immutable; sessions are revocable; access fails closed; Chore Relay shows chore-specific ranges; SMS-only/Textbelt/no-correction-send limits are explicit; and no unapproved architecture, paid service, email path, or exactly-once claim remains.

| Child Task | Gate | Parallel Lane | Depends On |
| --- | --- | --- | --- |
| `T-1.1` | `ST-1` | `QUALITY-ci-security` | `SC-01/T-3.1, SC-03/T-3.1, SC-10/T-4.1` |
| `T-1.2` | `ST-1` | `QUALITY-product-a11y` | `SC-08/T-3.1, SC-09/T-3.1, SC-10/T-5.1` |
| `T-1.3` | `ST-1` | `QUALITY-operator` | `SC-03/T-3.1, SC-10/T-5.1` |
| `T-2.1` | `ST-2` | `QUALITY-converge` | `T-1.1, T-1.2, T-1.3` |

## 6. Dependencies

- `SC-08 -> SC-11`
- `SC-09 -> SC-11`
- `SC-10 -> SC-11`

## 7. Next steps

Run in `G5` only after the reopened `G4` migration slices close and deferred E.164/consent/time/deployment inputs are supplied; do not provision resources or send quota-consuming live messages as part of planning.
