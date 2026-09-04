import { useEffect, useRef, useState } from "react";
import { Link, useFetcher } from "react-router";

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
import type { HouseholdRange } from "./model";
import { MiniCalendar } from "./mini-calendar";
import { CustomDropdown } from "./custom-dropdown";

export interface ChoreRelayData {
  signedInMember: AuthorizedMember;
  householdRange: HouseholdRange;
  localToday: string;
  current: Awaited<ReturnType<typeof getCurrentAndNext>>;
  mine: Awaited<ReturnType<typeof getPersonalAgenda>>;
  householdList: Awaited<ReturnType<typeof getHouseholdList>>;
  household: Awaited<ReturnType<typeof getHouseholdCalendar>>;
  history: Awaited<ReturnType<typeof getGroupedHistory>>;
  activeMembers: ProjectedMember[];
  assignmentCandidates: ProjectedAssignment[];
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
      step: "recipient" | "review";
      balanceAssignmentId: string;
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
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const sync = () => {
      const current = effectiveTheme();
      document
        .querySelector('meta[name="theme-color"]')
        ?.setAttribute("content", current === "dark" ? "#1d201c" : "#fffefa");
      setTheme(current);
    };
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);
  function toggleTheme() {
    const next = (theme ?? effectiveTheme()) === "dark" ? "light" : "dark";
    applyTheme(next);
    setTheme(next);
  }
  if (props.state === "unauthorized") {
    return (
      <div className="app-shell sign-in-shell">
        <a className="skip-link" href="#main-content">
          Skip to content
        </a>
        <main id="main-content" className="sign-in-page" tabIndex={-1}>
          <div className="sign-in-panel">
            <span className="brand-mark" aria-hidden="true">
              <Icon name="brand" />
            </span>
            <h1>ChoRotate</h1>
            <AuthControl kind="sign-in" />
          </div>
        </main>
      </div>
    );
  }
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <header className="site-header">
        <div className="header-row">
          <Link
            className="brand"
            to="?view=now"
            aria-label="ChoRotate, go to Now"
          >
            <span className="brand-mark" aria-hidden="true">
              <Icon name="brand" />
            </span>
            <span>ChoRotate</span>
          </Link>
          <div className="header-actions">
            <button
              className="icon-button theme-toggle"
              type="button"
              onClick={toggleTheme}
              aria-label={
                theme
                  ? `Switch to ${theme === "dark" ? "light" : "dark"} mode`
                  : "Switch color mode"
              }
              title={
                theme
                  ? `Switch to ${theme === "dark" ? "light" : "dark"} mode`
                  : "Switch color mode"
              }
            >
              <span className="theme-icon theme-icon-light">
                <Icon name="moon" />
              </span>
              <span className="theme-icon theme-icon-dark">
                <Icon name="sun" />
              </span>
            </button>
            {props.state === "ready" ? (
              <ProfileMenu member={props.data.signedInMember} />
            ) : null}
          </div>
        </div>
        <nav className="primary-nav" aria-label="ChoRotate views">
          {views.map((view) => (
            <Link
              key={view}
              to={`?view=${view}`}
              preventScrollReset
              aria-current={props.activeView === view ? "page" : undefined}
            >
              <Icon name={view} />
              <span>{labels[view]}</span>
            </Link>
          ))}
        </nav>
      </header>
      <main id="main-content" className="main-content" tabIndex={-1}>
        {props.state === "unavailable" ? (
          <SystemState kind="unavailable" />
        ) : props.data ? (
          <ReadyShell activeView={props.activeView} data={props.data} />
        ) : (
          <SystemState kind="unavailable" />
        )}
      </main>
    </div>
  );
}

function effectiveTheme(): Exclude<Theme, undefined> {
  const documentTheme = document.documentElement.dataset.theme;
  if (documentTheme === "light" || documentTheme === "dark")
    return documentTheme;
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function applyTheme(theme: Exclude<Theme, undefined>) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem("chorotate-theme", theme);
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", theme === "dark" ? "#1d201c" : "#fffefa");
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
      step: "recipient",
      balanceAssignmentId: "",
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
  const assignments = unique(
    [
      ...data.assignmentCandidates,
      ...data.householdList.items,
      ...data.household.periods.flatMap((period) => period.assignments),
      ...(data.current.state === "ready"
        ? data.current.handoffs.flatMap(({ current, next }) =>
            [current, next].filter(
              (assignment): assignment is ProjectedAssignment =>
                assignment !== null,
            ),
          )
        : []),
    ],
    (assignment) => assignment.assignmentId,
  );
  return (
    <>
      {activeView === "now" ? (
        <NowView data={data} onReassign={reassign} />
      ) : null}
      {activeView === "mine" ? <MineView data={data} /> : null}
      {activeView === "household" ? (
        <HouseholdView data={data} onReassign={reassign} onSwap={swap} />
      ) : null}
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
          localToday={data.localToday}
          fetcher={fetcher}
          issue={issue}
          onChange={(next) => {
            setDialog(next);
            setIssue(undefined);
          }}
          onReviewConflict={setDialog}
          onClose={close}
        />
      ) : null}
    </>
  );
}

function ViewHeading({
  title,
  id,
  action,
}: {
  title: string;
  id: string;
  action?: React.ReactNode;
}) {
  return (
    <header className="view-heading">
      <h1 id={id}>{title}</h1>
      {action}
    </header>
  );
}

function NowView({
  data,
  onReassign,
}: {
  data: ChoreRelayData;
  onReassign(id: string): void;
}) {
  const { current } = data;
  if (current.state === "empty") return <SystemState kind="empty" />;
  if (current.state === "unavailable")
    return <SystemState kind="unavailable" />;
  return (
    <section aria-labelledby="now-title">
      <ViewHeading id="now-title" title="On duty" />
      <div className="handoff-grid">
        {current.handoffs.map(
          ({ chore, currentPeriod, nextPeriod, current: assignment, next }) =>
            assignment && next ? (
              <article className="handoff-card" key={assignment.assignmentId}>
                <div className="card-topline">
                  <div className="current-person">
                    <Person member={assignment.member} />
                    <strong>{assignment.member.displayName}</strong>
                  </div>
                  <div className="card-chore">
                    <p className="card-kicker">On duty now</p>
                    <h2>{chore.name}</h2>
                  </div>
                </div>
                <PeriodRange range={currentPeriod} label="Current period" />
                <MiniCalendar
                  range={currentPeriod}
                  today={data.localToday}
                  label={`${chore.name} current period`}
                />
                <ReminderStatus reminder={assignment.reminder} />
                <p className="chore-description">{chore.instructions}</p>
                <div className="handoff-strip">
                  <span className="strip-label">Next period</span>
                  <div className="handoff-next-person">
                    <Person member={next.member} size="tiny" />
                    <strong>{next.member.displayName}</strong>
                  </div>
                  <PeriodRange range={nextPeriod} />
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
    </section>
  );
}

function MineView({ data }: { data: ChoreRelayData }) {
  return (
    <section aria-labelledby="mine-title">
      <div className="mine-summary">
        <Person member={toProjected(data.signedInMember)} />
        <div>
          <h1 id="mine-title">Your upcoming chores</h1>
          <p>{data.signedInMember.displayName}</p>
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
                <MiniCalendar
                  range={assignment.period}
                  today={data.localToday}
                  label={`${assignment.chore.name} assignment period`}
                />
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

function HouseholdView({
  data,
  onReassign,
  onSwap,
}: {
  data: ChoreRelayData;
  onReassign(assignmentId: string): void;
  onSwap(): void;
}) {
  const [visibleMonth, setVisibleMonth] = useState(data.localToday.slice(0, 7));
  return (
    <section aria-labelledby="household-title">
      <ViewHeading
        id="household-title"
        title="Household schedule"
        action={
          <button className="button secondary" type="button" onClick={onSwap}>
            <Icon name="swap" /> Swap two turns
          </button>
        }
      />
      <TurnTallies
        assignments={data.householdList.items}
        truncated={data.householdList.page.nextOffset !== null}
      />
      {data.householdList.state === "empty" ? (
        <SystemState kind="empty" />
      ) : (
        <MonthCalendar
          assignments={data.householdList.items}
          month={visibleMonth}
          today={data.localToday}
          onMonthChange={setVisibleMonth}
          onReassign={onReassign}
        />
      )}
    </section>
  );
}

const calendarWeekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function MonthCalendar({
  assignments,
  month,
  today,
  onMonthChange,
  onReassign,
}: {
  assignments: ProjectedAssignment[];
  month: string;
  today: string;
  onMonthChange(month: string): void;
  onReassign(assignmentId: string): void;
}) {
  const firstOfMonth = `${month}-01`;
  const monthDate = parseCalendarDate(firstOfMonth);
  const lastDay = new Date(monthDate);
  lastDay.setUTCMonth(lastDay.getUTCMonth() + 1);
  lastDay.setUTCDate(0);
  const lastOfMonth = lastDay.toISOString().slice(0, 10);
  const gridStart = addCalendarDays(firstOfMonth, -monthDate.getUTCDay());
  const gridEnd = addCalendarDays(
    lastOfMonth,
    6 - parseCalendarDate(lastOfMonth).getUTCDay(),
  );
  const dates: string[] = [];
  for (let date = gridStart; date <= gridEnd; date = addCalendarDays(date, 1))
    dates.push(date);
  const weeks = Array.from({ length: dates.length / 7 }, (_, index) =>
    dates.slice(index * 7, index * 7 + 7),
  );
  const heading = new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(monthDate);

  return (
    <section
      className="month-calendar"
      aria-labelledby="calendar-month-heading"
    >
      <header className="month-calendar-header">
        <button
          className="icon-button"
          type="button"
          aria-label="Previous month"
          onClick={() => onMonthChange(shiftCalendarMonth(month, -1))}
        >
          <span aria-hidden="true">‹</span>
        </button>
        <div>
          <span>Household calendar</span>
          <h2 id="calendar-month-heading" aria-live="polite">
            {heading}
          </h2>
        </div>
        <button
          className="icon-button"
          type="button"
          aria-label="Next month"
          onClick={() => onMonthChange(shiftCalendarMonth(month, 1))}
        >
          <span aria-hidden="true">›</span>
        </button>
      </header>
      <div className="month-calendar-grid" aria-label={heading}>
        <div className="month-weekdays" aria-hidden="true">
          {calendarWeekdays.map((weekday) => (
            <span key={weekday}>{weekday}</span>
          ))}
        </div>
        {weeks.map((week) => {
          const weekStart = week[0]!;
          const weekEnd = week[6]!;
          const weekAssignments = chronological(assignments).filter(
            ({ period }) =>
              period.localStartDate <= weekEnd &&
              period.localEndDateInclusive >= weekStart,
          );
          return (
            <div className="month-week" key={weekStart}>
              <div className="month-days">
                {week.map((date) => (
                  <time
                    key={date}
                    dateTime={date}
                    data-outside-month={date.slice(0, 7) !== month || undefined}
                    data-today={date === today || undefined}
                    aria-current={date === today ? "date" : undefined}
                    aria-label={accessibleCalendarDate(date)}
                  >
                    {Number(date.slice(-2))}
                  </time>
                ))}
              </div>
              <div
                className="month-assignment-lanes"
                style={{
                  gridTemplateRows: `repeat(${weekAssignments.length}, 32px)`,
                }}
              >
                {weekAssignments.map((assignment, index) => {
                  const segmentStart =
                    assignment.period.localStartDate < weekStart
                      ? weekStart
                      : assignment.period.localStartDate;
                  const segmentEnd =
                    assignment.period.localEndDateInclusive > weekEnd
                      ? weekEnd
                      : assignment.period.localEndDateInclusive;
                  const columnStart = week.indexOf(segmentStart) + 1;
                  const columnEnd = week.indexOf(segmentEnd) + 2;
                  const choreTone =
                    assignment.chore.id === "trash"
                      ? "is-trash"
                      : assignment.chore.id === "dishwasher"
                        ? "is-dishwasher"
                        : "is-other";
                  return (
                    <button
                      key={`${assignment.assignmentId}-${weekStart}`}
                      className={`month-assignment ${choreTone}`}
                      type="button"
                      style={{
                        gridColumn: `${columnStart} / ${columnEnd}`,
                        gridRow: index + 1,
                      }}
                      aria-label={assignmentActionLabel(assignment)}
                      title={`${assignment.chore.name}: ${assignment.member.displayName}`}
                      onClick={() => onReassign(assignment.assignmentId)}
                    >
                      <ChoreGlyph choreId={assignment.chore.id} />
                      <span className="month-assignment-chore">
                        {assignment.chore.name}
                      </span>
                      <Person member={assignment.member} size="tiny" />
                      <strong>{assignment.member.displayName}</strong>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function parseCalendarDate(localDate: string): Date {
  return new Date(`${localDate}T00:00:00Z`);
}

function addCalendarDays(localDate: string, days: number): string {
  const date = parseCalendarDate(localDate);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function shiftCalendarMonth(month: string, amount: number): string {
  const date = parseCalendarDate(`${month}-01`);
  date.setUTCMonth(date.getUTCMonth() + amount);
  return date.toISOString().slice(0, 7);
}

function accessibleCalendarDate(localDate: string): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(parseCalendarDate(localDate));
}

function assignmentActionLabel(assignment: ProjectedAssignment): string {
  return `Reassign ${assignment.chore.name}, ${formatPeriod(assignment.period)}, assigned to ${assignment.member.displayName}`;
}

function TurnTallies({
  assignments,
  truncated,
}: {
  assignments: ProjectedAssignment[];
  truncated: boolean;
}) {
  const counts = new Map<string, { member: ProjectedMember; turns: number }>();
  for (const assignment of assignments) {
    const current = counts.get(assignment.member.id);
    counts.set(assignment.member.id, {
      member: assignment.member,
      turns: (current?.turns ?? 0) + 1,
    });
  }
  const tallies = [...counts.values()].sort((left, right) =>
    left.member.displayName.localeCompare(right.member.displayName),
  );
  return (
    <section className="turn-tallies" aria-labelledby="turn-tallies-title">
      <h2 id="turn-tallies-title">
        {truncated ? "Assigned turns shown" : "Assigned turns"}
      </h2>
      <ul>
        {tallies.map(({ member, turns }) => (
          <li key={member.id}>
            <Person member={member} size="tiny" />
            <span>{member.displayName}</span>
            <strong>
              {turns} {turns === 1 ? "turn" : "turns"}
            </strong>
          </li>
        ))}
      </ul>
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
      <ViewHeading id="history-title" title="Recent changes" />
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
        : ["cloud", "No schedule found"];
  return (
    <div
      className={`system-state state-${kind}`}
      role={kind === "unavailable" ? "alert" : "status"}
    >
      <Icon name={content[0]} />
      <div>
        <h1>{content[1]}</h1>
        {content[2] ? <p>{content[2]}</p> : null}
        {kind === "unauthorized" ? <AuthControl kind="sign-in" /> : null}
        {kind === "empty" ? <MaterializeControl /> : null}
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

function ProfileMenu({ member }: { member: AuthorizedMember }) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeWithEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        menuRef.current
          ?.querySelector<HTMLButtonElement>(".profile-trigger")
          ?.focus();
      }
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeWithEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeWithEscape);
    };
  }, [open]);
  return (
    <div className="profile-menu" ref={menuRef}>
      <button
        className="profile-trigger"
        type="button"
        aria-label="Open profile menu"
        aria-expanded={open}
        aria-controls="profile-popover"
        onClick={() => setOpen((current) => !current)}
      >
        <Person member={toProjected(member)} size="small" />
      </button>
      <div className="profile-popover" id="profile-popover" hidden={!open}>
        <strong>{member.displayName}</strong>
        <AuthControl kind="sign-out" />
      </div>
    </div>
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
        : {};
      const response = await fetch(endpoint, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
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
        className={`button ${signIn ? "primary" : "quiet"}${pending ? " is-pending" : ""}`}
        type="button"
        onClick={submit}
        disabled={pending}
        aria-busy={pending}
      >
        {signIn ? (
          <svg
            className="google-mark"
            viewBox="0 0 24 24"
            role="img"
            aria-hidden="true"
          >
            <path
              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              fill="#4285f4"
            />
            <path
              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              fill="#34a853"
            />
            <path
              d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
              fill="#fbbc05"
            />
            <path
              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
              fill="#ea4335"
            />
          </svg>
        ) : null}
        {signIn ? "Sign in with Google" : "Sign out"}
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
  return {
    id: member.id,
    displayName: member.displayName,
    active: true,
    imageUrl: member.imageUrl,
  };
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
  return name.trim().charAt(0).toUpperCase();
}
function cueClass(id: string): string {
  const cues = ["tone-0", "tone-1", "tone-2", "tone-3"];
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
      {member.imageUrl ? (
        <img
          src={member.imageUrl}
          alt=""
          width="50"
          height="50"
          referrerPolicy="no-referrer"
          onError={(event) => {
            event.currentTarget.hidden = true;
          }}
        />
      ) : null}
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
    if (occurrence.result === "pending") continue;
    const phase = occurrence.phase === "evening" ? "Evening" : "Morning";
    const details =
      occurrence.result === "accepted"
        ? {
            icon: "check" as const,
            tone: "positive" as const,
            text: `${phase} reminder accepted for sending`,
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
    brand: (
      <>
        <path d="M7 8a7 7 0 0 1 11-1l2-1v6h-6l2-2a4.2 4.2 0 0 0-6.8.2" />
        <path d="M17 16a7 7 0 0 1-11 1l-2 1v-6h6l-2 2a4.2 4.2 0 0 0 6.8-.2" />
      </>
    ),
    now: (
      <>
        <circle cx="12" cy="12" r="7.5" />
        <path d="m9 12 2 2 4-5" />
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
        <circle cx="9" cy="9" r="3" />
        <circle cx="17" cy="10" r="2.5" />
        <path d="M3.5 19a5.5 5.5 0 0 1 11 0M14 16a4.5 4.5 0 0 1 6.5 3" />
      </>
    ),
    history: (
      <>
        <path d="M8 6h12M8 12h12M8 18h12" />
        <circle cx="4" cy="6" r=".7" fill="currentColor" stroke="none" />
        <circle cx="4" cy="12" r=".7" fill="currentColor" stroke="none" />
        <circle cx="4" cy="18" r=".7" fill="currentColor" stroke="none" />
      </>
    ),
    swap: (
      <>
        <path d="M6 7h12m0 0-3-3m3 3-3 3" />
        <path d="M18 17H6m0 0 3 3m-3-3 3-3" />
      </>
    ),
    moon: (
      <path d="M20.5 14.3A8.5 8.5 0 0 1 9.7 3.5a8.5 8.5 0 1 0 10.8 10.8Z" />
    ),
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
