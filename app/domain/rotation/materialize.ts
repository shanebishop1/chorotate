import type { HouseholdId, IsoTimestamp, LocalDate } from "../contracts";
import type { D1DatabaseLike } from "../storage/d1";
import { chorePeriodAt } from "./period";
import { previewRotation, type ChoreRotation } from "./rotation";

const insertAssignmentSql = `INSERT INTO weekly_assignments (
  id, household_id, local_week_start, chore_id, member_id, version, source,
  actor_member_id, request_id, operation_id, operation_kind, occurred_at
) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)
ON CONFLICT (household_id, local_week_start, chore_id) DO NOTHING`;

export interface MaterializationInput {
  householdId: HouseholdId;
  timeZone: string;
  now: Date;
  horizonPeriods: number;
  choreRotations: readonly ChoreRotation[];
  occurredAt: IsoTimestamp;
}

export interface PlannedAssignment {
  id: string;
  localPeriodStart: LocalDate;
  localInclusiveEndDate: LocalDate;
  choreId: string;
  memberId: string;
}

function stableId(...parts: string[]): string {
  return parts.map((part) => encodeURIComponent(part)).join(":");
}

export async function materializeRollingHorizon(
  database: D1DatabaseLike,
  input: MaterializationInput,
): Promise<readonly PlannedAssignment[]> {
  if (!Number.isInteger(input.horizonPeriods) || input.horizonPeriods < 1) {
    throw new RangeError("horizonPeriods must be a positive integer");
  }
  if (Number.isNaN(input.now.getTime()))
    throw new RangeError("Invalid instant");
  if (
    new Set(input.choreRotations.map(({ choreId }) => choreId)).size !==
    input.choreRotations.length
  ) {
    throw new RangeError("Chore rotations must be unique");
  }

  const planned = input.choreRotations.flatMap((rotation) => {
    const currentPeriod = chorePeriodAt(input.now, {
      timeZone: input.timeZone,
      startsOn: rotation.ownershipStartWeekday,
    });
    return previewRotation({
      rotation,
      fromPeriod: currentPeriod.localStartDate,
      periodCount: input.horizonPeriods,
    }).map(
      ({ choreId, localPeriodStart, localInclusiveEndDate, memberId }) => ({
        id: stableId(
          "assignment",
          input.householdId,
          localPeriodStart,
          choreId,
        ),
        localPeriodStart,
        localInclusiveEndDate,
        choreId,
        memberId,
      }),
    );
  });

  await database.batch(
    planned.map((assignment) => {
      const operationId = stableId("materialize", assignment.id);
      return database
        .prepare(insertAssignmentSql)
        .bind(
          assignment.id,
          input.householdId,
          assignment.localPeriodStart,
          assignment.choreId,
          assignment.memberId,
          1,
          "rotation",
          operationId,
          operationId,
          "materialize",
          input.occurredAt,
        );
    }),
  );
  return planned;
}
