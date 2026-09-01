import type { LocalDate } from "../contracts";

export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface ChorePeriodSettings {
  timeZone: string;
  startsOn: Weekday;
}

export interface ChorePeriod {
  localStartDate: LocalDate;
  localInclusiveEndDate: LocalDate;
  startsAt: Date;
  endsAt: Date;
}

interface DateParts {
  year: number;
  month: number;
  day: number;
}

interface DateTimeParts extends DateParts {
  hour: number;
  minute: number;
  second: number;
}

const dateTimeFormatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  const cached = dateTimeFormatters.get(timeZone);
  if (cached) return cached;
  const created = new Intl.DateTimeFormat("en-US", {
    timeZone,
    calendar: "gregory",
    numberingSystem: "latn",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  dateTimeFormatters.set(timeZone, created);
  return created;
}

function partsAt(instant: Date, timeZone: string): DateTimeParts {
  const values: Record<string, number> = {};
  for (const part of formatter(timeZone).formatToParts(instant)) {
    if (part.type !== "literal") values[part.type] = Number(part.value);
  }
  return {
    year: values.year!,
    month: values.month!,
    day: values.day!,
    hour: values.hour!,
    minute: values.minute!,
    second: values.second!,
  };
}

function utcMillis(parts: DateTimeParts): number {
  const date = new Date(0);
  date.setUTCFullYear(parts.year, parts.month - 1, parts.day);
  date.setUTCHours(parts.hour, parts.minute, parts.second, 0);
  return date.getTime();
}

function sameDateTime(left: DateTimeParts, right: DateTimeParts): boolean {
  return (
    left.year === right.year &&
    left.month === right.month &&
    left.day === right.day &&
    left.hour === right.hour &&
    left.minute === right.minute &&
    left.second === right.second
  );
}

function localMidnight(localDate: LocalDate, timeZone: string): Date {
  const date = parseLocalDate(localDate);
  const target: DateTimeParts = { ...date, hour: 0, minute: 0, second: 0 };
  const guess = utcMillis(target);
  const offsets = new Set<number>();
  for (let hours = -36; hours <= 36; hours += 6) {
    const sample = new Date(guess + hours * 60 * 60 * 1_000);
    const sampleAtSecond = Math.floor(sample.getTime() / 1_000) * 1_000;
    offsets.add(utcMillis(partsAt(sample, timeZone)) - sampleAtSecond);
  }

  const exact = [...offsets]
    .map((offset) => new Date(guess - offset))
    .filter((candidate) => sameDateTime(partsAt(candidate, timeZone), target))
    .sort((left, right) => left.getTime() - right.getTime())[0];
  if (exact) return exact;

  // A few zones advance at midnight. Use the first real instant on the target
  // local date, matching compatible civil-time disambiguation.
  for (let minutes = -18 * 60; minutes <= 18 * 60; minutes += 1) {
    const candidate = new Date(guess + minutes * 60 * 1_000);
    const candidateParts = partsAt(candidate, timeZone);
    if (
      candidateParts.year === target.year &&
      candidateParts.month === target.month &&
      candidateParts.day === target.day
    ) {
      return candidate;
    }
  }
  throw new RangeError(
    `Unable to resolve local midnight ${localDate} in ${timeZone}`,
  );
}

export function parseLocalDate(localDate: LocalDate): DateParts {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(localDate);
  if (!match) throw new RangeError(`Invalid local date: ${localDate}`);
  const parts = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
  if (formatLocalDate(parts) !== localDate) {
    throw new RangeError(`Invalid local date: ${localDate}`);
  }
  return parts;
}

function epochDay(localDate: LocalDate): number {
  const parts = parseLocalDate(localDate);
  const date = new Date(0);
  date.setUTCFullYear(parts.year, parts.month - 1, parts.day);
  date.setUTCHours(0, 0, 0, 0);
  return Math.floor(date.getTime() / 86_400_000);
}

function localDateFromEpochDay(day: number): LocalDate {
  const date = new Date(day * 86_400_000);
  return formatLocalDate({
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  });
}

function formatLocalDate({ year, month, day }: DateParts): LocalDate {
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(0, 0, 0, 0);
  return `${String(date.getUTCFullYear()).padStart(4, "0")}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

export function addLocalDays(localDate: LocalDate, days: number): LocalDate {
  if (!Number.isInteger(days)) {
    throw new RangeError("Calendar days must be an integer");
  }
  return localDateFromEpochDay(epochDay(localDate) + days);
}

export function weekdayOfLocalDate(localDate: LocalDate): Weekday {
  return ((((epochDay(localDate) + 4) % 7) + 7) % 7) as Weekday;
}

export function periodsBetween(
  anchorPeriod: LocalDate,
  period: LocalDate,
): number {
  const days = epochDay(period) - epochDay(anchorPeriod);
  if (days % 7 !== 0) {
    throw new RangeError(
      `${period} is not on the period boundary anchored at ${anchorPeriod}`,
    );
  }
  return days / 7;
}

function validateStartsOn(startsOn: Weekday): void {
  if (!Number.isInteger(startsOn) || startsOn < 0 || startsOn > 6) {
    throw new RangeError("startsOn must be an integer from 0 through 6");
  }
}

export function localPeriodFromStart(
  localStartDate: LocalDate,
  settings: ChorePeriodSettings,
): ChorePeriod {
  validateStartsOn(settings.startsOn);
  if (weekdayOfLocalDate(localStartDate) !== settings.startsOn) {
    throw new RangeError(
      `${localStartDate} is not a chore period boundary for weekday ${settings.startsOn}`,
    );
  }
  const nextStart = addLocalDays(localStartDate, 7);
  return {
    localStartDate,
    localInclusiveEndDate: addLocalDays(localStartDate, 6),
    startsAt: localMidnight(localStartDate, settings.timeZone),
    endsAt: localMidnight(nextStart, settings.timeZone),
  };
}

export function chorePeriodAt(
  instant: Date,
  settings: ChorePeriodSettings,
): ChorePeriod {
  if (Number.isNaN(instant.getTime())) throw new RangeError("Invalid instant");
  validateStartsOn(settings.startsOn);
  const localParts = partsAt(instant, settings.timeZone);
  const localDate = formatLocalDate(localParts);
  const daysSinceStart =
    (weekdayOfLocalDate(localDate) - settings.startsOn + 7) % 7;
  return localPeriodFromStart(
    addLocalDays(localDate, -daysSinceStart),
    settings,
  );
}
