import type { ChorePeriodRange } from "./model";

const weekdays = [
  ["Sun", "Sunday"],
  ["Mon", "Monday"],
  ["Tue", "Tuesday"],
  ["Wed", "Wednesday"],
  ["Thu", "Thursday"],
  ["Fri", "Friday"],
  ["Sat", "Saturday"],
] as const;

export interface MiniCalendarDate {
  localDate: string;
  day: number;
  inRange: boolean;
}

function parseLocalDate(localDate: string): Date {
  return new Date(`${localDate}T00:00:00Z`);
}

function addLocalDays(localDate: string, days: number): string {
  const value = parseLocalDate(localDate);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function miniCalendarDates(range: ChorePeriodRange): MiniCalendarDate[] {
  const first = parseLocalDate(range.localStartDate);
  const last = parseLocalDate(range.localEndDateInclusive);
  const gridStart = addLocalDays(range.localStartDate, -first.getUTCDay());
  const gridEnd = addLocalDays(
    range.localEndDateInclusive,
    6 - last.getUTCDay(),
  );
  const cells: MiniCalendarDate[] = [];
  for (let localDate = gridStart; localDate <= gridEnd;) {
    cells.push({
      localDate,
      day: parseLocalDate(localDate).getUTCDate(),
      inRange:
        localDate >= range.localStartDate &&
        localDate <= range.localEndDateInclusive,
    });
    localDate = addLocalDays(localDate, 1);
  }
  return cells;
}

function calendarHeading(range: ChorePeriodRange): string {
  const start = parseLocalDate(range.localStartDate);
  const end = parseLocalDate(range.localEndDateInclusive);
  const month = new Intl.DateTimeFormat("en-US", {
    month: "short",
    timeZone: "UTC",
  });
  const monthAndYear = new Intl.DateTimeFormat("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
  const startMonth = month.format(start);
  const endMonth = month.format(end);
  if (start.getUTCFullYear() !== end.getUTCFullYear()) {
    return `${monthAndYear.format(start)}–${monthAndYear.format(end)}`;
  }
  return startMonth === endMonth
    ? monthAndYear.format(start)
    : `${startMonth}–${monthAndYear.format(end)}`;
}

function accessibleDate(localDate: string): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(parseLocalDate(localDate));
}

export function MiniCalendar({
  range,
  today,
  label,
}: {
  range: ChorePeriodRange;
  today: string;
  label: string;
}) {
  const cells = miniCalendarDates(range);
  const rows = Array.from({ length: cells.length / 7 }, (_, index) =>
    cells.slice(index * 7, index * 7 + 7),
  );
  return (
    <table className="mini-calendar" aria-label={label}>
      <caption>{calendarHeading(range)}</caption>
      <thead>
        <tr>
          {weekdays.map(([short, full]) => (
            <th key={short} scope="col" abbr={full}>
              {short.slice(0, 1)}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row[0]!.localDate}>
            {row.map((cell) => {
              const isToday = cell.localDate === today;
              return (
                <td
                  key={cell.localDate}
                  data-date={cell.localDate}
                  data-in-range={cell.inRange ? "true" : undefined}
                  data-today={isToday ? "true" : undefined}
                  aria-label={`${accessibleDate(cell.localDate)}${cell.inRange ? ", in ownership period" : ""}${isToday ? ", today" : ""}`}
                >
                  <time dateTime={cell.localDate}>{cell.day}</time>
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
