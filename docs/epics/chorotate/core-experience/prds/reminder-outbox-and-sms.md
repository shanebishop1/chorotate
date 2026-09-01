# Reminder Outbox and SMS PRD

Status: Active
Last updated: 2026-08-31
Doc Class: plan
Doc Type: product-requirements
Plan Type: initiative
Lifecycle: active
Authority: authoritative
Canonical Source: docs/milestones/mvp/INDEX.md
Superseded by: n/a
Parent Artifact: docs/epics/chorotate/core-experience/prds/chorotate-mvp.md

## 1. Summary

Translate milestone candidate `SC-10` into chore-period-aware SMS planning, durable D1 outbox dispatch, Textbelt free-endpoint delivery, quota-safe duplicate avoidance, assignment-change correction evidence, and honest delivery limitations.

## 2. Goal

Send two one-segment SMS occurrences to exactly one incoming assignee per chore period on the approved Sunday/Monday/Thursday/Friday cadence without consuming another occurrence's one-per-day Textbelt allowance or claiming exactly-once delivery that the provider cannot support.

## 3. Scope

### In scope

- Trash Thursday-night/Friday-morning and Dishwasher Sunday-night/Monday-morning occurrences, each targeting only the assignee of the announced period.
- ChoRotate-identified, opt-out-aware, GSM-7 one-segment content with chore and inclusive ownership range.
- Operator-supplied E.164 D1 member contact data, consent/suppression state, and redacted access.
- Pending occurrence supersession before send; correction-needed persistence/surfacing after an accepted or ambiguous send without immediate correction SMS.
- D1 logical occurrence uniqueness, expiring claims, bounded Cron dispatch, Textbelt `key=textbelt`, response/status evidence, quota-aware terminal states, and sanitized errors.
- Conclusive pre-submit retry only; no retry after an ambiguous timeout/submission, no next-day catch-up, and no use of the next occurrence's daily quota.

### Out of scope

- Reminder email/Resend, push/calendar sync, paid messaging services, reply-webhook behavior, another queue/state authority, product resource provisioning during planning, or provider truth replacing D1.
- A guarantee of provider/handset exactly-once delivery. D1 can prevent duplicate logical application sends, but a free-API timeout after submission is inherently ambiguous.

## 4. Acceptance criteria

- Clock-controlled tests prove exactly one planned SMS on each local Sunday, Monday, Thursday, and Friday and no reminder on other days.
- Every occurrence targets exactly one current incoming assignee and uses valid one-segment ChoRotate/period/opt-out content; invalid, missing, unconsented, or suppressed E.164 contacts are not sent.
- Duplicate/overlapping Cron and expired claims cannot issue a second application send for a logical occurrence. Ambiguous timeout/submission becomes terminal `delivery_unknown`, and retries/catch-up never roll into or consume a later local day.
- Pre-send changes supersede pending recipient/content. Post-send changes persist and surface correction-needed state, send the next ordinary occurrence to the then-current assignee, and do not enqueue old/new-recipient correction SMS.
- Textbelt `textId`, `quotaRemaining`, status evidence, attempts, and sanitized failures are retained when available without treating provider acceptance as handset delivery proof.

## 5. Stories, Tasks, and Execution Order

The closed `T-1.1`–`T-2.2` items record the superseded email implementation and remain mapped to their historical Beads items. They do not satisfy the current SMS acceptance criteria; current execution begins at `ST-3`.

### Implemented reliability/configuration substrate

The ordered `0005_reminder_reliability.sql` migration and reminder runtime now provide a transport-independent reliability substrate: schema-constrained and runtime-typed household-owned `reminder_send_local_time`, immutable `recipient_assigned` message meaning, current-period correction reconciliation from delivered recipient beliefs, preservation of unexpired in-flight work, bounded retry backoff, lease verification immediately before provider dispatch, fenced non-accepted completion, and accepted-result reconciliation after lease turnover. Provider receipt identity remains globally unique; an idempotently repeated receipt is authoritative only for the same logical outbox event and can never be reassociated to another event.

Operational reminder values are required and validated once in runtime configuration and again at the dispatcher boundary. The lease must cover the configured sequential batch (`batch size × provider timeout + 5 seconds`). The scheduled handler refreshes claim time after planning and immediately before dispatch. Scheduled infrastructure failures emit only the fixed `Reminder scheduled dispatch failed` message and reject without calling `noRetry()`.

This subset still uses the superseded Resend transport/content and sends correction messages. It therefore does **not** satisfy `ST-3`–`ST-5`, the Textbelt/no-correction-SMS contract, or release acceptance. The SMS migration must reuse or deliberately forward-migrate these reliability invariants rather than treating this subset as completed SMS evidence.

ST-1: Superseded email reminder baseline (closed)
- T-1.1: Implement the original timezone-aware email reminder planning baseline. DoD: Historical clock-controlled evidence proves the prior one-day-prior email intent, supersession, and correction-row baseline that the approved SMS migration must replace.

ST-2: Superseded email transport baseline (closed)
- T-2.1: Implement the original leased email dispatcher baseline. DoD: Historical lease, retry, Resend-idempotency, and receipt evidence identifies the transport and semantics that the approved SMS migration must remove.
- T-2.2: Verify the original end-to-end email reminder baseline. DoD: Historical integration evidence identifies prior email/correction behavior and D1 outbox coverage without granting acceptance to the superseded channel.

ST-3: Replace reminder planning with the approved SMS occurrence contract
- T-3.1: Implement chore-specific two-touch SMS occurrence planning and correction state. DoD: Clock-controlled tests prove Trash Thursday-night/Friday-morning and Dishwasher Sunday-night/Monday-morning planning, one recipient per occurrence, pre-send supersession, and visible correction-needed state without correction SMS after accepted/ambiguous sends.

ST-4: Dispatch through the Textbelt free endpoint without unsafe retries
- T-4.1: Replace Resend with one-segment Textbelt dispatch and quota-safe D1 state transitions. DoD: Contract/integration tests prove POST https://textbelt.com/text with key=textbelt, E.164/consent/suppression and segment validation, occurrence deduplication, retained textId/quota/status evidence, same-date conclusive retry only, terminal ambiguous outcomes, and no next-day catch-up or duplicate application send.

ST-5: Prove the complete SMS and correction contract
- T-5.1: Verify end-to-end SMS cadence, content, evidence, and correction surfacing. DoD: Worker/Cron/read-model tests prove one planned SMS on Sunday, Monday, Thursday, and Friday only; exactly one incoming assignee, ChoRotate/range/opt-out one-segment content, sanitized evidence, no email/Resend path, no reply-webhook claim, and explicit non-guarantee of exactly-once delivery across ambiguous provider timeout.

| Child Task | Gate | Parallel Lane | Depends On |
| --- | --- | --- | --- |
| `T-1.1` | `ST-1` | `REMINDER-plan` | `none` |
| `T-2.1` | `ST-2` | `REMINDER-dispatch` | `T-1.1` |
| `T-2.2` | `ST-2` | `REMINDER-proof` | `T-1.1` |
| `T-3.1` | `ST-3` | `REMINDER-sms-plan` | `SC-01/T-3.1, SC-03/T-3.1, SC-05/T-3.1` |
| `T-4.1` | `ST-4` | `REMINDER-sms-dispatch` | `T-3.1` |
| `T-5.1` | `ST-5` | `REMINDER-sms-proof` | `T-3.1, T-4.1, SC-07/T-3.1` |

## 6. Dependencies

- `SC-02 -> SC-10`
- `SC-03 -> SC-10`
- `SC-05 -> SC-10`
- `SC-07 -> SC-10`
- This PRD blocks `SC-11` as recorded in the [MVP milestone](../../../../milestones/mvp/INDEX.md).

## 7. Next steps

Reopen `G4` lane REMINDER after the runtime, DATA, rotation, and read-contract migration tasks close. Remove the Resend path completely; do not close this slice on simulated exactly-once claims or by adding a paid service.
