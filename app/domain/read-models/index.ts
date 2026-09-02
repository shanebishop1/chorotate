import { trustedGoogleImage, type AuthorizedMember } from "../../auth/access";
import type { LocalDate } from "../contracts";
import {
  addLocalDays,
  chorePeriodAt,
  localPeriodFromStart,
  type Weekday,
} from "../rotation/period";
import type { D1DatabaseLike } from "../storage/d1";

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;
const MAX_PAGE_OFFSET = 10_000;
const MAX_CALENDAR_DAYS = 84;
const MAX_CALENDAR_ASSIGNMENTS = 1_200;
const DEFAULT_SCHEDULE_WEEKS = 12;

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

export async function getActiveMembers(
  context: ReadModelContext,
  input: { request: Request },
): Promise<ProjectedMember[]> {
  const { household } = await authorize(context, input.request);
  try {
    const result = await context.database
      .prepare(
        `SELECT id, display_name, active,
                (SELECT u.image
                 FROM allowlisted_identities AS ai
                 INNER JOIN "user" AS u ON u.id = ai.auth_user_id
                 WHERE ai.household_id = members.household_id
                   AND ai.member_id = members.id
                   AND ai.active = 1
                 ORDER BY ai.id
                 LIMIT 1) AS image_url
         FROM members
         WHERE household_id = ? AND active = 1 ORDER BY display_name, id`,
      )
      .bind(household.id)
      .all<{
        id: unknown;
        display_name: unknown;
        active: unknown;
        image_url: unknown;
      }>();
    return result.results.map((row) =>
      memberFromRow(row.id, row.display_name, row.active, row.image_url),
    );
  } catch (error) {
    if (error instanceof ReadModelError) throw error;
    unavailable();
  }
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

type ProjectionState = "ready" | "empty";

interface HouseholdRow {
  id: unknown;
  time_zone: unknown;
}

interface AssignmentRow {
  assignment_id: unknown;
  local_period_start: unknown;
  chore_id: unknown;
  chore_name: unknown;
  chore_instructions: unknown;
  ownership_start_weekday: unknown;
  member_id: unknown;
  member_name: unknown;
  member_active: unknown;
  member_image_url: unknown;
  version: unknown;
  source: unknown;
  sms_has_phone: unknown;
  sms_consent_status: unknown;
  sms_suppression_status: unknown;
  evening_status: unknown;
  evening_correction_needed: unknown;
  morning_status: unknown;
  morning_correction_needed: unknown;
  correction_needed: unknown;
}

interface ChoreRow {
  chore_id: unknown;
  chore_name: unknown;
  chore_instructions: unknown;
  ownership_start_weekday: unknown;
}

function invalidInput(): never {
  throw new ReadModelError(400);
}

function unavailable(): never {
  throw new ReadModelError(503);
}

function stringValue(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) unavailable();
  return value;
}

function nullableString(value: unknown): string | null {
  if (value === null) return null;
  return stringValue(value);
}

function integerValue(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) unavailable();
  return value;
}

function activeValue(value: unknown): boolean {
  const active = integerValue(value);
  if (active !== 0 && active !== 1) unavailable();
  return active === 1;
}

function isLocalDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return (
    !Number.isNaN(parsed.valueOf()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

function localDateInput(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (!isLocalDate(value)) invalidInput();
  return value;
}

function addDays(localDate: string, days: number): string {
  const date = new Date(`${localDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function periodRange(householdId: string, localStartDate: string): PeriodRange {
  if (!isLocalDate(localStartDate)) unavailable();
  return {
    householdId,
    localStartDate,
    localEndDateInclusive: addDays(localStartDate, 6),
  };
}

function chorePeriodRange(
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

function localDateAt(date: Date, timeZone: string): string {
  if (Number.isNaN(date.valueOf())) invalidInput();
  const parts = dateParts(date, timeZone);
  const value = `${parts.year}-${parts.month}-${parts.day}`;
  if (!isLocalDate(value)) unavailable();
  return value;
}

function localDateTimeAt(timestamp: string, timeZone: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.valueOf())) unavailable();
  const parts = dateParts(date, timeZone);
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
}

interface Household {
  id: string;
  timeZone: string;
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

async function authorize(
  context: ReadModelContext,
  request: Request,
): Promise<{ member: AuthorizedMember; household: Household }> {
  const member = await context.authorizer.requireAuthorizedMember(request);
  const household = await householdFor(context, member);
  if (household.id !== member.householdId) unavailable();
  return { member, household };
}

function pageInput(
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

function idFilter(
  values: readonly string[] | undefined,
): readonly string[] | undefined {
  if (values === undefined) return undefined;
  if (values.length > MAX_PAGE_SIZE) invalidInput();
  if (values.some((value) => typeof value !== "string" || value.length === 0))
    invalidInput();
  return [...new Set(values)];
}

function sourceValue(value: unknown): ProjectedAssignment["source"] {
  if (value === "rotation" || value === "reassignment" || value === "swap")
    return value;
  unavailable();
}

function weekdayValue(value: unknown): Weekday {
  const weekday = integerValue(value);
  if (weekday < 0 || weekday > 6) unavailable();
  return weekday as Weekday;
}

function booleanInteger(value: unknown): boolean {
  return activeValue(value);
}

function reminderResult(value: unknown): ReminderResult {
  if (value === "pending" || value === "leased") return "pending";
  if (value === "accepted" || value === "delivery_unknown") return value;
  if (value === "failed") return "missed";
  unavailable();
}

function reminderStatus(input: {
  hasPhone: unknown;
  consent: unknown;
  suppression: unknown;
  eveningStatus: unknown;
  eveningCorrection: unknown;
  morningStatus: unknown;
  morningCorrection: unknown;
  correctionNeeded?: unknown;
}): ProjectedReminderStatus {
  const contactStatus: ReminderContactStatus =
    input.suppression === "suppressed"
      ? "suppressed"
      : !booleanInteger(input.hasPhone)
        ? "missing_contact"
        : input.consent !== "consented"
          ? "unconsented"
          : "ready";
  if (
    input.suppression !== "suppressed" &&
    input.suppression !== "not_suppressed"
  )
    unavailable();
  if (
    input.consent !== "consented" &&
    input.consent !== "not_recorded" &&
    input.consent !== "revoked"
  )
    unavailable();
  const occurrences: ProjectedReminderStatus["occurrences"] = [];
  for (const [phase, status, correction] of [
    ["evening", input.eveningStatus, input.eveningCorrection],
    ["morning", input.morningStatus, input.morningCorrection],
  ] as const) {
    if (status === null) {
      if (correction !== null) unavailable();
      continue;
    }
    occurrences.push({
      phase,
      result: reminderResult(status),
      correctionNeeded: booleanInteger(correction),
    });
  }
  const correctionNeeded =
    input.correctionNeeded === undefined
      ? occurrences.some((occurrence) => occurrence.correctionNeeded)
      : booleanInteger(input.correctionNeeded);
  return { contactStatus, correctionNeeded, occurrences };
}

function memberFromRow(
  id: unknown,
  name: unknown,
  active: unknown,
  image: unknown,
): ProjectedMember {
  const member: ProjectedMember = {
    id: stringValue(id),
    displayName: stringValue(name),
    active: activeValue(active),
  };
  const imageUrl = trustedGoogleImage(image);
  return imageUrl ? { ...member, imageUrl } : member;
}

function assignmentFromRow(
  row: AssignmentRow,
  householdId: string,
  timeZone: string,
): ProjectedAssignment {
  const ownershipStartWeekday = weekdayValue(row.ownership_start_weekday);
  return {
    assignmentId: stringValue(row.assignment_id),
    period: chorePeriodRange(
      householdId,
      stringValue(row.local_period_start),
      timeZone,
      ownershipStartWeekday,
    ),
    chore: {
      id: stringValue(row.chore_id),
      name: stringValue(row.chore_name),
      instructions: stringValue(row.chore_instructions),
      ownershipStartWeekday,
    },
    member: memberFromRow(
      row.member_id,
      row.member_name,
      row.member_active,
      row.member_image_url,
    ),
    version: integerValue(row.version),
    source: sourceValue(row.source),
    reminder: reminderStatus({
      hasPhone: row.sms_has_phone,
      consent: row.sms_consent_status,
      suppression: row.sms_suppression_status,
      eveningStatus: row.evening_status,
      eveningCorrection: row.evening_correction_needed,
      morningStatus: row.morning_status,
      morningCorrection: row.morning_correction_needed,
      correctionNeeded: row.correction_needed,
    }),
  };
}

const assignmentSelect = `
  SELECT wa.id AS assignment_id, wa.local_period_start, wa.chore_id,
         c.name AS chore_name, c.instructions AS chore_instructions,
         c.ownership_start_weekday,
         wa.member_id, m.display_name AS member_name,
         m.active AS member_active,
         (SELECT u.image
          FROM allowlisted_identities AS ai
          INNER JOIN "user" AS u ON u.id = ai.auth_user_id
          WHERE ai.household_id = m.household_id
            AND ai.member_id = m.id
            AND ai.active = 1
          ORDER BY ai.id
          LIMIT 1) AS member_image_url,
         wa.version, wa.source,
         (m.sms_phone_e164 IS NOT NULL) AS sms_has_phone,
         m.sms_consent_status, m.sms_suppression_status,
         evening.status AS evening_status,
         evening.correction_needed AS evening_correction_needed,
         morning.status AS morning_status,
         morning.correction_needed AS morning_correction_needed,
         EXISTS (
           SELECT 1 FROM reminder_outbox AS correction
           WHERE correction.assignment_id = wa.id
             AND correction.correction_needed = 1
         ) AS correction_needed
  FROM weekly_assignments AS wa
  INNER JOIN chores AS c ON c.id = wa.chore_id AND c.household_id = wa.household_id
  INNER JOIN members AS m ON m.id = wa.member_id AND m.household_id = wa.household_id
  LEFT JOIN reminder_outbox AS evening
    ON evening.assignment_id = wa.id AND evening.assignment_version = wa.version
   AND evening.recipient_member_id = wa.member_id AND evening.occurrence_phase = 'evening'
  LEFT JOIN reminder_outbox AS morning
    ON morning.assignment_id = wa.id AND morning.assignment_version = wa.version
   AND morning.recipient_member_id = wa.member_id AND morning.occurrence_phase = 'morning'`;

async function assignmentPage(
  context: ReadModelContext,
  input: {
    householdId: string;
    timeZone: string;
    fromDate: string;
    toDate: string;
    memberIds?: readonly string[];
    choreIds?: readonly string[];
    limit: number;
    offset: number;
  },
): Promise<{ items: ProjectedAssignment[]; page: Page }> {
  if (input.memberIds?.length === 0 || input.choreIds?.length === 0) {
    return {
      items: [],
      page: { limit: input.limit, offset: input.offset, nextOffset: null },
    };
  }
  const clauses = [
    "wa.household_id = ?",
    "wa.local_period_start >= ?",
    "wa.local_period_start <= ?",
  ];
  const values: unknown[] = [input.householdId, input.fromDate, input.toDate];
  if (input.memberIds !== undefined) {
    clauses.push(
      `wa.member_id IN (${input.memberIds.map(() => "?").join(",")})`,
    );
    values.push(...input.memberIds);
  }
  if (input.choreIds !== undefined) {
    clauses.push(`wa.chore_id IN (${input.choreIds.map(() => "?").join(",")})`);
    values.push(...input.choreIds);
  }
  values.push(input.limit + 1, input.offset);
  try {
    const result = await context.database
      .prepare(
        `${assignmentSelect}
         WHERE ${clauses.join(" AND ")}
         ORDER BY wa.local_period_start, c.name, wa.chore_id, wa.id
         LIMIT ? OFFSET ?`,
      )
      .bind(...values)
      .all<AssignmentRow>();
    const hasMore = result.results.length > input.limit;
    const items = result.results
      .slice(0, input.limit)
      .map((row) => assignmentFromRow(row, input.householdId, input.timeZone));
    return {
      items,
      page: {
        limit: input.limit,
        offset: input.offset,
        nextOffset: hasMore ? input.offset + input.limit : null,
      },
    };
  } catch (error) {
    if (error instanceof ReadModelError) throw error;
    unavailable();
  }
}

export async function getCurrentAndNext(
  context: ReadModelContext,
  input: { request: Request; now?: Date },
): Promise<{
  state: "ready" | "empty" | "unavailable";
  handoffs: Array<{
    chore: ProjectedChore;
    currentPeriod: PeriodRange;
    nextPeriod: PeriodRange;
    current: ProjectedAssignment | null;
    next: ProjectedAssignment | null;
  }>;
}> {
  const { household } = await authorize(context, input.request);
  try {
    const choreResult = await context.database
      .prepare(
        `SELECT c.id AS chore_id, c.name AS chore_name,
                c.instructions AS chore_instructions, c.ownership_start_weekday
         FROM chores AS c
         WHERE c.household_id = ? AND c.active = 1
         ORDER BY c.name, c.id
         LIMIT ?`,
      )
      .bind(household.id, MAX_PAGE_SIZE + 1)
      .all<ChoreRow>();
    if (choreResult.results.length > MAX_PAGE_SIZE) unavailable();
    if (choreResult.results.length === 0) {
      return { state: "empty", handoffs: [] };
    }
    const now = input.now ?? new Date();
    const chores = choreResult.results.map((row) => {
      const startsOn = weekdayValue(row.ownership_start_weekday);
      const chore: ProjectedChore = {
        id: stringValue(row.chore_id),
        name: stringValue(row.chore_name),
        instructions: stringValue(row.chore_instructions),
        ownershipStartWeekday: startsOn,
      };
      const current = chorePeriodAt(now, {
        timeZone: household.timeZone,
        startsOn,
      });
      return { chore, currentStart: current.localStartDate };
    });
    const starts = chores.flatMap(({ currentStart }) => [
      currentStart,
      addLocalDays(currentStart, 7),
    ]);
    const assignmentResult = await assignmentPage(context, {
      householdId: household.id,
      timeZone: household.timeZone,
      fromDate: starts.reduce((left, right) => (left < right ? left : right)),
      toDate: starts.reduce((left, right) => (left > right ? left : right)),
      choreIds: chores.map(({ chore }) => chore.id),
      limit: MAX_CALENDAR_ASSIGNMENTS,
      offset: 0,
    });
    if (assignmentResult.page.nextOffset !== null) unavailable();
    const assignments = new Map(
      assignmentResult.items.map((assignment) => [
        `${assignment.chore.id}\u0000${assignment.period.localStartDate}`,
        assignment,
      ]),
    );
    const handoffs = chores.map(({ chore, currentStart }) => {
      const nextStart = addLocalDays(currentStart, 7);
      return {
        chore,
        currentPeriod: periodRange(household.id, currentStart),
        nextPeriod: periodRange(household.id, nextStart),
        current: assignments.get(`${chore.id}\u0000${currentStart}`) ?? null,
        next: assignments.get(`${chore.id}\u0000${nextStart}`) ?? null,
      };
    });
    const assignmentCount = handoffs.reduce(
      (count, { current, next }) =>
        count + Number(current !== null) + Number(next !== null),
      0,
    );
    const state =
      assignmentCount === 0
        ? "empty"
        : assignmentCount < handoffs.length * 2
          ? "unavailable"
          : "ready";
    return { state, handoffs };
  } catch (error) {
    if (error instanceof ReadModelError) throw error;
    unavailable();
  }
}

export async function getPersonalAgenda(
  context: ReadModelContext,
  input: {
    request: Request;
    now?: Date;
    fromDate?: string;
    toDate?: string;
    limit?: number;
    offset?: number;
  },
): Promise<{
  state: ProjectionState;
  items: ProjectedAssignment[];
  page: Page;
}> {
  const { member, household } = await authorize(context, input.request);
  const page = pageInput(input.limit, input.offset);
  const localToday = localDateAt(input.now ?? new Date(), household.timeZone);
  const fromDate = localDateInput(input.fromDate) ?? addDays(localToday, -6);
  const toDate =
    localDateInput(input.toDate) ??
    addDays(localToday, DEFAULT_SCHEDULE_WEEKS * 7 - 1);
  if (fromDate > toDate) invalidInput();
  const result = await assignmentPage(context, {
    householdId: household.id,
    timeZone: household.timeZone,
    fromDate,
    toDate,
    memberIds: [member.id],
    ...page,
  });
  return {
    state: result.items.length === 0 ? "empty" : "ready",
    ...result,
  };
}

export async function getHouseholdList(
  context: ReadModelContext,
  input: {
    request: Request;
    now?: Date;
    fromDate?: string;
    toDate?: string;
    memberIds?: readonly string[];
    choreIds?: readonly string[];
    limit?: number;
    offset?: number;
  },
): Promise<{
  state: ProjectionState;
  items: ProjectedAssignment[];
  page: Page;
}> {
  const { household } = await authorize(context, input.request);
  const page = pageInput(input.limit, input.offset);
  const localToday = localDateAt(input.now ?? new Date(), household.timeZone);
  const fromDate = localDateInput(input.fromDate) ?? addDays(localToday, -6);
  const toDate =
    localDateInput(input.toDate) ??
    addDays(localToday, DEFAULT_SCHEDULE_WEEKS * 7 - 1);
  if (fromDate > toDate) invalidInput();
  const result = await assignmentPage(context, {
    householdId: household.id,
    timeZone: household.timeZone,
    fromDate,
    toDate,
    memberIds: idFilter(input.memberIds),
    choreIds: idFilter(input.choreIds),
    ...page,
  });
  return {
    state: result.items.length === 0 ? "empty" : "ready",
    ...result,
  };
}

export async function getHouseholdCalendar(
  context: ReadModelContext,
  input: {
    request: Request;
    now?: Date;
    fromDate?: string;
    toDate?: string;
    memberIds?: readonly string[];
    choreIds?: readonly string[];
  },
): Promise<{
  state: ProjectionState;
  periods: Array<{ period: PeriodRange; assignments: ProjectedAssignment[] }>;
}> {
  const { household } = await authorize(context, input.request);
  const localToday = localDateAt(input.now ?? new Date(), household.timeZone);
  const fromDate = localDateInput(input.fromDate) ?? addDays(localToday, -6);
  const toDate = localDateInput(input.toDate) ?? addDays(localToday, 27);
  if (fromDate > toDate) invalidInput();
  const dayCount =
    (new Date(`${toDate}T00:00:00Z`).valueOf() -
      new Date(`${fromDate}T00:00:00Z`).valueOf()) /
      86_400_000 +
    1;
  if (dayCount > MAX_CALENDAR_DAYS) invalidInput();
  const result = await assignmentPage(context, {
    householdId: household.id,
    timeZone: household.timeZone,
    fromDate,
    toDate,
    memberIds: idFilter(input.memberIds),
    choreIds: idFilter(input.choreIds),
    limit: MAX_CALENDAR_ASSIGNMENTS,
    offset: 0,
  });
  if (result.page.nextOffset !== null) unavailable();
  const byPeriod = new Map<string, ProjectedAssignment[]>();
  for (const item of result.items) {
    const key = `${item.period.localStartDate}\u0000${item.period.localEndDateInclusive}`;
    const assignments = byPeriod.get(key) ?? [];
    assignments.push(item);
    byPeriod.set(key, assignments);
  }
  const periods = [...byPeriod.values()].map((assignments) => ({
    period: assignments[0]!.period,
    assignments,
  }));
  return {
    state: result.items.length === 0 ? "empty" : "ready",
    periods,
  };
}

type OperationKind = "materialize" | "reassign" | "swap" | "correct";

interface HistoryRow {
  event_id: unknown;
  assignment_id: unknown;
  operation_id: unknown;
  request_id: unknown;
  operation_kind: unknown;
  occurred_at: unknown;
  local_period_start: unknown;
  chore_id: unknown;
  chore_name: unknown;
  ownership_start_weekday: unknown;
  actor_member_id: unknown;
  actor_name: unknown;
  actor_active: unknown;
  before_member_id: unknown;
  before_name: unknown;
  before_active: unknown;
  before_version: unknown;
  before_source: unknown;
  before_sms_has_phone: unknown;
  before_sms_consent_status: unknown;
  before_sms_suppression_status: unknown;
  before_evening_status: unknown;
  before_evening_correction_needed: unknown;
  before_morning_status: unknown;
  before_morning_correction_needed: unknown;
  after_member_id: unknown;
  after_name: unknown;
  after_active: unknown;
  after_version: unknown;
  after_source: unknown;
  after_sms_has_phone: unknown;
  after_sms_consent_status: unknown;
  after_sms_suppression_status: unknown;
  after_evening_status: unknown;
  after_evening_correction_needed: unknown;
  after_morning_status: unknown;
  after_morning_correction_needed: unknown;
}

interface HistoryMember {
  id: string;
  displayName: string | null;
  active: boolean | null;
}

interface HistorySnapshot {
  member: HistoryMember;
  version: number;
  source: string;
  reminder: ProjectedReminderStatus;
}

export interface HistoryOperation {
  operationId: string;
  requestId: string;
  kind: OperationKind;
  occurredAt: string;
  localOccurredAt: string;
  actorType: "member" | "system";
  actor: HistoryMember | null;
  changes: Array<{
    eventId: string;
    assignmentId: string;
    period: PeriodRange;
    chore: { id: string; name: string };
    before: HistorySnapshot | null;
    after: HistorySnapshot;
  }>;
}

function operationKind(value: unknown): OperationKind {
  if (
    value === "materialize" ||
    value === "reassign" ||
    value === "swap" ||
    value === "correct"
  )
    return value;
  unavailable();
}

function historyMember(
  id: unknown,
  name: unknown,
  active: unknown,
): HistoryMember {
  return {
    id: stringValue(id),
    displayName: nullableString(name),
    active: active === null ? null : activeValue(active),
  };
}

export async function getGroupedHistory(
  context: ReadModelContext,
  input: {
    request: Request;
    fromOccurredAt?: string;
    toOccurredAt?: string;
    actorMemberIds?: readonly string[];
    choreIds?: readonly string[];
    kinds?: readonly OperationKind[];
    limit?: number;
    offset?: number;
  },
): Promise<{
  state: ProjectionState;
  operations: HistoryOperation[];
  page: Page;
}> {
  const { household } = await authorize(context, input.request);
  const page = pageInput(input.limit, input.offset);
  const actorMemberIds = idFilter(input.actorMemberIds);
  const choreIds = idFilter(input.choreIds);
  const kinds =
    input.kinds === undefined ? undefined : [...new Set(input.kinds)];
  if (
    kinds?.some(
      (kind) => !["materialize", "reassign", "swap", "correct"].includes(kind),
    )
  )
    invalidInput();
  if (
    input.fromOccurredAt !== undefined &&
    Number.isNaN(new Date(input.fromOccurredAt).valueOf())
  )
    invalidInput();
  if (
    input.toOccurredAt !== undefined &&
    Number.isNaN(new Date(input.toOccurredAt).valueOf())
  )
    invalidInput();
  if (
    input.fromOccurredAt !== undefined &&
    input.toOccurredAt !== undefined &&
    input.fromOccurredAt > input.toOccurredAt
  )
    invalidInput();
  if (
    actorMemberIds?.length === 0 ||
    choreIds?.length === 0 ||
    kinds?.length === 0
  ) {
    return {
      state: "empty",
      operations: [],
      page: { ...page, nextOffset: null },
    };
  }

  const clauses = ["household_id = ?"];
  const values: unknown[] = [household.id];
  if (input.fromOccurredAt !== undefined) {
    clauses.push("occurred_at >= ?");
    values.push(input.fromOccurredAt);
  }
  if (input.toOccurredAt !== undefined) {
    clauses.push("occurred_at <= ?");
    values.push(input.toOccurredAt);
  }
  if (actorMemberIds !== undefined) {
    clauses.push(
      `actor_member_id IN (${actorMemberIds.map(() => "?").join(",")})`,
    );
    values.push(...actorMemberIds);
  }
  if (choreIds !== undefined) {
    clauses.push(`chore_id IN (${choreIds.map(() => "?").join(",")})`);
    values.push(...choreIds);
  }
  if (kinds !== undefined) {
    clauses.push(`operation_kind IN (${kinds.map(() => "?").join(",")})`);
    values.push(...kinds);
  }
  values.push(page.limit + 1, page.offset);

  try {
    const result = await context.database
      .prepare(
        `WITH matching_operations AS (
           SELECT operation_id, MAX(occurred_at) AS latest
           FROM assignment_audit_events
           WHERE ${clauses.join(" AND ")}
           GROUP BY operation_id
         ), selected_operations AS (
           SELECT operation_id, latest
           FROM matching_operations
           ORDER BY latest DESC, operation_id DESC
           LIMIT ? OFFSET ?
         )
         SELECT e.id AS event_id, e.assignment_id, e.operation_id, e.request_id,
                 e.operation_kind, e.occurred_at, e.local_period_start, e.chore_id,
                 c.name AS chore_name, c.ownership_start_weekday,
                 e.actor_member_id, actor.display_name AS actor_name,
                 actor.active AS actor_active, e.before_member_id,
                 before_member.display_name AS before_name, before_member.active AS before_active,
                 e.before_version, e.before_source, e.after_member_id,
                 after_member.display_name AS after_name, after_member.active AS after_active,
                 e.after_version, e.after_source,
                 (before_member.sms_phone_e164 IS NOT NULL) AS before_sms_has_phone,
                 before_member.sms_consent_status AS before_sms_consent_status,
                 before_member.sms_suppression_status AS before_sms_suppression_status,
                 (SELECT status FROM reminder_outbox
                   WHERE assignment_id=e.assignment_id AND assignment_version=e.before_version
                     AND recipient_member_id=e.before_member_id AND occurrence_phase='evening')
                   AS before_evening_status,
                 (SELECT correction_needed FROM reminder_outbox
                   WHERE assignment_id=e.assignment_id AND assignment_version=e.before_version
                     AND recipient_member_id=e.before_member_id AND occurrence_phase='evening')
                   AS before_evening_correction_needed,
                 (SELECT status FROM reminder_outbox
                   WHERE assignment_id=e.assignment_id AND assignment_version=e.before_version
                     AND recipient_member_id=e.before_member_id AND occurrence_phase='morning')
                   AS before_morning_status,
                 (SELECT correction_needed FROM reminder_outbox
                   WHERE assignment_id=e.assignment_id AND assignment_version=e.before_version
                     AND recipient_member_id=e.before_member_id AND occurrence_phase='morning')
                   AS before_morning_correction_needed,
                 (after_member.sms_phone_e164 IS NOT NULL) AS after_sms_has_phone,
                 after_member.sms_consent_status AS after_sms_consent_status,
                 after_member.sms_suppression_status AS after_sms_suppression_status,
                 (SELECT status FROM reminder_outbox
                   WHERE assignment_id=e.assignment_id AND assignment_version=e.after_version
                     AND recipient_member_id=e.after_member_id AND occurrence_phase='evening')
                   AS after_evening_status,
                 (SELECT correction_needed FROM reminder_outbox
                   WHERE assignment_id=e.assignment_id AND assignment_version=e.after_version
                     AND recipient_member_id=e.after_member_id AND occurrence_phase='evening')
                   AS after_evening_correction_needed,
                 (SELECT status FROM reminder_outbox
                   WHERE assignment_id=e.assignment_id AND assignment_version=e.after_version
                     AND recipient_member_id=e.after_member_id AND occurrence_phase='morning')
                   AS after_morning_status,
                 (SELECT correction_needed FROM reminder_outbox
                   WHERE assignment_id=e.assignment_id AND assignment_version=e.after_version
                     AND recipient_member_id=e.after_member_id AND occurrence_phase='morning')
                   AS after_morning_correction_needed
         FROM selected_operations AS selected
         INNER JOIN assignment_audit_events AS e ON e.operation_id = selected.operation_id
         INNER JOIN chores AS c ON c.id = e.chore_id AND c.household_id = e.household_id
         LEFT JOIN members AS actor ON actor.id = e.actor_member_id AND actor.household_id = e.household_id
         LEFT JOIN members AS before_member ON before_member.id = e.before_member_id AND before_member.household_id = e.household_id
         LEFT JOIN members AS after_member ON after_member.id = e.after_member_id AND after_member.household_id = e.household_id
         WHERE e.household_id = ?
         ORDER BY selected.latest DESC, selected.operation_id DESC,
                   e.local_period_start, c.name, e.chore_id, e.id`,
      )
      .bind(...values, household.id)
      .all<HistoryRow>();

    const grouped = new Map<string, HistoryOperation>();
    for (const row of result.results) {
      const operationId = stringValue(row.operation_id);
      const occurredAt = stringValue(row.occurred_at);
      const actor =
        row.actor_member_id === null
          ? null
          : historyMember(
              row.actor_member_id,
              row.actor_name,
              row.actor_active,
            );
      let operation = grouped.get(operationId);
      if (operation === undefined) {
        operation = {
          operationId,
          requestId: stringValue(row.request_id),
          kind: operationKind(row.operation_kind),
          occurredAt,
          localOccurredAt: localDateTimeAt(occurredAt, household.timeZone),
          actorType: actor === null ? "system" : "member",
          actor,
          changes: [],
        };
        grouped.set(operationId, operation);
      } else if (
        operation.requestId !== row.request_id ||
        operation.kind !== row.operation_kind ||
        operation.occurredAt !== occurredAt
      ) {
        unavailable();
      }
      const before =
        row.before_member_id === null
          ? null
          : {
              member: historyMember(
                row.before_member_id,
                row.before_name,
                row.before_active,
              ),
              version: integerValue(row.before_version),
              source: stringValue(row.before_source),
              reminder: reminderStatus({
                hasPhone: row.before_sms_has_phone,
                consent: row.before_sms_consent_status,
                suppression: row.before_sms_suppression_status,
                eveningStatus: row.before_evening_status,
                eveningCorrection: row.before_evening_correction_needed,
                morningStatus: row.before_morning_status,
                morningCorrection: row.before_morning_correction_needed,
              }),
            };
      operation.changes.push({
        eventId: stringValue(row.event_id),
        assignmentId: stringValue(row.assignment_id),
        period: chorePeriodRange(
          household.id,
          stringValue(row.local_period_start),
          household.timeZone,
          weekdayValue(row.ownership_start_weekday),
        ),
        chore: {
          id: stringValue(row.chore_id),
          name: stringValue(row.chore_name),
        },
        before,
        after: {
          member: historyMember(
            row.after_member_id,
            row.after_name,
            row.after_active,
          ),
          version: integerValue(row.after_version),
          source: stringValue(row.after_source),
          reminder: reminderStatus({
            hasPhone: row.after_sms_has_phone,
            consent: row.after_sms_consent_status,
            suppression: row.after_sms_suppression_status,
            eveningStatus: row.after_evening_status,
            eveningCorrection: row.after_evening_correction_needed,
            morningStatus: row.after_morning_status,
            morningCorrection: row.after_morning_correction_needed,
          }),
        },
      });
    }
    const allOperations = [...grouped.values()];
    const hasMore = allOperations.length > page.limit;
    const operations = allOperations.slice(0, page.limit);
    return {
      state: operations.length === 0 ? "empty" : "ready",
      operations,
      page: {
        ...page,
        nextOffset: hasMore ? page.offset + page.limit : null,
      },
    };
  } catch (error) {
    if (error instanceof ReadModelError) throw error;
    unavailable();
  }
}
