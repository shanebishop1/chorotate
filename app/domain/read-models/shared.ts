import type { AuthorizedMember } from "../../auth/access";
import type { LocalDate } from "../contracts";
import { localPeriodFromStart, type Weekday } from "../rotation/period";
import type { D1DatabaseLike } from "../storage/d1";

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;
export const MAX_PAGE_OFFSET = 10_000;
export const MAX_CALENDAR_DAYS = 84;
export const MAX_CALENDAR_ASSIGNMENTS = 1_200;
export const DEFAULT_SCHEDULE_WEEKS = 12;

export interface ReadModelContext {
  database: D1DatabaseLike;
  authorizer: {
    requireAuthorizedMember(request: Request): Promise<AuthorizedMember>;
  };
}

export class ReadModelError extends Error {
  constructor(readonly status: 400 | 503) {
    super(
      status === 400 ? "Invalid read model request" : "Schedule unavailable",
    );
    this.name = "ReadModelError";
  }
}

export interface PeriodRange {
  householdId: string;
  localStartDate: string;
  localEndDateInclusive: string;
}

export interface ProjectedMember {
  id: string;
  displayName: string;
  active: boolean;
  imageUrl?: string;
}

export interface ProjectedChore {
  id: string;
  name: string;
  instructions: string;
  ownershipStartWeekday: Weekday;
}

export type ReminderContactStatus =
  | "ready"
  | "missing_contact"
  | "unconsented"
  | "suppressed";
export type ReminderResult =
  | "pending"
  | "accepted"
  | "missed"
  | "delivery_unknown";
export interface ProjectedReminderStatus {
  contactStatus: ReminderContactStatus;
  correctionNeeded: boolean;
  occurrences: Array<{
    phase: "evening" | "morning";
    result: ReminderResult;
    correctionNeeded: boolean;
  }>;
}

export interface ProjectedAssignment {
  assignmentId: string;
  period: PeriodRange;
  chore: ProjectedChore;
  member: ProjectedMember;
  version: number;
  source: "rotation" | "reassignment" | "swap";
  reminder: ProjectedReminderStatus;
}

export interface Page {
  limit: number;
  offset: number;
  nextOffset: number | null;
}

export type ProjectionState = "ready" | "empty";

export interface HouseholdRow {
  id: unknown;
  time_zone: unknown;
}

export interface Household {
  id: string;
  timeZone: string;
}

export function invalidInput(): never {
  throw new ReadModelError(400);
}

export function unavailable(): never {
  throw new ReadModelError(503);
}

export function stringValue(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) unavailable();
  return value;
}

export function nullableString(value: unknown): string | null {
  if (value === null) return null;
  return stringValue(value);
}

export function integerValue(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) unavailable();
  return value;
}

export function activeValue(value: unknown): boolean {
  const active = integerValue(value);
  if (active !== 0 && active !== 1) unavailable();
  return active === 1;
}

export function isLocalDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return (
    !Number.isNaN(parsed.valueOf()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

export function localDateInput(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (!isLocalDate(value)) invalidInput();
  return value;
}

export function addDays(localDate: string, days: number): string {
  const date = new Date(`${localDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function periodRange(
  householdId: string,
  localStartDate: string,
): PeriodRange {
  if (!isLocalDate(localStartDate)) unavailable();
  return {
    householdId,
    localStartDate,
    localEndDateInclusive: addDays(localStartDate, 6),
  };
}

export function chorePeriodRange(
  householdId: string,
  localStartDate: string,
  timeZone: string,
  startsOn: Weekday,
): PeriodRange {
  const period = localPeriodFromStart(localStartDate as LocalDate, {
    timeZone,
    startsOn,
  });
  return {
    householdId,
    localStartDate: period.localStartDate,
    localEndDateInclusive: period.localInclusiveEndDate,
  };
}

function dateParts(date: Date, timeZone: string): Record<string, string> {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  return Object.fromEntries(parts.map(({ type, value }) => [type, value]));
}

export function localDateAt(date: Date, timeZone: string): string {
  if (Number.isNaN(date.valueOf())) invalidInput();
  const parts = dateParts(date, timeZone);
  const value = `${parts.year}-${parts.month}-${parts.day}`;
  if (!isLocalDate(value)) unavailable();
  return value;
}

export function localDateTimeAt(timestamp: string, timeZone: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.valueOf())) unavailable();
  const parts = dateParts(date, timeZone);
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
}

async function householdFor(
  context: ReadModelContext,
  member: AuthorizedMember,
): Promise<Household> {
  try {
    const result = await context.database
      .prepare(
        `SELECT h.id, h.time_zone
         FROM households AS h
         INNER JOIN members AS m ON m.household_id = h.id
         WHERE h.id = ? AND m.id = ? AND m.active = 1
         LIMIT 2`,
      )
      .bind(member.householdId, member.id)
      .all<HouseholdRow>();
    if (result.results.length !== 1) unavailable();
    const row = result.results[0];
    return {
      id: stringValue(row.id),
      timeZone: stringValue(row.time_zone),
    };
  } catch (error) {
    if (error instanceof ReadModelError) throw error;
    unavailable();
  }
}

export async function authorize(
  context: ReadModelContext,
  request: Request,
): Promise<{ member: AuthorizedMember; household: Household }> {
  const member = await context.authorizer.requireAuthorizedMember(request);
  const household = await householdFor(context, member);
  if (household.id !== member.householdId) unavailable();
  return { member, household };
}

export function pageInput(
  limitValue?: number,
  offsetValue?: number,
): { limit: number; offset: number } {
  const limit = limitValue ?? DEFAULT_PAGE_SIZE;
  const offset = offsetValue ?? 0;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_PAGE_SIZE)
    invalidInput();
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > MAX_PAGE_OFFSET)
    invalidInput();
  return { limit, offset };
}

export function idFilter(
  values: readonly string[] | undefined,
): readonly string[] | undefined {
  if (values === undefined) return undefined;
  if (values.length > MAX_PAGE_SIZE) invalidInput();
  if (values.some((value) => typeof value !== "string" || value.length === 0))
    invalidInput();
  return [...new Set(values)];
}

export function sourceValue(value: unknown): ProjectedAssignment["source"] {
  if (value === "rotation" || value === "reassignment" || value === "swap")
    return value;
  unavailable();
}

export function weekdayValue(value: unknown): Weekday {
  const weekday = integerValue(value);
  if (weekday < 0 || weekday > 6) unavailable();
  return weekday as Weekday;
}

export function booleanInteger(value: unknown): boolean {
  return activeValue(value);
}
