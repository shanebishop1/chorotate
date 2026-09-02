import type { AuthorizedMember } from "../../auth/access";
import type { D1DatabaseLike } from "../storage/d1";
import { materializeRollingHorizon } from "./materialize";
import type { Weekday } from "./period";
import type { ChoreRotation, RotationConfiguration } from "./rotation";

export const MATERIALIZATION_HORIZON_PERIODS = 53;

interface HouseholdRow {
  id: unknown;
  time_zone: unknown;
}

interface ConfigChoreRow {
  config_id: unknown;
  effective_from: unknown;
  chore_id: unknown;
  rotation_offset: unknown;
  ownership_start_weekday: unknown;
}

interface ConfigMemberRow {
  config_id: unknown;
  member_id: unknown;
}

function text(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("Schedule unavailable");
  }
  return value;
}

function integer(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new Error("Schedule unavailable");
  }
  return value;
}

function weekday(value: unknown): Weekday {
  const parsed = integer(value);
  if (parsed < 0 || parsed > 6) throw new Error("Schedule unavailable");
  return parsed as Weekday;
}

/** Idempotently ensures each chore's bounded product horizon exists. */
export async function prepareCurrentSchedule(
  database: D1DatabaseLike,
  actor: AuthorizedMember,
  input: { now?: Date; horizonPeriods?: number } = {},
): Promise<void> {
  const householdResult = await database
    .prepare(
      `SELECT h.id, h.time_zone
       FROM households h INNER JOIN members m ON m.household_id = h.id
       WHERE h.id = ? AND m.id = ? AND m.active = 1 LIMIT 2`,
    )
    .bind(actor.householdId, actor.id)
    .all<HouseholdRow>();
  if (householdResult.results.length !== 1) {
    throw new Error("Schedule unavailable");
  }
  const household = householdResult.results[0]!;

  const [choreResult, memberResult] = await Promise.all([
    database
      .prepare(
        `SELECT rc.id AS config_id, rc.effective_from, rc.chore_id,
                rc.rotation_offset, c.ownership_start_weekday
         FROM rotation_configs rc INNER JOIN chores c
           ON c.household_id = rc.household_id AND c.id = rc.chore_id
         WHERE rc.household_id = ? AND c.active = 1
         ORDER BY rc.chore_id, rc.effective_from, rc.id`,
      )
      .bind(actor.householdId)
      .all<ConfigChoreRow>(),
    database
      .prepare(
        `SELECT rcm.rotation_config_id AS config_id, rcm.member_id
         FROM rotation_config_members rcm
         WHERE rcm.household_id = ?
         ORDER BY rcm.rotation_config_id, rcm.position`,
      )
      .bind(actor.householdId)
      .all<ConfigMemberRow>(),
  ]);
  if (choreResult.results.length === 0) return;

  const memberIdsByConfig = new Map<string, string[]>();
  for (const row of memberResult.results) {
    const id = text(row.config_id);
    memberIdsByConfig.set(id, [
      ...(memberIdsByConfig.get(id) ?? []),
      text(row.member_id),
    ]);
  }

  const rotationsByChore = new Map<string, ChoreRotation>();
  for (const row of choreResult.results) {
    const configId = text(row.config_id);
    const choreId = text(row.chore_id);
    const effectiveFrom = text(row.effective_from);
    const memberIds = memberIdsByConfig.get(configId) ?? [];
    if (memberIds.length === 0) throw new Error("Schedule unavailable");
    const configuration: RotationConfiguration = {
      id: configId,
      effectiveFrom,
      memberIds,
      rotationOffset: integer(row.rotation_offset),
    };
    const startsOn = weekday(row.ownership_start_weekday);
    const existing = rotationsByChore.get(choreId);
    if (existing && existing.ownershipStartWeekday !== startsOn) {
      throw new Error("Schedule unavailable");
    }
    rotationsByChore.set(choreId, {
      choreId,
      ownershipStartWeekday: startsOn,
      anchorPeriodStart:
        existing && existing.anchorPeriodStart < effectiveFrom
          ? existing.anchorPeriodStart
          : effectiveFrom,
      configurations: [...(existing?.configurations ?? []), configuration],
    });
  }

  const now = input.now ?? new Date();
  await materializeRollingHorizon(database, {
    householdId: actor.householdId,
    timeZone: text(household.time_zone),
    now,
    horizonPeriods: input.horizonPeriods ?? MATERIALIZATION_HORIZON_PERIODS,
    choreRotations: [...rotationsByChore.values()],
    occurredAt: now.toISOString(),
  });
}
