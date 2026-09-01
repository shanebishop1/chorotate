# ChoRotate Frontend Comparison Brief

Status: Approved for comparative prototype execution
Capability: direction-exploration
Approved: 2026-08-30

## Decision

Choose a simple, mobile-first interface direction for a four-person weekly chore scheduler by reviewing three working HTML mockups under equivalent content and viewport conditions.

## Users And Dominant Task

Jack, Joe, Dylan, and Shane need to answer “who has Trash and Dishwasher now, who is next, and when am I up?” in a few seconds, primarily on a phone. Any signed-in member may reassign or swap future assignments and then inspect the immutable operation history.

## Shared Prototype Contract

- Self-contained static HTML/CSS/JavaScript with no network or runtime dependencies.
- Responsive at 390x844 and 1440x900.
- Simple navigation across Now, Mine, Household, and History views.
- Household includes a useful multi-week/calendar representation, not only a list.
- Every concept has a visible light/dark mode control and complete styling in both modes.
- Representative data is identical: Jack, Joe, Dylan, Shane; Trash and Dishwasher; week of Aug 31-Sep 6, 2026; signed-in member Shane.
- Now shows Trash assigned to Jack and Dishwasher assigned to Dylan, plus Joe and Shane as the next assignees.
- A simulated reassign flow must be usable without implying production persistence.
- Accessibility: semantic controls, visible keyboard focus, no color-only meaning, touch-sized primary actions, reduced-motion support.
- Prototype output is design evidence only, not production code.

## Approved Paths And Model Mapping

1. **Path A: Rota Book** — calm cream-and-ink weekly tables and ruled rota structure. GPT baseline (`openai/gpt-5.6-sol`).
2. **Path B: Chore Relay** — colorful people-first handoffs emphasizing who is up now and next. Qwen open-weight comparison (`opencode-go/qwen3.8-max`).
3. **Path C: House Ops** — high-contrast task-first utility board optimized for rapid status scanning. Kimi open-weight comparison (`opencode-go/kimi-k3`).

## Useful Variation Axes

- schedule-first vs people-first vs task-first hierarchy;
- ruled table vs handoff flow vs compact status board;
- navigation and responsive disclosure;
- household multi-week representation;
- density and visual tone.

## Fixed Constraints

- Keep every path simple despite its distinct visual language.
- Preserve all four views and both color modes.
- Do not add gamification, points, completion tracking, admin configuration, social features, or production integration.
- Keep model provenance out of the visible comparison labels.

## Selection State

Browser validation and private Shlook publication completed on 2026-08-31.

- Private review: https://private.shlook.shane-bishop.com/assets/fddd5545-dd17-43b0-bb2b-594d1f60807e/
- Asset ID: `fddd5545-dd17-43b0-bb2b-594d1f60807e`
- Verified visibility: `private`

**Approved on 2026-08-31: Path B, Chore Relay.** The user found B to have the cleanest structure and strongest polish, with controls and buttons that fit and feel good, and concluded “honestly just go with B.” Direction C's Household view and light mode were liked, but C was rejected overall because of its dark palette; those visual choices are not blended into B. Direction A was strongly rejected and its ruled rota/ledger direction is not retained unless an independent functional requirement calls for equivalent behavior.

The model mappings above are internal provenance only. They must not appear in the prototype or production interface.
