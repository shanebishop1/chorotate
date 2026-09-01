# ChoRotate Operator Runbook

Status: Active
Last updated: 2026-09-01
Doc Class: context
Doc Type: operator-runbook
Context Type: runbook
Authority: authoritative
Canonical Source: docs/operations/operator-runbook.md
Superseded by: n/a

## Purpose

Provide the operator-owned setup, migration, smoke, deployment, and rollback procedure for the [ChoRotate MVP contract](../epics/chorotate/core-experience/prds/chorotate-mvp.md).

## Scope

- Local and production configuration inputs that must remain outside source control.
- Google OAuth, D1, Textbelt-target, deployment, smoke, and rollback actions.
- Credential-free validation and the external checks that require operator credentials or deliberate live-send approval.

This runbook performs setup and release operations. CI runs only the credential-free tests and dry-run checks explicitly included in the release gate; it never runs provider setup, remote mutation, deployment, or live-send commands. Replace every angle-bracket input in your shell or provider console. Never write actual credentials into source-controlled files.

## 1. Local preparation

1. Install Mise, then from the repository run `mise install`, `node --version`, `npm --version`, and `npm ci`. The expected toolchain is Node 24 and npm 11.19.0.
2. Copy `.dev.vars.example` to the ignored `.dev.vars` and replace the OAuth/auth test-only values. Keep `.dev.vars` local. SMS uses no environment secret or sender binding; member contact data belongs only in D1.
3. Apply local D1 migrations in order:

   ```sh
   npx wrangler d1 migrations apply chorotate-local --local
   ```

   Confirm the command reports the contiguous canonical set `0001_domain_schema.sql` through `0008_sms_occurrence_times.sql`. Migration `0004_better_auth.sql` is generated, not hand-authored. The pinned command is `npm run auth:schema:generate` (`auth@1.7.2 generate --adapter kysely --dialect sqlite`); `npm run auth:schema:check` regenerates into an operating-system temporary directory and byte-compares it without changing the repository. Migrations `0007` and `0008` add D1-only SMS contacts, chore-specific periods, Textbelt outbox evidence, and evening/morning occurrence times.

4. `seed/chorotate-local.template.sql` is a test-only structural seed with deliberately unusable identities and non-sendable contacts. Apply it only to local D1 with `npm run seed:local`; never edit it with real values.
5. Run `npm run operator:contacts:test` and `npm run operator:d1:verify:dry-run`. These credential-free checks prove input validation, private SQL generation, redacted remote-check command shape, and the runtime's existing missing/malformed/unconsented/suppressed no-send contract without contacting Cloudflare or Textbelt.
6. Run `npm run doctor`, `npm run check`, `npm run build`, and `npm run test:browser`.

## 2. Provider and production inputs

### Google OAuth

In a Google Cloud OAuth web client, configure the exact deployed HTTPS origin. Register the Better Auth callback URL:

`https://<deployment-host>/api/auth/callback/google`

Set the inputs without putting values on the command line or in shell history:

```sh
npx wrangler secret put GOOGLE_CLIENT_ID --env production
npx wrangler secret put GOOGLE_CLIENT_SECRET --env production
```

Keep test and production clients separate. Verify the consent-screen configuration, published/test-user status as appropriate, exact authorized JavaScript origin, and that no wildcard callback is present.

### Better Auth

Generate a cryptographically random value of at least 32 bytes outside the repository and enter it interactively with `npx wrangler secret put BETTER_AUTH_SECRET --env production`. Do not pass it as a command argument. Rotating it invalidates cryptographic session material; plan a sign-in interruption and revoke old database sessions.

### Reminder transport status and Textbelt target

No Textbelt account, paid key, sender domain, or Worker secret is part of the MVP. The transport uses `POST https://textbelt.com/text` with the documented public key `textbelt`; do not provision a paid service or create a secret for that public value.

The public free key permits only one SMS **segment** per day, and its reset boundary is not guaranteed. Keep content to one GSM-7 segment. Trash uses Thursday night/Friday morning; Dishwasher uses Sunday night/Monday morning. Provider acceptance and a `textId` are evidence that Textbelt accepted the request, not proof of handset delivery. An accepted, out-of-quota, failed-after-submission, or ambiguous timeout/crash is never automatically retried or caught up on the next day. Exactly-once handset delivery is not claimed.

Textbelt applies STOP suppression, but the public key provides no reply webhook ingestion to ChoRotate. ChoRotate does not read ordinary SMS replies. When a member opts out through STOP or another reasonable channel, promptly use the private contact workflow below to record `suppression: "suppressed"` (and `consent: "revoked"` when applicable) before the next occurrence.

### Private exact-email and contact preparation

Create an operator-owned JSON file **outside this repository**. The file must be mode `0600`, contain exactly the four stable member IDs, exact lowercase Google emails, and each member's E.164-or-null/consent/suppression state. Use only `not_recorded`, `consented`, or `revoked` for consent and `not_suppressed` or `suppressed` for suppression. A sendable contact is E.164 (`+` plus 2–15 digits beginning 1–9), consented, and not suppressed. Never paste the file or generated SQL into a terminal, log, issue, or chat.

```json
{
  "householdId": "chorotate",
  "recordedAt": "<current-utc-iso-timestamp-with-milliseconds>",
  "members": [
    {
      "id": "<jack-joe-dylan-or-shane>",
      "email": "<exact-lowercase-google-email>",
      "phoneE164": "<operator-confirmed-e164-or-null>",
      "consent": "<consent-state>",
      "suppression": "<suppression-state>"
    }
  ]
}
```

Repeat the member object exactly once for each stable ID `jack`, `joe`, `dylan`, and `shane`.

Prepare a new mode-`0600` SQL file. The tool refuses repository-contained paths, permissive input modes, malformed/duplicate identities, malformed E.164, unknown states, output overwrite, or any member set other than Jack/Joe/Dylan/Shane's stable IDs. It reports only category counts, never values.

```sh
chmod 600 <private-json-path>
npm run operator:contacts:prepare -- --input <private-json-path> --output <new-private-sql-path>
```

The generated SQL updates only D1 `allowlisted_identities` and `members` rows and asserts that exactly four rows matched each update. Review it only in an approved private editor, then apply it to local or remote D1 as applicable. Securely remove it when retention is no longer required.

### Cloudflare D1 and Worker configuration

Resource creation is an explicit operator action, not part of this repository's CI or doctor:

```sh
npx wrangler d1 create chorotate-production
```

Do not copy the returned UUID into any repository file. `wrangler.jsonc` contains a named `production` environment without a production resource id. Export the operator values only in the shell that performs the operation:

```sh
export PRODUCTION_D1_DATABASE_ID='<returned-d1-uuid>'
export PRODUCTION_CANONICAL_ORIGIN='https://<deployment-host>'
export PRODUCTION_HOUSEHOLD_TIME_ZONE='<iana-time-zone>'
export PRODUCTION_HOUSEHOLD_WEEK_START='<weekday>'
export PRODUCTION_OWNER_EMAIL='<exact-lowercase-owner-email>'
export PRODUCTION_ALLOWED_EMAILS='<exact-comma-separated-lowercase-emails>'
export PRODUCTION_REMINDER_BATCH_SIZE='25'
export PRODUCTION_REMINDER_LEASE_MILLISECONDS='300000'
export PRODUCTION_REMINDER_MAX_ATTEMPTS='5'
export PRODUCTION_REMINDER_PROVIDER_TIMEOUT_MILLISECONDS='10000'
export PRODUCTION_REMINDER_RETRY_BASE_MILLISECONDS='60000'
export PRODUCTION_REMINDER_RETRY_MAX_MILLISECONDS='900000'
```

The production script validates all current names before building, injects the D1 UUID and plain bindings into a mode-0600 temporary Wrangler config, selects `CLOUDFLARE_ENV=production` for the Vite build, redacts injected values from child output, and deletes temporary/emitted deploy configs. Reminder bounds are: batch `1–100`, lease `6000–3600000` ms, attempts `1–20`, provider timeout `1000–30000` ms, retry base `1000–3600000` ms, and retry max `1000–86400000` ms. Retry max must be at least retry base, and lease must be at least `batch × provider timeout + 5000` ms. D1 `households.reminder_evening_local_time` and `reminder_morning_local_time` are authoritative and use `HH:mm` (`00:00`–`23:59`). D1 chores must retain Trash Friday (`5`) and Dishwasher Monday (`1`) boundaries. Run `npm run doctor`; production placeholders and non-contiguous migrations fail the check.

## 3. Migrate, smoke, and deploy

1. Create an access-controlled release evidence record. Record UTC timestamps, approvals, command exit status, current deployed Worker version, D1 backup/bookmark identifier, and sanitized failure categories. Do not record secrets, emails, phones, OAuth tokens, raw provider payloads, or capability URLs. Back up/export D1 according to the current Cloudflare D1 recovery procedure before mutation.
2. Preview migration state, then apply to the named remote database only after review:

   ```sh
    npx wrangler d1 migrations list chorotate-production --remote
    npx wrangler d1 migrations apply chorotate-production --remote
    npx wrangler d1 migrations list chorotate-production --remote
    ```

   Stop if the first preview is unexpected or the final list does not show `0001` through `0008` applied in order. Never edit migration history to force success.

3. Apply the prepared access-controlled SQL input: `npx wrangler d1 execute chorotate-production --remote --file <private-sql-path>`. Do not use `--command` with contact values. If import fails, D1 returns the database to its original state; retain the sanitized error category and do not blindly retry until the cause is known.
4. Run `npm run operator:d1:verify`. It captures Wrangler JSON internally and emits only pass/fail check names. It requires authenticated Cloudflare access to `chorotate-production`, verifies the exact `0001`–`0008` migration names, four active exact identities/sendable contacts, chore boundaries, and no duplicate logical outbox occurrences, and never invokes Textbelt. Missing, malformed, unconsented, or suppressed active contacts fail readiness without printing them. A deliberate opt-out remains correctly non-sendable; record that approved exception rather than weakening D1 state or forcing a send.
5. Run the complete local gate: `npm run check:release` from a clean checkout. Confirm `git status --porcelain=v1` remains empty.
6. Build and inspect without deployment: `npm run deploy:production:dry-run`. An unqualified `npm run deploy` always refuses before build or upload.
7. Deploy only after approval. Set `PRODUCTION_DEPLOY_CONFIRM=chorotate-production`, then run `npm run deploy:production`. This command is intentionally absent from CI and fails before build/upload when confirmation or any production input is invalid.

## 4. Cron and production verification

The Worker cron is `*/15 * * * *`. After deployment, verify that exact trigger in Cloudflare and record its status without copying sensitive logs. Invoke only a controlled non-sending validation when possible, then rerun `npm run operator:d1:verify`. Confirm one claim/attempt per logical assignment-version/phase/recipient occurrence. Scheduled infrastructure failure logs the fixed redacted message and rejects so the platform observes failure. Never manually requeue `delivery_unknown`, force duplicate real messages, or use catch-up work that can consume the next day's slot.

Final external smoke checklist:

- Sign in with one exact allowlisted Google identity; verify a non-allowlisted identity is denied and an allowlist removal denies the next request.
- Confirm the active allowlist row is bound to that Better Auth user id. An unbound/backfill row must not authorize an existing session; account creation recovery may only atomically claim the exact normalized active identity for the same auth user.
- Verify Now, Mine, Household, and History at phone and desktop widths in light and dark modes.
- Against remote D1, retain sanitized evidence for migration order, materialization, direct reassignment, atomic swap, stale conflict, immutable audit triggers, outbox uniqueness, contact no-send states, and session revocation.
- Only with explicit approval naming the low-risk day, consenting recipient, and quota owner, allow the deployed application to send **at most one** controlled live Textbelt reminder. Do not call Textbelt directly from a shell. Verify one-segment ChoRotate/range/STOP content, `textId`/quota/status evidence when available, sanitized/phone-redacted fields, and D1 duplicate suppression by inspection or non-sending checks; never repeat the live provider call. Provider acceptance does not prove handset delivery, and an ambiguous timeout remains terminal with no retry.
- Verify HTTPS origin/cookies, Google callback, Worker logs (no secret values), observability, and cron health.

These live Google, remote D1, live Textbelt, and production deployment checks cannot truthfully pass in credential-free local CI. A live smoke also cannot prove exactly-once delivery across an ambiguous provider timeout.

## 5. Rollback

On any failed gate, record the command, UTC time, exit status, affected non-secret check names, and decision in the private release evidence; do not paste raw config/provider output. Do not reverse an applied D1 migration by deleting migration records or editing history. Stop traffic-changing operations, disable the cron if reminders could be unsafe, and roll the Worker back to the previously recorded Cloudflare version. Use a reviewed forward-fix migration for schema defects. Restore D1 from the pre-deploy backup only for an approved disaster-recovery event, then rerun the redacted remote verification and reconcile immutable audit/outbox state before re-enabling writes or cron. Rotate compromised Google/Better Auth/Cloudflare credentials and revoke affected sessions independently of code rollback. A live SMS cannot be rolled back; suppression and no-retry rules remain in force.

## 6. Next steps

Keep this runbook aligned with `SC-01`, `SC-03`, `SC-10`, and `SC-11`. Do not perform a live Textbelt send until all credential-free gates and remote D1 verification pass and the specific one-segment smoke is deliberately approved.
