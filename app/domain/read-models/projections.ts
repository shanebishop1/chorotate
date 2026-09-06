import { trustedGoogleImage } from "../../auth/access";
import {
  activeValue,
  booleanInteger,
  chorePeriodRange,
  integerValue,
  sourceValue,
  stringValue,
  unavailable,
  weekdayValue,
  type ProjectedAssignment,
  type ProjectedChore,
  type ProjectedMember,
  type ProjectedReminderStatus,
  type ReminderContactStatus,
  type ReminderResult,
} from "./shared";

export interface MemberRow {
  id: unknown;
  display_name: unknown;
  active: unknown;
  image_url: unknown;
}

export interface AssignmentRow {
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

export interface ChoreRow {
  chore_id: unknown;
  chore_name: unknown;
  chore_instructions: unknown;
  ownership_start_weekday: unknown;
}

function reminderResult(value: unknown): ReminderResult {
  if (value === "pending" || value === "leased") return "pending";
  if (value === "accepted" || value === "delivery_unknown") return value;
  if (value === "failed") return "missed";
  unavailable();
}

export function reminderStatus(input: {
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

export function memberFromRow(
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

export function choreFromRow(row: ChoreRow): ProjectedChore {
  const ownershipStartWeekday = weekdayValue(row.ownership_start_weekday);
  return {
    id: stringValue(row.chore_id),
    name: stringValue(row.chore_name),
    instructions: stringValue(row.chore_instructions),
    ownershipStartWeekday,
  };
}

export function assignmentFromRow(
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
