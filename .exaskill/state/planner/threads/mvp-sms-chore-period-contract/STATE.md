# ChoRotate SMS and Chore-Period Contract State

Thread Slug: mvp-sms-chore-period-contract
Last Updated: 2026-08-31
Current Planning Mode: approved material-contract amendment and execution handoff

## Current Canonical Artifacts

- `docs/epics/chorotate/core-experience/prds/chorotate-mvp.md`
- `docs/milestones/mvp/INDEX.md`
- `docs/epics/chorotate/core-experience/prds/INDEX.md`
- `docs/epics/chorotate/core-experience/prds/reminder-outbox-and-sms.md`
- `docs/reports/architecture/chorotate-architecture-decision.md`

## Latest Accepted Decisions

- SMS through Textbelt's public `key=textbelt` endpoint is the only reminder channel; email/Resend is removed.
- Trash periods run Friday through Thursday with Thursday-night and Friday-morning SMS; Dishwasher runs Monday through Sunday with Sunday-night and Monday-morning SMS.
- Each occurrence targets exactly one incoming assignee. D1 deduplicates logical sends, but ambiguous provider timeout cannot guarantee exactly-once delivery and is not retried.
- Post-send changes persist/surface correction-needed state without immediate correction SMS or paid-service fallback.
- Views show chore-specific ownership ranges and make no universal current-week claim.

## Unresolved Items

- Operator must supply exact E.164 member contacts and consent/suppression state before production readiness.
- Exact reminder-time overrides are deferred; planned defaults are 20:00 evening and 08:00 morning in the household timezone.
- Textbelt does not guarantee whether the free allowance resets by UTC day, another calendar boundary, or a rolling period; this is an accepted delivery limitation, not an open architecture decision.

## Recommended Next Workflow

- `exaskill/plan/workflows/resume-from-handoff.md`

## Latest Handoff Pointer

- Markdown: `/.exaskill/state/planner/threads/mvp-sms-chore-period-contract/handoffs/20260831T200000Z-sms-period-amendment.md`
- JSON: `/.exaskill/state/planner/threads/mvp-sms-chore-period-contract/handoffs/20260831T200000Z-sms-period-amendment.json`

## Read First On Resume

1. `/.exaskill/state/planner/threads/mvp-sms-chore-period-contract/STATE.md`
2. `/.exaskill/state/planner/threads/mvp-sms-chore-period-contract/handoffs/20260831T200000Z-sms-period-amendment.md`
3. `docs/epics/chorotate/core-experience/prds/chorotate-mvp.md`
4. `docs/milestones/mvp/INDEX.md`
5. `docs/epics/chorotate/core-experience/prds/reminder-outbox-and-sms.md`
