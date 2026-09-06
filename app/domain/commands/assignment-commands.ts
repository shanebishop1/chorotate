import type { AuthorizedMember } from "../../auth/access";
import { localPeriodFromStart } from "../rotation/period";
import {
  actorIsActive,
  createPrimarySession,
  loadAssignments,
  memberIsActive,
  membersAreActive,
  reassignAssignment,
  swapAssignments,
  type AssignmentState,
  type SessionCapableDatabase,
} from "./assignment-persistence";

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

export interface AssignmentCommandServiceOptions {
  /** Receives only a fixed message so database details cannot escape to logs. */
  reportError?: (message: string) => void;
}

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

        const changes = await reassignAssignment(session, {
          recipientMemberId: command.recipientMemberId,
          actorMemberId: context.actor.id,
          requestId: command.requestId,
          operationId: command.operationId,
          occurredAt: context.occurredAt,
          assignmentId: command.assignmentId,
          householdId: context.actor.householdId,
          expectedVersion: command.expectedVersion,
          localPeriodStart: assignment.localPeriodStart,
          ownershipStartWeekday: assignment.ownershipStartWeekday,
          timeZone: context.timeZone,
        });
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

        const changes = await swapAssignments(session, {
          actorMemberId: context.actor.id,
          householdId: context.actor.householdId,
          firstMemberId: ordered[0].memberId,
          secondMemberId: ordered[1].memberId,
          firstAssignmentId: command.first.assignmentId,
          firstExpectedVersion: command.first.expectedVersion,
          firstLocalPeriodStart: ordered[0].localPeriodStart,
          firstOwnershipStartWeekday: ordered[0].ownershipStartWeekday,
          secondAssignmentId: command.second.assignmentId,
          secondExpectedVersion: command.second.expectedVersion,
          secondLocalPeriodStart: ordered[1].localPeriodStart,
          secondOwnershipStartWeekday: ordered[1].ownershipStartWeekday,
          timeZone: context.timeZone,
          requestId: command.requestId,
          operationId: command.operationId,
          occurredAt: context.occurredAt,
        });
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
