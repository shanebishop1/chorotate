import type { AuthorizedMember } from "../auth/access";
import { AuthorizationError } from "../auth/access";
import { requireAuthorizedMember } from "../auth/better-auth";
import { createAssignmentCommandService } from "../domain/commands/assignment-commands";
import {
  MATERIALIZATION_HORIZON_PERIODS,
  prepareCurrentSchedule,
} from "../domain/rotation/prepare";
import type { D1DatabaseLike } from "../domain/storage/d1";
import type { RuntimeConfig } from "../runtime/environment";

export type HomeActionData =
  | { state: "success"; intent: "materialize" | "reassign" | "swap" }
  | {
      state: "conflict";
      current: Array<{
        assignmentId: string;
        memberId: string;
        version: number;
      }>;
    }
  | { state: "validation"; message: string }
  | { state: "denial"; message: string }
  | { state: "unavailable"; message: string };

export interface ActionServices {
  authorize(
    request: Request,
    database: D1Database,
    config: RuntimeConfig,
  ): Promise<AuthorizedMember>;
  now(): Date;
  prepare(
    database: D1DatabaseLike,
    member: AuthorizedMember,
    input: { now: Date; horizonPeriods: number },
  ): Promise<void>;
}

const actionServices: ActionServices = {
  authorize: requireAuthorizedMember,
  now: () => new Date(),
  prepare: prepareCurrentSchedule,
};

function denial(message = "This change is not allowed."): HomeActionData {
  return { state: "denial", message };
}

function validation(
  message = "Review the selected assignments and try again.",
): HomeActionData {
  return { state: "validation", message };
}

function exactUnsafeOrigin(request: Request, canonicalOrigin: string): boolean {
  return (
    request.method === "POST" &&
    request.headers.get("origin") === canonicalOrigin
  );
}

function one(form: FormData, key: string, max = 200): string | null {
  const values = form.getAll(key);
  if (values.length !== 1 || typeof values[0] !== "string") return null;
  const value = values[0];
  return value.length > 0 && value.length <= max && value.trim() === value
    ? value
    : null;
}

function version(form: FormData, key: string): number | null {
  const value = one(form, key, 9);
  if (value === null || !/^[1-9]\d{0,8}$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function exactKeys(form: FormData, expected: readonly string[]): boolean {
  const keys = [...form.keys()];
  return (
    keys.length === expected.length &&
    expected.every((key) => keys.includes(key))
  );
}

export async function runHomeAction(
  request: Request,
  database: D1Database,
  config: RuntimeConfig,
  dependencies: ActionServices = actionServices,
): Promise<HomeActionData> {
  if (!exactUnsafeOrigin(request, config.canonicalOrigin))
    return denial("Request origin denied.");
  const contentType = request.headers.get("content-type") ?? "";
  if (
    !contentType.startsWith("application/x-www-form-urlencoded") &&
    !contentType.startsWith("multipart/form-data")
  ) {
    return validation();
  }
  try {
    const actor = await dependencies.authorize(request, database, config);
    const now = dependencies.now();
    const form = await request.formData();
    const intent = one(form, "intent", 16);
    const requestId = one(form, "requestId");
    if (
      requestId === null ||
      !/^request:[A-Za-z0-9-]{1,128}$/.test(requestId)
    ) {
      return validation();
    }
    if (intent === "materialize") {
      if (!exactKeys(form, ["intent", "requestId"])) return validation();
      await dependencies.prepare(database, actor, {
        now,
        horizonPeriods: MATERIALIZATION_HORIZON_PERIODS,
      });
      return { state: "success", intent };
    }
    const commandService = createAssignmentCommandService(database);
    const commandContext = {
      actor,
      timeZone: config.household.timeZone,
      occurredAt: now.toISOString(),
    };
    const operationId = `operation:${requestId.slice("request:".length)}`;
    let result;
    if (intent === "reassign") {
      const keys = [
        "intent",
        "assignmentId",
        "recipientMemberId",
        "expectedVersion",
        "requestId",
      ];
      const assignmentId = one(form, "assignmentId");
      const recipientMemberId = one(form, "recipientMemberId");
      const expectedVersion = version(form, "expectedVersion");
      if (
        !exactKeys(form, keys) ||
        assignmentId === null ||
        recipientMemberId === null ||
        expectedVersion === null
      ) {
        return validation();
      }
      result = await commandService.reassign(
        {
          assignmentId,
          recipientMemberId,
          expectedVersion,
          requestId,
          operationId,
        },
        commandContext,
      );
    } else if (intent === "swap") {
      const keys = [
        "intent",
        "firstAssignmentId",
        "firstExpectedVersion",
        "secondAssignmentId",
        "secondExpectedVersion",
        "requestId",
      ];
      const firstAssignmentId = one(form, "firstAssignmentId");
      const firstExpectedVersion = version(form, "firstExpectedVersion");
      const secondAssignmentId = one(form, "secondAssignmentId");
      const secondExpectedVersion = version(form, "secondExpectedVersion");
      if (
        !exactKeys(form, keys) ||
        firstAssignmentId === null ||
        secondAssignmentId === null ||
        firstAssignmentId === secondAssignmentId ||
        firstExpectedVersion === null ||
        secondExpectedVersion === null
      ) {
        return validation();
      }
      result = await commandService.swap(
        {
          first: {
            assignmentId: firstAssignmentId,
            expectedVersion: firstExpectedVersion,
          },
          second: {
            assignmentId: secondAssignmentId,
            expectedVersion: secondExpectedVersion,
          },
          requestId,
          operationId,
        },
        commandContext,
      );
    } else {
      return validation();
    }
    if (result.status === "success") return { state: "success", intent };
    if (result.status === "conflict")
      return { state: "conflict", current: result.current };
    if (result.status === "unauthorized") return denial();
    if (result.status === "rejected") {
      const messages = {
        assignment_not_found: "That assignment is no longer available.",
        invalid_request: "Review the selected assignments and try again.",
        no_op: "Choose a different active household member or assignment.",
        past_assignment:
          "That assignment week has ended and cannot be changed.",
        recipient_ineligible: "Choose an active household member.",
      } as const;
      return result.reason === "assignment_not_found"
        ? denial(messages[result.reason])
        : validation(messages[result.reason]);
    }
    return {
      state: "unavailable",
      message: "The change could not be saved. Nothing moved.",
    };
  } catch (error) {
    if (
      error instanceof AuthorizationError &&
      (error.status === 401 || error.status === 403)
    )
      return denial();
    return {
      state: "unavailable",
      message: "The change could not be saved. Nothing moved.",
    };
  }
}
