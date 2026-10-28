import { useFetcher } from "react-router";

import type { HomeActionData } from "../../routes/home-action";
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

function focusOverrideHeading(node: HTMLHeadingElement | null) {
  node?.focus();
}

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
            candidate.chore.id === assignment?.chore.id &&
            candidate.member.active &&
            candidate.member.id === recipient.id &&
            candidate.period.localStartDate > localToday,
        )
      : [];
  const validSwap = Boolean(
    first &&
    second &&
    first.assignmentId !== second.assignmentId &&
    first.chore.id === second.chore.id &&
    first.member.active &&
    second.member.active &&
    second.period.localStartDate > localToday &&
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
    eligibleBalanceAssignments.some(
      ({ assignmentId }) => assignmentId === balanceAssignment.assignmentId,
    ) &&
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
      <fetcher.Form
        method="post"
        onSubmit={(event) => {
          if (
            pending ||
            (conflict && !reviewedConflict) ||
            (dialog.kind === "reassign"
              ? !validRecipient ||
                dialog.step === "recipient" ||
                (dialog.step === "review" && !validBalancedSwap)
              : !validSwap)
          )
            event.preventDefault();
        }}
      >
        <header className="dialog-header">
          <div>
            <p className="eyebrow">Confirm change</p>
            <h2 id="dialog-title">
              {dialog.kind === "reassign"
                ? dialog.step === "recipient"
                  ? `Reassign ${assignment?.chore.name ?? "chore"}`
                  : dialog.step === "override"
                    ? "Reassign without a swap?"
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
                        {current ? <small>On it now</small> : null}
                      </span>
                    </label>
                  );
                })}
              </fieldset>
            ) : recipient && validRecipient ? (
              <>
                {dialog.step === "review" &&
                validBalancedSwap &&
                balanceAssignment ? (
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
                ) : dialog.step === "override" ? (
                  <>
                    <input type="hidden" name="intent" value="reassign" />
                    <input type="hidden" name="oneTimeOverride" value="true" />
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
                ) : null}
                <ReassignReview assignment={assignment} recipient={recipient} />
                {dialog.step === "override" ? (
                  <section
                    className="balance-choice"
                    aria-labelledby="override-title"
                  >
                    <h3
                      id="override-title"
                      tabIndex={-1}
                      ref={focusOverrideHeading}
                    >
                      A fair swap is one turn for one turn
                    </h3>
                    <p>
                      Normally, trade {assignment.chore.name} for a future{" "}
                      {assignment.chore.name} turn. Without a return turn,{" "}
                      {recipient.displayName} takes an extra{" "}
                      {assignment.chore.name} turn and{" "}
                      {assignment.member.displayName} does not take one back.
                      This is a one-time reassignment, not a swap.
                    </p>
                    <label className="override-acknowledgement">
                      <input type="checkbox" required disabled={pending} />
                      I understand this gives {recipient.displayName} an extra
                      turn with no return swap.
                    </label>
                  </section>
                ) : (
                  <section
                    className="balance-choice"
                    aria-labelledby="balance-title"
                  >
                    <h3 id="balance-title">Swap one for one · same chore</h3>
                    <p>
                      {recipient.displayName} takes this {assignment.chore.name}{" "}
                      turn. Choose one of their future {assignment.chore.name}{" "}
                      turns for {assignment.member.displayName} in return.
                      Dishwasher for Dishwasher, Trash for Trash — never a
                      different chore.
                    </p>
                    <CustomDropdown
                      id="balance-assignment"
                      label="Balance with a future turn"
                      value={dialog.balanceAssignmentId}
                      disabled={pending}
                      options={[
                        { value: "", label: "Choose a matching future turn" },
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
                        {recipient.displayName} has no future{" "}
                        {assignment.chore.name} turns available in the loaded
                        schedule. Choose another member or explicitly continue
                        without a swap.
                      </p>
                    ) : null}
                    <button
                      className="button quiet"
                      type="button"
                      disabled={pending}
                      onClick={() =>
                        onChange({
                          ...dialog,
                          step: "override",
                          balanceAssignmentId: "",
                        })
                      }
                    >
                      Continue without a swap…
                    </button>
                  </section>
                )}
                {dialog.step === "review" &&
                validBalancedSwap &&
                balanceAssignment ? (
                  <SwapReview first={assignment} second={balanceAssignment} />
                ) : null}
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
                onChange={(firstId) =>
                  onChange({ ...dialog, firstId, secondId: "" })
                }
              />
              <span className="swap-glyph" aria-hidden="true">
                <Icon name="swap" />
              </span>
              <AssignmentSelect
                id="second-assignment"
                label="Second turn"
                value={dialog.secondId}
                assignments={chronological(assignments).filter(
                  (candidate) =>
                    first &&
                    candidate.chore.id === first.chore.id &&
                    candidate.member.id !== first.member.id &&
                    candidate.member.active &&
                    candidate.period.localStartDate > localToday,
                )}
                disabled={pending || !first}
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
                  Choose a future turn of the same chore held by a different
                  person.
                </p>
              ) : null}
            </div>
            <p className="swap-guidance">
              Trade one for one: choose a first turn, then a future turn of the
              same chore held by a different person.
            </p>
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
              if (dialog.kind === "reassign" && dialog.step !== "recipient") {
                onChange({
                  ...dialog,
                  step: dialog.step === "override" ? "review" : "recipient",
                  balanceAssignmentId: "",
                });
              } else {
                onClose();
              }
            }}
            disabled={pending}
          >
            {dialog.kind === "reassign" && dialog.step !== "recipient"
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
                  (dialog.step === "review" && !validBalancedSwap)
                : !validSwap)
            }
          >
            {pending
              ? "Saving…"
              : dialog.kind === "reassign"
                ? dialog.step === "recipient"
                  ? "Continue"
                  : dialog.step === "override"
                    ? "Confirm one-time change"
                    : "Confirm swap"
                : "Confirm"}
          </button>
        </footer>
      </fetcher.Form>
    </dialog>
  );
}
