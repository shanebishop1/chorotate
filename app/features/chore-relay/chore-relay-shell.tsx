import { useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";

import type { AuthorizedMember } from "../../auth/access";
import type {
  HistoryOperation,
  ProjectedAssignment,
  ProjectedMember,
  ProjectedReminderStatus,
  getCurrentAndNext,
  getGroupedHistory,
  getHouseholdCalendar,
  getHouseholdList,
  getPersonalAgenda,
} from "../../domain/read-models";
import type { HomeActionData } from "../../routes/home";
import { views, type ChorePeriodRange, type ChoreRelayView } from "./model";

export interface ChoreRelayData {
  signedInMember: AuthorizedMember;
  current: Awaited<ReturnType<typeof getCurrentAndNext>>;
  mine: Awaited<ReturnType<typeof getPersonalAgenda>>;
  householdList: Awaited<ReturnType<typeof getHouseholdList>>;
  household: Awaited<ReturnType<typeof getHouseholdCalendar>>;
  history: Awaited<ReturnType<typeof getGroupedHistory>>;
  activeMembers: ProjectedMember[];
}

type Props =
  | {
      activeView: ChoreRelayView;
      state: "unauthorized" | "unavailable";
      data?: never;
    }
  | { activeView: ChoreRelayView; state: "ready"; data: ChoreRelayData };
type Theme = "light" | "dark" | undefined;
type DialogState = (
  | {
      kind: "reassign";
      assignmentId: string;
      recipientId: string;
      requestId: string;
    }
  | { kind: "swap"; firstId: string; secondId: string; requestId: string }
) & { reviewedConflictKey?: string };

const labels: Record<ChoreRelayView, string> = {
  now: "Now",
  mine: "Mine",
  household: "Household",
  history: "History",
};

export function ChoreRelayShell(props: Props) {
  const [theme, setTheme] = useState<Theme>();
  function toggleTheme() {
    const current =
      theme ??
      (typeof window !== "undefined" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light");
    setTheme(current === "dark" ? "light" : "dark");
  }
  return (
    <div className="app-shell" data-theme={theme}>
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <header className="site-header">
        <div className="header-row">
          <a
            className="brand"
            href="?view=now"
            aria-label="ChoRotate, go to Now"
          >
            <span className="brand-mark" aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
            <span>ChoRotate</span>
          </a>
          <div className="header-actions">
            {props.state === "ready" ? (
              <>
                <div className="signed-in">
                  <Person
                    member={toProjected(props.data.signedInMember)}
                    size="small"
                  />
                  <span>
                    <small>Home crew</small>
                    <strong>{props.data.signedInMember.displayName}</strong>
                  </span>
                </div>
                <AuthControl kind="sign-out" />
              </>
            ) : null}
            <button
              className="icon-button"
              type="button"
              onClick={toggleTheme}
              aria-label="Toggle color mode"
              title="Switch color mode"
            >
              <Icon name={theme === "dark" ? "sun" : "moon"} />
            </button>
          </div>
        </div>
        <nav className="primary-nav" aria-label="ChoRotate views">
          {views.map((view) => (
            <a
              key={view}
              href={`?view=${view}`}
              aria-current={props.activeView === view ? "page" : undefined}
            >
              <Icon name={view} />
              <span>{labels[view]}</span>
            </a>
          ))}
        </nav>
      </header>
      <main id="main-content" className="main-content" tabIndex={-1}>
        {props.state === "unauthorized" ? (
          <SystemState kind="unauthorized" />
        ) : props.state === "unavailable" ? (
          <SystemState kind="unavailable" />
        ) : props.data ? (
          <ReadyShell activeView={props.activeView} data={props.data} />
        ) : (
          <SystemState kind="unavailable" />
        )}
      </main>
      <footer className="site-footer">
        <p>One home. Clear handoffs. No chore left between people.</p>
        <span>Authoritative household schedule</span>
      </footer>
    </div>
  );
}

function ReadyShell({
  activeView,
  data,
}: {
  activeView: ChoreRelayView;
  data: ChoreRelayData;
}) {
  const fetcher = useFetcher<HomeActionData>();
  const [dialog, setDialog] = useState<DialogState>();
  const [notice, setNotice] = useState("");
  const [issue, setIssue] = useState<HomeActionData>();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (dialog && dialogRef.current && !dialogRef.current.open)
      dialogRef.current.showModal();
  }, [dialog]);
  useEffect(() => {
    if (!fetcher.data) return;
    if (fetcher.data.state === "success") {
      setNotice(
        fetcher.data.intent === "swap"
          ? "Both swap legs moved together."
          : "The handoff was saved.",
      );
      setIssue(undefined);
      dialogRef.current?.close();
      setDialog(undefined);
      openerRef.current?.focus();
    } else {
      setIssue(fetcher.data);
      if (fetcher.data.state === "conflict") {
        setDialog((current) =>
          current ? { ...current, reviewedConflictKey: undefined } : current,
        );
      }
    }
  }, [fetcher.data]);
  useEffect(() => {
    if (!issue) return;
    requestAnimationFrame(() =>
      dialogRef.current?.querySelector<HTMLElement>(".dialog-issue")?.focus(),
    );
  }, [issue]);
  function remember() {
    if (
      typeof document !== "undefined" &&
      document.activeElement instanceof HTMLElement
    )
      openerRef.current = document.activeElement;
  }
  function close() {
    dialogRef.current?.close();
    setDialog(undefined);
    setIssue(undefined);
    openerRef.current?.focus();
  }
  function reassign(assignmentId: string) {
    remember();
    setIssue(undefined);
    setDialog({
      kind: "reassign",
      assignmentId,
      recipientId: "",
      requestId: `request:${crypto.randomUUID()}`,
    });
  }
  function swap() {
    remember();
    setIssue(undefined);
    setDialog({
      kind: "swap",
      firstId: "",
      secondId: "",
      requestId: `request:${crypto.randomUUID()}`,
    });
  }
  const assignments = data.household.periods.flatMap(
    ({ assignments }) => assignments,
  );
  return (
    <>
      {activeView === "now" ? (
        <NowView data={data} onReassign={reassign} onSwap={swap} />
      ) : null}
      {activeView === "mine" ? <MineView data={data} /> : null}
      {activeView === "household" ? <HouseholdView data={data} /> : null}
      {activeView === "history" ? <HistoryView history={data.history} /> : null}
      {notice ? (
        <div className="toast" role="status">
          <Icon name="check" />
          <span>{notice}</span>
          <button
            type="button"
            onClick={() => setNotice("")}
            aria-label="Dismiss message"
          >
            ×
          </button>
        </div>
      ) : null}
      {dialog ? (
        <ChangeDialog
          dialogRef={dialogRef}
          dialog={dialog}
          assignments={assignments}
          members={data.activeMembers}
          fetcher={fetcher}
          issue={issue}
          onChange={(next) => {
            setDialog(next);
            if (issue?.state !== "conflict") setIssue(undefined);
          }}
          onReviewConflict={setDialog}
          onClose={close}
        />
      ) : null}
    </>
  );
}

function ViewHeading({
  eyebrow,
  title,
  detail,
  action,
}: {
  eyebrow: string;
  title: string;
  detail: string;
  action?: React.ReactNode;
}) {
  return (
    <header className="view-heading">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p>{detail}</p>
      </div>
      {action}
    </header>
  );
}

function NowView({
  data,
  onReassign,
  onSwap,
}: {
  data: ChoreRelayData;
  onReassign(id: string): void;
  onSwap(): void;
}) {
  const { current } = data;
  if (current.state === "empty") return <SystemState kind="empty" />;
  if (current.state === "unavailable")
    return <SystemState kind="unavailable" />;
  return (
    <section aria-labelledby="now-title">
      <ViewHeading
        eyebrow="Current handoffs"
        title="The handoff starts here"
        detail="See who has each chore now, and who takes the baton next."
        action={
          <button className="button secondary" type="button" onClick={onSwap}>
            <Icon name="swap" /> Swap two turns
          </button>
        }
      />
      <h2 id="now-title" className="section-label">
        Current and next turns
      </h2>
      <div className="handoff-grid">
        {current.handoffs.map(
          ({ chore, currentPeriod, nextPeriod, current: assignment, next }) =>
            assignment && next ? (
              <article className="handoff-card" key={assignment.assignmentId}>
                <div className="card-topline">
                  <ChoreGlyph choreId={chore.id} />
                  <div>
                    <p className="card-kicker">On duty now</p>
                    <h2>{chore.name}</h2>
                  </div>
                </div>
                <div className="current-person">
                  <Person member={assignment.member} />
                  <div>
                    <strong>{assignment.member.displayName}</strong>
                    <span>has this turn</span>
                  </div>
                </div>
                <PeriodRange range={currentPeriod} label="Current period" />
                <ReminderStatus reminder={assignment.reminder} />
                <p className="chore-description">{chore.instructions}</p>
                <div className="handoff-strip">
                  <span className="strip-label">Hands off next</span>
                  <div className="handoff-next-person">
                    <Person member={assignment.member} size="tiny" />
                    <span className="flow-line" aria-hidden="true">
                      <span />→
                    </span>
                    <Person member={next.member} size="tiny" />
                    <strong>{next.member.displayName}</strong>
                  </div>
                  <PeriodRange range={nextPeriod} label="Next period" />
                  <ReminderStatus reminder={next.reminder} />
                </div>
                <button
                  className="button quiet"
                  type="button"
                  onClick={() => onReassign(assignment.assignmentId)}
                >
                  Reassign this turn <span aria-hidden="true">→</span>
                </button>
              </article>
            ) : null,
        )}
      </div>
      <aside className="coming-up" aria-label="Planning chore handoffs">
        <span className="date-block" aria-hidden="true">
          <Icon name="calendar" />
        </span>
        <div>
          <p className="eyebrow">Plan ahead</p>
          <h2>Every turn keeps its own dates</h2>
          <p>Trash and Dishwasher hand off on different days.</p>
        </div>
        <a href="?view=household">
          See four turns <span aria-hidden="true">→</span>
        </a>
      </aside>
    </section>
  );
}

function MineView({ data }: { data: ChoreRelayData }) {
  return (
    <section aria-labelledby="mine-title">
      <ViewHeading
        eyebrow="Your lane"
        title={`${data.signedInMember.displayName}’s turns`}
        detail="A quiet view of what is yours now and what is coming around."
      />
      <div className="mine-summary">
        <Person member={toProjected(data.signedInMember)} />
        <div>
          <span className="status-mark">
            <Icon name="check" /> Personal route
          </span>
          <h2 id="mine-title">Your upcoming handoffs</h2>
          <p>Each chore keeps its own start and end dates.</p>
        </div>
      </div>
      {data.mine.state === "empty" ? (
        <SystemState kind="empty" />
      ) : (
        <ol className="mine-timeline">
          {chronological(data.mine.items).map((assignment, index) => (
            <li key={assignment.assignmentId}>
              <span className="timeline-node" aria-hidden="true">
                {index + 1}
              </span>
              <article>
                <div>
                  <PeriodRange range={assignment.period} />
                  <h2>{assignment.chore.name}</h2>
                </div>
                <p>{assignment.chore.instructions}</p>
                <span className="handoff-source">
                  Assigned to {assignment.member.displayName}
                </span>
                <ReminderStatus reminder={assignment.reminder} />
              </article>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function HouseholdView({ data }: { data: ChoreRelayData }) {
  const [memberId, setMemberId] = useState("");
  const [choreId, setChoreId] = useState("");
  const chores = unique(
    data.householdList.items.map(({ chore }) => chore),
    ({ id }) => id,
  );
  const currentAssignmentIds = new Set(
    data.current.state === "ready"
      ? data.current.handoffs.flatMap(({ current }) =>
          current ? [current.assignmentId] : [],
        )
      : [],
  );
  const filteredAssignments = chronological(
    data.household.periods.flatMap(({ assignments }) => assignments),
  ).filter(
    (item) =>
      (!memberId || item.member.id === memberId) &&
      (!choreId || item.chore.id === choreId),
  );
  return (
    <section aria-labelledby="household-title">
      <ViewHeading
        eyebrow="Upcoming route"
        title="The whole household, in motion"
        detail="Each row is its own relay. Every assignment names its chore-specific dates."
      />
      <div className="filter-row" aria-label="Schedule filters">
        <label>
          Member
          <select
            value={memberId}
            onChange={(event) => setMemberId(event.target.value)}
          >
            <option value="">Everyone</option>
            {data.activeMembers.map((member) => (
              <option key={member.id} value={member.id}>
                {member.displayName}
              </option>
            ))}
          </select>
        </label>
        <label>
          Chore
          <select
            value={choreId}
            onChange={(event) => setChoreId(event.target.value)}
          >
            <option value="">All chores</option>
            {chores.map((chore) => (
              <option key={chore.id} value={chore.id}>
                {chore.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <h2 id="household-title" className="section-label">
        Household schedule
      </h2>
      {data.household.state === "empty" ? (
        <SystemState kind="empty" />
      ) : (
        <>
          {filteredAssignments.length === 0 ? (
            <p className="filtered-empty" role="status">
              No assignments match these filters.
            </p>
          ) : (
            <>
              <div className="schedule-table-wrap">
                <table className="schedule-table">
                  <caption>
                    Chronological household schedule with chore-specific periods
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">Period</th>
                      <th scope="col">Chore</th>
                      <th scope="col">On duty</th>
                      <th scope="col">Assignment</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredAssignments.map((assignment) => {
                      const current = currentAssignmentIds.has(
                        assignment.assignmentId,
                      );
                      return (
                        <tr
                          key={assignment.assignmentId}
                          data-period-start={assignment.period.localStartDate}
                          className={current ? "is-current" : undefined}
                        >
                          <th scope="row">
                            <PeriodRange range={assignment.period} />
                          </th>
                          <td className="schedule-chore">
                            <ChoreGlyph choreId={assignment.chore.id} />
                            <strong>{assignment.chore.name}</strong>
                          </td>
                          <td>
                            <div className="schedule-person">
                              <Person member={assignment.member} size="small" />
                              <strong>{assignment.member.displayName}</strong>
                            </div>
                          </td>
                          <td>
                            <span className="assignment-source">
                              {assignment.source === "rotation"
                                ? "Rotation"
                                : "Changed"}
                            </span>
                            {current ? (
                              <span className="now-badge">Current turn</span>
                            ) : null}
                            <ReminderStatus reminder={assignment.reminder} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <ol
                className="schedule-list"
                aria-label="Chronological household schedule"
              >
                {filteredAssignments.map((assignment) => {
                  const current = currentAssignmentIds.has(
                    assignment.assignmentId,
                  );
                  return (
                    <li
                      key={assignment.assignmentId}
                      data-period-start={assignment.period.localStartDate}
                      className={current ? "is-current" : undefined}
                    >
                      <ChoreGlyph choreId={assignment.chore.id} />
                      <div>
                        <small>{assignment.chore.name}</small>
                        <strong>{assignment.member.displayName}</strong>
                        <PeriodRange range={assignment.period} />
                        {current ? (
                          <span className="now-badge">Current turn</span>
                        ) : null}
                        <ReminderStatus reminder={assignment.reminder} />
                      </div>
                    </li>
                  );
                })}
              </ol>
            </>
          )}
        </>
      )}
    </section>
  );
}

function HistoryView({
  history,
}: {
  history: Awaited<ReturnType<typeof getGroupedHistory>>;
}) {
  return (
    <section aria-labelledby="history-title">
      <ViewHeading
        eyebrow="Change trail"
        title="Every handoff, kept together"
        detail="Direct changes stand alone. Atomic swaps keep both legs in one group."
      />
      <h2 id="history-title" className="section-label">
        Latest changes
      </h2>
      {history.state === "empty" ? (
        <SystemState kind="empty" />
      ) : (
        <ol className="history-list">
          {history.operations.map((operation) => (
            <HistoryItem key={operation.operationId} operation={operation} />
          ))}
        </ol>
      )}
    </section>
  );
}
function HistoryItem({ operation }: { operation: HistoryOperation }) {
  return (
    <li>
      <span className="history-rail" aria-hidden="true">
        <Icon name={operation.kind === "swap" ? "swap" : "arrow"} />
      </span>
      <article>
        <div className="history-meta">
          <span className={`event-badge ${operation.kind}`}>
            {operation.kind === "swap"
              ? "Atomic swap"
              : operation.kind === "reassign"
                ? "Direct change"
                : "Schedule update"}
          </span>
          <time dateTime={operation.occurredAt}>
            {formatLocalTimestamp(operation.localOccurredAt)}
          </time>
        </div>
        <h2>
          {operation.kind === "swap"
            ? "Two assignments exchanged together."
            : `${operation.changes.length} assignment changed.`}
        </h2>
        <div className="history-legs">
          {operation.changes.map((change, index) => (
            <div key={change.eventId}>
              <span>
                {operation.kind === "swap"
                  ? `Swap leg ${index + 1} of ${operation.changes.length}`
                  : "Assignment"}
              </span>
              <strong>{change.chore.name}</strong>
              <PeriodRange range={change.period} label="Ownership range" />
              <p>
                {change.before?.member.displayName ?? "Unassigned"}{" "}
                <span aria-hidden="true">→</span>{" "}
                {change.after.member.displayName ?? "Former member"}
              </p>
              {change.after.reminder.correctionNeeded ? (
                <HistoryCorrectionStatus />
              ) : null}
            </div>
          ))}
        </div>
        <footer>
          Recorded by{" "}
          <strong>{operation.actor?.displayName ?? "ChoRotate"}</strong>
          <code>{operation.operationId}</code>
        </footer>
      </article>
    </li>
  );
}

type ActionFetcher = ReturnType<typeof useFetcher<HomeActionData>>;
function ChangeDialog({
  dialogRef,
  dialog,
  assignments,
  members,
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
  const validSwap = Boolean(
    first &&
    second &&
    first.assignmentId !== second.assignmentId &&
    first.member.id !== second.member.id,
  );
  const validRecipient = Boolean(
    recipient && assignment && recipient.id !== assignment.member.id,
  );
  const selectedAssignments = [assignment, first, second].filter(
    (item): item is ProjectedAssignment => Boolean(item),
  );
  const reviewedConflict = Boolean(
    conflictKey && dialog.reviewedConflictKey === conflictKey,
  );
  return (
    <dialog
      ref={dialogRef}
      className="change-dialog"
      aria-labelledby="dialog-title"
      aria-describedby="dialog-description"
      onCancel={(event) => {
        event.preventDefault();
        if (!pending) onClose();
      }}
    >
      <fetcher.Form method="post">
        <header className="dialog-header">
          <div>
            <p className="eyebrow">Confirm change</p>
            <h2 id="dialog-title">
              {dialog.kind === "reassign"
                ? `Reassign ${assignment?.chore.name ?? "chore"}`
                : "Swap two turns"}
            </h2>
            <p id="dialog-description">
              {dialog.kind === "reassign"
                ? formatPeriod(assignment?.period)
                : "Both assignments update together—or neither does."}
            </p>
          </div>
          <button
            className="icon-button"
            type="button"
            onClick={onClose}
            disabled={pending}
            aria-label="Close dialog"
          >
            ×
          </button>
        </header>
        <input type="hidden" name="intent" value={dialog.kind} />
        <input type="hidden" name="requestId" value={dialog.requestId} />
        {dialog.kind === "reassign" && assignment ? (
          <>
            <input
              type="hidden"
              name="assignmentId"
              value={assignment.assignmentId}
            />
            <input
              type="hidden"
              name="expectedVersion"
              value={assignment.version}
            />
            <fieldset className="member-picker" disabled={pending}>
              <legend>Who will take it?</legend>
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
                      name="recipientMemberId"
                      value={member.id}
                      disabled={current}
                      checked={dialog.recipientId === member.id}
                      onChange={() =>
                        onChange({ ...dialog, recipientId: member.id })
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
            {recipient && validRecipient ? (
              <ReassignReview assignment={assignment} recipient={recipient} />
            ) : null}
          </>
        ) : null}
        {dialog.kind === "swap" ? (
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
              <input
                type="hidden"
                name="firstExpectedVersion"
                value={first.version}
              />
            ) : null}
            {second ? (
              <input
                type="hidden"
                name="secondExpectedVersion"
                value={second.version}
              />
            ) : null}
            {dialog.firstId && dialog.secondId && !validSwap ? (
              <p className="field-error">
                Choose two turns held by different people.
              </p>
            ) : null}
          </div>
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
            onClick={onClose}
            disabled={pending}
          >
            Cancel
          </button>
          <button
            className="button primary"
            type="submit"
            disabled={
              pending ||
              Boolean(conflict && !reviewedConflict) ||
              (dialog.kind === "reassign" ? !validRecipient : !validSwap)
            }
          >
            {pending
              ? "Saving…"
              : dialog.kind === "reassign"
                ? "Confirm handoff"
                : "Confirm atomic swap"}
          </button>
        </footer>
      </fetcher.Form>
    </dialog>
  );
}
function AssignmentSelect({
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
  const prefix = id.startsWith("first") ? "first" : "second";
  return (
    <label htmlFor={id}>
      {label}
      <select
        id={id}
        name={`${prefix}AssignmentId`}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">Choose an assignment</option>
        {assignments.map((item) => (
          <option key={item.assignmentId} value={item.assignmentId}>
            {item.chore.name} — {formatPeriod(item.period)} — outgoing{" "}
            {item.member.displayName}
          </option>
        ))}
      </select>
    </label>
  );
}
function ReassignReview({
  assignment,
  recipient,
}: {
  assignment: ProjectedAssignment;
  recipient: ProjectedMember;
}) {
  return (
    <section className="change-review" aria-labelledby="review-title">
      <p className="eyebrow">Before → after</p>
      <h3 id="review-title">Review this handoff</h3>
      <div className="review-route">
        <span>
          <Person member={assignment.member} />
          <small>Outgoing person</small>
          <strong>{assignment.member.displayName}</strong>
        </span>
        <i aria-hidden="true">→</i>
        <span>
          <Person member={recipient} />
          <small>Incoming person</small>
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
function SwapReview({
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
      <p className="eyebrow">Before → after</p>
      <h3 id="swap-review-title">Review both swap legs</h3>
      <SwapLeg index={1} assignment={first} to={second.member} />
      <SwapLeg index={2} assignment={second} to={first.member} />
      <p className="atomic-note">
        <Icon name="lock" /> These two legs confirm as one operation.
      </p>
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
      <span>Leg {index}</span>
      <div>
        <strong>{assignment.chore.name}</strong>
        <PeriodRange range={assignment.period} label="Ownership range" />
      </div>
      <p>
        <span>Outgoing: {assignment.member.displayName}</span>{" "}
        <span aria-hidden="true">→</span>{" "}
        <span>Incoming: {to.displayName}</span>
      </p>
    </div>
  );
}
function ActionIssue({
  result,
  assignments,
  conflictReviewed,
  onReviewCurrent,
}: {
  result: Exclude<HomeActionData, { state: "success" }>;
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
function SystemState({
  kind,
}: {
  kind: "unauthorized" | "unavailable" | "empty";
}) {
  const content =
    kind === "unauthorized"
      ? [
          "lock",
          "This household is private",
          "Sign in with an exact active household email to continue.",
        ]
      : kind === "empty"
        ? [
            "calendar",
            "Nothing is scheduled yet",
            "The household schedule has no assignments in this view.",
          ]
        : [
            "cloud",
            "Schedule temporarily unavailable",
            "No household details were exposed. Try again in a moment.",
          ];
  return (
    <div
      className={`system-state state-${kind}`}
      role={kind === "unavailable" ? "alert" : "status"}
    >
      <Icon name={content[0]} />
      <div>
        <h1>{content[1]}</h1>
        <p>{content[2]}</p>
        {kind === "unauthorized" ? <AuthControl kind="sign-in" /> : null}
        {kind === "empty" ? <MaterializeControl /> : null}
        {kind === "unavailable" ? (
          <a className="text-button" href="?view=now">
            Try again <span aria-hidden="true">→</span>
          </a>
        ) : null}
      </div>
    </div>
  );
}

function MaterializeControl() {
  const fetcher = useFetcher<HomeActionData>();
  const pending = fetcher.state !== "idle";
  return (
    <fetcher.Form method="post">
      <input type="hidden" name="intent" value="materialize" />
      <input type="hidden" name="requestId" value="request:materialize" />
      <button
        className="button primary"
        type="submit"
        disabled={pending}
        aria-busy={pending}
      >
        {pending ? "Preparing schedule…" : "Prepare schedule"}
      </button>
      {fetcher.data && fetcher.data.state !== "success" ? (
        <span className="auth-status" role="alert">
          {fetcher.data.state === "conflict"
            ? "The schedule changed. Try again."
            : fetcher.data.message}
        </span>
      ) : null}
    </fetcher.Form>
  );
}

function AuthControl({ kind }: { kind: "sign-in" | "sign-out" }) {
  const [state, setState] = useState<"idle" | "pending" | "error">("idle");
  const signIn = kind === "sign-in";
  async function submit() {
    setState("pending");
    try {
      const endpoint = signIn
        ? "/api/auth/sign-in/social"
        : "/api/auth/sign-out";
      const body = signIn
        ? { provider: "google", callbackURL: `${window.location.origin}/` }
        : undefined;
      const response = await fetch(endpoint, {
        method: "POST",
        credentials: "same-origin",
        headers: body ? { "content-type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!response.ok) throw new Error("Authentication request failed");
      if (signIn) {
        const payload: unknown = await response.json();
        if (
          typeof payload !== "object" ||
          payload === null ||
          !("url" in payload) ||
          typeof payload.url !== "string"
        ) {
          throw new Error("Authentication response invalid");
        }
        const providerUrl = new URL(payload.url);
        if (providerUrl.protocol !== "https:") {
          throw new Error("Authentication response invalid");
        }
        window.location.assign(providerUrl.href);
      } else {
        window.location.assign("/");
      }
    } catch {
      setState("error");
    }
  }
  const pending = state === "pending";
  return (
    <div className="auth-control">
      <button
        className={`button ${signIn ? "primary" : "quiet"}`}
        type="button"
        onClick={submit}
        disabled={pending}
        aria-busy={pending}
      >
        {pending
          ? signIn
            ? "Starting sign in…"
            : "Signing out…"
          : signIn
            ? "Sign in with Google"
            : "Sign out"}
      </button>
      <span aria-live="polite" className="auth-status">
        {state === "error"
          ? signIn
            ? "Sign in could not be started. Try again."
            : "Sign out could not be completed. Try again."
          : ""}
      </span>
    </div>
  );
}

function toProjected(member: AuthorizedMember): ProjectedMember {
  return { id: member.id, displayName: member.displayName, active: true };
}
function unique<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const value = key(item);
    if (seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}
function chronological(items: ProjectedAssignment[]): ProjectedAssignment[] {
  return [...items].sort(
    (left, right) =>
      left.period.localStartDate.localeCompare(right.period.localStartDate) ||
      left.chore.name.localeCompare(right.chore.name) ||
      left.assignmentId.localeCompare(right.assignmentId),
  );
}
function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}
function cueClass(id: string): string {
  const cues = ["jack", "joe", "dylan", "shane"];
  let total = 0;
  for (const char of id) total += char.charCodeAt(0);
  return cues[total % cues.length];
}
function Person({
  member,
  size = "regular",
}: {
  member: ProjectedMember;
  size?: "regular" | "small" | "tiny";
}) {
  return (
    <span
      className={`person person-${cueClass(member.id)} person-${size}`}
      aria-hidden="true"
    >
      <span>{initials(member.displayName)}</span>
    </span>
  );
}
function ChoreGlyph({ choreId }: { choreId: string }) {
  return (
    <span className="chore-glyph" aria-hidden="true">
      <Icon name={choreId.toLowerCase().includes("trash") ? "trash" : "dish"} />
    </span>
  );
}
function date(localDate: string): Date {
  return new Date(`${localDate}T00:00:00Z`);
}
function formatDate(localDate: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(date(localDate));
}
function formatPeriod(period?: ChorePeriodRange): string {
  return period
    ? `${formatPeriodDate(period.localStartDate)} – ${formatPeriodDate(period.localEndDateInclusive)}`
    : "Selected turn";
}
function formatPeriodDate(localDate: string): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(date(localDate));
}
function PeriodRange({
  range,
  label,
}: {
  range: ChorePeriodRange;
  label?: string;
}) {
  return (
    <span
      className="period-range"
      aria-label={`${label ? `${label}: ` : ""}${formatPeriod(range)}`}
    >
      {label ? <span>{label}</span> : null}
      <time dateTime={range.localStartDate}>
        {formatPeriodDate(range.localStartDate)}
      </time>{" "}
      <span aria-hidden="true">–</span>{" "}
      <time dateTime={range.localEndDateInclusive}>
        {formatPeriodDate(range.localEndDateInclusive)}
      </time>
    </span>
  );
}
function ReminderStatus({ reminder }: { reminder: ProjectedReminderStatus }) {
  const messages: Array<{
    key: string;
    icon: "alert" | "calendar" | "check";
    tone: "attention" | "neutral" | "positive";
    text: string;
  }> = [];
  const contactMessages = {
    missing_contact: "Reminder contact missing",
    unconsented: "Reminder consent not recorded",
    suppressed: "Reminders suppressed",
  } as const;
  if (reminder.contactStatus !== "ready") {
    messages.push({
      key: `contact-${reminder.contactStatus}`,
      icon: "alert",
      tone: "attention",
      text: contactMessages[reminder.contactStatus],
    });
  }
  for (const occurrence of reminder.occurrences) {
    const phase = occurrence.phase === "evening" ? "Evening" : "Morning";
    const details =
      occurrence.result === "accepted"
        ? {
            icon: "check" as const,
            tone: "positive" as const,
            text: `${phase} reminder accepted for sending`,
          }
        : occurrence.result === "pending"
          ? {
              icon: "calendar" as const,
              tone: "neutral" as const,
              text: `${phase} reminder planned`,
            }
          : occurrence.result === "delivery_unknown"
            ? {
                icon: "alert" as const,
                tone: "attention" as const,
                text: `Reminder delivery unconfirmed (${occurrence.phase})`,
              }
            : {
                icon: "alert" as const,
                tone: "attention" as const,
                text: `${phase} reminder missed`,
              };
    messages.push({
      key: `${occurrence.phase}-${occurrence.result}`,
      ...details,
    });
  }
  if (reminder.correctionNeeded) {
    messages.push({
      key: "correction",
      icon: "alert",
      tone: "attention",
      text: "Reminder correction needed",
    });
  }
  if (messages.length === 0) return null;
  return (
    <ul className="reminder-status" aria-label="Reminder status">
      {messages.map((message) => (
        <li key={message.key} className={`is-${message.tone}`}>
          <Icon name={message.icon} />
          <span>{message.text}</span>
        </li>
      ))}
    </ul>
  );
}
function HistoryCorrectionStatus() {
  return (
    <div className="history-correction" role="status">
      <Icon name="alert" />
      <span>
        <strong>Reminder correction needed.</strong> The assignment changed
        after a reminder was sent. No immediate correction SMS is sent.
      </span>
    </div>
  );
}
function formatLocalTimestamp(value: string): string {
  const [localDate, time] = value.split("T");
  return `${formatDate(localDate)} · ${time.slice(0, 5)}`;
}
function Icon({ name }: { name: string }) {
  const paths: Record<string, React.ReactNode> = {
    now: (
      <>
        <circle cx="12" cy="12" r="8" />
        <path d="M12 7v5l3 2" />
      </>
    ),
    mine: (
      <>
        <circle cx="12" cy="8" r="3.5" />
        <path d="M5 20a7 7 0 0 1 14 0" />
      </>
    ),
    household: (
      <>
        <path d="m3 11 9-7 9 7" />
        <path d="M5 10v10h14V10M9 20v-6h6v6" />
      </>
    ),
    history: (
      <>
        <path d="M4 7v5h5" />
        <path d="M5.5 17a8 8 0 1 0-1.2-7" />
        <path d="M12 8v4l3 2" />
      </>
    ),
    swap: <path d="M4 8h14l-3-3M20 16H6l3 3" />,
    moon: <path d="M20 15a8 8 0 1 1-11-11 7 7 0 0 0 11 11Z" />,
    sun: (
      <>
        <circle cx="12" cy="12" r="3.5" />
        <path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M19 5l-1.5 1.5M6.5 17.5 5 19" />
      </>
    ),
    trash: (
      <>
        <path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5" />
      </>
    ),
    dish: (
      <>
        <rect x="4" y="4" width="16" height="16" rx="2" />
        <path d="M4 9h16" />
        <circle cx="12" cy="14" r="3" />
      </>
    ),
    check: <path d="m5 12 4 4L19 6" />,
    arrow: <path d="M4 12h16m-6-6 6 6-6 6" />,
    calendar: (
      <>
        <rect x="4" y="5" width="16" height="15" rx="2" />
        <path d="M8 3v4M16 3v4M4 10h16" />
      </>
    ),
    cloud: (
      <path d="M7 18h10a4 4 0 0 0 .5-8 6 6 0 0 0-11-1A4.5 4.5 0 0 0 7 18Z" />
    ),
    lock: (
      <>
        <rect x="5" y="10" width="14" height="11" rx="2" />
        <path d="M8 10V7a4 4 0 0 1 8 0v3" />
      </>
    ),
    alert: (
      <>
        <path d="M12 3 2.8 20h18.4Z" />
        <path d="M12 9v5M12 17h.01" />
      </>
    ),
    refresh: (
      <>
        <path d="M20 7v5h-5M4 17v-5h5" />
        <path d="M6 8a7 7 0 0 1 12-1l2 5M18 16a7 7 0 0 1-12 1l-2-5" />
      </>
    ),
  };
  return (
    <svg
      className="icon"
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      {paths[name] ?? paths.alert}
    </svg>
  );
}
