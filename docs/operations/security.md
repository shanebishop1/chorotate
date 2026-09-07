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

Define the repository/runtime secret, identity, contact-data, redaction, and deployment boundaries. See the [operator runbook](operator-runbook.md) for setup and deployment instructions.

## Scope

- Exact-email/session authorization and origin controls.
- Worker secrets, including the private SMS-provider credential.
- E.164 contact/consent protection, logging redaction, repository checks, and deploy configuration safety.

ChoRotate keeps assignment state and database-backed sessions in D1. Production access fails closed unless Google identity, session, and one active allowlist row validate as the exact `(normalized email, Better Auth user id)` pair on each request. Unbound/backfill rows never authorize an existing session. Cookie-authenticated mutations additionally require the exact configured origin.

Local development has a separate credential-free entry point. It is available only in a Vite development build (`import.meta.env.DEV`), when `APP_ENV=local` and `LOCAL_AUTH_ENABLED=true`, and for an HTTP loopback request whose URL, optional Host header, and Origin exactly match the configured `CANONICAL_ORIGIN`. The endpoint creates a normal D1 `session` row for the seeded `local-dev-user`; it does not fabricate an identity in memory. A production build rejects the endpoint even if an operator mistakenly configures the flag, and production configuration rejects `LOCAL_AUTH_ENABLED=true`. Local sessions use a separate HttpOnly, SameSite cookie and are rechecked against the D1 user, session, member, and allowlist rows on every request.

`npm run operator:bootstrap:local` is the only custom bootstrap path for a configured local household. It always invokes Wrangler with the fixed `chorotate-local --local` target, refuses production process environments, inserts `local-dev-user`, and binds that identity to the first configured member's exact normalized email. It never emits or executes production/remote SQL. The default Vite dev server is explicitly bound to `127.0.0.1` with a strict local port; request URL/Host/Origin checks are defense in depth, not the network boundary.

Better Auth user creation performs a single-statement compare-and-set claim of an active unbound allowlist row. D1 does not provide Better Auth's Kysely adapter with interactive transactions, so a transient failure can leave a user row before its account row. Account creation retries reconcile only by reading that user's stored normalized email and replaying the same idempotent claim; mismatched, ambiguous, inactive, already-differently-bound, or malformed rows fail closed. Session creation and every authenticated request require the completed binding.

Member phone numbers are sensitive operator-supplied contact data, not authentication keys or Worker secrets. Store normalized E.164 values plus consent/suppression state in D1 only; keep real values out of source, ordinary logs, issue text, screenshots, browser schedule payloads, and test fixtures. Authorized operator/dispatch paths may access the minimum required value, while ordinary UI/logging exposes only status or a masked suffix when necessary.

## Secret contract

Only these Worker secret names are approved:

- `BETTER_AUTH_SECRET`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `TEXTBELT_API_KEY`

Add values with `wrangler secret put`; never place them in `wrangler.jsonc`, `.env`, `.dev.vars.example`, logs, screenshots, issues, or documentation. `.dev.vars.example` contains deliberately non-production values and only documents names. `TEXTBELT_API_KEY` is passed only to the outbound provider request and is never persisted in D1. A new secret name requires review of `app/runtime/environment.ts`, `app/runtime/security.ts`, tests, this document, and the operator runbook.

Structured logging must pass fields through `redactForLog`. It redacts the approved names and common credential-bearing keys such as authorization, cookie, token, password, API key, and client secret. Errors may identify an invalid binding by name but must never include its value. `app/runtime/security.test.ts` and `app/runtime/environment.test.ts` enforce this contract.

`LOCAL_AUTH_ENABLED` is a plain local-development opt-in, not a secret. It is true only in the local Wrangler configuration/example; it is not an authorization credential and cannot enable the build-gated endpoint in production. Runtime validation requires `REMINDER_SMS_ENABLED=false` when local authentication is enabled. Do not expose this trusted local development server through a tunnel, proxy, or public interface. Production SMS remains disabled unless the validated production deployment input explicitly enables it.

## Repository protections

- `npm run scan:secrets` scans repository files for known credential signatures and reports only file/name categories, never matching values.
- `npm run doctor` rejects tracked secret files, dependency/build outputs, stale generated bindings, and production config that still contains local placeholders.
- CI has read-only repository permission, does not receive production secrets, pins actions to immutable commits, and checks for tracked-file mutation after all validation.
- The named Wrangler production environment contains no resource id. Validated production scripts inject `PRODUCTION_D1_DATABASE_ID` only into short-lived mode-0600 OS-temp configs, remove it from the child environment, disable Wrangler disk logs, and remove temporary and Vite-emitted deploy configs before reporting success. D1 operator wrappers redact only long private identifiers/paths from approved successful migration output and withhold SQL/failed provider output. The production deploy wrapper suppresses all build and Wrangler stdout/stderr instead of attempting exact or partial value replacement; abbreviated identities, canonical/capability URLs, UUIDs, payloads, and short numeric operational values therefore cannot cross that output boundary. It reports failures and successful dry-run/deploy evidence only through fixed sanitized categories/check names and never prints a deployment URL or provider payload. The UUID never belongs in Git or a direct command argument. Unqualified deploy is disabled.
- Keep D1 as the only assignment/contact/reminder authority. Do not log OAuth tokens, cookies, full phone numbers, provider payloads, or raw provider failures. Production SMS is a validated plain-binding switch that defaults false; disabled Cron must return before planning or constructing Textbelt transport.
- `npm run operator:bootstrap:prepare` and `npm run operator:contacts:prepare` accept only mode-restricted files under the ignored `.chorotate/` directory or outside the repository, write a new mode-`0600` D1 SQL file without overwrite, and report contact readiness only as category counts. Bootstrap is first-run-only, refuses any pre-existing ChoRotate structure, creates the configured household/member/identity/chore/rotation rows without assignments, and keeps private values only in the input and generated file. Both generated forms use ordinary assertion tables created and dropped within D1's atomic file-import transaction; unsupported temporary tables are forbidden, and assertion failure rolls back data and transient schema together. A later exact-email change atomically revokes that binding's D1 sessions and releases only its `auth_user_id`; unchanged bindings remain intact. Production migration list/apply and private SQL execution use only `operator:d1:migrations:list`, `operator:d1:migrations:apply`, and `operator:d1:execute`; the execution wrapper accepts exactly a mode-restricted regular `.sql` file under `.chorotate/` or outside the repository and refuses arbitrary commands. `npm run operator:d1:verify` uses the same temporary binding config and only the repository-generated aggregate query through Wrangler's clean `--command --json` result path; private SQL remains on `--file`. Verification captures remote JSON and reports check names without contact, identity, receipt, or resource values.

If exposure is suspected, revoke/rotate at the provider first, revoke affected D1 sessions, remove the material from history using the repository owner's incident process, and rerun the full release checks. Secret scanning does not replace provider-side rotation.

## Next steps

Keep the four-secret allowlist, D1-only contact state, private Textbelt key, redacted operator tooling, and no-retry ambiguous-delivery contract aligned with the operator runbook before release.
