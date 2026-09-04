# ChoRotate

**MVP implementation status:** the React Router/D1/Chore Relay baseline, SMS-only reminder path, and chore-specific periods are implemented. Live Google OAuth, remote D1, one deliberately controlled Textbelt smoke, and production deployment remain operator-run checks. No remote resource is created by CI or the commands below.

ChoRotate is a mobile-first household scheduler for rotating weekly chores, direct reassignment and swaps, visible immutable change history, Google sign-in with strict email access, and SMS-only reminders. Trash ownership runs Friday–Thursday; Dishwasher runs Monday–Sunday.

## Build and run with Node 24

The repository pins Node 24 in `mise.toml` and npm 11.19.0 in `package.json`.

```sh
mise install
node --version
npm --version
npm ci
npm run doctor
npm run dev
```

Copy `.dev.vars.example` to ignored `.dev.vars` and replace its deliberately test-only values before local OAuth work. Real E.164 member contacts belong only in private operator-supplied D1 inputs. Follow the [operator runbook](docs/operations/operator-runbook.md).

## Test and release checks

```sh
npm run check          # format/schema checks, strict types, Node + workerd Vitest, planning consistency
npm run build          # production Worker build
npm run test:browser   # Playwright: four views, phone/desktop, light/dark, keyboard and axe
npm run audit          # high-severity npm audit gate
npm run scan:secrets   # redacted repository credential-signature scan
npm run check:release  # complete local release gate
git diff --exit-code   # prove tracked files did not mutate
```

Install Chromium once with `npm run test:browser:install` if Playwright requests it. CI executes the lockfile on Node 24 using Mise, pins actions to immutable commits, has read-only permissions, and never deploys or provisions resources.

## Planning documents

- [Documentation index](docs/INDEX.md)
- [MVP product requirements](docs/epics/chorotate/core-experience/prds/chorotate-mvp.md)
- [Architecture decision and research report](docs/reports/architecture/chorotate-architecture-decision.md)
- [MVP milestone and approved decomposition](docs/milestones/mvp/INDEX.md)
- [Approved lower-level PRD decomposition](docs/epics/chorotate/core-experience/prds/INDEX.md)

## Deployment inputs

Household display name, ordered member IDs/display names, exact member emails, D1-only E.164 contacts/consent/suppression state, household timezone and reminder times, deployment domain, Google credentials, Better Auth secret, and Cloudflare D1 binding are operator-supplied deployment inputs. A fresh production D1 database must use the private first-run `operator:bootstrap:prepare` workflow after migrations; later identity/contact changes use `operator:contacts:prepare`. Production deploys start with `PRODUCTION_REMINDER_SMS_ENABLED=false`, which makes Cron return before planning or transport construction; enabling one smoke or recurring reminders requires separate explicit approval. Textbelt uses the fixed public key `textbelt`; there is no reminder-provider secret. See the [security contract](docs/operations/security.md), [operator runbook](docs/operations/operator-runbook.md), and [acceptance-evidence matrix](docs/operations/mvp-acceptance-evidence.md).

`npm run deploy` is intentionally blocked. Production dry-runs and deployments use the named Wrangler `production` environment through the validated scripts documented in the operator runbook.

## Household onboarding

Create the ignored `.chorotate/household.json` file with mode `0600` and enter the
household roster, display names, exact emails, and contact preferences there. Use
`npm run operator:bootstrap:prepare` for a fresh migrated database or
`npm run operator:contacts:prepare` for later display-name/email/contact updates.
Both commands accept private files under `.chorotate/` or outside the repository
and print category counts, not values. Apply generated private SQL only after
migrations `0001`–`0008`, then follow the
[operator runbook](docs/operations/operator-runbook.md) for the complete schema
and redacted verification steps. The tracked local seed contains neutral fixture
members only and is never a production onboarding input.
