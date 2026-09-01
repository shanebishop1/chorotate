# MVP Acceptance Evidence

Status: Active
Last updated: 2026-09-01
Doc Class: context
Doc Type: mvp-acceptance-evidence
Context Type: reference
Authority: evidence
Canonical Source: docs/epics/chorotate/core-experience/prds/chorotate-mvp.md
Superseded by: n/a

## Purpose

Map each criterion in the [ChoRotate MVP PRD](../epics/chorotate/core-experience/prds/chorotate-mvp.md) to current reproducible evidence after the SMS/chore-period amendment.

## Scope

- Credential-free automated evidence already present in the repository.
- Completed chore-period, product, mutation, SMS, security, and release evidence.
- Operator-owned external smoke evidence that local CI cannot supply.

Status labels are deliberately conservative: **Automated** means credential-free local/CI evidence exists; **External final smoke** requires operator-owned providers or deployment and is not claimed as passing here.

| PRD criterion | Evidence | Status |
| --- | --- | --- |
| 1. Four consecutive periods preserve the approved member sequence with Trash Friday–Thursday and Dishwasher Monday–Sunday. | `app/domain/rotation/rotation.test.ts` proves the four-period acceptance table independently for both chores; `period.test.ts`, `prepare.test.ts`, and `materialize.test.ts` prove Friday/Monday boundaries, DST-safe inclusive ranges, persisted anchors, insert-only idempotence, and override preservation. | **Automated** |
| 2. Every view uses correct chore-specific current/next ranges and never claims a universal household week. | `app/domain/read-models/read-models.test.ts`, `app/features/chore-relay/chore-relay.test.ts`, `app/routes/home.test.ts`, and `tests/browser/chore-relay.spec.ts` prove independent ranges at the same instant and across DST, including an explicit no-universal-week assertion. | **Automated** |
| 3. Now, Mine, Household list/calendar are consistent on mobile and desktop for both period boundaries. | Read-model and Chore Relay component tests prove one projection contract; the 60-case Playwright matrix exercises Now, Mine, Household, and History at phone/desktop widths in light/dark, including the chronological list/table representations and 320px reflow. | **Automated** |
| 4. Active members may reassign/swap current/future work; each chore's ended period is rejected. | `app/domain/commands/assignment-commands.test.ts` proves active-member authorization, direct reassignment, atomic cross-chore swap, current/future boundary rules, no-op rejection, and rollback; `app/routes/home.test.ts` and Playwright prove range-specific review and ended Trash/Dishwasher recovery states. | **Automated** |
| 5. Stale mutations conflict without overwrite or false audit. | `app/domain/commands/assignment-commands.test.ts` proves optimistic conflict values and idempotent replay; `app/routes/home.test.ts` and Playwright prove intentional review/retry without silently resubmitting stale values. | **Automated** |
| 6. Visible complete history with chore-specific ranges; audit update/delete rejected. | `app/domain/read-models/read-models.test.ts` proves grouped swap legs, actor names, local operation time, inactive-name retention, and chore ranges; Chore Relay/Playwright prove visible history and correction state; `app/domain/storage/schema.integration.test.ts` and `sms-period-schema.integration.test.ts` prove trigger-enforced audit immutability. | **Automated**; remote D1 parity remains an **External final smoke**. |
| 7. Non-allowlisted Google identity cannot create/use access or read routes. | `app/auth/better-auth.test.ts`, `app/auth/access.test.ts`, `app/domain/read-models/read-models.test.ts`, and `app/routes/home.test.ts` prove exact-email account gating, per-request denial, local route/read authorization, and fail-closed errors; `tests/workerd/better-auth-d1.test.ts` proves the real pinned Better Auth/D1 binding and race behavior. | **Automated local behavior**; live Google denial is an **External final smoke**. |
| 8. Allowlist removal denies next request and D1 sessions are revocable. | `app/auth/access.test.ts` and `app/auth/better-auth.test.ts` prove next-request allowlist rechecks; `tests/workerd/better-auth-d1.test.ts` creates and revokes a real Better Auth 1.7.2 database session and proves it no longer resolves. | **Automated local D1 behavior**; remote D1/live session verification is an **External final smoke**. |
| 9. Exactly one assignee receives each two-touch Trash/Dishwasher occurrence on Sunday, Monday, Thursday, and Friday with one-segment ChoRotate/range/STOP content. | `app/domain/reminders/planner.test.ts`, `dispatcher.test.ts`, `textbelt.test.ts`, and `tests/workerd/reminder-reliability-d1.test.ts` prove four-day cadence, one incoming recipient, GSM-7 one-segment validation, exact content, contact gating, Textbelt evidence, and redacted projections. | **Automated**; at most one deliberately approved provider send remains an **External final smoke**. |
| 10. D1 deduplicates occurrences; ambiguous submission is not retried; no next-day catch-up/correction SMS consumes quota; correction-needed state is visible. | `migrations/0007_sms_contact_period_outbox.sql`, reminder planner/dispatcher/read-model tests, and `tests/workerd/reminder-reliability-d1.test.ts` prove logical uniqueness, lease fencing, terminal `delivery_unknown`, no next-day retry/catch-up, no correction send, and the next regular occurrence/correction-needed projection. | **Automated local D1 behavior**; remote D1 parity remains an **External final smoke**. |
| 11. Automated coverage includes chore periods, E.164/suppression, Textbelt segment/quota/status/timeout behavior, accessibility, and responsive checks. | `npm run check:release` runs doctor, formatting/lint/type generation, 154 Node tests, 15 workerd/D1 tests, planning checks, operator contact tests, redacted D1 dry-run, production build, 60 Playwright phone/desktop/light/dark journeys with Axe/keyboard/320px assertions, dependency audit, secret scan, and tracked-file drift detection. | **Automated credential-free coverage**; provider/deploy checks remain external. |

## Release convergence evidence

- D1 authority, chore-specific periods, immutable audit, versioned mutations, database sessions, origin checks, and SMS-only reminder behavior have focused credential-free evidence.
- `npm run auth:schema:check` byte-compares a fresh `auth@1.7.2` Kysely/SQLite generation with ordered migration `0004`; `npm run test:workerd` proves `nodejs_als`, real Better Auth request handling, and D1 lifecycle behavior under workerd.
- `npm run doctor` validates the local release environment and repository without printing values or mutating generated bindings.
- Runtime tests validate all reminder operational bindings and the sequential-provider lease budget; Worker tests prove scheduled failures log only a fixed message, reject, and do not call `noRetry()`.
- `.github/workflows/ci.yml` installs the npm lockfile on Node 24 through Mise, uses immutable action commits, runs all release checks, and finishes with `git diff --exit-code`.
- `tests/browser/fixture/` is a Vite-only test root. It imports the production Chore Relay component with deterministic data, is absent from `app/routes.ts`, and cannot be reached from the production React Router build. It is not an authentication bypass.
- The 2026-09-01 convergence run passed 154 Node tests, 15 workerd/D1 tests, 60 Playwright journeys, production build, doctor, quality contracts, dependency audit, secret scan, operator contact tests, and the non-sending remote-D1 command dry-run.

External final smoke items remain: **live Google OAuth**, **remote D1**, at most one deliberately approved **live Textbelt** SMS, and **production deploy/cron verification**. See the operator runbook. No smoke may claim exactly-once delivery across an ambiguous provider timeout.

## Next steps

Run the operator-owned external final-smoke checklist from `docs/operations/operator-runbook.md` after Cloudflare, Google OAuth, exact private member contacts, and the production origin are available. Do not perform a live Textbelt send without the specific approval and one-send limit defined there.
