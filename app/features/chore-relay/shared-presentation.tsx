import type { ReactNode } from "react";

import type { AuthorizedMember } from "../../auth/access";
import type {
  ProjectedAssignment,
  ProjectedMember,
  ProjectedReminderStatus,
} from "../../domain/read-models";
import type { ChorePeriodRange } from "./model";

export function ViewHeading({
  title,
  id,
  action,
}: {
  title: string;
  id: string;
  action?: ReactNode;
}) {
  return (
    <header className="view-heading">
      <h1 id={id}>{title}</h1>
      {action}
    </header>
  );
}

export function toProjected(member: AuthorizedMember): ProjectedMember {
  return {
    id: member.id,
    displayName: member.displayName,
    active: true,
    imageUrl: member.imageUrl,
  };
}

export function unique<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const value = key(item);
    if (seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

export function chronological(
  items: ProjectedAssignment[],
): ProjectedAssignment[] {
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

export function Person({
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

export function ChoreGlyph({ choreId }: { choreId: string }) {
  return (
    <span className="chore-glyph" aria-hidden="true">
      <Icon name={choreId.toLowerCase().includes("trash") ? "trash" : "dish"} />
    </span>
  );
}

function calendarDate(localDate: string): Date {
  return new Date(`${localDate}T00:00:00Z`);
}

export function parseCalendarDate(localDate: string): Date {
  return calendarDate(localDate);
}

export function addCalendarDays(localDate: string, days: number): string {
  const date = calendarDate(localDate);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function shiftCalendarMonth(month: string, amount: number): string {
  const date = calendarDate(`${month}-01`);
  date.setUTCMonth(date.getUTCMonth() + amount);
  return date.toISOString().slice(0, 7);
}

export function accessibleCalendarDate(localDate: string): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(calendarDate(localDate));
}

export function assignmentActionLabel(assignment: ProjectedAssignment): string {
  return `Reassign ${assignment.chore.name}, ${formatPeriod(assignment.period)}, assigned to ${assignment.member.displayName}`;
}

export function formatDate(localDate: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(calendarDate(localDate));
}

export function formatPeriod(period?: ChorePeriodRange): string {
  return period
    ? `${formatPeriodDate(period.localStartDate)} – ${formatPeriodDate(period.localEndDateInclusive)}`
    : "Selected turn";
}

export function formatPeriodDate(localDate: string): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(calendarDate(localDate));
}

export function PeriodRange({
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

export function ReminderStatus({
  reminder,
  reserveSpace = false,
}: {
  reminder: ProjectedReminderStatus;
  reserveSpace?: boolean;
}) {
  const accepted = reminder.occurrences.some(
    ({ phase, result }) => phase === "morning" && result === "accepted",
  );
  if (!accepted && !reserveSpace) return null;
  return (
    <ul
      className={`reminder-status${reserveSpace ? " is-reserved" : ""}`}
      aria-label={accepted ? "Reminder status" : undefined}
      aria-hidden={!accepted}
    >
      {accepted ? (
        <li className="is-positive">
          <Icon name="check" />
          <span>Morning reminder</span>
        </li>
      ) : null}
    </ul>
  );
}

export function HistoryCorrectionStatus() {
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

export function formatLocalTimestamp(value: string): string {
  const [localDate, time] = value.split("T");
  return `${formatDate(localDate)} · ${time.slice(0, 5)}`;
}

export function Icon({ name }: { name: string }) {
  const paths: Record<string, ReactNode> = {
    brand: (
      <>
        <path d="M7 8a7 7 0 0 1 11-1l2-1v6h-6l2-2a4.2 4.2 0 0 0-6.8.2" />
        <path d="M17 16a7 7 0 0 1-11 1l-2 1v-6h6l-2 2a4.2 4.2 0 0 0 6.8-.2" />
      </>
    ),
    github: (
      <path
        fill="currentColor"
        stroke="none"
        d="M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48v-1.87c-2.78.6-3.37-1.18-3.37-1.18-.45-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.61.07-.61 1 .07 1.53 1.03 1.53 1.03.9 1.53 2.35 1.09 2.92.83.09-.65.35-1.09.64-1.34-2.22-.25-4.55-1.11-4.55-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.64 0 0 .84-.27 2.75 1.02A9.6 9.6 0 0 1 12 6.82a9.6 9.6 0 0 1 2.5.34c1.91-1.29 2.75-1.02 2.75-1.02.55 1.37.2 2.39.1 2.64.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.68-4.57 4.93.36.31.68.92.68 1.85v2.77c0 .27.18.58.69.48A10 10 0 0 0 12 2Z"
      />
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
