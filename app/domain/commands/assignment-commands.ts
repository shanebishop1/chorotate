import type { AuthorizedMember } from "../../auth/access";
import type { LocalDate } from "../contracts";
import { localPeriodFromStart, type Weekday } from "../rotation/period";
import type { D1DatabaseLike, D1StatementLike } from "../storage/d1";

export interface AssignmentCommandContext {
  /** Supplied by the server-side authentication boundary, never client input. */
  actor: AuthorizedMember | null;
  /** Trusted household IANA timezone used for chore-specific boundaries. */
  timeZone: string;
  /** A server-generated ISO timestamp. */
  occurredAt: string;
}

export interface ReassignAssignmentCommand {
  assignmentId: string;
  recipientMemberId: string;
  expectedVersion: number;
  requestId: string;
  operationId: string;
}

export interface SwapAssignmentCommand {
  first: AssignmentVersion;
  second: AssignmentVersion;
  requestId: string;
  operationId: string;
}

export interface AssignmentVersion {
  assignmentId: string;
  expectedVersion: number;
}

export interface CurrentAssignment {
  assignmentId: string;
  memberId: string;
  version: number;
}

export type AssignmentCommandResult =
  | {
      status: "success";
      replayed: boolean;
      assignments: CurrentAssignment[];
    }
  | { status: "conflict"; current: CurrentAssignment[] }
  | { status: "unauthorized" }
  | {
      status: "rejected";
      reason:
        | "assignment_not_found"
        | "invalid_request"
        | "no_op"
        | "past_assignment"
        | "recipient_ineligible";
    }
  | { status: "error" };

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

interface AssignmentState extends CurrentAssignment {
  householdId: string;
  householdTimeZone: string;
  localPeriodStart: LocalDate;
  ownershipStartWeekday: Weekday;
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

interface SessionCapableDatabase extends D1DatabaseLike {
  withSession?: (constraint: "first-primary") => D1DatabaseLike;
}

export interface AssignmentCommandServiceOptions {
  /** Receives only a fixed message so database details cannot escape to logs. */
  reportError?: (message: string) => void;
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

export function createAssignmentCommandService(
  database: SessionCapableDatabase,
  options: AssignmentCommandServiceOptions = {},
) {
  const reportFailure = (): AssignmentCommandResult => {
    options.reportError?.("Assignment command failed");
    return { status: "error" };
  };

  return {
    async reassign(
      command: ReassignAssignmentCommand,
      context: AssignmentCommandContext,
    ): Promise<AssignmentCommandResult> {
      if (context.actor === null) return { status: "unauthorized" };
      if (!validContext(context) || !validReassignCommand(command)) {
        return { status: "rejected", reason: "invalid_request" };
      }

      const session = createPrimarySession(database);
      try {
        if (!(await actorIsActive(session, context.actor))) {
          return { status: "unauthorized" };
        }

        const current = await loadAssignments(session, [command.assignmentId]);
        if (current.length !== 1) {
          return { status: "rejected", reason: "assignment_not_found" };
        }
        const assignment = current[0];
        if (assignment.householdId !== context.actor.householdId) {
          return { status: "unauthorized" };
        }

        const replay = directReplay(command, context.actor.id, assignment);
        if (replay) return success([assignment], true);
        if (assignment.version !== command.expectedVersion) {
          return conflict([assignment]);
        }
        if (assignmentHasEnded(assignment, context)) {
          return { status: "rejected", reason: "past_assignment" };
        }
        if (assignment.memberId === command.recipientMemberId) {
          return { status: "rejected", reason: "no_op" };
        }
        if (
          !(await memberIsActive(
            session,
            context.actor.householdId,
            command.recipientMemberId,
          ))
        ) {
          return { status: "rejected", reason: "recipient_ineligible" };
        }

        const changes = await executeMutation(
          session,
          session
            .prepare(reassignSql)
            .bind(
              command.recipientMemberId,
              context.actor.id,
              command.requestId,
              command.operationId,
              context.occurredAt,
              command.assignmentId,
              context.actor.householdId,
              command.expectedVersion,
              assignment.localPeriodStart,
              assignment.ownershipStartWeekday,
              context.timeZone,
            ),
        );
        const after = await loadAssignments(session, [command.assignmentId]);
        if (after.length !== 1) {
          return { status: "rejected", reason: "assignment_not_found" };
        }
        if (changes === 1) return success(after, false);
        if (directReplay(command, context.actor.id, after[0])) {
          return success(after, true);
        }
        return conflict(after);
      } catch {
        return reportFailure();
      }
    },

    async swap(
      command: SwapAssignmentCommand,
      context: AssignmentCommandContext,
    ): Promise<AssignmentCommandResult> {
      if (context.actor === null) return { status: "unauthorized" };
      if (!validContext(context) || !validSwapCommand(command)) {
        return { status: "rejected", reason: "invalid_request" };
      }

      const session = createPrimarySession(database);
      try {
        if (!(await actorIsActive(session, context.actor))) {
          return { status: "unauthorized" };
        }

        const states = await loadAssignments(session, [
          command.first.assignmentId,
          command.second.assignmentId,
        ]);
        const ordered = orderSwapStates(command, states);
        if (ordered === null) {
          return { status: "rejected", reason: "assignment_not_found" };
        }
        if (
          ordered.some(
            (assignment) =>
              assignment.householdId !== context.actor?.householdId,
          )
        ) {
          return { status: "unauthorized" };
        }

        if (swapReplay(command, context.actor.id, ordered)) {
          return success(ordered, true);
        }
        if (
          ordered[0].version !== command.first.expectedVersion ||
          ordered[1].version !== command.second.expectedVersion
        ) {
          return conflict(ordered);
        }
        if (
          ordered.some((assignment) => assignmentHasEnded(assignment, context))
        ) {
          return { status: "rejected", reason: "past_assignment" };
        }
        if (ordered[0].memberId === ordered[1].memberId) {
          return { status: "rejected", reason: "no_op" };
        }
        if (
          !(await membersAreActive(
            session,
            context.actor.householdId,
            ordered.map(({ memberId }) => memberId),
          ))
        ) {
          return { status: "rejected", reason: "recipient_ineligible" };
        }

        const changes = await executeMutation(
          session,
          session
            .prepare(swapSql)
            .bind(
              context.actor.id,
              context.actor.householdId,
              ordered[0].memberId,
              ordered[1].memberId,
              command.first.assignmentId,
              command.first.expectedVersion,
              ordered[0].localPeriodStart,
              ordered[0].ownershipStartWeekday,
              command.second.assignmentId,
              command.second.expectedVersion,
              ordered[1].localPeriodStart,
              ordered[1].ownershipStartWeekday,
              context.timeZone,
              command.requestId,
              command.operationId,
              context.occurredAt,
            ),
        );
        const afterStates = await loadAssignments(session, [
          command.first.assignmentId,
          command.second.assignmentId,
        ]);
        const after = orderSwapStates(command, afterStates);
        if (after === null) {
          return { status: "rejected", reason: "assignment_not_found" };
        }
        if (changes === 2) return success(after, false);
        if (swapReplay(command, context.actor.id, after)) {
          return success(after, true);
        }
        return conflict(after);
      } catch {
        return reportFailure();
      }
    },
  };
}

function createPrimarySession(
  database: SessionCapableDatabase,
): D1DatabaseLike {
  return database.withSession?.("first-primary") ?? database;
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

async function actorIsActive(
  database: D1DatabaseLike,
  actor: AuthorizedMember,
): Promise<boolean> {
  return memberIsActive(database, actor.householdId, actor.id);
}

async function memberIsActive(
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

async function membersAreActive(
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

async function loadAssignments(
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

function orderSwapStates(
  command: SwapAssignmentCommand,
  states: AssignmentState[],
): [AssignmentState, AssignmentState] | null {
  const first = states.find(
    ({ assignmentId }) => assignmentId === command.first.assignmentId,
  );
  const second = states.find(
    ({ assignmentId }) => assignmentId === command.second.assignmentId,
  );
  return first === undefined || second === undefined ? null : [first, second];
}

function directReplay(
  command: ReassignAssignmentCommand,
  actorMemberId: string,
  state: AssignmentState,
): boolean {
  return (
    state.version === command.expectedVersion + 1 &&
    state.memberId === command.recipientMemberId &&
    state.source === "reassignment" &&
    state.actorMemberId === actorMemberId &&
    state.requestId === command.requestId &&
    state.operationId === command.operationId &&
    state.operationKind === "reassign"
  );
}

function swapReplay(
  command: SwapAssignmentCommand,
  actorMemberId: string,
  states: [AssignmentState, AssignmentState],
): boolean {
  const sharedContext = states.every(
    (state) =>
      state.source === "swap" &&
      state.actorMemberId === actorMemberId &&
      state.requestId === command.requestId &&
      state.operationId === command.operationId &&
      state.operationKind === "swap",
  );
  return (
    sharedContext &&
    states[0].version === command.first.expectedVersion + 1 &&
    states[1].version === command.second.expectedVersion + 1
  );
}

function success(
  states: readonly AssignmentState[],
  replayed: boolean,
): AssignmentCommandResult {
  return {
    status: "success",
    replayed,
    assignments: states.map(toCurrentAssignment),
  };
}

function conflict(states: readonly AssignmentState[]): AssignmentCommandResult {
  return { status: "conflict", current: states.map(toCurrentAssignment) };
}

function toCurrentAssignment(state: AssignmentState): CurrentAssignment {
  return {
    assignmentId: state.assignmentId,
    memberId: state.memberId,
    version: state.version,
  };
}

function validReassignCommand(command: ReassignAssignmentCommand): boolean {
  return (
    isIdentifier(command.assignmentId) &&
    isIdentifier(command.recipientMemberId) &&
    isPositiveVersion(command.expectedVersion) &&
    isRequestIdentifier(command.requestId) &&
    isRequestIdentifier(command.operationId)
  );
}

function validSwapCommand(command: SwapAssignmentCommand): boolean {
  return (
    isIdentifier(command.first.assignmentId) &&
    isIdentifier(command.second.assignmentId) &&
    command.first.assignmentId !== command.second.assignmentId &&
    isPositiveVersion(command.first.expectedVersion) &&
    isPositiveVersion(command.second.expectedVersion) &&
    isRequestIdentifier(command.requestId) &&
    isRequestIdentifier(command.operationId)
  );
}

function validContext(context: AssignmentCommandContext): boolean {
  return (
    context.actor !== null &&
    validTimeZone(context.timeZone) &&
    isIsoTimestamp(context.occurredAt) &&
    isIdentifier(context.actor.id) &&
    isIdentifier(context.actor.householdId)
  );
}

function isIdentifier(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 200 &&
    value.trim() === value
  );
}

function isRequestIdentifier(value: unknown): value is string {
  return isIdentifier(value);
}

function isPositiveVersion(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1;
}

function isLocalDate(value: unknown): value is string {
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

function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 64) return false;
  const instant = new Date(value);
  return !Number.isNaN(instant.valueOf()) && instant.toISOString() === value;
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

function assignmentHasEnded(
  assignment: AssignmentState,
  context: AssignmentCommandContext,
): boolean {
  if (assignment.householdTimeZone !== context.timeZone) {
    throw new Error("Assignment command failed");
  }
  const period = localPeriodFromStart(assignment.localPeriodStart, {
    timeZone: context.timeZone,
    startsOn: assignment.ownershipStartWeekday,
  });
  return period.endsAt.getTime() <= new Date(context.occurredAt).getTime();
}
