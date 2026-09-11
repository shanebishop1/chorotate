# ChoRotate operator runbook

One person configures the household in JSON and deploys it. Roommates only need
the URL and Google sign-in. You can [run locally](#run-locally) without external
accounts or [deploy your household](#deploy-your-household) for shared use.

Commands use macOS/Linux or Windows WSL with Bash/Zsh, from the repository root.
Keep `.dev.vars`, `.chorotate/production.env`, household JSON, and generated SQL
private. Do not commit them or paste their contents into logs or support tickets.

## Run locally

No Google, Cloudflare, or SMS account is needed locally.

### 1. Install and prepare

Install Git and [Mise](https://mise.jdx.dev/getting-started.html), including shell
activation. Use Bash/Zsh on macOS, Linux, or Windows WSL:

```sh
git clone https://github.com/shanebishop1/chorotate.git
cd chorotate
mise install
npm ci
cp .dev.vars.example .dev.vars
mkdir -p .chorotate
cp seed/operator-bootstrap.example.json .chorotate/operator-bootstrap.json
chmod 600 .chorotate/operator-bootstrap.json
```

### 2. Configure your household

Edit `.chorotate/operator-bootstrap.json` with your roommates and chores using
the [household field guide](#household-configuration). Include every member ID
once in each rotation, choose a start date on the chore's starting weekday, and
keep the phone and consent defaults.

Add these lines to `.dev.vars`, choosing your household's
[IANA time zone](https://en.wikipedia.org/wiki/List_of_tz_database_time_zones):

```text
HOUSEHOLD_TIME_ZONE=America/New_York
HOUSEHOLD_WEEK_START=monday
```

### 3. Bootstrap and sign in

Use the same time zone and week start below. Bootstrap applies local migrations
automatically and is first-run-only; do not also run the demo seed.

```sh
npm run operator:bootstrap:local -- \
  --input .chorotate/operator-bootstrap.json \
  --time-zone America/New_York \
  --week-start monday \
  --evening-time 20:00 \
  --morning-time 08:00
npm run dev
```

Open <http://localhost:5173>, choose **Sign in locally**, then choose
**Prepare schedule** if the Now view is empty. Local sign-in uses the first
roommate in your JSON; SMS is disabled.

On later visits, run only `npm run dev`. To configure a different household
after bootstrap or demo seeding, use a fresh clone rather than deleting an
existing database. Restart the dev server after editing `.dev.vars`.

Local sign-in is development-only and requires exactly
`http://localhost:5173` with `LOCAL_AUTH_ENABLED=true`. If the port is occupied,
stop the conflicting server. Never expose the dev server through a tunnel or
reverse proxy. For a no-edit preview, use the [optional demo seed](#fast-local-development-no-oauth)
instead of custom bootstrap.

### Development checks

These are for code changes, not required setup steps:

```sh
npm run check
```

Browser tests require Chromium:

```sh
npm run test:browser:install
npm run test:browser
```

## Deploy your household

Follow steps 1-7 with a Cloudflare account and access to Google Cloud Console.
Local setup, a custom domain, and a Textbelt account are not required. Start with
SMS off. Check Cloudflare's current
[Workers](https://developers.cloudflare.com/workers/platform/pricing/) and
[D1](https://developers.cloudflare.com/d1/platform/pricing/) quotas/pricing;
optional SMS requires provider credit.

### 1. Prepare the project

Install Git and [Mise](https://mise.jdx.dev/getting-started.html), including shell
activation. Clone this repository or your own fork:

```sh
git clone https://github.com/shanebishop1/chorotate.git
cd chorotate
mise install
npm ci
```

Already set up locally? Reuse that checkout and skip these commands. Local and
remote databases are separate; local data is not uploaded.

### 2. Create the Cloudflare resources

Sign in and confirm you selected the intended account:

```sh
npx wrangler login
npx wrangler whoami
```

For a remote terminal, use `npx wrangler login --device` instead of `login`.
API-token users can use `CLOUDFLARE_API_TOKEN`; repository wrappers also accept
`CHOROTATE_CF_API_TOKEN`. Direct `npx wrangler` commands only recognize the former.

In **Cloudflare Dashboard > Workers & Pages**, choose or confirm your
`workers.dev` subdomain. Your app's origin will be:

```text
https://chorotate-production.<account-subdomain>.workers.dev
```

Replace `<account-subdomain>`; keep `chorotate-production`. Use this exact origin
in steps 3-4, without a trailing slash.

Create the production D1 database:

```sh
npx wrangler d1 create chorotate-production --update-config=false
```

Keep the database UUID for step 4; do not edit `wrangler.jsonc`. If the database
already exists, reuse its UUID.

### 3. Register Google sign-in

Open [Google Cloud Console](https://console.cloud.google.com/) and create or
select a project for this app. Under **Google Auth Platform**:

1. **Branding:** enter the app name, support email, and developer contact; complete the setup acknowledgement.
2. **Audience:** choose **External** for personal Google accounts or mixed organizations. Use **Internal** only if everyone belongs to the same eligible Workspace organization. If the app is in testing, add your household's Google email addresses as test users.
3. **Data Access:** use only `openid`, `email`, and `profile`. No Google Calendar API or sensitive scopes are needed.
4. **Clients > Create Client:** choose **Web application**, then enter the origin and redirect URI below.

```text
Authorized JavaScript origin:
https://chorotate-production.<account-subdomain>.workers.dev

Authorized redirect URI:
https://chorotate-production.<account-subdomain>.workers.dev/api/auth/callback/google
```

Save the client ID and secret in a password manager for step 6. Publishing the
OAuth app is not required for listed test users; follow Google's requirements
if you later expand its audience.

### 4. Configure the household and deployment

If local setup already created your private household JSON, reuse it; do not
overwrite it with the example. Otherwise:

```sh
mkdir -p .chorotate
cp seed/operator-bootstrap.example.json .chorotate/operator-bootstrap.json
chmod 600 .chorotate/operator-bootstrap.json
```

Edit the JSON using the [household field guide](#household-configuration).
Use the exact Google email addresses your roommates will sign in with. Leave
phones as `null` and consent as `not_recorded` for this initial no-SMS setup.

Create a private environment file if you do not already have one:

```sh
touch .chorotate/production.env
chmod 600 .chorotate/production.env
```

Add these lines, replacing the UUID, origin, time zone, and example emails.
The allowed-email list must match your household's Google emails and include
the lowercase owner email.

```text
PRODUCTION_D1_DATABASE_ID=uuid-from-step-2
PRODUCTION_CANONICAL_ORIGIN=https://chorotate-production.<account-subdomain>.workers.dev
PRODUCTION_HOUSEHOLD_TIME_ZONE=America/New_York
PRODUCTION_HOUSEHOLD_WEEK_START=monday
PRODUCTION_OWNER_EMAIL=owner@example.com
PRODUCTION_ALLOWED_EMAILS=owner@example.com,roommate@example.com
PRODUCTION_REMINDER_SMS_ENABLED=false
PRODUCTION_REMINDER_EVENING_LOCAL_TIME=20:00
PRODUCTION_REMINDER_MORNING_LOCAL_TIME=08:00
PRODUCTION_REMINDER_BATCH_SIZE=25
PRODUCTION_REMINDER_LEASE_MILLISECONDS=300000
PRODUCTION_REMINDER_MAX_ATTEMPTS=5
PRODUCTION_REMINDER_PROVIDER_TIMEOUT_MILLISECONDS=10000
PRODUCTION_REMINDER_RETRY_BASE_MILLISECONDS=60000
PRODUCTION_REMINDER_RETRY_MAX_MILLISECONDS=900000
```

Keep the reminder tuning defaults. Times are household-local, in 24-hour format.
The evening field is required but unused; only morning reminders are planned.

Deployment, remote D1, and verification commands load this file automatically;
no `source` is needed. Exported variables override it. Keep `PRODUCTION_*` values
here, not in `wrangler.jsonc` or `.dev.vars`.

### 5. Initialize the remote household

Validate the production build without uploading, then apply the database
migrations:

```sh
npm run deploy:production:dry-run
npm run operator:d1:migrations:apply
```

Generate and apply the household SQL. **Match the four settings below to
`production.env`.** Unlike the deployment commands, preparation takes explicit
flags and does not load that file.

```sh
npm run operator:bootstrap:prepare -- \
  --input .chorotate/operator-bootstrap.json \
  --output .chorotate/operator-bootstrap.sql \
  --time-zone America/New_York \
  --week-start monday \
  --evening-time 20:00 \
  --morning-time 08:00
npm run operator:d1:execute -- --file .chorotate/operator-bootstrap.sql
npm run operator:d1:verify -- --input .chorotate/operator-bootstrap.json
```

Expect **Remote D1 verification passed**. The verifier uses the JSON's member
count and the environment file's reminder times; it does not send SMS.

Bootstrap refuses a populated household. To regenerate SQL before execution,
choose a new output filename and use it in both commands. Do not bootstrap again
after execution succeeds.

### 6. Deploy and add secrets

```sh
PRODUCTION_DEPLOY_CONFIRM=chorotate-production npm run deploy:production
```

Expect **chorotate-production Worker deployment completed**. The app stays
unavailable until you add these four secrets:

| Secret | Value |
| --- | --- |
| `BETTER_AUTH_SECRET` | A new random secret with at least 32 characters; generating 32 random bytes is suitable. |
| `GOOGLE_CLIENT_ID` | The web client ID from step 3. |
| `GOOGLE_CLIENT_SECRET` | The web client secret from step 3. |
| `TEXTBELT_API_KEY` | With SMS off, a separate random value of at least 16 characters. Do not use the words `test-only`, `placeholder`, `change-me`, or `example`. No Textbelt account is needed yet. |

The SMS key binding is currently required even when SMS is off. Never reuse
your auth secret for it. Set each value at its interactive prompt, not as a
command-line argument:

```sh
npx wrangler secret put BETTER_AUTH_SECRET --env production
npx wrangler secret put GOOGLE_CLIENT_ID --env production
npx wrangler secret put GOOGLE_CLIENT_SECRET --env production
npx wrangler secret put TEXTBELT_API_KEY --env production
```

Each secret command deploys immediately; no extra deployment is needed.
Secrets are retained on later app deployments.

### 7. Sign in and share

Open your production URL and sign in with a configured Google account. If
**Now** is empty, click **Prepare schedule** to generate assignments.

Check the views, next-month navigation, a reassignment and its history, and
sign-out/sign-in. Confirm an unlisted account is denied, then share the URL.

Keep SMS off until you separately complete [Enable SMS later](#enable-sms-later-optional).

## Household configuration

Use `.chorotate/operator-bootstrap.json` for local or production bootstrap.
JSON does not allow comments or trailing commas.

| Field | What to enter |
| --- | --- |
| `householdId` | Keep `chorotate`; this is an internal identifier. |
| `householdName` | Your household's name. |
| `recordedAt` | A UTC timestamp such as `2026-09-10T12:00:00.000Z`; update it when preparing a change. |
| `members` | 1-50 people. Each needs a unique lowercase ID such as `alex`, a unique display name, and a unique lowercase email. Do not add or remove the required fields. |
| `phoneE164`, `consent`, `suppression` | For no SMS, keep `null`, `not_recorded`, and `not_suppressed`. See the SMS section before changing these. |
| `chores` | 1-50 chores with unique IDs, unique names, and nonempty instructions. Include this list rather than relying on legacy defaults. |
| `ownershipStartWeekday` | A lowercase weekday such as `friday`. That person owns the chore for seven days starting then; this is independent of the household week-start setting. |
| `rotation.id` | A unique lowercase ID such as `rotation-recycling`; it does not have to contain a date. |
| `rotation.effectiveFrom` | A `YYYY-MM-DD` date on the chore's starting weekday, on or before the first period you want scheduled. Future start dates can leave the current period empty. |
| `rotation.memberIds` | Every member ID exactly once, in rotation order. Update every chore's list when changing the roster before bootstrap. |
| `rotation.offset` | Use `0` to assign the anchor period to the first listed member. Rotation advances weekly from `effectiveFrom`, so an old anchor does not restart with the first member today. |

IDs use lowercase letters, numbers, and hyphens. Names and instructions must
not have leading/trailing whitespace. Keep private JSON files at mode `0600`
under `.chorotate/`, or outside the repository with the same permissions.

**Editing JSON alone does not update a running household.** [Contact updates](#update-member-contacts)
can change existing names, emails, and SMS settings. Adding/removing members or
changing chores/rotations requires a separate database change; there is no wizard.

## Fast local development: no OAuth

For a no-edit preview, run this in a fresh checkout after `mise install` and
`npm ci`. **Do not combine it with custom bootstrap.**

```sh
cp .dev.vars.example .dev.vars
npx wrangler d1 migrations apply chorotate-local --local
npm run seed:local
npm run dev
```

Keep the default time zone (`UTC`). Open `http://localhost:5173`, choose
**Sign in locally**, then **Prepare schedule** if needed.

## Update an existing deployment

Keep your private JSON, environment file, and Worker secrets. Review incoming
changes, then from a clean checkout:

```sh
git pull --ff-only
npm ci
npm run deploy:production:dry-run
npm run operator:d1:migrations:apply
PRODUCTION_DEPLOY_CONFIRM=chorotate-production npm run deploy:production
```

Do not rerun bootstrap or re-enter unchanged secrets. Check sign-in and the
schedule afterward.

### Update member contacts

Edit the existing private JSON and refresh `recordedAt`, then prepare a **new**
SQL output file:

```sh
npm run operator:contacts:prepare -- \
  --input .chorotate/operator-bootstrap.json \
  --output .chorotate/operator-contact-update.sql
npm run operator:d1:execute -- --file .chorotate/operator-contact-update.sql
```

Use a new output filename for later updates. This requires the exact existing
roster. Changed emails revoke the old member sessions/auth binding. Keep the
Google test-user list and `PRODUCTION_ALLOWED_EMAILS`/`PRODUCTION_OWNER_EMAIL`
consistent with email changes, then redeploy if deployment settings changed.

## Enable SMS later (optional)

Only enable SMS after recipients have consented and your
[Textbelt](https://textbelt.com/) account has a working paid API key and credit.
For each recipient, set `phoneE164` to their number with country code,
`consent` to `consented`, and `suppression` to `not_suppressed` in the private
JSON. Apply the [contact update](#update-member-contacts) first.

Replace the random SMS key with the real provider key:

```sh
npx wrangler secret put TEXTBELT_API_KEY --env production
```

Change `PRODUCTION_REMINDER_SMS_ENABLED` to `true` **in
`.chorotate/production.env`**, then run:

```sh
npm run operator:d1:verify -- --input .chorotate/operator-bootstrap.json
PRODUCTION_DEPLOY_CONFIRM=chorotate-production npm run deploy:production
```

Verification requires every active member to have a valid phone and consent,
without suppression. Stop if it fails. Keep the SMS flag in the file so it
persists across deployments.

Confirm the `*/15 * * * *` cron under **Workers & Pages > chorotate-production >
Settings > Trigger Events**. Morning reminders use each chore's starting weekday
and the database's local reminder time, subject to the 15-minute polling interval.
Editing the verification time in `production.env` does not change the database.

Messages must fit one GSM-7 segment. Provider acceptance does not prove handset
delivery; ambiguous timeouts are not retried. There is no next-day catch-up or
automatic correction message. Apply opt-outs promptly through contact updates
using `suppressed` and, when appropriate, `revoked`.

## Troubleshooting and recovery

| Symptom | Check |
| --- | --- |
| Wrong Node/npm version or `npm` not found | Complete Mise shell activation, reopen the shell, and run `mise install` in this repository. `node --version` should match `mise.toml`. |
| Local sign-in missing or denied | Use `npm run dev`, exactly `http://localhost:5173`, and the example `.dev.vars`. Confirm local bootstrap succeeded. |
| Bootstrap refuses existing rows | This is a first-run guard. Do not delete household data or rerun bootstrap on an existing deployment. |
| SQL generation reports an existing file | Pick a new private output filename; generation will not overwrite earlier SQL. |
| `redirect_uri_mismatch` | Match the exact production origin plus `/api/auth/callback/google` in Google Console. No trailing slash or wildcard. |
| A configured member cannot sign in | Check their exact lowercase Google email in the private JSON/D1 allowlist, Google audience/test users, and production email settings. |
| No current assignment after preparation | Check each rotation's start date/weekday and that the app time zone matches the database setup. |
| Production command fails | Fix the reported input or account authorization and retry the dry run. Provider output is deliberately withheld to avoid leaking private values. |

Verification queries can contain household configuration in process arguments;
protect terminal/process access. For rollback, restore a prior Worker version
in Cloudflare. Do not delete D1 rows or rerun bootstrap; handle database recovery
separately.

## References

- [Google OAuth web-server flow and redirect URI rules](https://developers.google.com/identity/protocols/oauth2/web-server)
- [Google Auth Platform help](https://support.google.com/cloud/answer/15544987)
- [Cloudflare workers.dev](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/)
- [Wrangler commands](https://developers.cloudflare.com/workers/wrangler/commands/)
- [D1 commands](https://developers.cloudflare.com/d1/wrangler-commands/)
- [ChoRotate security contract](security.md)
