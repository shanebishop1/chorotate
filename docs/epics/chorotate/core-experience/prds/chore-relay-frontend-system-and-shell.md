# Chore Relay Frontend System and Shell PRD

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

Translate milestone candidate `SC-04` into the approved Chore Relay responsive information architecture, visual system, shell, components, and representative states.

## 2. Goal

Preserve Direction B's clean, polished, people-first handoffs and fitted controls across all four views without blending Direction C styling or retaining Direction A's Weekly Ledger direction.

## 3. Scope

### In scope

- **Now**, **Mine**, **Household**, and **History** navigation and responsive phone/desktop shell.
- People-first current-to-next handoffs with each chore's own Friday–Thursday or Monday–Sunday range, clean fitted controls, complete light/dark tokens, and non-color-only member cues.
- Household multi-week/list patterns; reassignment/swap confirmation; loading, empty, unavailable, unauthorized, error, and stale-conflict states.
- WCAG 2.2 AA-oriented semantics, keyboard/focus behavior, 44px-class touch targets, reduced motion, and no hover-only action.

### Out of scope

- Direction A's warm-paper ruled ledger, Direction C's dark-first utility-board styling, a blended alternative, production data integration, or new product behavior.

## 4. Acceptance criteria

- Representative mobile and desktop states use Chore Relay's people-first hierarchy and fitted controls.
- All four views, multi-week Household, history, reassignment/swap, and conflict/error patterns are covered in light and dark modes.
- Keyboard, semantics, focus, touch-target, reduced-motion, responsive, and non-color-only checks pass.
- Shell/components provide no universal current-week banner or label and can render simultaneous chore-specific ranges without ambiguity.

## 5. Stories, Tasks, and Execution Order

ST-1: Establish the Chore Relay system
- T-1.1: Define Chore Relay tokens, four-view information architecture, responsive navigation, and people-first handoff components. DoD: Phone and desktop shell specifications preserve B's approved hierarchy and fitted controls in complete light/dark modes, with no A/C visual import.

ST-2: Complete representative interaction states
- T-2.1: Define representative schedule, multi-week Household, History, reassignment/swap, and system states. DoD: Loading, empty, unavailable, unauthorized, error, confirmation, and stale-conflict states are represented across the required views and interactions.
- T-2.2: Verify Chore Relay accessibility and responsive behavior. DoD: Keyboard, semantics, focus, 44px-class touch targets, reduced motion, no-hover, non-color-only, and phone/desktop visual checks pass in both modes.

ST-3: Amend Chore Relay for staggered ownership periods
- T-3.1: Revise shared handoff, assignment, and range components for chore-specific periods. DoD: Representative phone/desktop light/dark states show Trash Friday-Thursday and Dishwasher Monday-Sunday ranges at the point of use, remove any universal-week claim, preserve people-first hierarchy, and remain keyboard/semantic/non-color-only accessible.

| Child Task | Gate | Parallel Lane | Depends On |
| --- | --- | --- | --- |
| `T-1.1` | `ST-1` | `UI-system` | `none` |
| `T-2.1` | `ST-2` | `UI-states` | `T-1.1` |
| `T-2.2` | `ST-2` | `UI-a11y` | `T-1.1` |
| `T-3.1` | `ST-3` | `UI-chore-periods` | `SC-01/T-3.1, T-2.1, T-2.2` |

## 6. Dependencies

- `SC-01 -> SC-04`
- This PRD blocks `SC-08` and `SC-09` as recorded in the [MVP milestone](../../../../milestones/mvp/INDEX.md).

## 7. Next steps

Reopen `G2` lane UI only for `T-3.1` after the amended foundation. Chore-specific range labels are an approved product-contract correction inside Chore Relay; they do not reopen the visual-direction choice.
