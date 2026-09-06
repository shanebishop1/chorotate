import {
  addDays,
  authorize,
  DEFAULT_SCHEDULE_WEEKS,
  idFilter,
  invalidInput,
  localDateAt,
  localDateInput,
  MAX_CALENDAR_ASSIGNMENTS,
  MAX_CALENDAR_DAYS,
  MAX_PAGE_SIZE,
  pageInput,
  periodRange,
  ReadModelError,
  unavailable,
  type Page,
  type PeriodRange,
  type ProjectedAssignment,
  type ProjectedChore,
  type ProjectedMember,
  type ProjectionState,
  type ReadModelContext,
} from "./shared";
import {
  assignmentFromRow,
  choreFromRow,
  memberFromRow,
  type AssignmentRow,
  type ChoreRow,
  type MemberRow,
} from "./projections";
import { addLocalDays, chorePeriodAt } from "../rotation/period";

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
      .all<MemberRow>();
    return result.results.map((row) =>
      memberFromRow(row.id, row.display_name, row.active, row.image_url),
    );
  } catch (error) {
    if (error instanceof ReadModelError) throw error;
    unavailable();
  }
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
    if (error instanceof Error) throw error;
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
      const chore = choreFromRow(row);
      const startsOn = chore.ownershipStartWeekday;
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
    const currentCount = handoffs.reduce(
      (count, { current }) => count + Number(current !== null),
      0,
    );
    const state =
      currentCount > 0
        ? "ready"
        : assignmentCount === 0
          ? "empty"
          : "unavailable";
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
