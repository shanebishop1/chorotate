import { useState } from "react";
import type {
  HistoryOperation,
  ProjectedAssignment,
} from "../../domain/read-models";
import type { ChoreRelayView } from "./model";
import { MiniCalendar } from "./mini-calendar";
import {
  ChoreGlyph,
  HistoryCorrectionStatus,
  Icon,
  PeriodRange,
  Person,
  ReminderStatus,
  ViewHeading,
  accessibleCalendarDate,
  addCalendarDays,
  assignmentActionLabel,
  chronological,
  formatLocalTimestamp,
  parseCalendarDate,
  shiftCalendarMonth,
  toProjected,
} from "./shared-presentation";
import { SystemState } from "./shell-chrome";
import type { ChoreRelayData } from "./types";

export function ReadyView({
  activeView,
  data,
  onReassign,
  onSwap,
}: {
  activeView: ChoreRelayView;
  data: ChoreRelayData;
  onReassign(assignmentId: string): void;
  onSwap(): void;
}) {
  if (activeView === "now")
    return <NowView data={data} onReassign={onReassign} />;
  if (activeView === "mine") return <MineView data={data} />;
  if (activeView === "household") {
    return (
      <HouseholdView data={data} onReassign={onReassign} onSwap={onSwap} />
    );
  }
  return <HistoryView history={data.history} />;
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
            assignment ? (
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
                <ReminderStatus reminder={assignment.reminder} reserveSpace />
                <p className="chore-description">{chore.instructions}</p>
                {next ? (
                  <div className="handoff-strip">
                    <span className="strip-label">Next period</span>
                    <div className="handoff-next-person">
                      <Person member={next.member} size="tiny" />
                      <strong>{next.member.displayName}</strong>
                    </div>
                    <PeriodRange range={nextPeriod} />
                  </div>
                ) : null}
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

function TurnTallies({
  assignments,
  truncated,
}: {
  assignments: ProjectedAssignment[];
  truncated: boolean;
}) {
  const counts = new Map<
    string,
    { member: ProjectedAssignment["member"]; turns: number }
  >();
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

function HistoryView({ history }: { history: ChoreRelayData["history"] }) {
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
