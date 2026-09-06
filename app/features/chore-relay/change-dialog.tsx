import { useFetcher } from "react-router";

import type { HomeActionData } from "../../routes/home";
import type {
  ProjectedAssignment,
  ProjectedMember,
} from "../../domain/read-models";
import { CustomDropdown } from "./custom-dropdown";
import {
  ReassignReview,
  ActionIssue,
  AssignmentSelect,
  SwapReview,
} from "./change-forms";
import {
  Icon,
  Person,
  chronological,
  formatPeriod,
} from "./shared-presentation";
import type { DialogState } from "./types";

type ActionFetcher = ReturnType<typeof useFetcher<HomeActionData>>;

export function ChangeDialog({
  dialogRef,
  dialog,
  assignments,
  members,
  localToday,
  fetcher,
  issue,
  onChange,
  onReviewConflict,
  onClose,
}: {
  dialogRef: React.RefObject<HTMLDialogElement | null>;
  dialog: DialogState;
  assignments: ProjectedAssignment[];
  members: ProjectedMember[];
  localToday: string;
  fetcher: ActionFetcher;
  issue?: HomeActionData;
  onChange(next: DialogState): void;
  onReviewConflict(next: DialogState): void;
  onClose(): void;
}) {
  const pending = fetcher.state !== "idle";
  const conflict = issue?.state === "conflict" ? issue : undefined;
  const conflictKey = conflict
    ? conflict.current
        .map((item) => `${item.assignmentId}:${item.memberId}:${item.version}`)
        .sort()
        .join("|")
    : "";
  const currentValue = (item?: ProjectedAssignment) => {
    if (!item || !conflict) return item;
    const latest = conflict.current.find(
      ({ assignmentId }) => assignmentId === item.assignmentId,
    );
    if (!latest) return item;
    return {
      ...item,
      version: latest.version,
      member: members.find(({ id }) => id === latest.memberId) ?? {
        id: latest.memberId,
        displayName: "Current household member",
        active: false,
      },
    };
  };
  const assignment =
    dialog.kind === "reassign"
      ? currentValue(
          assignments.find(
            ({ assignmentId }) => assignmentId === dialog.assignmentId,
          ),
        )
      : undefined;
  const first =
    dialog.kind === "swap"
      ? currentValue(
          assignments.find(
            ({ assignmentId }) => assignmentId === dialog.firstId,
          ),
        )
      : undefined;
  const second =
    dialog.kind === "swap"
      ? currentValue(
          assignments.find(
            ({ assignmentId }) => assignmentId === dialog.secondId,
          ),
        )
      : undefined;
  const recipient =
    dialog.kind === "reassign"
      ? members.find(({ id }) => id === dialog.recipientId)
      : undefined;
  const balanceAssignment =
    dialog.kind === "reassign"
      ? currentValue(
          assignments.find(
            ({ assignmentId }) => assignmentId === dialog.balanceAssignmentId,
          ),
        )
      : undefined;
  const eligibleBalanceAssignments =
    dialog.kind === "reassign" && recipient
      ? chronological(assignments).filter(
          (candidate) =>
            candidate.assignmentId !== dialog.assignmentId &&
            candidate.member.id === recipient.id &&
            candidate.period.localStartDate > localToday,
        )
      : [];
  const validSwap = Boolean(
    first &&
    second &&
    first.assignmentId !== second.assignmentId &&
    first.member.id !== second.member.id,
  );
  const validRecipient = Boolean(
    recipient && assignment && recipient.id !== assignment.member.id,
  );
  const validBalancedSwap = Boolean(
    validRecipient &&
    balanceAssignment &&
    recipient &&
    balanceAssignment.member.id === recipient.id &&
    balanceAssignment.member.id !== assignment?.member.id,
  );
  const selectedAssignments = [
    assignment,
    balanceAssignment,
    first,
    second,
  ].filter((item): item is ProjectedAssignment => Boolean(item));
  const reviewedConflict = Boolean(
    conflictKey && dialog.reviewedConflictKey === conflictKey,
  );
  return (
    <dialog
      ref={dialogRef}
      className="change-dialog"
      aria-labelledby="dialog-title"
      aria-describedby={
        dialog.kind === "reassign" ? "dialog-description" : undefined
      }
      onCancel={(event) => {
        event.preventDefault();
        if (!pending) onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget && !pending) onClose();
      }}
    >
      <fetcher.Form method="post">
        <header className="dialog-header">
          <div>
            <p className="eyebrow">Confirm change</p>
            <h2 id="dialog-title">
              {dialog.kind === "reassign"
                ? dialog.step === "recipient"
                  ? `Reassign ${assignment?.chore.name ?? "chore"}`
                  : `Review ${assignment?.chore.name ?? "chore"} change`
                : "Swap two turns"}
            </h2>
            {dialog.kind === "reassign" ? (
              <p id="dialog-description">{formatPeriod(assignment?.period)}</p>
            ) : null}
          </div>
          <button
            className="icon-button dialog-close"
            type="button"
            onClick={onClose}
            disabled={pending}
            aria-label="Close dialog"
          >
            ×
          </button>
        </header>
        <input type="hidden" name="requestId" value={dialog.requestId} />
        {dialog.kind === "reassign" && assignment ? (
          <>
            {dialog.step === "recipient" ? (
              <fieldset className="member-picker" disabled={pending}>
                <legend>Choose a household member</legend>
                {members.map((member) => {
                  const current = member.id === assignment.member.id;
                  return (
                    <label
                      key={member.id}
                      className={
                        dialog.recipientId === member.id ? "is-selected" : ""
                      }
                    >
                      <input
                        type="radio"
                        name="recipient-choice"
                        value={member.id}
                        disabled={current}
                        checked={dialog.recipientId === member.id}
                        onChange={() =>
                          onChange({
                            ...dialog,
                            recipientId: member.id,
                            balanceAssignmentId: "",
                          })
                        }
                      />
                      <Person member={member} size="small" />
                      <span>
                        <strong>{member.displayName}</strong>
                        <small>
                          {current ? "On it now" : "Active household member"}
                        </small>
                      </span>
                    </label>
                  );
                })}
              </fieldset>
            ) : recipient && validRecipient ? (
              <>
                {balanceAssignment ? (
                  <>
                    <input type="hidden" name="intent" value="swap" />
                    <input
                      type="hidden"
                      name="firstAssignmentId"
                      value={assignment.assignmentId}
                    />
                    <input
                      type="hidden"
                      name="firstExpectedVersion"
                      value={assignment.version}
                    />
                    <input
                      type="hidden"
                      name="secondAssignmentId"
                      value={balanceAssignment.assignmentId}
                    />
                    <input
                      type="hidden"
                      name="secondExpectedVersion"
                      value={balanceAssignment.version}
                    />
                  </>
                ) : (
                  <>
                    <input type="hidden" name="intent" value="reassign" />
                    <input
                      type="hidden"
                      name="assignmentId"
                      value={assignment.assignmentId}
                    />
                    <input
                      type="hidden"
                      name="recipientMemberId"
                      value={recipient.id}
                    />
                    <input
                      type="hidden"
                      name="expectedVersion"
                      value={assignment.version}
                    />
                  </>
                )}
                <ReassignReview assignment={assignment} recipient={recipient} />
                <section
                  className="balance-choice"
                  aria-labelledby="balance-title"
                >
                  <h3 id="balance-title">
                    Keep it one-time or balance the turn
                  </h3>
                  <p>
                    Confirm the one-time change and {recipient.displayName}{" "}
                    receives an extra turn, or choose one of their future turns
                    to give to {assignment.member.displayName}.
                  </p>
                  <CustomDropdown
                    id="balance-assignment"
                    label="Balance with a future turn"
                    value={dialog.balanceAssignmentId}
                    disabled={pending}
                    options={[
                      { value: "", label: "Keep as a one-time change" },
                      ...eligibleBalanceAssignments.map((candidate) => ({
                        value: candidate.assignmentId,
                        label: `${candidate.chore.name} — ${formatPeriod(candidate.period)}`,
                      })),
                    ]}
                    onChange={(balanceAssignmentId) =>
                      onChange({ ...dialog, balanceAssignmentId })
                    }
                  />
                  {eligibleBalanceAssignments.length === 0 ? (
                    <p className="balance-empty">
                      No eligible future turns are available to balance this
                      change.
                    </p>
                  ) : null}
                </section>
              </>
            ) : null}
          </>
        ) : null}
        {dialog.kind === "swap" ? (
          <>
            <input type="hidden" name="intent" value="swap" />
            <div className="swap-picker">
              <AssignmentSelect
                id="first-assignment"
                label="First turn"
                value={dialog.firstId}
                assignments={assignments}
                disabled={pending}
                onChange={(firstId) => onChange({ ...dialog, firstId })}
              />
              <span className="swap-glyph" aria-hidden="true">
                <Icon name="swap" />
              </span>
              <AssignmentSelect
                id="second-assignment"
                label="Second turn"
                value={dialog.secondId}
                assignments={assignments}
                disabled={pending}
                onChange={(secondId) => onChange({ ...dialog, secondId })}
              />
              {first ? (
                <>
                  <input
                    type="hidden"
                    name="firstAssignmentId"
                    value={first.assignmentId}
                  />
                  <input
                    type="hidden"
                    name="firstExpectedVersion"
                    value={first.version}
                  />
                </>
              ) : null}
              {second ? (
                <>
                  <input
                    type="hidden"
                    name="secondAssignmentId"
                    value={second.assignmentId}
                  />
                  <input
                    type="hidden"
                    name="secondExpectedVersion"
                    value={second.version}
                  />
                </>
              ) : null}
              {dialog.firstId && dialog.secondId && !validSwap ? (
                <p className="field-error">
                  Choose two turns held by different people.
                </p>
              ) : null}
            </div>
          </>
        ) : null}
        {dialog.kind === "swap" && first && second && validSwap ? (
          <SwapReview first={first} second={second} />
        ) : null}
        {issue && issue.state !== "success" ? (
          <ActionIssue
            result={issue}
            assignments={selectedAssignments}
            conflictReviewed={reviewedConflict}
            onReviewCurrent={() =>
              onReviewConflict({
                ...dialog,
                requestId: `request:${crypto.randomUUID()}`,
                reviewedConflictKey: conflictKey,
              })
            }
          />
        ) : null}
        <footer className="dialog-actions">
          <button
            className="button quiet"
            type="button"
            onClick={() => {
              if (dialog.kind === "reassign" && dialog.step === "review") {
                onChange({
                  ...dialog,
                  step: "recipient",
                  balanceAssignmentId: "",
                });
              } else {
                onClose();
              }
            }}
            disabled={pending}
          >
            {dialog.kind === "reassign" && dialog.step === "review"
              ? "Back"
              : "Cancel"}
          </button>
          <button
            key={dialog.kind === "reassign" ? dialog.step : "swap-confirmation"}
            className="button primary"
            type={
              dialog.kind === "reassign" && dialog.step === "recipient"
                ? "button"
                : "submit"
            }
            onClick={() => {
              if (dialog.kind === "reassign" && dialog.step === "recipient") {
                onChange({ ...dialog, step: "review" });
              }
            }}
            disabled={
              pending ||
              Boolean(conflict && !reviewedConflict) ||
              (dialog.kind === "reassign"
                ? !validRecipient ||
                  (dialog.step === "review" &&
                    Boolean(dialog.balanceAssignmentId) &&
                    !validBalancedSwap)
                : !validSwap)
            }
          >
            {pending
              ? "Saving…"
              : dialog.kind === "reassign"
                ? dialog.step === "recipient"
                  ? "Continue"
                  : "Confirm change"
                : "Confirm"}
          </button>
        </footer>
      </fetcher.Form>
    </dialog>
  );
}
