# ChoRotate Documentation

## Operations and release evidence

- [Operator runbook](operations/operator-runbook.md)
- [Repository security contract](operations/security.md)
- [MVP acceptance evidence](operations/mvp-acceptance-evidence.md)

Status: Active
Last updated: 2026-08-31
Doc Class: index
Doc Type: docs-root-index
Authority: authoritative-routing
Canonical Source: docs/INDEX.md
Superseded by: n/a

## Purpose

Route readers to the minimal durable planning set for ChoRotate.

## Scope

- Product intent and requirements, including SMS-only reminders and chore-specific ownership ranges
- Architecture evidence and accepted technical direction
- MVP sequencing and the closed frontend approval gate
- Approved Chore Relay frontend contract and lower-level PRD decomposition

## Canonical planning surfaces

- PRD: [`docs/epics/chorotate/core-experience/prds/chorotate-mvp.md`](epics/chorotate/core-experience/prds/chorotate-mvp.md)
- Architecture report: [`docs/reports/architecture/chorotate-architecture-decision.md`](reports/architecture/chorotate-architecture-decision.md)
- Architecture diagram: [`docs/reports/architecture/chorotate-architecture.puml`](reports/architecture/chorotate-architecture.puml)
- Milestone plan: [`docs/milestones/mvp/INDEX.md`](milestones/mvp/INDEX.md)
- Lower-level execution PRDs: [`docs/epics/chorotate/core-experience/prds/INDEX.md`](epics/chorotate/core-experience/prds/INDEX.md)

## Next steps

Proceed through the amended milestone sequence. Chore Relay remains the approved frontend direction; focused contract-migration tasks reopen `G1`–`G4` before release convergence. The `main` repository and origin `https://github.com/shanebishop1/chorotate.git` satisfy the repository prerequisite. Do not implement application code, provision product resources, commit, or push during this planning transition.
