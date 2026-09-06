import type { D1DatabaseLike } from "../storage/d1";
import type { OccurrencePhase } from "./planner";
import {
  assertSingleSegmentGsm7,
  type TextbeltResponse,
  type TextbeltTransport,
} from "./textbelt";

interface ClaimedRow {
  id: string;
  assignment_id: string;
  assignment_version: number;
  local_period_start: string;
  chore_name: string;
  recipient_member_id: string;
  occurrence_phase: OccurrencePhase;
  attempt_count: number;
  lease_expires_at: string;
}

interface ContactRow {
  sms_phone_e164: string | null;
  sms_consent_status: string;
  sms_suppression_status: string;
  member_active: number;
}

export interface DispatchInput {
  now: Date;
  leaseOwner: string;
  batchSize: number;
  leaseMilliseconds: number;
  providerTimeoutMilliseconds: number;
}

export interface DispatchResult {
  claimed: number;
  accepted: number;
  failed: number;
  deliveryUnknown: number;
  ownershipLost: number;
}

export interface ReminderDispatcher {
  dispatch(input: DispatchInput): Promise<DispatchResult>;
}

type Completion = "accepted" | "failed" | "deliveryUnknown" | "ownershipLost";

function boundedInteger(
  value: number,
  minimum: number,
  maximum: number,
): number {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(
      `Value must be an integer from ${minimum} to ${maximum}`,
    );
  }
  return value;
}

function mutationChanges(result: unknown): number | null {
  if (typeof result !== "object" || result === null) return null;
  if ("meta" in result) {
    const meta = result.meta;
    if (typeof meta === "object" && meta !== null && "changes" in meta) {
      return typeof meta.changes === "number" ? meta.changes : null;
    }
  }
  if ("changes" in result) {
    if (typeof result.changes === "number") return result.changes;
    if (typeof result.changes === "bigint") return Number(result.changes);
  }
  return null;
}

function batchChanges(result: unknown, index: number): number | null {
  return Array.isArray(result) ? mutationChanges(result[index]) : null;
}

function periodLabel(localPeriodStart: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(localPeriodStart);
  if (!match) throw new RangeError("Invalid reminder period");
  const start = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])),
  );
  if (start.toISOString().slice(0, 10) !== localPeriodStart) {
    throw new RangeError("Invalid reminder period");
  }
  const end = new Date(start.getTime() + 6 * 86_400_000);
  const format = (date: Date) =>
    new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    }).format(date);
  return `${format(start)} to ${format(end)}`;
}

export function buildReminderSms(input: {
  phase: OccurrencePhase;
  choreName: string;
  localPeriodStart: string;
}): string {
  const message = `You're on ${input.choreName} this week- ${periodLabel(input.localPeriodStart)}`;
  assertSingleSegmentGsm7(message);
  return message;
}

const localDateFormatters = new Map<string, Intl.DateTimeFormat>();

function localDateAt(now: Date, timeZone: string): string {
  let formatter = localDateFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    localDateFormatters.set(timeZone, formatter);
  }
  const parts = Object.fromEntries(
    formatter
      .formatToParts(now)
      .filter(({ type }) => type !== "literal")
      .map(({ type, value }) => [type, value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

async function recoverExpiredLeases(
  database: D1DatabaseLike,
  now: string,
): Promise<void> {
  await database.batch([
    database
      .prepare(
        `INSERT OR IGNORE INTO reminder_delivery_attempts
         (id,outbox_id,attempt_number,attempted_at,outcome,
          sanitized_error_category,provider_status)
         SELECT id || ':attempt:' || attempt_count,id,attempt_count,?,
                'delivery_unknown','expired_in_flight_lease','unknown'
         FROM reminder_outbox
         WHERE status='leased' AND lease_expires_at <= ?`,
      )
      .bind(now, now),
    database
      .prepare(
        `UPDATE reminder_outbox
         SET status='delivery_unknown',lease_owner=NULL,lease_expires_at=NULL,
             sanitized_error_category='expired_in_flight_lease',
             provider_status='unknown',terminal_at=?
         WHERE status='leased' AND lease_expires_at <= ?`,
      )
      .bind(now, now),
  ]);
}

async function expireStalePending(
  database: D1DatabaseLike,
  now: Date,
  terminalAt: string,
): Promise<void> {
  const households = await database
    .prepare("SELECT id,time_zone FROM households ORDER BY id")
    .all<{ id: string; time_zone: string }>();
  for (const household of households.results) {
    await database
      .prepare(
        `UPDATE reminder_outbox
         SET status='failed',sanitized_error_category='missed_occurrence',
             terminal_at=?
         WHERE household_id=? AND status='pending'
           AND date(local_period_start,
                    CASE occurrence_phase WHEN 'evening' THEN '-1 day' ELSE '+0 day' END) < ?`,
      )
      .bind(terminalAt, household.id, localDateAt(now, household.time_zone))
      .run();
  }
}

async function claimedRows(
  database: D1DatabaseLike,
  leaseOwner: string,
  leaseExpiresAt: string,
): Promise<ClaimedRow[]> {
  const result = await database
    .prepare(
      `SELECT outbox.id,outbox.assignment_id,outbox.assignment_version,
              outbox.local_period_start,chore.name AS chore_name,
              outbox.recipient_member_id,outbox.occurrence_phase,
              outbox.attempt_count,outbox.lease_expires_at
       FROM reminder_outbox AS outbox
       JOIN chores AS chore
         ON chore.household_id=outbox.household_id AND chore.id=outbox.chore_id
       WHERE outbox.status='leased' AND outbox.lease_owner=?
         AND outbox.lease_expires_at=?
       ORDER BY outbox.available_at,outbox.id`,
    )
    .bind(leaseOwner, leaseExpiresAt)
    .all<ClaimedRow>();
  return result.results;
}

async function stillOwnsLease(
  database: D1DatabaseLike,
  row: ClaimedRow,
  leaseOwner: string,
): Promise<boolean> {
  const result = await database
    .prepare(
      `UPDATE reminder_outbox SET lease_expires_at=lease_expires_at
       WHERE id=? AND status='leased' AND lease_owner=?
         AND lease_expires_at=? AND attempt_count=?`,
    )
    .bind(row.id, leaseOwner, row.lease_expires_at, row.attempt_count)
    .run();
  return mutationChanges(result) === 1;
}

async function currentContact(
  database: D1DatabaseLike,
  row: ClaimedRow,
): Promise<ContactRow | null> {
  const result = await database
    .prepare(
      `SELECT member.sms_phone_e164,member.sms_consent_status,
              member.sms_suppression_status,member.active AS member_active
       FROM reminder_outbox AS outbox
       JOIN weekly_assignments AS assignment
         ON assignment.id=outbox.assignment_id
        AND assignment.household_id=outbox.household_id
        AND assignment.chore_id=outbox.chore_id
        AND assignment.local_period_start=outbox.local_period_start
        AND assignment.version=outbox.assignment_version
        AND assignment.member_id=outbox.recipient_member_id
       JOIN members AS member
         ON member.household_id=outbox.household_id
        AND member.id=outbox.recipient_member_id
       WHERE outbox.id=?`,
    )
    .bind(row.id)
    .all<ContactRow>();
  return result.results[0] ?? null;
}

function contactFailure(contact: ContactRow | null): string | null {
  if (!contact) return "stale_assignment";
  if (contact.member_active !== 1) return "inactive_contact";
  if (contact.sms_phone_e164 === null) return "missing_contact";
  if (!/^\+[1-9]\d{1,14}$/.test(contact.sms_phone_e164)) {
    return "invalid_contact";
  }
  if (contact.sms_consent_status !== "consented") {
    return "contact_unconsented";
  }
  if (contact.sms_suppression_status !== "not_suppressed") {
    return "contact_suppressed";
  }
  return null;
}

async function completeFenced(
  database: D1DatabaseLike,
  row: ClaimedRow,
  leaseOwner: string,
  attemptedAt: string,
  outcome: "failed" | "delivery_unknown" | "pre_submit_failure",
  category: string,
  quotaRemaining: number | null = null,
): Promise<Completion> {
  const status = outcome === "delivery_unknown" ? "delivery_unknown" : "failed";
  const providerStatus =
    outcome === "delivery_unknown" ? "unknown" : "rejected";
  const result = await database.batch([
    database
      .prepare(
        `INSERT OR IGNORE INTO reminder_delivery_attempts
         (id,outbox_id,attempt_number,attempted_at,outcome,
          textbelt_quota_remaining,sanitized_error_category,provider_status)
         SELECT ?,?,?,?,?,?,?,?
         WHERE EXISTS (
           SELECT 1 FROM reminder_outbox
           WHERE id=? AND status='leased' AND lease_owner=?
             AND lease_expires_at=? AND attempt_count=?
         )`,
      )
      .bind(
        `${row.id}:attempt:${row.attempt_count}`,
        row.id,
        row.attempt_count,
        attemptedAt,
        outcome,
        quotaRemaining,
        category,
        providerStatus,
        row.id,
        leaseOwner,
        row.lease_expires_at,
        row.attempt_count,
      ),
    database
      .prepare(
        `UPDATE reminder_outbox
         SET status=?,lease_owner=NULL,lease_expires_at=NULL,
             textbelt_quota_remaining=?,sanitized_error_category=?,
             provider_status=?,terminal_at=?
         WHERE id=? AND status='leased' AND lease_owner=?
           AND lease_expires_at=? AND attempt_count=?`,
      )
      .bind(
        status,
        quotaRemaining,
        category,
        providerStatus,
        attemptedAt,
        row.id,
        leaseOwner,
        row.lease_expires_at,
        row.attempt_count,
      ),
  ]);
  if (batchChanges(result, 1) !== 1) return "ownershipLost";
  return status === "delivery_unknown" ? "deliveryUnknown" : "failed";
}

async function receiptAssociations(
  database: D1DatabaseLike,
  textId: string,
): Promise<Set<string>> {
  const result = await database
    .prepare(
      `SELECT outbox_id FROM reminder_delivery_attempts
       WHERE textbelt_text_id=?
       UNION
       SELECT id AS outbox_id FROM reminder_outbox
       WHERE textbelt_text_id=?`,
    )
    .bind(textId, textId)
    .all<{ outbox_id: string }>();
  return new Set(result.results.map(({ outbox_id }) => outbox_id));
}

async function completeAccepted(
  database: D1DatabaseLike,
  row: ClaimedRow,
  attemptedAt: string,
  response: Extract<TextbeltResponse, { success: true }>,
): Promise<Completion> {
  const textId = String(response.textId);
  const associations = await receiptAssociations(database, textId);
  if ([...associations].some((outboxId) => outboxId !== row.id)) {
    return "ownershipLost";
  }
  await database
    .prepare(
      `INSERT OR IGNORE INTO reminder_delivery_attempts
       (id,outbox_id,attempt_number,attempted_at,outcome,textbelt_text_id,
        textbelt_quota_remaining,provider_status)
       VALUES (?,?,?,?, 'accepted',?,?,'accepted')`,
    )
    .bind(
      `${row.id}:attempt:${row.attempt_count}`,
      row.id,
      row.attempt_count,
      attemptedAt,
      textId,
      response.quotaRemaining,
    )
    .run();
  const completion = await database
    .prepare(
      `UPDATE reminder_outbox
       SET status='accepted',lease_owner=NULL,lease_expires_at=NULL,
           textbelt_text_id=?,textbelt_quota_remaining=?,
           sanitized_error_category=NULL,provider_status='accepted',terminal_at=?
       WHERE id=? AND status='leased'
         AND EXISTS (
           SELECT 1 FROM reminder_delivery_attempts AS attempt
           WHERE attempt.outbox_id=reminder_outbox.id
             AND attempt.textbelt_text_id=?
         )`,
    )
    .bind(textId, response.quotaRemaining, attemptedAt, row.id, textId)
    .run();
  return mutationChanges(completion) === 1 ? "accepted" : "ownershipLost";
}

function explicitFailureCategory(error: string): string {
  return error.toLowerCase().includes("quota")
    ? "out_of_quota"
    : "provider_rejected";
}

export function createReminderDispatcher(
  database: D1DatabaseLike,
  transport: TextbeltTransport,
): ReminderDispatcher {
  return {
    async dispatch(input) {
      if (!Number.isFinite(input.now.getTime()))
        throw new RangeError("Invalid clock");
      if (!input.leaseOwner.trim())
        throw new RangeError("leaseOwner is required");
      const batchSize = boundedInteger(input.batchSize, 1, 100);
      const leaseMilliseconds = boundedInteger(
        input.leaseMilliseconds,
        6_000,
        3_600_000,
      );
      const providerTimeoutMilliseconds = boundedInteger(
        input.providerTimeoutMilliseconds,
        1_000,
        30_000,
      );
      if (leaseMilliseconds < batchSize * providerTimeoutMilliseconds + 5_000) {
        throw new RangeError(
          "leaseMilliseconds must cover the sequential provider timeout budget",
        );
      }

      const attemptedAt = input.now.toISOString();
      const leaseExpiresAt = new Date(
        input.now.getTime() + leaseMilliseconds,
      ).toISOString();
      await recoverExpiredLeases(database, attemptedAt);
      await expireStalePending(database, input.now, attemptedAt);
      await database
        .prepare(
          `UPDATE reminder_outbox
           SET status='leased',lease_owner=?,lease_expires_at=?,
               attempt_count=attempt_count+1
           WHERE id IN (
             SELECT id FROM reminder_outbox
             WHERE status='pending' AND available_at <= ?
             ORDER BY available_at,id LIMIT ?
           )`,
        )
        .bind(input.leaseOwner, leaseExpiresAt, attemptedAt, batchSize)
        .run();
      const rows = await claimedRows(
        database,
        input.leaseOwner,
        leaseExpiresAt,
      );
      const summary: DispatchResult = {
        claimed: rows.length,
        accepted: 0,
        failed: 0,
        deliveryUnknown: 0,
        ownershipLost: 0,
      };

      for (const row of rows) {
        if (!(await stillOwnsLease(database, row, input.leaseOwner))) {
          summary.ownershipLost += 1;
          continue;
        }
        const contact = await currentContact(database, row);
        const blocked = contactFailure(contact);
        let state: Completion;
        if (blocked) {
          state = await completeFenced(
            database,
            row,
            input.leaseOwner,
            attemptedAt,
            "pre_submit_failure",
            blocked,
          );
        } else {
          let message: string;
          try {
            message = buildReminderSms({
              phase: row.occurrence_phase,
              choreName: row.chore_name,
              localPeriodStart: row.local_period_start,
            });
          } catch {
            state = await completeFenced(
              database,
              row,
              input.leaseOwner,
              attemptedAt,
              "pre_submit_failure",
              "invalid_sms_content",
            );
            summary[state] += 1;
            continue;
          }
          if (!(await stillOwnsLease(database, row, input.leaseOwner))) {
            summary.ownershipLost += 1;
            continue;
          }
          try {
            const response = await transport.send({
              phone: contact!.sms_phone_e164!,
              message,
            });
            state = response.success
              ? await completeAccepted(database, row, attemptedAt, response)
              : await completeFenced(
                  database,
                  row,
                  input.leaseOwner,
                  attemptedAt,
                  "failed",
                  explicitFailureCategory(response.error),
                  response.quotaRemaining ?? null,
                );
          } catch {
            state = await completeFenced(
              database,
              row,
              input.leaseOwner,
              attemptedAt,
              "delivery_unknown",
              "ambiguous_transport_result",
            );
          }
        }
        summary[state] += 1;
      }
      return summary;
    },
  };
}
