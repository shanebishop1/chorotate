# ChoRotate Architecture Decision

Status: Active
Last updated: 2026-08-31
Doc Class: report
Doc Type: architecture-decision-report
Report Type: decision
Decision Status: accepted
Authority: decision-authoritative
Canonical Source: docs/epics/chorotate/core-experience/prds/chorotate-mvp.md
Superseded by: n/a
Parent Artifact: docs/epics/chorotate/core-experience/prds/chorotate-mvp.md

## Summary

Use React Router v8 Framework Mode with TypeScript and the Cloudflare Vite plugin in one Cloudflare Worker. The same module owns `fetch` and `scheduled`; D1 is the sole authoritative application/contact/outbox state; Better Auth on D1 owns Google OAuth/session integration; Cloudflare Cron wakes a D1 outbox dispatcher; Textbelt's public `POST /text` endpoint with `key=textbelt` is the only reminder transport.

Do not introduce Next/OpenNext, Durable Objects, KV, Queues, AWS, a separate API service, or a self-contained long-lived JWT session in the MVP. The direct Worker integration matches the product’s CRUD shape and preserves an application-owned runtime boundary.

Plain language: this is one small house ledger and one quota-limited text courier, not a distributed platform. D1 records what should happen and what was attempted; the courier cannot promise that an ambiguous handoff happened exactly once.

The component companion is [`chorotate-architecture.puml`](chorotate-architecture.puml), with current [SVG](chorotate-architecture.svg) and [PNG](chorotate-architecture.png) renders.

## Research question

Which current greenfield architecture best supports a private, auditable weekly chore scheduler on Cloudflare while keeping authentication, reminders, and operational complexity proportionate?

## Scope

### In scope

- React Router/Cloudflare runtime choice
- D1 data ownership, materialization, audit, and outbox boundaries
- Google OAuth, allowlist, cookies, and revocable session requirements
- Cron/Textbelt free-endpoint, quota, correction, and ambiguous-delivery semantics
- Reusable engineering practices from `/projects/shane/mc-aws`

### Out of scope

- Runtime scaffolding, package selection beyond the accepted defaults, cloud provisioning, cost modeling, final schema DDL, and UI implementation.

## Method

Normal-depth research used current authoritative product documentation plus targeted inspection of the local `mc-aws` repository. Claims were translated into planning implications and caveats. No provider resources were created and no implementation was run.

## Findings and decisions

### 1. Direct React Router on Workers is the default

Cloudflare’s current React Router guide documents a first-class React Router v8 Framework Mode scaffold using the Cloudflare Vite plugin, TypeScript, an application-owned Worker entry, bindings in route context, and local execution in the Workers runtime. A module Worker can expose both `fetch` and the Cron `scheduled` handler.

**Decision:** choose React Router v8 Framework Mode + TypeScript + Cloudflare Vite plugin. Keep one deployment unit with static assets, route loaders/actions, D1 bindings, secrets, `fetch`, and `scheduled`.

**Rejected default:** Next/OpenNext. This product has no Next-specific compatibility requirement, ISR requirement, or migration constraint. Cloudflare’s current OpenNext page is oriented toward maintaining existing OpenNext applications and introduces an adapter-generated boundary. If Next becomes mandatory later, reassess the then-current Cloudflare path rather than carrying OpenNext complexity now.

### 2. D1 is authoritative and assignments are materialized

The domain needs direct edits, stable history, optimistic concurrency, and reminders tied to exact assignment versions. Read-time-only rotation generation would make human overrides and audit identity harder to reason about.

**Decision:** persist households, allowlisted identities, members and protected E.164 contact/consent state, chores, effective rotation configuration, weekly assignments, audit events, auth/session tables, reminder outbox rows, and delivery attempts in D1. Materialize a rolling assignment horizon idempotently; never overwrite a human override. Store assignment identity as household-local chore-period start date plus household ID and chore ID. Trash periods start Friday; Dishwasher periods start Monday.

No KV or Durable Object may become a second assignment authority. Caches may be introduced later only as disposable derived state with explicit invalidation and no authorization role.

### 3. Audit immutability uses database and application controls

D1 uses SQLite semantics and supports triggers, but local and remote behavior must be verified for the exact DDL. The Worker is the only normal write interface, so authenticated actor/request context can be stamped onto assignment mutations before trigger-produced audit insertion.

**Decision:**

- Every assignment has a monotonically increasing version and last-change context controlled by the Worker.
- Direct reassignments and both legs of a swap carry authenticated actor ID, request ID, operation ID, and change kind in one transactional mutation boundary.
- assignment insert/update triggers append complete before/after audit rows;
- audit-table update/delete triggers abort the statement;
- swaps share an operation ID and commit both assignment changes/audits or neither;
- contract tests inventory every assignment mutation route and prove actor/context injection;
- local and remote D1 tests prove trigger creation, transaction rollback, and immutability.

This guards against accidental or ordinary application mutation. Operator-level database disaster recovery remains an operational capability and is not represented as editable user history.

### 4. Better Auth is preferred, with a mandatory feasibility gate

Better Auth documents Google as a built-in provider, D1-compatible database support, durable user/account/session tables, database hooks, and revocable sessions. Its opaque database session model fits the requirement better than the 30-day self-contained JWT used by `mc-aws`.

**Decision:** prefer Better Auth with D1 and Google OAuth. Disable session cookie caching initially so allowlist removal and session revocation take effect on the next request. Validate adapter construction, migrations, generated types, request mounting, exact callback URLs, session revocation, and coexistence with project triggers before foundation work converges.

The database allowlist is checked in two places:

1. before account creation, preventing unauthorized account creation; and
2. on every authenticated request, preventing stale account/session state from bypassing current membership.

Failure to read session or allowlist state denies access. An active allowlist row links normalized email to one member. All authorized members have equal assignment mutation rights.

### 5. OAuth and cookie boundaries remain explicit

Better Auth owns protocol implementation only if validation proves the required guarantees. The application contract still requires OAuth state and PKCE, short-lived secure HTTP-only OAuth cookies, exact configured callback origins, secure/HTTP-only/SameSite session cookies, route-local authorization, and exact-origin checks for cookie-authenticated mutations.

The deployment domain is a deferred setup input because Google callback registration and canonical-origin checks require its exact value before production configuration, not before planning.

### 6. Cron plus D1 outbox provides quota-safe SMS reminder evidence

Cloudflare Cron is a UTC wake-up mechanism, not an exactly-once queue. Reminder eligibility must be computed from household-local chore periods and calendar days. The D1 outbox remains the durable logical-occurrence/attempt record across overlap and provider failures.

**Decision:** run a bounded scheduled dispatcher frequently enough to meet configured night/morning times (planned default wake-up: every 15 minutes). It plans exactly one incoming assignee per occurrence: Trash Thursday night and Friday morning; Dishwasher Sunday night and Monday morning. This intentionally allocates one outgoing SMS on each local Sunday, Monday, Thursday, and Friday.

Textbelt's free API has no client idempotency key and its documented “one free SMS per day” is segment-based without a guaranteed reset boundary. D1 uses a unique household/assignment-version/period/phase/recipient occurrence key, persists an attempt-start transition before network delivery, and prevents a deliberate second send. An explicit non-accepted response may retry only when it conclusively proves no segment was consumed and only on the same local date before cutoff. Submitted, out-of-quota, failed-after-submission, or ambiguous timeout/crash outcomes are terminal for sending; no next-day catch-up may collide with the next occurrence.

Reliable exactly-once delivery cannot be guaranteed across an ambiguous Textbelt timeout: crashing before send can miss a reminder, while retrying after an unknown submission can duplicate it. The MVP deliberately favors duplicate avoidance and quota preservation, records `delivery_unknown`, and surfaces that evidence instead of automatically retrying.

Pre-send reassignment supersedes the unsent occurrence. Post-send reassignment persists a correction-needed state, and the next ordinary occurrence targets the then-current assignee. It does not create immediate correction SMS because reminder days fully allocate the free quota. Textbelt's free key cannot deliver reply webhooks; STOP wording/provider suppression and operator-recorded suppression are the bounded opt-out contract.

### 7. Environment, secrets, quality, and operations stay small but strict

**Decision:** define one typed environment schema separating plain bindings/vars from secrets, fail closed on missing/invalid production configuration, maintain an explicit secret-name allowlist, pin the toolchain, provide a non-mutating doctor command, and run format/lint, typecheck, unit/contract tests, D1 integration tests, browser tests, production build, dependency audit, and secret scan in CI. Remove all `RESEND_*` inputs; `key=textbelt` is a fixed public provider selector, not a stored secret. E.164 contacts live only in D1/operator-controlled inputs.

Logs must omit emails and full phone numbers where not essential, session/OAuth values, raw provider payloads/errors, and callback query strings. Audit history may show member display names and authorized household actions inside the authenticated UI; that is product data, not general logs.

## Proposed structural design

### Runtime components

- **React Router application:** mobile-first routes, server rendering/data loading, actions, and accessible interaction states.
- **Worker entry:** exports `fetch` and `scheduled`, supplies typed bindings, and contains no parallel state store.
- **Domain services:** chore-period/rotation calculation, materializer, assignment command service, read models, audit projection, and SMS reminder planner/dispatcher.
- **D1:** authoritative domain, auth/session, audit, and outbox records with constraints/triggers.
- **Google OAuth via Better Auth:** identity proof and database session lifecycle.
- **Textbelt public free endpoint:** outbound SMS transport only; no reply webhook or idempotency key; not delivery truth.

### Primary data boundaries

| Data | Authority | Key invariant |
| --- | --- | --- |
| Allowlisted identity/member link | D1 | exact normalized active email required on every request |
| Member SMS contact | D1 | operator-supplied E.164 plus consent/suppression; never an identity key or ordinary log field |
| Rotation configuration | D1 | effective chore-period changes; historical periods never reinterpreted |
| Weekly assignment | D1 | unique household/chore/period-start; versioned; materialized |
| Audit event | D1 | append-only; trigger-guarded; full before/after context |
| Session | Better Auth tables in D1 | opaque, revocable, rechecked against allowlist |
| Reminder/outbox | D1 | one logical assignment-version/phase/recipient occurrence; terminal ambiguous outcomes; same-date conclusive retry only |
| Provider delivery | Textbelt plus D1 evidence | `textId`/quota/status are evidence, not exactly-once or handset-delivery proof |

## `mc-aws` practices to reuse deliberately

These are reference patterns, not files to copy wholesale:

- **OAuth state, PKCE, and short-lived secure cookies:** `/projects/shane/mc-aws/app/api/auth/login/route.ts` and `/projects/shane/mc-aws/app/api/auth/callback/route.ts`; lifecycle proof in `app/api/auth/auth-lifecycle.integration.test.ts` and cookie contract in `app/api/auth/login/route.rate-limit.test.ts`.
- **Exact-origin mutation protection:** `/projects/shane/mc-aws/lib/same-origin.ts`, `lib/same-origin.test.ts`, and `app/api/same-origin.contract.test.ts`.
- **Route-local authorization:** `/projects/shane/mc-aws/lib/api-auth.ts` explicitly verifies each route rather than trusting middleware headers.
- **Typed environment ownership and fail-closed production validation:** `/projects/shane/mc-aws/lib/runtime-config-schema.ts`, `lib/runtime-config-schema.test.ts`, `lib/env.ts`, and `lib/env.test.ts`.
- **Explicit Worker secret allowlist:** `/projects/shane/mc-aws/lib/runtime-config-schema.ts` (`workerSecretAllowlist`) and `scripts/get-worker-secret-allowlist.ts`.
- **Doctor/reproducibility checks:** `/projects/shane/mc-aws/scripts/doctor.ts` and the `doctor`/`repo:doctor` package scripts.
- **Quality and security CI:** `/projects/shane/mc-aws/.github/workflows/baseline-pr-validation.yml`, including non-mutating checks, typecheck, tests, builds, audits, and introduced-commit secret scanning.
- **Documented security boundaries and redaction:** `/projects/shane/mc-aws/SECURITY.md`.

## `mc-aws` practices explicitly not copied

- The 30-day signed JWT session in `/projects/shane/mc-aws/lib/auth.ts`; ChoRotate requires database-backed revocation.
- SSM-based allowlist caching; ChoRotate checks its D1 allowlist on every request.
- Next/OpenNext, CDK, CloudFormation, SSM, DynamoDB, Lambda, EC2, runtime operation state machines, lifecycle locks, hosting migration scripts, and deployment complexity.
- AWS SES/inbound-command features and cloud runtime adapters.
- Anonymous or merely “signed-in but unapproved” read access. ChoRotate is private and fails closed for all routes.

## Risks and implementation gates

| Risk | Planned control | Gate effect |
| --- | --- | --- |
| Better Auth lacks a clean React Router + Worker + D1 integration detail | bounded spike with local/remote migration, OAuth, session, and hook tests | blocks auth/data convergence, not planning |
| Better Auth schema changes conflict with project triggers | keep project audit triggers off managed auth tables; pin/inspect migrations | blocks dependency upgrade until migration review |
| D1 trigger or transaction behavior differs locally/remotely | execute exact migration and rollback/immutability suite in both | blocks assignment mutations |
| Cron overlap duplicates an application attempt | unique logical occurrence, attempt-start transition, bounded claim | blocks reminder release |
| Textbelt timeout is ambiguous and has no idempotency key | persist `delivery_unknown`; no automatic retry/catch-up; disclose exactly-once limitation | blocks any stronger delivery claim, not schedule use |
| One-segment/day quota is consumed or reset semantics differ | reject multi-segment content; use Sunday/Monday/Thursday/Friday only; terminal out-of-quota/missed evidence; no next-day retry | blocks reminder acceptance if unacknowledged |
| Free key cannot expose ordinary replies | STOP wording/provider suppression plus operator-recorded contact suppression | blocks in-app reply/opt-out ingestion claims |
| Configuration changes distort historical rotation | future effective chore period plus immutable materialized history | blocks config application |

No researched issue blocks the amended planning. Better Auth/D1 behavior already has local implementation evidence; remote D1 remains a release smoke item. Textbelt's quota, reply, and ambiguous-timeout limitations are accepted product constraints, not reasons to add infrastructure.

## Evidence and references

1. [Cloudflare: React Router on Workers](https://developers.cloudflare.com/workers/framework-guides/web-apps/react-router/) — direct React Router v8 Framework Mode, Vite plugin, Worker entry, bindings, and local runtime.
2. [Cloudflare: D1 SQL statements and SQLite compatibility](https://developers.cloudflare.com/d1/sql-api/sql-statements/) — D1 SQL/SQLite and trigger-related behavior.
3. [Cloudflare: Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/) — `scheduled()` module handler and UTC schedule behavior.
4. [Better Auth: Database](https://better-auth.com/docs/concepts/database) — D1/database setup, core schema, migrations, and hooks.
5. [Better Auth: Session management](https://better-auth.com/docs/concepts/session-management) — database sessions, revocation, and cookie-cache caveats.
6. [Better Auth: Google](https://better-auth.com/docs/authentication/google) — Google provider and exact callback/base URL setup.
7. [Textbelt: Getting started](https://docs.textbelt.com/) — `POST /text`, public `key=textbelt`, response fields, quota, status, and free-key reply limitation.
8. [Textbelt: sending/receiving FAQ](https://docs.textbelt.com/faq/sending-and-receiving-messages) — segment counting, E.164-compatible formatting, status/reply behavior, and free-key limits.
9. [Textbelt: compliance](https://docs.textbelt.com/compliance) — sender identity, consent, and STOP/opt-out guidance.
10. [Cloudflare: OpenNext](https://developers.cloudflare.com/workers/framework-guides/web-apps/opennext/) — current adapter positioning and comparison boundary.

Cloudflare/auth sources were reviewed on 2026-08-30; Textbelt sources were reviewed on 2026-08-31 for the approved amendment. Provider behavior must be rechecked at implementation start if documentation has materially changed.

## Limitations

- The existing implementation proves the former shared-week/Resend contract only; it is not evidence for the amended SMS/chore-period contract.
- Remote D1 parity, live Google behavior, and a deliberately bounded live Textbelt send remain operator-owned release evidence.
- Textbelt documents one free SMS segment per day but not a guaranteed reset timezone/rolling boundary; Sunday-night/Monday-morning and Thursday-night/Friday-morning success therefore cannot be guaranteed by calendar staggering alone.
- SMS compliance details can vary by jurisdiction/carrier. The MVP records consent/suppression, identifies ChoRotate, includes applicable STOP wording, and does not claim legal review.

## Next steps

1. Treat the 2026-08-31 Chore Relay approval and closed `G0` as the frontend input to foundation work.
2. Execute the reopened FDN → DATA/UI → ROTATION → MUTATION/READ → PRODUCT/REMINDER migration sequence before release convergence.
3. Do not add a paid service, provider idempotency fiction, reply-webhook claim, or immediate correction SMS without another material decision.
