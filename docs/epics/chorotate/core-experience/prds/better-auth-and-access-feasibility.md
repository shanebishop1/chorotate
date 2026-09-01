# Better Auth and Access Feasibility PRD

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

Translate milestone candidate `SC-02` into the bounded Better Auth, Google OAuth, D1 session, and strict access-control feasibility slice.

## 2. Goal

Prove that only exact active allowlisted identities can create or use revocable database sessions and that every route and cookie-authenticated mutation fails closed.

## 3. Scope

### In scope

- Better Auth Google provider on D1, migrations, database sessions, state/PKCE, secure cookies, and exact callback/origin behavior.
- Exact normalized-email allowlist before account creation and on every request.
- Route-local authorization, revocation, denial, and same-origin mutation contracts.

### Out of scope

- Alternate auth infrastructure unless the accepted architecture decision is amended after bounded evidence proves Better Auth blocked.

## 4. Acceptance criteria

- Local and remote D1 auth integration passes.
- Non-allowlisted account creation/read access fails and allowlist removal denies the next request.
- Session revocation, OAuth state/PKCE, cookie, exact-origin, and route-local authorization tests pass.

## 5. Stories, Tasks, and Execution Order

ST-1: Prove the preferred auth adapter
- T-1.1: Prove Better Auth Google OAuth, D1 migrations, and revocable database sessions. DoD: Local and remote D1 integration demonstrates migration compatibility, callback handling, opaque session creation, and session revocation.

ST-2: Prove the application access boundary
- T-2.1: Enforce account-creation and per-request exact allowlist checks with route-local authorization. DoD: Unauthorized identities cannot create usable accounts or read any household route, and deactivated identities fail closed on their next request.
- T-2.2: Enforce OAuth, cookie, and mutation-origin protections. DoD: State/PKCE, secure cookie attributes, exact configured origin checks, and denial behavior pass contract tests.

| Child Task | Gate | Parallel Lane | Depends On |
| --- | --- | --- | --- |
| `T-1.1` | `ST-1` | `AUTH-adapter` | `none` |
| `T-2.1` | `ST-2` | `AUTH-access` | `T-1.1` |
| `T-2.2` | `ST-2` | `AUTH-protocol` | `T-1.1` |

## 6. Dependencies

- `SC-01 -> SC-02`
- This PRD blocks `SC-06`, `SC-07`, and `SC-10` as recorded in the [MVP milestone](../../../../milestones/mvp/INDEX.md).

## 7. Next steps

Run in `G2` lane AUTH after foundation closes; stop only AUTH consumers and amend the architecture decision if the bounded proof fails materially.
