import type { AuthorizedMember } from "../../auth/access";
import type { LocalDate } from "../contracts";
import type { Weekday } from "../rotation/period";
import type { D1DatabaseLike, D1StatementLike } from "../storage/d1";

interface AssignmentRow {
  assignment_id: unknown;
  household_id: unknown;
  household_time_zone: unknown;
  local_period_start: unknown;
  ownership_start_weekday: unknown;
  member_id: unknown;
  version: unknown;
  source: unknown;
  actor_member_id: unknown;
  request_id: unknown;
  operation_id: unknown;
  operation_kind: unknown;
}

export interface AssignmentState {
  assignmentId: string;
  householdId: string;
  householdTimeZone: string;
  localPeriodStart: LocalDate;
  ownershipStartWeekday: Weekday;
  memberId: string;
  version: number;
  source: string;
  actorMemberId: string | null;
  requestId: string;
  operationId: string;
  operationKind: string;
}

interface D1MutationResult {
  success?: unknown;
  meta?: { changes?: unknown };
}

export interface SessionCapableDatabase extends D1DatabaseLike {
  withSession?: (constraint: "first-primary") => D1DatabaseLike;
}

export interface ReassignAssignmentMutation {
  recipientMemberId: string;
  actorMemberId: string;
  requestId: string;
  operationId: string;
  occurredAt: string;
  assignmentId: string;
  householdId: string;
  expectedVersion: number;
  localPeriodStart: LocalDate;
  ownershipStartWeekday: Weekday;
  timeZone: string;
}

export interface SwapAssignmentsMutation {
  actorMemberId: string;
  householdId: string;
  firstMemberId: string;
  secondMemberId: string;
  firstAssignmentId: string;
  firstExpectedVersion: number;
  firstLocalPeriodStart: LocalDate;
  firstOwnershipStartWeekday: Weekday;
  secondAssignmentId: string;
  secondExpectedVersion: number;
  secondLocalPeriodStart: LocalDate;
  secondOwnershipStartWeekday: Weekday;
  timeZone: string;
  requestId: string;
  operationId: string;
  occurredAt: string;
}

const assignmentColumns = `
  assignment.id AS assignment_id,
  assignment.household_id,
  household.time_zone AS household_time_zone,
  assignment.local_period_start,
  chore.ownership_start_weekday,
  assignment.member_id,
  assignment.version,
  assignment.source,
  assignment.actor_member_id,
  assignment.request_id,
  assignment.operation_id,
  assignment.operation_kind`;

const reassignSql = `
  UPDATE weekly_assignments
  SET member_id = ?1,
      version = version + 1,
      source = 'reassignment',
      actor_member_id = ?2,
      request_id = ?3,
      operation_id = ?4,
      operation_kind = 'reassign',
      occurred_at = ?5
  WHERE id = ?6
    AND household_id = ?7
    AND version = ?8
    AND member_id <> ?1
    AND local_period_start = ?9
    AND EXISTS (
      SELECT 1 FROM chores AS chore
      WHERE chore.id = weekly_assignments.chore_id
        AND chore.household_id = ?7
        AND chore.ownership_start_weekday = ?10
    )
    AND EXISTS (
      SELECT 1 FROM members AS actor
      WHERE actor.id = ?2 AND actor.household_id = ?7 AND actor.active = 1
    )
    AND EXISTS (
      SELECT 1 FROM households AS household
      WHERE household.id = ?7 AND household.time_zone = ?11
    )
    AND EXISTS (
      SELECT 1 FROM members AS recipient
      WHERE recipient.id = ?1 AND recipient.household_id = ?7 AND recipient.active = 1
    )`;

// A single UPDATE statement changes both rows. Its materialized eligibility CTE
// captures both expected versions and active recipients before either row changes;
// SQLite and D1 roll back the statement (including trigger audits) on any failure.
const swapSql = `
  WITH eligible AS MATERIALIZED (
    SELECT 1
    WHERE EXISTS (
      SELECT 1 FROM households
      WHERE id = ?2 AND time_zone = ?13
    )
      AND EXISTS (
      SELECT 1 FROM members
      WHERE id = ?1 AND household_id = ?2 AND active = 1
    )
      AND EXISTS (
        SELECT 1 FROM members
        WHERE id = ?3 AND household_id = ?2 AND active = 1
      )
      AND EXISTS (
        SELECT 1 FROM members
        WHERE id = ?4 AND household_id = ?2 AND active = 1
      )
      AND EXISTS (
        SELECT 1 FROM weekly_assignments AS assignment
        INNER JOIN chores AS chore
          ON chore.id = assignment.chore_id
         AND chore.household_id = assignment.household_id
        WHERE assignment.id = ?5 AND assignment.household_id = ?2
          AND assignment.version = ?6 AND assignment.member_id = ?3
          AND assignment.local_period_start = ?7
          AND chore.ownership_start_weekday = ?8
      )
      AND EXISTS (
        SELECT 1 FROM weekly_assignments AS assignment
        INNER JOIN chores AS chore
          ON chore.id = assignment.chore_id
         AND chore.household_id = assignment.household_id
        WHERE assignment.id = ?9 AND assignment.household_id = ?2
          AND assignment.version = ?10 AND assignment.member_id = ?4
          AND assignment.local_period_start = ?11
          AND chore.ownership_start_weekday = ?12
      )
  )
  UPDATE weekly_assignments
  SET member_id = CASE id WHEN ?5 THEN ?4 WHEN ?9 THEN ?3 END,
      version = version + 1,
      source = 'swap',
      actor_member_id = ?1,
      request_id = ?14,
      operation_id = ?15,
      operation_kind = 'swap',
      occurred_at = ?16
  WHERE EXISTS (SELECT 1 FROM eligible)
    AND ((id = ?5 AND version = ?6) OR (id = ?9 AND version = ?10))`;

export function createPrimarySession(
  database: SessionCapableDatabase,
): D1DatabaseLike {
  return database.withSession?.("first-primary") ?? database;
}

export async function actorIsActive(
  database: D1DatabaseLike,
  actor: AuthorizedMember,
): Promise<boolean> {
  return memberIsActive(database, actor.householdId, actor.id);
}

export async function memberIsActive(
  database: D1DatabaseLike,
  householdId: string,
  memberId: string,
): Promise<boolean> {
  const result = await database
    .prepare(
      `SELECT id FROM members
       WHERE id = ?1 AND household_id = ?2 AND active = 1
       LIMIT 1`,
    )
    .bind(memberId, householdId)
    .all<{ id: unknown }>();
  return result.results.length === 1;
}

export async function membersAreActive(
  database: D1DatabaseLike,
  householdId: string,
  memberIds: readonly string[],
): Promise<boolean> {
  if (memberIds.length !== 2) return false;
  const result = await database
    .prepare(
      `SELECT id FROM members
       WHERE household_id = ?1 AND active = 1 AND id IN (?2, ?3)`,
    )
    .bind(householdId, memberIds[0], memberIds[1])
    .all<{ id: unknown }>();
  return result.results.length === 2;
}

export async function loadAssignments(
  database: D1DatabaseLike,
  assignmentIds: readonly string[],
): Promise<AssignmentState[]> {
  if (assignmentIds.length < 1 || assignmentIds.length > 2) {
    throw new Error("Assignment command failed");
  }
  const placeholders = assignmentIds.length === 1 ? "?1" : "?1, ?2";
  const result = await database
    .prepare(
      `SELECT ${assignmentColumns}
       FROM weekly_assignments AS assignment
       INNER JOIN chores AS chore
         ON chore.id = assignment.chore_id
        AND chore.household_id = assignment.household_id
       INNER JOIN households AS household
         ON household.id = assignment.household_id
       WHERE assignment.id IN (${placeholders})`,
    )
    .bind(...assignmentIds)
    .all<AssignmentRow>();
  if (result.results.length > assignmentIds.length) {
    throw new Error("Assignment command failed");
  }
  return result.results.map(parseAssignment);
}

export async function reassignAssignment(
  database: D1DatabaseLike,
  mutation: ReassignAssignmentMutation,
): Promise<number> {
  return executeMutation(
    database,
    database
      .prepare(reassignSql)
      .bind(
        mutation.recipientMemberId,
        mutation.actorMemberId,
        mutation.requestId,
        mutation.operationId,
        mutation.occurredAt,
        mutation.assignmentId,
        mutation.householdId,
        mutation.expectedVersion,
        mutation.localPeriodStart,
        mutation.ownershipStartWeekday,
        mutation.timeZone,
      ),
  );
}

export async function swapAssignments(
  database: D1DatabaseLike,
  mutation: SwapAssignmentsMutation,
): Promise<number> {
  return executeMutation(
    database,
    database
      .prepare(swapSql)
      .bind(
        mutation.actorMemberId,
        mutation.householdId,
        mutation.firstMemberId,
        mutation.secondMemberId,
        mutation.firstAssignmentId,
        mutation.firstExpectedVersion,
        mutation.firstLocalPeriodStart,
        mutation.firstOwnershipStartWeekday,
        mutation.secondAssignmentId,
        mutation.secondExpectedVersion,
        mutation.secondLocalPeriodStart,
        mutation.secondOwnershipStartWeekday,
        mutation.timeZone,
        mutation.requestId,
        mutation.operationId,
        mutation.occurredAt,
      ),
  );
}

async function executeMutation(
  database: D1DatabaseLike,
  statement: D1StatementLike,
): Promise<number> {
  const results = (await database.batch([statement])) as D1MutationResult[];
  const changes = results[0]?.meta?.changes;
  if (results.length !== 1 || changes === undefined) {
    throw new Error("Assignment command failed");
  }
  if (typeof changes !== "number" || !Number.isSafeInteger(changes)) {
    throw new Error("Assignment command failed");
  }
  return changes;
}

function parseAssignment(row: AssignmentRow): AssignmentState {
  if (
    !isIdentifier(row.assignment_id) ||
    !isIdentifier(row.household_id) ||
    !validTimeZone(row.household_time_zone) ||
    !isLocalDate(row.local_period_start) ||
    !isWeekday(row.ownership_start_weekday) ||
    !isIdentifier(row.member_id) ||
    !isPositiveVersion(row.version) ||
    typeof row.source !== "string" ||
    (row.actor_member_id !== null && !isIdentifier(row.actor_member_id)) ||
    !isIdentifier(row.request_id) ||
    !isIdentifier(row.operation_id) ||
    typeof row.operation_kind !== "string"
  ) {
    throw new Error("Assignment command failed");
  }
  return {
    assignmentId: row.assignment_id,
    householdId: row.household_id,
    householdTimeZone: row.household_time_zone,
    localPeriodStart: row.local_period_start,
    ownershipStartWeekday: row.ownership_start_weekday,
    memberId: row.member_id,
    version: row.version,
    source: row.source,
    actorMemberId: row.actor_member_id,
    requestId: row.request_id,
    operationId: row.operation_id,
    operationKind: row.operation_kind,
  };
}

function isIdentifier(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 200 &&
    value.trim() === value
  );
}

function isPositiveVersion(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1;
}

function isLocalDate(value: unknown): value is LocalDate {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isWeekday(value: unknown): value is Weekday {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= 6
  );
}

function validTimeZone(value: unknown): value is string {
  if (!isIdentifier(value)) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}
