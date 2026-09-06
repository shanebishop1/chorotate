import type { D1DatabaseLike } from "../storage/d1";
import { localDateAt, zonedParts } from "./local-time";
import {
  contactEligibilityFailure,
  type ContactFailureCategory,
} from "./contact-eligibility";

const PLANNING_HORIZON_DAYS = 14;

type DecimalDigit = "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9";
type ReminderHour =
  | `0${DecimalDigit}`
  | `1${DecimalDigit}`
  | `2${"0" | "1" | "2" | "3"}`;
type ReminderMinute = `${"0" | "1" | "2" | "3" | "4" | "5"}${DecimalDigit}`;
export type ReminderLocalTime = `${ReminderHour}:${ReminderMinute}`;
export type OccurrencePhase = "evening" | "morning";

interface PlannedAssignmentRow {
  id: string;
  household_id: string;
  assignment_version: number;
  member_id: string;
  local_period_start: string;
  chore_id: string;
  time_zone: string;
  reminder_morning_local_time: ReminderLocalTime;
  local_today: string;
  sms_phone_e164: string | null;
  sms_consent_status: string;
  sms_suppression_status: string;
}

export interface ReminderPlanningInput {
  now: Date;
}

export interface ReminderPlanningResult {
  assignmentsConsidered: number;
}

interface LocalDateParts {
  year: number;
  month: number;
  day: number;
}

function parseLocalDate(localDate: string): LocalDateParts {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(localDate);
  if (!match) throw new RangeError("Invalid local date");
  const parts = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
  if (formatUtcDate(parts) !== localDate) {
    throw new RangeError("Invalid local date");
  }
  return parts;
}

function formatUtcDate(parts: LocalDateParts): string {
  const date = new Date(0);
  date.setUTCFullYear(parts.year, parts.month - 1, parts.day);
  date.setUTCHours(0, 0, 0, 0);
  return `${String(date.getUTCFullYear()).padStart(4, "0")}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function addLocalDays(localDate: string, days: number): string {
  const { year, month, day } = parseLocalDate(localDate);
  const shifted = new Date(0);
  shifted.setUTCFullYear(year, month - 1, day + days);
  shifted.setUTCHours(0, 0, 0, 0);
  return formatUtcDate({
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  });
}

export function parseReminderLocalTime(value: string): ReminderLocalTime {
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) {
    throw new RangeError("Reminder local time must use HH:mm");
  }
  return value as ReminderLocalTime;
}

function parseLocalTime(localTime: ReminderLocalTime): {
  hour: number;
  minute: number;
} {
  const [hour, minute] = localTime.split(":").map(Number);
  return { hour: hour!, minute: minute! };
}

function sameLocalMinute(
  instant: Date,
  desired: LocalDateParts & { hour: number; minute: number },
  timeZone: string,
): boolean {
  const actual = zonedParts(instant, timeZone);
  return (
    actual.year === desired.year &&
    actual.month === desired.month &&
    actual.day === desired.day &&
    actual.hour === desired.hour &&
    actual.minute === desired.minute
  );
}

/** Resolve an occurrence's household-local civil clock to a UTC instant. */
export function occurrenceInstant(
  localPeriodStart: string,
  phase: OccurrencePhase,
  localSendTime: ReminderLocalTime,
  timeZone: string,
): string {
  // Constructing the formatter validates the IANA zone before doing any work.
  zonedParts(new Date(0), timeZone);
  const occurrenceDate = addLocalDays(
    localPeriodStart,
    phase === "evening" ? -1 : 0,
  );
  const desired = {
    ...parseLocalDate(occurrenceDate),
    ...parseLocalTime(localSendTime),
  };
  const nominal = Date.UTC(
    desired.year,
    desired.month - 1,
    desired.day,
    desired.hour,
    desired.minute,
  );

  // Earliest exact match handles repeated clocks deterministically.
  for (let delta = -18 * 60; delta <= 18 * 60; delta += 1) {
    const candidate = new Date(nominal + delta * 60_000);
    if (sameLocalMinute(candidate, desired, timeZone)) {
      return candidate.toISOString();
    }
  }
  // For a DST gap, use the first real local minute after the requested clock.
  for (let minuteAfter = 1; minuteAfter <= 180; minuteAfter += 1) {
    const shiftedDate = new Date(nominal + minuteAfter * 60_000);
    const shifted = {
      year: shiftedDate.getUTCFullYear(),
      month: shiftedDate.getUTCMonth() + 1,
      day: shiftedDate.getUTCDate(),
      hour: shiftedDate.getUTCHours(),
      minute: shiftedDate.getUTCMinutes(),
    };
    for (let delta = -18 * 60; delta <= 18 * 60; delta += 1) {
      const candidate = new Date(
        Date.UTC(
          shifted.year,
          shifted.month - 1,
          shifted.day,
          shifted.hour,
          shifted.minute,
        ) +
          delta * 60_000,
      );
      if (sameLocalMinute(candidate, shifted, timeZone)) {
        return candidate.toISOString();
      }
    }
  }
  throw new RangeError("Unable to resolve local reminder time");
}

function logicalOutboxId(
  assignmentId: string,
  version: number,
  phase: OccurrencePhase,
  recipientMemberId: string,
): string {
  return [
    "reminder",
    "sms",
    encodeURIComponent(assignmentId),
    `v${version}`,
    phase,
    encodeURIComponent(recipientMemberId),
  ].join(":");
}

async function insertOccurrence(
  database: D1DatabaseLike,
  assignment: PlannedAssignmentRow,
  phase: OccurrencePhase,
  availableAt: string,
  createdAt: string,
  failureCategory: ContactFailureCategory | "missed_occurrence" | null,
): Promise<void> {
  const status = failureCategory === null ? "pending" : "failed";
  await database
    .prepare(
      `INSERT INTO reminder_outbox
       (id,household_id,assignment_id,assignment_version,local_period_start,
        chore_id,recipient_member_id,occurrence_phase,status,available_at,
        sanitized_error_category,created_at,terminal_at)
       SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?
       FROM weekly_assignments AS current_assignment
       WHERE current_assignment.id = ?
         AND current_assignment.version = ?
         AND current_assignment.member_id = ?
       ON CONFLICT (
         household_id,assignment_id,assignment_version,local_period_start,
         chore_id,occurrence_phase,recipient_member_id
       ) DO NOTHING`,
    )
    .bind(
      logicalOutboxId(
        assignment.id,
        assignment.assignment_version,
        phase,
        assignment.member_id,
      ),
      assignment.household_id,
      assignment.id,
      assignment.assignment_version,
      assignment.local_period_start,
      assignment.chore_id,
      assignment.member_id,
      phase,
      status,
      availableAt,
      failureCategory,
      createdAt,
      failureCategory === null ? null : createdAt,
      assignment.id,
      assignment.assignment_version,
      assignment.member_id,
    )
    .run();
}

async function reconcilePhase(
  database: D1DatabaseLike,
  assignment: PlannedAssignmentRow,
  phase: OccurrencePhase,
  now: string,
): Promise<boolean> {
  await database
    .prepare(
      `UPDATE reminder_outbox
       SET correction_needed = 1
       WHERE assignment_id = ? AND occurrence_phase = ?
         AND assignment_version < ? AND recipient_member_id <> ?
         AND status IN ('accepted','delivery_unknown')`,
    )
    .bind(
      assignment.id,
      phase,
      assignment.assignment_version,
      assignment.member_id,
    )
    .run();

  await database
    .prepare(
      `UPDATE reminder_outbox
       SET status = 'failed', sanitized_error_category = 'superseded',
           lease_owner = NULL, lease_expires_at = NULL, terminal_at = ?
       WHERE assignment_id = ? AND occurrence_phase = ?
         AND assignment_version < ?
         AND (status = 'pending' OR
              (status = 'leased' AND lease_expires_at <= ?))`,
    )
    .bind(now, assignment.id, phase, assignment.assignment_version, now)
    .run();

  const terminalOrInFlight = await database
    .prepare(
      `SELECT id
       FROM reminder_outbox
       WHERE assignment_id = ? AND occurrence_phase = ?
         AND (status IN ('accepted','delivery_unknown') OR
              (status = 'leased' AND lease_expires_at > ?))
       LIMIT 1`,
    )
    .bind(assignment.id, phase, now)
    .all<{ id: string }>();
  return terminalOrInFlight.results.length > 0;
}

async function expireMissedOccurrence(
  database: D1DatabaseLike,
  assignment: PlannedAssignmentRow,
  phase: OccurrencePhase,
  now: string,
): Promise<void> {
  await database
    .prepare(
      `UPDATE reminder_outbox
       SET status = 'failed', sanitized_error_category = 'missed_occurrence',
           lease_owner = NULL, lease_expires_at = NULL, terminal_at = ?
       WHERE assignment_id = ? AND occurrence_phase = ?
         AND assignment_version = ?
         AND (status = 'pending' OR
              (status = 'leased' AND lease_expires_at <= ?))`,
    )
    .bind(now, assignment.id, phase, assignment.assignment_version, now)
    .run();
}

export async function planReminders(
  database: D1DatabaseLike,
  input: ReminderPlanningInput,
): Promise<ReminderPlanningResult> {
  if (!Number.isFinite(input.now.getTime())) {
    throw new RangeError("Invalid clock");
  }
  const now = input.now.toISOString();
  await database
    .prepare(
      `UPDATE reminder_outbox
       SET status = 'failed', sanitized_error_category = 'occurrence_disabled',
           lease_owner = NULL, lease_expires_at = NULL, terminal_at = ?
       WHERE occurrence_phase = 'evening'
         AND (status = 'pending' OR
              (status = 'leased' AND lease_expires_at <= ?))`,
    )
    .bind(now, now)
    .run();
  const households = await database
    .prepare(
      `SELECT id,time_zone,reminder_morning_local_time
       FROM households ORDER BY id`,
    )
    .all<{
      id: string;
      time_zone: string;
      reminder_morning_local_time: string;
    }>();
  const assignments: PlannedAssignmentRow[] = [];
  for (const household of households.results) {
    const localToday = localDateAt(input.now, household.time_zone);
    const planningThrough = addLocalDays(localToday, PLANNING_HORIZON_DAYS);
    const result = await database
      .prepare(
        `SELECT assignment.id,assignment.household_id,
                assignment.version AS assignment_version,
                 assignment.member_id,assignment.local_period_start,
                 assignment.chore_id,household.time_zone,
                 household.reminder_morning_local_time,
                member.sms_phone_e164,member.sms_consent_status,
                member.sms_suppression_status,? AS local_today
         FROM weekly_assignments AS assignment
         JOIN households AS household ON household.id = assignment.household_id
         JOIN members AS member ON member.id = assignment.member_id
                              AND member.household_id = assignment.household_id
          WHERE assignment.household_id = ?
            AND date(assignment.local_period_start, '+6 days') >= ?
            AND assignment.local_period_start <= ?
          ORDER BY assignment.local_period_start,assignment.chore_id,assignment.id`,
      )
      .bind(localToday, household.id, localToday, planningThrough)
      .all<PlannedAssignmentRow>();
    assignments.push(
      ...result.results.map((assignment) => ({
        ...assignment,
        reminder_morning_local_time: parseReminderLocalTime(
          assignment.reminder_morning_local_time,
        ),
      })),
    );
  }

  for (const assignment of assignments) {
    const contactFailureCategory = contactEligibilityFailure(assignment);
    const phase = "morning";
    const blocked = await reconcilePhase(database, assignment, phase, now);
    if (blocked) continue;

    if (assignment.local_period_start < assignment.local_today) {
      await expireMissedOccurrence(database, assignment, phase, now);
    }
    await insertOccurrence(
      database,
      assignment,
      phase,
      occurrenceInstant(
        assignment.local_period_start,
        phase,
        assignment.reminder_morning_local_time,
        assignment.time_zone,
      ),
      now,
      assignment.local_period_start < assignment.local_today
        ? "missed_occurrence"
        : contactFailureCategory,
    );
  }
  return { assignmentsConsidered: assignments.length };
}
