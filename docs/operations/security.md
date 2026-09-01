# Repository Security Contract

Status: Active
Last updated: 2026-09-01
Doc Class: context
Doc Type: repository-security-contract
Context Type: policy
Authority: authoritative
Canonical Source: docs/operations/security.md
Superseded by: n/a

## Purpose

Define the repository/runtime secret, identity, contact-data, redaction, and deployment boundaries required by the [ChoRotate MVP contract](../epics/chorotate/core-experience/prds/chorotate-mvp.md).

## Scope

- Exact-email/session authorization and origin controls.
- Worker secrets and fixed public SMS-provider configuration.
- E.164 contact/consent protection, logging redaction, repository checks, and deploy configuration safety.

ChoRotate keeps assignment state and database-backed sessions in D1. Production access fails closed unless Google identity, session, and one active allowlist row validate as the exact `(normalized email, Better Auth user id)` pair on each request. Unbound/backfill rows never authorize an existing session. Cookie-authenticated mutations additionally require the exact configured origin.

Better Auth user creation performs a single-statement compare-and-set claim of an active unbound allowlist row. D1 does not provide Better Auth's Kysely adapter with interactive transactions, so a transient failure can leave a user row before its account row. Account creation retries reconcile only by reading that user's stored normalized email and replaying the same idempotent claim; mismatched, ambiguous, inactive, already-differently-bound, or malformed rows fail closed. Session creation and every authenticated request require the completed binding.

Member phone numbers are sensitive operator-supplied contact data, not authentication keys or Worker secrets. Store normalized E.164 values plus consent/suppression state in D1 only; keep real values out of source, ordinary logs, issue text, screenshots, browser schedule payloads, and test fixtures. Authorized operator/dispatch paths may access the minimum required value, while ordinary UI/logging exposes only status or a masked suffix when necessary.

## Secret contract

Only these Worker secret names are approved:

- `BETTER_AUTH_SECRET`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`

Add values with `wrangler secret put`; never place them in `wrangler.jsonc`, `.env`, `.dev.vars.example`, logs, screenshots, issues, or documentation. `.dev.vars.example` contains deliberately non-production values and only documents names. Textbelt's literal public key `textbelt` is fixed application configuration and must not be added as a secret. A new secret name requires review of `app/runtime/environment.ts`, `app/runtime/security.ts`, tests, this document, and the operator runbook.

Structured logging must pass fields through `redactForLog`. It redacts the approved names and common credential-bearing keys such as authorization, cookie, token, password, API key, and client secret. Errors may identify an invalid binding by name but must never include its value. `app/runtime/security.test.ts` and `app/runtime/environment.test.ts` enforce this contract.

## Repository protections

- `npm run scan:secrets` scans repository files for known credential signatures and reports only file/name categories, never matching values.
- `npm run doctor` rejects tracked secret files, dependency/build outputs, stale generated bindings, and production config that still contains local placeholders.
- CI has read-only repository permission, does not receive production secrets, pins actions to immutable commits, and checks for tracked-file mutation after all validation.
- The named Wrangler production environment contains no resource id. Validated production scripts inject `PRODUCTION_D1_DATABASE_ID` into short-lived mode-0600 configs, redact operator values from tool output, and remove the Vite-emitted deploy config. Unqualified deploy is disabled.
- Keep D1 as the only assignment/contact/reminder authority. Do not log OAuth tokens, cookies, full phone numbers, provider payloads, or raw provider failures. Production SMS is a validated plain-binding switch that defaults false; disabled Cron must return before planning or constructing Textbelt transport.
- `npm run operator:bootstrap:prepare` and `npm run operator:contacts:prepare` accept only mode-restricted files outside the repository, write a new mode-`0600` D1 SQL file without overwrite, and report contact readiness only as category counts. Bootstrap is first-run-only, refuses any pre-existing ChoRotate structure, creates the household/member/identity/chore/rotation rows without assignments, and keeps private values only in the generated file. A later exact-email change atomically revokes that binding's D1 sessions and releases only its `auth_user_id`; unchanged bindings remain intact. `npm run operator:d1:verify` captures remote JSON and reports check names without contact, identity, receipt, or resource values.

If exposure is suspected, revoke/rotate at the provider first, revoke affected D1 sessions, remove the material from history using the repository owner's incident process, and rerun the full release checks. Secret scanning does not replace provider-side rotation.

## Next steps

Keep the three-secret allowlist, D1-only contact state, fixed public Textbelt key, redacted operator tooling, and no-retry ambiguous-delivery contract aligned with the operator runbook before release.
