import type {
  ProjectedAssignment,
  ProjectedMember,
} from "../../domain/read-models";
import { CustomDropdown } from "./custom-dropdown";
import { Icon, PeriodRange, Person, formatPeriod } from "./shared-presentation";
import type { ActionResult } from "./types";

export function AssignmentSelect({
  id,
  label,
  value,
  assignments,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  assignments: ProjectedAssignment[];
  disabled: boolean;
  onChange(value: string): void;
}) {
  return (
    <CustomDropdown
      id={id}
      label={label}
      value={value}
      disabled={disabled}
      options={[
        { value: "", label: "Choose an assignment" },
        ...assignments.map((item) => ({
          value: item.assignmentId,
          label: `${item.chore.name} — ${formatPeriod(item.period)} — ${item.member.displayName}`,
        })),
      ]}
      onChange={onChange}
    />
  );
}

export function ReassignReview({
  assignment,
  recipient,
}: {
  assignment: ProjectedAssignment;
  recipient: ProjectedMember;
}) {
  return (
    <section className="change-review" aria-labelledby="review-title">
      <h3 id="review-title">Review this change</h3>
      <div className="review-route">
        <span>
          <Person member={assignment.member} />
          <small>Current</small>
          <strong>{assignment.member.displayName}</strong>
        </span>
        <i aria-hidden="true">→</i>
        <span>
          <Person member={recipient} />
          <small>New</small>
          <strong>{recipient.displayName}</strong>
        </span>
      </div>
      <div className="review-assignment">
        <strong>{assignment.chore.name}</strong>
        <PeriodRange range={assignment.period} label="Ownership range" />
      </div>
    </section>
  );
}

export function SwapReview({
  first,
  second,
}: {
  first: ProjectedAssignment;
  second: ProjectedAssignment;
}) {
  return (
    <section
      className="change-review swap-review"
      aria-labelledby="swap-review-title"
    >
      <h3 id="swap-review-title">Review both swap legs</h3>
      <SwapLeg index={1} assignment={first} to={second.member} />
      <SwapLeg index={2} assignment={second} to={first.member} />
    </section>
  );
}

function SwapLeg({
  index,
  assignment,
  to,
}: {
  index: number;
  assignment: ProjectedAssignment;
  to: ProjectedMember;
}) {
  return (
    <div className="swap-leg">
      <header>
        <span>Leg {index}</span>
        <strong>{assignment.chore.name}</strong>
        <PeriodRange range={assignment.period} label="Ownership range" />
      </header>
      <div className="swap-route">
        <span>
          <Person member={assignment.member} size="small" />
          <small>Current</small>
          <strong>{assignment.member.displayName}</strong>
        </span>
        <i aria-hidden="true">→</i>
        <span>
          <Person member={to} size="small" />
          <small>After swap</small>
          <strong>{to.displayName}</strong>
        </span>
      </div>
    </div>
  );
}

export function ActionIssue({
  result,
  assignments,
  conflictReviewed,
  onReviewCurrent,
}: {
  result: ActionResult;
  assignments: ProjectedAssignment[];
  conflictReviewed: boolean;
  onReviewCurrent(): void;
}) {
  const stale = result.state === "conflict";
  const ended = !stale && /(?:week|period) has ended/i.test(result.message);
  const message = stale
    ? conflictReviewed
      ? "Current values are ready below. Review every person and ownership range, then confirm again."
      : "Nothing was overwritten. Review the current values before choosing whether to retry."
    : ended
      ? "At least one selected ownership period has ended and is locked. Choose current or future assignments and review the change again."
      : result.message;
  return (
    <div
      className={`dialog-issue ${stale ? "stale" : "error"}`}
      role="alert"
      tabIndex={-1}
    >
      <Icon name={stale ? "refresh" : "alert"} />
      <div>
        <h3>
          {stale
            ? conflictReviewed
              ? "Current values loaded"
              : "Someone changed this relay first"
            : ended
              ? "An ownership period has ended"
              : "The change couldn’t be saved"}
        </h3>
        <p>{message}</p>
        {stale || ended ? (
          <ul
            className="issue-assignments"
            aria-label="Current assignment values"
          >
            {assignments.map((assignment) => (
              <li key={assignment.assignmentId}>
                <strong>{assignment.chore.name}</strong>
                <PeriodRange
                  range={assignment.period}
                  label="Ownership range"
                />
                <span>Current owner: {assignment.member.displayName}</span>
              </li>
            ))}
          </ul>
        ) : null}
        {stale ? (
          <button
            className="button secondary"
            type="button"
            onClick={() => {
              if (!conflictReviewed) onReviewCurrent();
            }}
            aria-disabled={conflictReviewed}
          >
            <Icon name={conflictReviewed ? "check" : "refresh"} />
            {conflictReviewed
              ? "Current values reviewed"
              : "Review current values"}
          </button>
        ) : null}
      </div>
    </div>
  );
}
