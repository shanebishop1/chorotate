# ChoRotate MVP Milestone and Execution Plan

Status: Active
Last updated: 2026-08-31
Doc Class: plan
Doc Type: milestone-spec
Authority: authoritative-sequencing
Canonical Source: docs/epics/chorotate/core-experience/prds/chorotate-mvp.md
Superseded by: n/a
Parent Artifact: docs/epics/chorotate/core-experience/prds/chorotate-mvp.md
Parallel Plan: yes

## Summary

This milestone defines the minimum story-shaped delivery sequence for the ChoRotate MVP. Direction B, **Chore Relay**, remains the approved visual/frontend direction. On 2026-08-31 the user approved a material product-contract amendment: SMS/Textbelt replaces reminder email/Resend, and Trash and Dishwasher use distinct Friday and Monday weekly ownership boundaries. The same eleven slices remain canonical, but focused migration tasks reopen `G1`–`G4` before `G5` can converge.

Technical rationale: the first hard gate freezes the only user-owned direction decision. One shared foundation then allows auth, D1, and frontend contracts to be validated in parallel. Vertical capability lanes begin only after those contracts converge, minimizing expensive cross-lane churn.

Plain language: agree on the shape of the house first, then let separate crews validate the lock, schedule, and rooms before joining them.

## Goal

Deliver a secure, auditable, mobile-first household scheduler that satisfies the amended PRD without introducing infrastructure beyond one Worker, D1, Google OAuth, Cron, and Textbelt's public free SMS endpoint.

## Scope

### In scope

- Approved Chore Relay frontend direction and bounded frontend contract
- React Router/Worker foundation
- Better Auth/D1 validation and strict allowlist
- Materialized fair rotation over Trash Friday–Thursday and Dishwasher Monday–Sunday periods, assignment mutations, and append-only audit
- Current/next, personal, household list/calendar, and history views with chore-specific ranges
- Cron/D1 outbox/Textbelt free-key SMS reminders on Sunday, Monday, Thursday, and Friday
- Tests, CI, doctor, security checks, and deployment readiness

### Out of scope

- Further Git initialization, remote changes, commits, or pushes during this planning transition; `main` and origin are already configured
- Application/runtime scaffolding during this planning transition
- Cloudflare, Google, paid messaging, or AWS resource provisioning and quota-consuming SMS during planning
- Any lower-level story/PRD or Beads Rust scope beyond the eleven disclosed candidates

## Entry criteria

- PRD and architecture decision exist and validate as planning artifacts.
- The user has authorized durable planning and autonomous non-frontend product/architecture decisions.
- Chore Relay is approved and `G0` is closed.

## Approved frontend direction

**Direction B: Chore Relay — approved 2026-08-31.** Use B's clean, polished, people-first handoff structure. The current and next people are the dominant schedule cues, while chore, instructions, and each chore's ownership-period boundaries remain explicit. Controls and buttons stay fitted to their content and context, remain touch-friendly, and preserve the fit and feel approved in the validated B mockup.

The product retains four clear views: **Now**, **Mine**, **Household**, and **History**. Now makes each current-to-next chore handoff immediately scannable. Mine is chronological and personal. Household provides the required useful multi-week schedule plus an accessible list alternative. History groups operation details so direct changes and both legs of a swap remain trustworthy and understandable. Reassignment and swap use explicit selection, before/after review, confirmation, stale-conflict recovery, and no drag-only interaction.

The contract is phone-first from 320px-class widths and becomes a purposeful desktop layout rather than a stretched phone column. Every view and interaction supports complete light and dark modes without adopting Direction C's dark-first palette or visual styling. Member color may aid scanning but never carries meaning alone. Keyboard access, visible focus, semantic labels, 44px-class touch targets, reduced motion, and WCAG 2.2 AA remain required.

Direction C's Household view and light mode were positively noted, but C was rejected overall and its styling is not imported. Direction A was strongly rejected; its Weekly Ledger, warm-paper, ruled-table, and rota-book visual direction is not retained. Independent functional requirements for household multi-week visibility, history, and accessibility remain binding regardless of prototype provenance.

**Bounded post-approval design work:** establish Chore Relay tokens/components and representative states for Now, Mine, Household multi-week/list, History, reassignment/swap confirmation, loading/empty/error/conflict, light/dark modes, and responsive phone/desktop behavior. No alternative or blended visual lane is authorized; material deviation reopens `G0`.

## Gate definitions

| Gate ID | Purpose | Entry criteria | Exit criteria |
| --- | --- | --- | --- |
| `G0` | Frontend direction approval — **closed 2026-08-31** | Three validated private mockups were reviewable | User approved Direction B, Chore Relay, its bounded post-approval contract, and translation of the disclosed decomposition into lower-level PRDs/Beads Rust |
| `G1` | Shared foundation — **reopened for contract amendment** | `G0` approved; repository prerequisite satisfied | Existing runtime remains stable; all Resend inputs are removed; fixed public Textbelt transport/no-new-secret vocabulary is proven |
| `G2` | Parallel contract validation — **reopened for contract amendment** | amended `G1` closed | Better Auth remains valid; D1 contact/chore-period/outbox migration passes; Chore Relay components represent distinct ranges |
| `G3` | Core domain capabilities — **reopened for contract amendment** | amended `G2` closed | Chore-specific materialization, mutation boundaries, and read/correction projections pass independently |
| `G4` | Vertical product convergence — **reopened for contract amendment** | amended `G3` closed | Schedule/change/history views and Textbelt SMS flow work end to end against the amended contracts and limitations |
| `G5` | Release readiness | `G4` closed and deferred deployment inputs supplied | Full CI/doctor/security/accessibility/remote D1 evidence passes and deployment runbook inputs are complete |

## Lane definitions

- Lane **FDN** (`G1`, serial): remove Resend env/secret/type contracts and establish fixed Textbelt/no-secret vocabulary.
- Lane **AUTH** (`G2`, parallel): Better Auth Google/D1 feasibility, database sessions, exact allowlist, route-local auth, and same-origin mutation contract.
- Lane **DATA** (`G2`, parallel): D1 E.164 contact/consent, chore-period, correction, outbox occurrence/status fields, migrations, and parity proof.
- Lane **UI** (`G2`, parallel): approved responsive components/states amended to show Friday Trash and Monday Dishwasher ranges without a universal week.
- Lane **ROTATION** (`G3`, first): independent chore-period semantics, fair offset rotation, materialization, effective configuration, and DST coverage.
- Lane **MUTATION** (`G3`, after ROTATION): optimistic direct reassign/swap and audit behavior evaluated against each chore's actual period end.
- Lane **READ** (`G3`, parallel with MUTATION after ROTATION): current/next, personal, household, history, and redacted correction-status projections.
- Lane **REMINDER** (`G4`, parallel): two-touch SMS planning, free Textbelt dispatch, no-provider-idempotency limitations, quota-safe terminal outcomes, and correction evidence without correction sends.
- Lane **PRODUCT** (`G4`, parallel): approved UI integrated with chore-period read/mutation/history/correction contracts.
- Lane **QUALITY** (`G5`, convergence): end-to-end, accessibility, security, CI, doctor, production configuration, and remote smoke evidence.

## Approved child PRD slices

These eleven approved candidates are mirrored 1:1 by lower-level PRDs in [`docs/epics/chorotate/core-experience/prds/INDEX.md`](../../epics/chorotate/core-experience/prds/INDEX.md). They remain the complete authorized decomposition; task lines inside those PRDs may divide a candidate into focused implementation/verification passes but may not add product scope.

| Slice | Gate/lane | Focused outcome | Depends on | Verification that closes the slice |
| --- | --- | --- | --- | --- |
| `SC-01` Foundation and shared contracts | `G1` / FDN | Existing Worker foundation drops Resend inputs and defines fixed Textbelt/no-secret transport vocabulary | `G0` | generated/env/doctor/security tests contain no `RESEND_*`, no Textbelt secret, and keep phone data in D1 |
| `SC-02` Better Auth and access feasibility | `G2` / AUTH | Google OAuth on D1 proves account-create allowlist, per-request allowlist, revocable DB sessions, PKCE/state, cookies, exact origin, and route-local auth | `SC-01` | local/remote D1 auth integration and unauthorized/revocation tests pass |
| `SC-03` D1 schema, migrations, and trigger proof | `G2` / DATA | Existing D1 authority adds protected E.164/consent, chore-period, correction, and Textbelt evidence/state boundaries | `SC-01` | local/remote parity proves new constraints, occurrence uniqueness, ambiguous states, and no phone leakage |
| `SC-04` Approved frontend system and shell | `G2` / UI | Chore Relay shared components represent simultaneous chore-specific ranges and remove universal-week claims | `SC-01` | representative phone/desktop light/dark accessibility states show Friday Trash and Monday Dishwasher ranges |
| `SC-05` Week rotation and materialization | `G3` / ROTATION | Each chore advances through its own consecutive seven-day periods while preserving offset fairness and overrides | `SC-03` | deterministic/DST/property tests prove Friday–Thursday Trash and Monday–Sunday Dishwasher four-period sequences |
| `SC-06` Audited assignment commands | `G3` / MUTATION | Existing versioned reassign/swap behavior uses each chore's actual period end and audit identity | `SC-02`, `SC-03`, `SC-05` | boundary, authorization, conflict, rollback, audit grouping, and immutability tests pass |
| `SC-07` Schedule and history read models | `G3` / READ | Projections return chore-specific ranges and safe correction/delivery status with no universal week/full-phone leakage | `SC-02`, `SC-03`, `SC-05` | route/data contracts cover both boundaries, filters, correction states, history, and denial |
| `SC-08` Schedule viewing experience | `G4` / PRODUCT | Now, Mine, and Household display correct independent ranges in the approved responsive direction | `SC-04`, `SC-05`, `SC-07` | phone/desktop browser journeys remove universal-week claims and pass accessibility checks |
| `SC-09` Reassignment, swap, and history experience | `G4` / PRODUCT | Change/history journeys use actual ranges and proportionally surface correction-needed state | `SC-04`, `SC-06`, `SC-07` | multi-user journeys prove range labels, ended-period behavior, conflict/history, and no immediate-correction promise |
| `SC-10` Reminder outbox and SMS | `G4` / REMINDER | Two single-recipient occurrences per chore use Textbelt free endpoint on Sunday/Monday/Thursday/Friday with quota-safe duplicate avoidance | `SC-02`, `SC-03`, `SC-05`, `SC-07` | clock, segment, E.164/suppression, duplicate-Cron, explicit-response, ambiguous-timeout, no-next-day-retry, content, and correction-state tests pass |
| `SC-11` Release quality and operator readiness | `G5` / QUALITY | CI, doctor, security/contact redaction, production config, remote D1 smoke, and amended setup documentation close | `SC-08`, `SC-09`, `SC-10` | clean-checkout checks prove no Resend/email path, no unsafe SMS claim/send, and no unauthorized resource creation |

Each candidate has one corresponding PRD/story artifact and task lines in Section 5. Each task is intended for one subagent in one focused pass.

## Dependencies and edges

- `G0 -> SC-01`
- `SC-01 -> SC-02`
- `SC-01 -> SC-03`
- `SC-01 -> SC-04`
- `SC-03 -> SC-05`
- `SC-02 -> SC-06`
- `SC-03 -> SC-06`
- `SC-05 -> SC-06`
- `SC-02 -> SC-07`
- `SC-03 -> SC-07`
- `SC-05 -> SC-07`
- `SC-04 -> SC-08`
- `SC-05 -> SC-08`
- `SC-07 -> SC-08`
- `SC-04 -> SC-09`
- `SC-06 -> SC-09`
- `SC-07 -> SC-09`
- `SC-02 -> SC-10`
- `SC-03 -> SC-10`
- `SC-05 -> SC-10`
- `SC-07 -> SC-10`
- `SC-08 -> SC-11`
- `SC-09 -> SC-11`
- `SC-10 -> SC-11`

The amended graph is acyclic. After FDN, AUTH remains complete while DATA and UI amendments run in parallel. ROTATION follows DATA; MUTATION and READ follow ROTATION and may run in parallel. PRODUCT and REMINDER then converge against stable chore-period/read contracts.

## Convergence and fallback plan

- **G2 convergence:** do not begin core domain stories unless Better Auth is viable, D1 trigger/transaction semantics pass local and remote proof, and the frontend contract is aligned to the approved direction.
- **Auth fallback:** if Better Auth is blocked, stop only AUTH consumers, record the evidence, and amend the architecture decision with the smallest database-session OAuth alternative. Do not add Next, external auth infrastructure, or JWT-only sessions by default.
- **D1 fallback:** if exact trigger behavior is blocked, stop mutation/audit work and redesign within D1 before considering another state service.
- **Frontend fallback:** ordinary refinements continue autonomously inside the approved direction. Any material change to navigation, hierarchy, interaction model, or visual direction reopens `G0`.
- **Reminder fallback:** explicit pre-submit/non-accepted failures may retry only on the same local occurrence date when no segment was consumed. Out-of-quota, submitted, ambiguous, or next-day work becomes visible terminal/missed evidence; it never catches up into the next daily slot. Schedule reads/mutations remain available.
- **Correction fallback:** a post-send reassignment marks correction-needed state and the next ordinary occurrence uses the current assignee. No immediate correction SMS is promised because reminder days fully allocate the free quota.

## Implementation handoff paths

These are minimum ownership surfaces, not permission to widen a task. Each open Beads task remains one focused pass and should read its parent PRD first.

| Task/lane | Minimum implementation context |
| --- | --- |
| `SC-01/T-3.1` FDN | `app/runtime/environment.ts`, `app/runtime/security.ts`, runtime tests/fixtures, `.dev.vars.example`, `wrangler.jsonc`, production/doctor/secret-scan scripts, generated Worker bindings |
| `SC-03/T-3.1` DATA | `migrations/`, `app/domain/storage/d1.ts`, `app/domain/storage/schema.integration.test.ts`, private seed contract |
| `SC-04/T-3.1` UI | `app/features/chore-relay/`, shared domain view contracts, representative component/browser fixtures |
| `SC-05/T-3.1` ROTATION | `app/domain/rotation/`, `app/domain/contracts.ts`, materialization/property/DST tests |
| `SC-06/T-3.1` MUTATION | `app/domain/commands/assignment-commands.ts` and focused command/route tests |
| `SC-07/T-3.1` READ | `app/domain/read-models/`, read-model contracts/tests, redacted reminder-state projection |
| `SC-08/T-3.1` PRODUCT-view | `app/features/chore-relay/`, `app/routes/home.tsx`, route/component tests, `tests/browser/fixture/` and schedule journeys |
| `SC-09/T-3.1` PRODUCT-change | assignment dialogs/history surfaces under `app/features/chore-relay/`, route action states, multi-user browser journeys |
| `SC-10/T-3.1`–`T-5.1` REMINDER | `app/domain/reminders/`, `app/domain/storage/d1.ts`, `workers/app.ts`, scheduled/Worker tests, and the DATA/read contracts; remove rather than wrap the Resend module |
| `SC-11/T-1.1`–`T-2.1` QUALITY | `package.json`, `.github/workflows/`, doctor/deploy/secret-scan scripts, browser/release checks, `docs/operations/`, and `README.md` |

## Verification evidence expectations

Planning-stage validators are run against this file before presenting the decomposition as ready. Future implementation stories must select exact commands from the scaffolded repository, with at least these surfaces:

- non-mutating format/lint and TypeScript checks;
- unit and property tests for chore-specific period/rotation semantics;
- local and remote D1 migration, trigger, transaction, and outbox integration tests;
- auth/allowlist/session/origin contract tests;
- browser journeys for current/next, personal, household list/calendar, reassign, swap, conflict, history, and denial;
- automated accessibility checks plus keyboard/manual responsive review;
- Cron overlap, lease expiry, logical occurrence deduplication, one-segment validation, Textbelt responses/status, ambiguous timeout, quota collision, suppression, and correction-state tests;
- production Worker build, generated binding types, doctor, dependency audit, and secret scan;
- clean-checkout CI proving validation does not mutate tracked files.

## Definition of done

- All eleven amended child outcomes are complete with evidence; historical closed tasks do not substitute for reopened migration-task DoDs.
- Every PRD acceptance criterion is traceable to passing automated or explicit review evidence.
- D1 remains the only authoritative state, audit rows are immutable, sessions are revocable, and non-allowlisted access fails closed.
- The deployed UI follows the approved direction on phone and desktop.
- Deferred setup values, including E.164 contacts and consent/suppression state, are supplied and validated without entering source control or ordinary logs.
- No unapproved infrastructure or architecture has been introduced.

## Next steps

1. Keep Chore Relay and closed `G0` as the frontend source for all downstream work.
2. Execute the focused amendment tasks inside the disclosed lower-level PRDs in the documented gate/lane and dependency order; do not add paid messaging or restore email without another material decision.
3. Treat the existing `main` repository and configured ChoRotate origin as satisfying G1's repository prerequisite; commits and pushes remain outside this planning transition.
