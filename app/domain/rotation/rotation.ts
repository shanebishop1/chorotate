import type { ChoreId, LocalDate, MemberId } from "../contracts";
import {
  addLocalDays,
  periodsBetween,
  weekdayOfLocalDate,
  type Weekday,
} from "./period";

export interface RotationConfiguration {
  id: string;
  effectiveFrom: LocalDate;
  memberIds: readonly MemberId[];
  rotationOffset: number;
}

export interface ChoreRotation {
  choreId: ChoreId;
  anchorPeriodStart: LocalDate;
  ownershipStartWeekday: Weekday;
  configurations: readonly RotationConfiguration[];
}

export interface RotationPreviewPeriod {
  choreId: ChoreId;
  localPeriodStart: LocalDate;
  localInclusiveEndDate: LocalDate;
  periodIndex: number;
  configurationId: string;
  memberId: MemberId;
}

export function assigneeFor(
  memberIds: readonly MemberId[],
  periodIndex: number,
  rotationOffset: number,
): MemberId {
  if (memberIds.length === 0) {
    throw new RangeError("Rotation requires a member");
  }
  if (!Number.isInteger(periodIndex) || !Number.isInteger(rotationOffset)) {
    throw new RangeError("Period index and rotation offset must be integers");
  }
  const index =
    (((periodIndex + rotationOffset) % memberIds.length) + memberIds.length) %
    memberIds.length;
  return memberIds[index]!;
}

export function validateRotationConfiguration(
  configuration: RotationConfiguration,
  context: { anchorPeriod: LocalDate; ownershipStartWeekday: Weekday },
): void {
  if (!configuration.id.trim()) {
    throw new RangeError("Configuration id is required");
  }
  if (configuration.memberIds.length === 0) {
    throw new RangeError("Rotation configuration requires active members");
  }
  if (
    new Set(configuration.memberIds).size !== configuration.memberIds.length
  ) {
    throw new RangeError("Rotation member ids must be unique");
  }
  if (!Number.isInteger(configuration.rotationOffset)) {
    throw new RangeError("Rotation offset must be an integer");
  }
  if (
    weekdayOfLocalDate(configuration.effectiveFrom) !==
    context.ownershipStartWeekday
  ) {
    throw new RangeError("Configuration must begin on a chore period boundary");
  }
  periodsBetween(context.anchorPeriod, configuration.effectiveFrom);
}

export function validateFutureConfiguration(
  configuration: RotationConfiguration,
  context: {
    currentPeriod: LocalDate;
    anchorPeriod: LocalDate;
    ownershipStartWeekday: Weekday;
  },
): void {
  validateRotationConfiguration(configuration, context);
  if (configuration.effectiveFrom <= context.currentPeriod) {
    throw new RangeError("Configuration must take effect in a future period");
  }
}

export function selectEffectiveConfiguration(
  configurations: readonly RotationConfiguration[],
  period: LocalDate,
): RotationConfiguration {
  const selected = configurations
    .filter(({ effectiveFrom }) => effectiveFrom <= period)
    .sort((left, right) =>
      right.effectiveFrom.localeCompare(left.effectiveFrom),
    )[0];
  if (!selected) {
    throw new RangeError(
      `No rotation configuration is effective for ${period}`,
    );
  }
  return selected;
}

function validateChoreRotation(rotation: ChoreRotation): void {
  if (!rotation.choreId.trim()) throw new RangeError("Chore id is required");
  if (
    weekdayOfLocalDate(rotation.anchorPeriodStart) !==
    rotation.ownershipStartWeekday
  ) {
    throw new RangeError("Rotation anchor must be a chore period boundary");
  }
  if (rotation.configurations.length === 0) {
    throw new RangeError("Chore rotation requires a configuration");
  }
  const effectiveDates = new Set<string>();
  for (const configuration of rotation.configurations) {
    validateRotationConfiguration(configuration, {
      anchorPeriod: rotation.anchorPeriodStart,
      ownershipStartWeekday: rotation.ownershipStartWeekday,
    });
    if (effectiveDates.has(configuration.effectiveFrom)) {
      throw new RangeError(
        `Duplicate effective configuration for ${configuration.effectiveFrom}`,
      );
    }
    effectiveDates.add(configuration.effectiveFrom);
  }
  selectEffectiveConfiguration(
    rotation.configurations,
    rotation.anchorPeriodStart,
  );
}

export function previewRotation(input: {
  rotation: ChoreRotation;
  fromPeriod: LocalDate;
  periodCount: number;
}): RotationPreviewPeriod[] {
  if (!Number.isInteger(input.periodCount) || input.periodCount < 0) {
    throw new RangeError("periodCount must be a non-negative integer");
  }
  validateChoreRotation(input.rotation);
  const firstIndex = periodsBetween(
    input.rotation.anchorPeriodStart,
    input.fromPeriod,
  );
  if (
    weekdayOfLocalDate(input.fromPeriod) !==
    input.rotation.ownershipStartWeekday
  ) {
    throw new RangeError("Preview must begin on a chore period boundary");
  }

  return Array.from({ length: input.periodCount }, (_, offset) => {
    const localPeriodStart = addLocalDays(input.fromPeriod, offset * 7);
    const periodIndex = firstIndex + offset;
    const configuration = selectEffectiveConfiguration(
      input.rotation.configurations,
      localPeriodStart,
    );
    return {
      choreId: input.rotation.choreId,
      localPeriodStart,
      localInclusiveEndDate: addLocalDays(localPeriodStart, 6),
      periodIndex,
      configurationId: configuration.id,
      memberId: assigneeFor(
        configuration.memberIds,
        periodIndex,
        configuration.rotationOffset,
      ),
    };
  });
}
