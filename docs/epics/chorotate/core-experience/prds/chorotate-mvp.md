# ChoRotate MVP Product Requirements

Status: Active
Last updated: 2026-08-31
Doc Class: plan
Doc Type: product-requirements
Plan Type: initiative
Lifecycle: active
Authority: authoritative
Canonical Source: docs/epics/chorotate/core-experience/prds/chorotate-mvp.md
Superseded by: n/a
Parent Context: Root product requirements for the ChoRotate MVP

## 1. Summary

ChoRotate is a private, mobile-first scheduler for a small household. It makes the current and upcoming owner and date range of each weekly chore obvious, lets any authenticated household member reassign or swap work, and keeps a visible immutable record of every change.

The initial household has four data-driven members—Jack, Joe, Dylan, and Shane—and two chores:

- **Trash:** take the trash out and replace bags.
- **Dishwasher:** empty the completed dishwasher.

The initial rotation offsets the chores so one person does not normally hold both in the same week. The model must remain configurable rather than hard-code these names or chore count into domain logic.

## 2. Goals and non-goals

### Goals

1. Make “what do I do now and next?” answerable in seconds on a phone.
2. Provide deterministic, fair weekly rotation with explicit chore-specific ownership boundaries.
3. Support direct reassignment and atomic swaps by any allowed household member.
4. Preserve trustworthy, visible history showing who changed what and when.
5. Restrict all application data and actions to exact allowlisted Google identities.
6. Send two durable SMS reminders to exactly one incoming assignee for each chore period while respecting Textbelt's one-free-SMS-per-day constraint.
7. Establish a config-driven foundation that can support other households and chores later.

### Non-goals

- Chore completion tracking, points, streaks, rewards, or household gamification.
- Recurring schedules other than weekly rotation in the MVP.
- Multiple households per user, public sharing, invitations, or self-service registration.
- Native iOS/Android applications, reminder email, push notifications, or calendar-provider sync.
- User-facing administration of the security allowlist or rotation configuration in the MVP.
- Durable Objects, KV, Queues, AWS services, or a separate API service initially.
- Branding beyond the product name **ChoRotate** and the approved Chore Relay design direction.

## 3. Personas and user flows

### Personas

- **Household member:** one of the configured, allowlisted residents. Reads all schedules and history and may change assignments.
- **Deployment operator:** supplies deferred setup values, applies database/configuration changes, and deploys the Worker. This is an operational role, not an in-app elevated user.

All allowlisted household members have the same in-app assignment permissions. The product must not imply that one member is an administrator unless a future requirement introduces that role.

### Primary flows

1. **Sign in:** member selects Google sign-in; only an active exact email match in the database allowlist may create/use an account or session.
2. **Check now and next:** home shows a card for each chore with its own current and next ownership date ranges and assignees.
3. **Check personal schedule:** member sees their own chronological upcoming assignments with chore-specific ownership ranges.
4. **Browse the household:** member switches between an all-household chronological list and calendar-oriented view.
5. **Reassign directly:** member selects an assignment, chooses an active member, reviews the change, and confirms it.
6. **Swap assignments:** member selects two current/future assignments and confirms an atomic exchange of assignees.
7. **Review history:** member sees an append-only timeline with actor, timestamp, operation, before/after values, and affected chore-specific period.
8. **Receive reminder:** the incoming Trash assignee receives SMS Thursday night and Friday morning for the Friday-starting period; the incoming Dishwasher assignee receives SMS Sunday night and Monday morning for the Monday-starting period.

## 4. Configuration and scheduling model

### Configuration model

The initial deployment uses one household record with:

- stable household ID and display name;
- IANA timezone;
- evening and morning local reminder times (planned defaults `20:00` and `08:00`);
- a rotation anchor period per chore;
- ordered active member records with stable IDs, display names, normalized emails, operator-supplied E.164 phone contact/consent state, and rotation positions;
- active chore definitions with stable IDs, label, instructions, display order, ownership-start weekday, and integer rotation offset;
- materialization horizon and audit/reminder retention controls where needed.

Initial seed values are members `[Jack, Joe, Dylan, Shane]`, Trash offset `0` with Friday ownership starts, and Dishwasher offset `2` with Monday ownership starts. Exact emails, E.164 phone numbers, consent/suppression state, and timezone are deferred operator inputs. Display names, emails, and phone numbers are not interchangeable identity keys.

### Chore ownership-period semantics

1. Trash ownership starts Friday at `00:00` in the household IANA timezone and runs through Thursday; Dishwasher ownership starts Monday at `00:00` and runs through Sunday.
2. Every chore period is seven local calendar days. The UI displays its local start and inclusive end dates; persisted assignment identity uses the chore's local period-start date.
3. Period calculations operate in local calendar time before conversion to UTC so daylight-saving transitions do not shift logical ownership.
4. A chore's current period is the interval containing “now” for that chore. Its next period begins at that chore's following boundary. There is no universal household “current week” range.

### Baseline rotation semantics

For a chore's consecutive period index `w`, chore offset `o`, and `N` ordered active members, the baseline assignee index is:

`(w + o) mod N`

With the initial offsets, the four-week cycle is:

| Chore period index | Trash (Fri–Thu) | Dishwasher (Mon–Sun) |
| --- | --- | --- |
| 0 | Jack | Dylan |
| 1 | Joe | Shane |
| 2 | Dylan | Jack |
| 3 | Shane | Joe |

Offset validation should warn or reject equivalent offsets modulo member count when the stated intent is to stagger ownership. Because chore ranges overlap differently, the product does not promise one universal-week no-double-assignment invariant. Explicit human reassignment may produce overlapping ownership and must not be silently undone.

Weekly assignments are materialized authoritative records, not generated only at read time. Each chore advances through its own consecutive seven-day periods while preserving `(w + o) mod N` fairness. A rolling horizon must include each chore's current, next, and enough future periods for personal/calendar views and reminder creation. Re-materialization is idempotent and never overwrites a human-edited assignment. Past periods remain available for schedule and audit history. Configuration changes apply from an explicit future effective period per chore and do not rewrite ended or in-progress periods.

## 5. Functional requirements

### 5.1 Schedule reads

- Screens never claim one universal current-week range; each assignment/chore presents its applicable Friday–Thursday or Monday–Sunday range clearly.
- Home shows every active chore, its instructions, current assignee/range, and next assignee/range.
- Personal schedule resolves the signed-in identity to one active member and shows that member’s current and future assignments.
- Household list view is chronological and filterable by member/chore without changing authoritative state.
- Household calendar view conveys chore-specific period boundaries, chore, and assignee without relying on color alone.
- Empty, loading, stale-conflict, unauthorized, and unavailable states are explicit.

### 5.2 Reassignment and swaps

- Any active allowlisted member may reassign a current or future chore-period assignment to any active member.
- Any active allowlisted member may atomically swap the assignees of two current/future assignments, including assignments from different periods or chores.
- Ended ownership periods are immutable through normal application routes.
- A no-op change is rejected or returned as a no-op without an audit event.
- Mutations require a client request ID and expected assignment version. Stale versions return a conflict and current values; they never silently overwrite another member’s change.
- A successful swap commits both assignment changes and their linked audit records together or commits nothing.
- UI confirmation states the affected chore(s), chore-specific date range(s), outgoing assignee(s), and incoming assignee(s).

### 5.3 Authentication and authorization

- Google OAuth is the only production sign-in method in the MVP.
- The database allowlist stores normalized exact email addresses linked to active member IDs. Normalization is trim plus lowercase; aliases or plus-address equivalence are not inferred.
- Allowlist membership is checked before account creation and again on every authenticated request, including reads.
- A removed/deactivated email immediately loses application access on its next request; existing database-backed sessions are revocable.
- The system fails closed if identity, session, or allowlist state cannot be verified.
- Cookie-authenticated mutations require exact configured host/origin checks in addition to secure cookie attributes and OAuth state/PKCE protections.
- Every route enforces authentication and authorization locally; middleware or client state is not trusted as the sole control.

### 5.4 Audit history

- Every assignment create, direct reassignment, swap component, correction, and system materialization records an immutable audit event.
- Each event records event ID, operation/group ID, request ID, actor type, actor member ID when applicable, UTC timestamp, household, chore period, chore, before assignee, after assignee, assignment version, and event kind.
- Human-facing history renders actor display name, local timestamp, action, before/after assignees, chore, and chore-specific range.
- Swap events share one operation/group ID so the UI can present one atomic action without hiding either changed assignment.
- Database triggers reject update and delete attempts against audit events. Application mutation contracts ensure authenticated actor/request context reaches trigger-produced events.
- Ordinary application behavior cannot edit or erase audit history. Operational disaster recovery is outside the in-app contract and must not masquerade as a user action.

### 5.5 Reminder semantics

- SMS is the only reminder channel. ChoRotate uses `POST https://textbelt.com/text` with the public free key `textbelt`; no Resend/email path or paid messaging service remains in MVP scope.
- Each materialized assignment produces two logical reminder occurrences for exactly one recipient: the assignee of the period being announced. Trash occurrences are Thursday night and Friday morning for the Friday-starting period; Dishwasher occurrences are Sunday night and Monday morning for the Monday-starting period.
- This produces at most one planned outgoing SMS on each household-local Sunday, Monday, Thursday, and Friday. No other automatic SMS, including correction or catch-up SMS, may consume those days' quota.
- SMS content identifies **ChoRotate**, names the chore and its inclusive date range, indicates first/second reminder where useful, and includes `Reply STOP to opt out` when applicable. Content should use GSM-7 and remain at most one SMS segment whenever feasible; a multi-segment request is rejected rather than silently consuming extra quota.
- Member phone numbers are operator-supplied E.164 contact data stored in D1, omitted from source and ordinary logs, and accessible only to authorized contact-management/dispatch paths. A missing, invalid, unconsented, or suppressed contact creates visible non-delivery evidence and is never sent.
- Reminder intent and attempt evidence are persisted in D1 before network delivery. A unique logical key covers household, assignment/version, chore period, reminder phase, and recipient so overlapping Cron invocations cannot claim the same occurrence twice.
- Textbelt provides no client idempotency key. Once an outbound request may have crossed the network boundary, an ambiguous timeout/crash becomes terminal `delivery_unknown` evidence and is not automatically retried. Reliable exactly-once handset delivery cannot be guaranteed; D1 guarantees only one logical occurrence and prevents an intentional second application send after an ambiguous outcome.
- A retry is allowed only for a conclusively pre-submit failure or an explicit non-accepted response that proves no SMS/segment was consumed, and only on the same local reminder date before a safety cutoff. Out-of-quota, accepted, failed-after-submission, ambiguous, or next-day attempts are not retried or caught up, so stale work cannot consume/collide with the next day's one-SMS quota.
- Textbelt `textId`, `quotaRemaining`, accepted/failed/unknown state, sanitized error category, and status-poll evidence are retained when available. Provider acceptance is evidence, not proof of handset delivery.
- A reassignment before an unsent occurrence supersedes its recipient/content. If a prior occurrence was already accepted or is delivery-unknown, ChoRotate persists and surfaces a correction-needed state and sends the next regularly scheduled occurrence to the current assignee, but it does not promise or enqueue an immediate correction SMS to either old or new assignee.
- The free key cannot provide reply webhooks. Textbelt's STOP suppression is respected, and the operator must record opt-out/contact suppression received through any available channel; ChoRotate does not claim to ingest ordinary SMS replies.

### 5.6 Edge cases

- Inactive members remain named in historical assignments and audit events but cannot receive new assignments or SMS.
- Member deactivation or member-count/offset/start-day changes require an explicit future effective chore period and successful preview of the resulting cycle.
- Overlapping chore periods assigned to one person are allowed only as explicit state and are visually called out.
- Concurrent edits resolve through optimistic version checks; the loser refreshes and retries intentionally.
- Duplicate Cron invocations and expired leases must not create a second application send for one logical occurrence; ambiguous provider outcomes follow the no-retry limitation above.
- Timezone changes apply at explicit future chore boundaries and do not reinterpret stored historical period keys.
- Calendar/list views degrade accessibly on narrow screens and do not require hover.

## 6. Non-functional requirements

- **Accessibility:** target WCAG 2.2 AA; keyboard operation, visible focus, semantic labels, 44px-class touch targets, and non-color-only status cues.
- **Responsive behavior:** phone-first from 320px-class widths with a purposeful desktop layout, not a stretched mobile column.
- **Performance:** authenticated schedule views should avoid avoidable request waterfalls and keep primary current/next content server-renderable; exact budgets are set during implementation validation.
- **Consistency:** D1 is authoritative. No client cache, KV, or Durable Object may become a competing source of assignment truth.
- **Security:** least-secret exposure, explicit runtime env schema, fail-closed production config, secret-name allowlist, redacted logs, dependency/secret scanning, and no long-lived self-contained session JWT.
- **Reliability:** mutation and outbox state transitions are idempotent and covered by local and remote D1 integration tests; reminder transport is quota-safe and duplicate-averse rather than falsely claiming exactly-once delivery.
- **Maintainability:** rotation, chore-period, authorization, audit, and reminder rules have isolated contract tests plus end-to-end coverage of representative user journeys.

## 7. Acceptance criteria

1. With initial configuration and no overrides, four consecutive periods of each chore exactly match the assignment sequence in Section 4 while Trash remains Friday–Thursday and Dishwasher remains Monday–Sunday.
2. At any tested instant, every view renders the correct current/next range for each chore across DST boundaries and never labels one range as the universal household week.
3. Home, personal schedule, household list, and household calendar show consistent chore-specific materialized assignments/ranges on mobile and desktop.
4. Any one of the four active allowlisted members can reassign or swap current/future assignments; an ended-period edit is rejected.
5. A concurrent stale mutation returns a conflict and does not overwrite or produce a false audit event.
6. Every successful change appears in visible history with actor, local time, chore/week, and before/after values; direct database update/delete of an audit event fails.
7. A non-allowlisted Google identity cannot create an application account, establish usable access, or read any household route.
8. Removing an email from the allowlist denies its next request and permits its sessions to be revoked from D1.
9. Exactly one upcoming assignee is targeted for each of the two Trash and two Dishwasher reminder occurrences, yielding one planned single-segment SMS on Sunday, Monday, Thursday, and Friday with ChoRotate identity, range, and applicable opt-out wording.
10. D1 deduplicates logical occurrences across duplicate Cron/lease recovery; quota-safe tests prove no next-day retry/catch-up, ambiguous timeout is surfaced without a second send, and post-send changes persist/surface correction-needed state without correction SMS.
11. Automated checks cover rotation, chore-specific period boundaries, auth/allowlist, same-origin mutation protection, audit immutability, swaps, E.164/suppression handling, outbox leases/deduplication, Textbelt response/segment/quota behavior, accessible primary flows, and responsive viewport smoke tests.

## 8. Open decisions and deferred inputs

### Approved frontend decision

Direction B, **Chore Relay**, was approved on 2026-08-31, closing milestone gate `G0`. The approved contract is people-first and handoff-oriented, with clean fitted controls; four views (**Now**, **Mine**, **Household**, and **History**); responsive phone and purposeful desktop behavior; complete light and dark modes; WCAG 2.2 AA-oriented semantics, keyboard behavior, focus, touch targets, reduced motion, and non-color-only cues; direct reassignment and atomic swap flows; an accessible household multi-week view; and grouped immutable history. Direction C's visual styling and Direction A's Weekly Ledger/ruled-rota styling are not part of the approval.

The three validated mockups remain private design evidence; no prototype is production code.

### Deferred setup inputs (not planning blockers)

- exact member emails;
- household IANA timezone and exact evening/morning reminder times if the planned defaults are changed;
- exact E.164 member phone numbers plus operator-confirmed consent/suppression state;
- deployment domain and Google OAuth callback origin;

Repository setup is complete on `main` with origin `https://github.com/shanebishop1/chorotate.git`; it is no longer a deferred input.

### Implementation validation gate (not a product decision)

Better Auth must be validated with React Router v8, Cloudflare Workers, D1 migrations, database-backed session revocation, Google callback URLs, and trigger coexistence. If that bounded validation finds a blocker, the planner may select the smallest standards-compliant alternative without changing product behavior, but must update the architecture decision before implementation proceeds.

## 9. Scope

This PRD defines MVP product behavior and constraints. Architecture evidence lives in [`docs/reports/architecture/chorotate-architecture-decision.md`](../../../../reports/architecture/chorotate-architecture-decision.md); execution order lives in [`docs/milestones/mvp/INDEX.md`](../../../../milestones/mvp/INDEX.md). Closed `G0` authorizes only the disclosed lower-level PRDs and matching Beads Rust plan. Existing Git/origin setup satisfies the repository prerequisite; this PRD does not authorize application scaffolding, dependency installation, infrastructure provisioning, commits, or pushes.

## 10. Next steps

1. Use Chore Relay as the bounded frontend contract; reopen `G0` only for a material navigation, hierarchy, interaction-model, or visual-direction change.
2. Execute the foundation and bounded Better Auth/D1/frontend contract validation in milestone gate order.
3. Keep the eleven lower-level PRDs and matching Beads Rust graph limited to the already-disclosed milestone decomposition.
