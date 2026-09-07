# ChoRotate operator runbook

This runbook is for the person deploying a household instance of ChoRotate. It
uses a Cloudflare Worker and D1 database, with Google OAuth for production
sign-in. Keep production contact JSON and generated SQL private. Commands below
are run from the repository root.

## What is manual and what is automated

**Manual:** Google Cloud Console, Cloudflare Dashboard, copying/editing the
private household JSON, choosing environment values, entering secret values,
and deciding whether SMS is enabled.

**Automated by repository scripts:** `operator:bootstrap:prepare` validates a
private JSON document and creates private SQL; `operator:bootstrap:local`
migrates and bootstraps local D1; `operator:d1:*` runs fixed remote D1
operations; `operator:d1:verify` runs a redacted structural verification; and
`deploy:production` builds a temporary production Wrangler configuration and
deploys it. These scripts intentionally do not print contact values, but some
generated SQL/query text is passed to Wrangler as a process argument; keep the
terminal and process list private while running them.

## Prerequisites

1. Install Git, [Mise](https://mise.jdx.dev/), and a supported shell.
2. Clone the repository, then run:

   ```sh
   mise install
   npm ci
   ```

3. Have access to the Cloudflare account that will own the Worker and D1
   database. Have a Google account available for Google Cloud Console and for
   the OAuth test users.

## Fast local development: no OAuth

This is the recommended local smoke-test path. It uses the checked-in neutral
demo seed and the development-only local auth implementation. It does not call
Google, Cloudflare, or an SMS provider.

```sh
cp .dev.vars.example .dev.vars
npx wrangler d1 migrations apply chorotate-local --local
npm run seed:local
npm run dev
```

`.dev.vars` is local-only and ignored by Git. Do not copy production Google,
Textbelt, or household values into it.

Open <http://localhost:5173> and use the sign-in control. In a Vite
development build, the control posts to `/api/auth/local`; the server accepts
it only on loopback when `LOCAL_AUTH_ENABLED=true` and the seeded
`local-dev-user` identity exists. The local session lasts seven days. Signing
out posts to `/api/auth/local/sign-out`.

The demo path intentionally contains placeholder identities and two demo
chores. It is separate from the custom bootstrap path below.

### Custom local household

Use this alternate path when you want custom names, emails, chores, or
rotations. It is first-run-only and requires an empty local D1 database. The
wrapper applies local migrations itself; do not run `npm run seed:local` first.
Its first configured member is bound to the development-only `local-dev-user`,
so this custom path also works with the no-OAuth sign-in control.

```sh
cp .dev.vars.example .dev.vars
mkdir -p .chorotate
cp seed/operator-bootstrap.example.json .chorotate/operator-bootstrap.json
chmod 600 .chorotate/operator-bootstrap.json
```

Edit the copied private JSON, then run:

```sh
npm run operator:bootstrap:local -- \
  --input .chorotate/operator-bootstrap.json \
  --time-zone America/New_York \
  --week-start monday \
  --evening-time 20:00 \
  --morning-time 08:00
npm run dev
```

The command applies migrations and executes generated bootstrap SQL. The JSON
must remain mode `0600`, outside the repository, or below `.chorotate/`.
`householdId` must remain `chorotate`. Edit `householdName`, each member's
safe lowercase `id`, display name, normalized lowercase email, and optional
phone/consent fields. In `chores`, edit each chore's `id`, name, instructions,
`ownershipStartWeekday`, and rotation `memberIds` order. Each rotation's
`effectiveFrom` date must fall on its ownership weekday, and its member list
must contain every member exactly once.

The local wrapper adds `local-dev-user` and binds it to the first member in the
JSON. The local sign-in control therefore works with these custom names and
chores without Google OAuth. The wrapper passes SQL through a temporary mode-`0600`
file, suppresses provider output, disables Wrangler disk logs, and removes the
temporary file afterward. It never puts roommate details in command arguments.

If this checkout has already used `npm run seed:local`, do not delete or reset
the local D1 files. Use a separate clone for the custom first-run path:

```sh
cd ..
git clone https://github.com/shanebishop1/chorotate.git chorotate-custom-local
cd chorotate-custom-local
mise install
npm ci
cp .dev.vars.example .dev.vars
mkdir -p .chorotate
cp seed/operator-bootstrap.example.json .chorotate/operator-bootstrap.json
chmod 600 .chorotate/operator-bootstrap.json
```

Edit that copy and run the `operator:bootstrap:local` command above from the
new clone. This preserves the previously seeded checkout and gives the custom
bootstrap its required empty local database.

## Google Cloud Console: create the OAuth client

These are **manual** Google Cloud Console steps. Google periodically changes
navigation labels; the current console groups these settings under **Google
Auth Platform**.

1. Create or select a Google Cloud project at
   <https://console.cloud.google.com/>. Keep this project dedicated to this
   ChoRotate deployment.
2. Open **Google Auth Platform > Branding** and select **Get Started** if the
   platform is not configured. Set the app name, user support email, and
   developer/contact email. Complete the policy acknowledgement.
3. Open **Google Auth Platform > Audience**. Choose **External** for a
   household whose members are not all in one Google Workspace organization.
   Choose **Internal** only when every user is in the owning Workspace
   organization. While the app is in testing, add every intended sign-in
   address under **Test users**.
4. Open **Google Auth Platform > Data Access > Add or Remove Scopes**. Request
   only the basic sign-in scopes this app needs: `openid`, `email`, and
   `profile`. ChoRotate's calendar is an application calendar; it does **not**
   need Google Calendar API access. Do not add Drive, Calendar, or other
   sensitive scopes.
5. Open **Google Auth Platform > Clients > Create Client**. Choose **Web
   application**. Add the exact production origin as an **Authorized
   JavaScript origin**, and add the exact callback as an **Authorized redirect
   URI**:

   ```text
   Origin:   https://chorotate-production.<account-subdomain>.workers.dev
   Callback: https://chorotate-production.<account-subdomain>.workers.dev/api/auth/callback/google
   ```

   Replace `<account-subdomain>` with the workers.dev subdomain selected in
   Cloudflare. Do not add a path to the origin, and do not add a trailing slash
   to either value. The application constructs the callback as
   `<CANONICAL_ORIGIN>/api/auth/callback/google`.

6. Save the client ID and client secret in a password manager. Do not commit
   them or put them in `wrangler.jsonc`.
7. Keep the Google app in testing until the household is ready. When the
   household should no longer be limited to test users, use the Audience
   publishing control to publish it. If Google requests verification, follow
   Google's OAuth verification process; publishing is not a substitute for
   that review.

Google's references: [configure the OAuth consent screen and scopes](https://developers.google.com/workspace/marketplace/configure-oauth-consent-screen),
[OAuth web-server redirect URI rules](https://developers.google.com/identity/protocols/oauth2/web-server),
and [Google Auth Platform help](https://support.google.com/cloud/answer/15544987).

## Cloudflare account and resources

These are **manual commands or dashboard actions**. Run the commands after
installing dependencies.

1. Authenticate Wrangler and confirm the account:

   ```sh
   npx wrangler login
   npx wrangler whoami
   ```

    For a remote terminal, `npx wrangler login --device` avoids the local
    callback server. A CI/API-token setup may use `CLOUDFLARE_API_TOKEN`
    instead. The repository's `operator:*` and deployment wrappers also accept
    `CHOROTATE_CF_API_TOKEN` and map it to Wrangler's token input without
    writing it to a file; direct `npx wrangler` commands use
    `CLOUDFLARE_API_TOKEN`.

2. In the Cloudflare Dashboard, open **Workers & Pages** and select **Change**
   next to **Your subdomain**. Choose or confirm the account subdomain. The
   resulting production URL is
   `https://chorotate-production.<account-subdomain>.workers.dev` because the
   production Worker name is `chorotate-production`.

   There is no supported `workers.dev` subdomain CLI setup step in this
   runbook; use the dashboard control. Cloudflare can later attach a custom
   domain, but the OAuth origin and callback must then be changed to that exact
   custom origin before redeploying.

3. Create the remote production D1 database. The `--update-config=false` flag
   prevents Wrangler from writing a production resource ID into the tracked
   config; the deployment wrapper receives the ID through an environment
   variable instead.

   ```sh
   npx wrangler d1 create chorotate-production --update-config=false
   ```

   Record the UUID printed by Wrangler as `PRODUCTION_D1_DATABASE_ID`. Do not
   use the local placeholder UUID from `wrangler.jsonc`.

Cloudflare references: [workers.dev configuration](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/),
[Wrangler authentication and `whoami`](https://developers.cloudflare.com/workers/wrangler/commands/general/),
and [D1 Wrangler commands](https://developers.cloudflare.com/d1/wrangler-commands/).

## Production values and secrets

The deployment wrapper reads `PRODUCTION_*` values from the shell process. Put
these values in a local, ignored shell environment or secret manager; do **not**
put them in `wrangler.jsonc`, `.dev.vars`, or the private household JSON.

Set the following before any deployment or remote D1 command. Replace every
placeholder, and keep SMS disabled until consent and provider readiness are
complete:

```sh
export PRODUCTION_D1_DATABASE_ID='uuid-from-wrangler-d1-create'
export PRODUCTION_CANONICAL_ORIGIN='https://chorotate-production.<account-subdomain>.workers.dev'
export PRODUCTION_HOUSEHOLD_TIME_ZONE='America/New_York'
export PRODUCTION_HOUSEHOLD_WEEK_START='monday'
export PRODUCTION_OWNER_EMAIL='owner@example.com'
export PRODUCTION_ALLOWED_EMAILS='owner@example.com,roommate@example.com'
export PRODUCTION_REMINDER_SMS_ENABLED='false'
export PRODUCTION_REMINDER_BATCH_SIZE='25'
export PRODUCTION_REMINDER_LEASE_MILLISECONDS='300000'
export PRODUCTION_REMINDER_MAX_ATTEMPTS='5'
export PRODUCTION_REMINDER_PROVIDER_TIMEOUT_MILLISECONDS='10000'
export PRODUCTION_REMINDER_RETRY_BASE_MILLISECONDS='60000'
export PRODUCTION_REMINDER_RETRY_MAX_MILLISECONDS='900000'
```

`PRODUCTION_OWNER_EMAIL` must be lowercase and must appear in
`PRODUCTION_ALLOWED_EMAILS`. `PRODUCTION_CANONICAL_ORIGIN` must be the exact
HTTPS origin registered in Google Cloud Console. The deployment wrapper
validates all ranges and creates a temporary production Wrangler config. That
temporary production config sets `CANONICAL_ORIGIN` to
`PRODUCTION_CANONICAL_ORIGIN` and forces `LOCAL_AUTH_ENABLED=false`; neither
value is persisted in the repository.

The following are **Cloudflare Worker secrets**, not `PRODUCTION_*` inputs:

- `BETTER_AUTH_SECRET`: generate a 32-byte random secret in your password manager.
- `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`: the web client created above.
- `TEXTBELT_API_KEY`: runtime configuration currently requires this binding even
  with SMS disabled. If you do not want SMS, enter a separate random value from
  your password manager and keep `PRODUCTION_REMINDER_SMS_ENABLED=false`; you
  do not need a Textbelt account. Replace it with a real provider key before
  enabling reminders. Do not reuse your Better Auth secret.

After the first Worker deployment exists, enter each value interactively so it
does not appear in shell history:

```sh
npx wrangler secret put BETTER_AUTH_SECRET --env production
npx wrangler secret put GOOGLE_CLIENT_ID --env production
npx wrangler secret put GOOGLE_CLIENT_SECRET --env production
npx wrangler secret put TEXTBELT_API_KEY --env production
```

These commands target the `production` Wrangler environment, whose Worker name
is `chorotate-production`. Verify the selected account before entering a
secret. Secrets are retained across deployments; never pass a secret as a
command-line argument.

## First production deployment

Run these steps in order. The commands marked **script** are automated wrappers;
the choices and environment setup around them remain manual.

1. **Script:** build and validate the deployment without uploading it:

   ```sh
   npm run deploy:production:dry-run
   ```

2. **Script:** apply the ordered D1 migrations to the newly created empty
   database:

   ```sh
   npm run operator:d1:migrations:list
   npm run operator:d1:migrations:apply
   ```

3. **Script:** deploy the Worker. The explicit confirmation is required:

   ```sh
   PRODUCTION_DEPLOY_CONFIRM=chorotate-production npm run deploy:production
   ```

4. **Manual:** add the four Worker secrets above with `wrangler secret put`.
   Each command immediately deploys a new Worker version. The initial Worker
   fails closed until all required secrets exist; keep SMS disabled throughout.
5. **Script:** bootstrap the empty production household as described below.
6. **Script:** run the redacted verification as described below.
7. **Manual:** test Google sign-in with an address present in both the Google
   test-user list (while testing) and the now-populated household allowlist.
   Click **Prepare schedule** to create assignments, then check the calendar,
   a reassignment, and sign-out. Confirm an unlisted account is denied.
   Do not enable SMS merely because deployment succeeded.

## Bootstrap a production household

### Prepare private input

Copy the safe example; never edit or commit the tracked example itself:

```sh
mkdir -p .chorotate
cp seed/operator-bootstrap.example.json .chorotate/operator-bootstrap.json
chmod 600 .chorotate/operator-bootstrap.json
```

Edit the copied JSON manually:

- Keep `householdId` exactly `chorotate`; set `householdName` to the household
  name and update `recordedAt` to the current UTC timestamp with milliseconds.
- Replace every member's `id`, `displayName`, and normalized lowercase `email`.
  IDs must be lowercase kebab-case. The roster must contain 1–50 members and
  every email/display name must be unique.
- Set `phoneE164` to `null` unless that person has provided the number. Set
  `consent` to `consented` only with recorded consent; otherwise use
  `not_recorded` or `revoked`. Use `suppression: "suppressed"` to prevent an
  otherwise eligible contact from sending.
- For custom chores, edit every object in `chores`: safe `id`, display `name`,
  instructions, `ownershipStartWeekday`, and `rotation`. A rotation's
  `effectiveFrom` must be a date on that weekday. Its `memberIds` array must
  list every roster member exactly once in the desired order; the order is
meaningful. Start with rotation `offset: 0` to use the first listed roommate
   for the anchor period; higher offsets shift the starting position. Choose an
   `effectiveFrom` date on or before the first period you want scheduled.

The `chores` property is optional for backwards compatibility. Omitting it
selects the script's existing Trash/Dishwasher default. Include it, as in
`seed/operator-bootstrap.example.json`, for a custom chore set so the bootstrap
and later verification use the same configuration.

### Generate and execute bootstrap SQL

The following **script** reads and validates the private input, writes a new
mode-`0600` SQL file, and prints only readiness counts:

```sh
npm run operator:bootstrap:prepare -- \
  --input .chorotate/operator-bootstrap.json \
  --output .chorotate/operator-bootstrap.sql \
  --time-zone "$PRODUCTION_HOUSEHOLD_TIME_ZONE" \
  --week-start "$PRODUCTION_HOUSEHOLD_WEEK_START" \
  --evening-time 20:00 \
  --morning-time 08:00
```

The bootstrap is **first-run-only**. Its SQL assertion refuses to proceed if
the target already contains household, member, identity, chore, or rotation
rows. Confirm the database and input before executing:

```sh
npm run operator:d1:execute -- --file .chorotate/operator-bootstrap.sql
```

Do not reuse bootstrap SQL for an existing household. For an existing roster,
prepare a contact update instead:

```sh
npm run operator:contacts:prepare -- \
  --input .chorotate/operator-bootstrap.json \
  --output .chorotate/operator-contact-update.sql
npm run operator:d1:execute -- --file .chorotate/operator-contact-update.sql
```

That update is also exact-roster-only and clears stale auth bindings when an
email changes. Keep private JSON and SQL files out of commits, logs, support
bundles, and chat transcripts.

## Verify production D1

Set the verifier's additional expected values manually. The member count must
match the private JSON; the reminder times must match the bootstrap arguments:

```sh
export PRODUCTION_HOUSEHOLD_MEMBER_COUNT='3'
export PRODUCTION_REMINDER_EVENING_LOCAL_TIME='20:00'
export PRODUCTION_REMINDER_MORNING_LOCAL_TIME='08:00'
```

Run the no-network command first, then the remote check with the **same private
input used for bootstrap**:

```sh
npm run operator:d1:verify:dry-run -- --input .chorotate/operator-bootstrap.json
npm run operator:d1:verify -- --input .chorotate/operator-bootstrap.json
```

With `--input`, the verifier checks the configured chore names, instructions,
weekdays, rotations, member order, migrations, identity shape, contact-state
integrity, and reminder-outbox uniqueness. It does not call Textbelt. The
verification query is assembled from the private input and passed to Wrangler
as `--command`; it can contain configured chore/rotation values and member
IDs/order. It is not a value-free query, so protect shell history, process
inspection, and CI logs. The wrapper withholds provider output and the script
prints only fixed success/failure messages. Without `--input`, it expects the
legacy default chore configuration; use the input for a custom household.

SMS is optional. When `PRODUCTION_REMINDER_SMS_ENABLED=false`, the verifier
expects the missing, unconsented, and suppressed contact counts from the
private input and still rejects malformed contact states. Thus `null` phones,
nonconsent, and suppression are valid when SMS is off, while identity,
normalization, and contact-state integrity are still checked. When SMS is
enabled, sendability is required by the verifier: all active members must have
valid E.164 numbers, consent, and no suppression.

## Enable SMS later (optional)

Only enable SMS after every recipient has explicitly consented, has a valid
E.164 number, and the Textbelt account/key and sender policy are ready. Update
contacts using the private contact-update command first. Obtain a paid API key
at <https://textbelt.com/> and enter it with
`npx wrangler secret put TEXTBELT_API_KEY --env production`. Set the production
shell value, verify readiness, then redeploy:

```sh
export PRODUCTION_REMINDER_SMS_ENABLED='true'
npm run operator:d1:verify -- --input .chorotate/operator-bootstrap.json
PRODUCTION_DEPLOY_CONFIRM=chorotate-production npm run deploy:production
```

The application still suppresses missing, unconsented, revoked, or manually
suppressed contacts. Provider acceptance is not handset delivery. Keep SMS off
for households that do not want it.

The deployment config installs the `*/15 * * * *` cron automatically. Confirm
it in **Workers & Pages > chorotate-production > Settings > Trigger Events**.
Only morning reminders are currently planned, on each chore's starting weekday
at the household-local morning time. The evening field is retained but does
not schedule evening messages. Messages must fit one GSM-7 segment. Ambiguous
provider timeouts are terminal, not automatically retried; exactly-once handset
delivery, next-day catch-up, and automatic correction messages are not promised.
Record opt-outs promptly using `suppression: "suppressed"` and, when applicable,
`consent: "revoked"` in the private contact-update workflow.

## Rollback and recovery

- A failed `deploy:production` stops before or during upload and withholds
  provider output. Correct the reported input and rerun the dry run; the
  wrapper cleans temporary configs.
- Do not roll back D1 by deleting rows or rerunning bootstrap. Migrations are
  ordered and bootstrap is one-time. Restore the Worker version through the
  Cloudflare deployment/version controls, then investigate database changes
  separately.
- If a private SQL command fails, keep the SQL file private and inspect the
  redacted script error. The bootstrap assertion is designed to fail before
  changing a non-empty household.
- If Google login returns `redirect_uri_mismatch`, compare the exact HTTPS
  origin and `/api/auth/callback/google` callback in Google Cloud Console with
  `PRODUCTION_CANONICAL_ORIGIN`; do not add a wildcard.
- If an allowlisted member cannot sign in, compare the normalized email in the
  Google account, the private input, and `PRODUCTION_ALLOWED_EMAILS`. An OAuth
  login alone never bypasses the D1 household allowlist.

## References

- [Google OAuth consent, scopes, clients, and test users](https://developers.google.com/workspace/marketplace/configure-oauth-consent-screen)
- [Google OAuth web-server flow and redirect URI rules](https://developers.google.com/identity/protocols/oauth2/web-server)
- [Cloudflare workers.dev](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/)
- [Cloudflare Wrangler general commands](https://developers.cloudflare.com/workers/wrangler/commands/general/)
- [Cloudflare D1 Wrangler commands](https://developers.cloudflare.com/d1/wrangler-commands/)
