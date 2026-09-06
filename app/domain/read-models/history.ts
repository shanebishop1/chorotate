import {
  authorize,
  chorePeriodRange,
  booleanInteger,
  idFilter,
  invalidInput,
  integerValue,
  localDateTimeAt,
  nullableString,
  pageInput,
  ReadModelError,
  stringValue,
  unavailable,
  weekdayValue,
  type Page,
  type PeriodRange,
  type ProjectedReminderStatus,
  type ProjectionState,
  type ReadModelContext,
} from "./shared";
import { reminderStatus } from "./projections";

type OperationKind = "materialize" | "reassign" | "swap" | "correct";

interface HistoryRow {
  event_id: unknown;
  assignment_id: unknown;
  operation_id: unknown;
  request_id: unknown;
  operation_kind: unknown;
  occurred_at: unknown;
  local_period_start: unknown;
  chore_id: unknown;
  chore_name: unknown;
  ownership_start_weekday: unknown;
  actor_member_id: unknown;
  actor_name: unknown;
  actor_active: unknown;
  before_member_id: unknown;
  before_name: unknown;
  before_active: unknown;
  before_version: unknown;
  before_source: unknown;
  before_sms_has_phone: unknown;
  before_sms_consent_status: unknown;
  before_sms_suppression_status: unknown;
  before_evening_status: unknown;
  before_evening_correction_needed: unknown;
  before_morning_status: unknown;
  before_morning_correction_needed: unknown;
  after_member_id: unknown;
  after_name: unknown;
  after_active: unknown;
  after_version: unknown;
  after_source: unknown;
  after_sms_has_phone: unknown;
  after_sms_consent_status: unknown;
  after_sms_suppression_status: unknown;
  after_evening_status: unknown;
  after_evening_correction_needed: unknown;
  after_morning_status: unknown;
  after_morning_correction_needed: unknown;
}

interface HistoryMember {
  id: string;
  displayName: string | null;
  active: boolean | null;
}

interface HistorySnapshot {
  member: HistoryMember;
  version: number;
  source: string;
  reminder: ProjectedReminderStatus;
}

export interface HistoryOperation {
  operationId: string;
  requestId: string;
  kind: OperationKind;
  occurredAt: string;
  localOccurredAt: string;
  actorType: "member" | "system";
  actor: HistoryMember | null;
  changes: Array<{
    eventId: string;
    assignmentId: string;
    period: PeriodRange;
    chore: { id: string; name: string };
    before: HistorySnapshot | null;
    after: HistorySnapshot;
  }>;
}

function operationKind(value: unknown): OperationKind {
  if (
    value === "materialize" ||
    value === "reassign" ||
    value === "swap" ||
    value === "correct"
  )
    return value;
  unavailable();
}

function historyMember(
  id: unknown,
  name: unknown,
  active: unknown,
): HistoryMember {
  return {
    id: stringValue(id),
    displayName: nullableString(name),
    active: active === null ? null : booleanInteger(active),
  };
}

export async function getGroupedHistory(
  context: ReadModelContext,
  input: {
    request: Request;
    fromOccurredAt?: string;
    toOccurredAt?: string;
    actorMemberIds?: readonly string[];
    choreIds?: readonly string[];
    kinds?: readonly OperationKind[];
    limit?: number;
    offset?: number;
  },
): Promise<{
  state: ProjectionState;
  operations: HistoryOperation[];
  page: Page;
}> {
  const { household } = await authorize(context, input.request);
  const page = pageInput(input.limit, input.offset);
  const actorMemberIds = idFilter(input.actorMemberIds);
  const choreIds = idFilter(input.choreIds);
  const kinds =
    input.kinds === undefined ? undefined : [...new Set(input.kinds)];
  if (
    kinds?.some(
      (kind) => !["materialize", "reassign", "swap", "correct"].includes(kind),
    )
  )
    invalidInput();
  if (
    input.fromOccurredAt !== undefined &&
    Number.isNaN(new Date(input.fromOccurredAt).valueOf())
  )
    invalidInput();
  if (
    input.toOccurredAt !== undefined &&
    Number.isNaN(new Date(input.toOccurredAt).valueOf())
  )
    invalidInput();
  if (
    input.fromOccurredAt !== undefined &&
    input.toOccurredAt !== undefined &&
    input.fromOccurredAt > input.toOccurredAt
  )
    invalidInput();
  if (
    actorMemberIds?.length === 0 ||
    choreIds?.length === 0 ||
    kinds?.length === 0
  ) {
    return {
      state: "empty",
      operations: [],
      page: { ...page, nextOffset: null },
    };
  }

  const clauses = ["household_id = ?"];
  const values: unknown[] = [household.id];
  if (input.fromOccurredAt !== undefined) {
    clauses.push("occurred_at >= ?");
    values.push(input.fromOccurredAt);
  }
  if (input.toOccurredAt !== undefined) {
    clauses.push("occurred_at <= ?");
    values.push(input.toOccurredAt);
  }
  if (actorMemberIds !== undefined) {
    clauses.push(
      `actor_member_id IN (${actorMemberIds.map(() => "?").join(",")})`,
    );
    values.push(...actorMemberIds);
  }
  if (choreIds !== undefined) {
    clauses.push(`chore_id IN (${choreIds.map(() => "?").join(",")})`);
    values.push(...choreIds);
  }
  if (kinds !== undefined) {
    clauses.push(`operation_kind IN (${kinds.map(() => "?").join(",")})`);
    values.push(...kinds);
  }
  values.push(page.limit + 1, page.offset);

  try {
    const result = await context.database
      .prepare(
        `WITH matching_operations AS (
           SELECT operation_id, MAX(occurred_at) AS latest
           FROM assignment_audit_events
           WHERE ${clauses.join(" AND ")}
           GROUP BY operation_id
         ), selected_operations AS (
           SELECT operation_id, latest
           FROM matching_operations
           ORDER BY latest DESC, operation_id DESC
           LIMIT ? OFFSET ?
         )
         SELECT e.id AS event_id, e.assignment_id, e.operation_id, e.request_id,
                 e.operation_kind, e.occurred_at, e.local_period_start, e.chore_id,
                 c.name AS chore_name, c.ownership_start_weekday,
                 e.actor_member_id, actor.display_name AS actor_name,
                 actor.active AS actor_active, e.before_member_id,
                 before_member.display_name AS before_name, before_member.active AS before_active,
                 e.before_version, e.before_source, e.after_member_id,
                 after_member.display_name AS after_name, after_member.active AS after_active,
                 e.after_version, e.after_source,
                 (before_member.sms_phone_e164 IS NOT NULL) AS before_sms_has_phone,
                 before_member.sms_consent_status AS before_sms_consent_status,
                 before_member.sms_suppression_status AS before_sms_suppression_status,
                 (SELECT status FROM reminder_outbox
                   WHERE assignment_id=e.assignment_id AND assignment_version=e.before_version
                     AND recipient_member_id=e.before_member_id AND occurrence_phase='evening')
                   AS before_evening_status,
                 (SELECT correction_needed FROM reminder_outbox
                   WHERE assignment_id=e.assignment_id AND assignment_version=e.before_version
                     AND recipient_member_id=e.before_member_id AND occurrence_phase='evening')
                   AS before_evening_correction_needed,
                 (SELECT status FROM reminder_outbox
                   WHERE assignment_id=e.assignment_id AND assignment_version=e.before_version
                     AND recipient_member_id=e.before_member_id AND occurrence_phase='morning')
                   AS before_morning_status,
                 (SELECT correction_needed FROM reminder_outbox
                   WHERE assignment_id=e.assignment_id AND assignment_version=e.before_version
                     AND recipient_member_id=e.before_member_id AND occurrence_phase='morning')
                   AS before_morning_correction_needed,
                 (after_member.sms_phone_e164 IS NOT NULL) AS after_sms_has_phone,
                 after_member.sms_consent_status AS after_sms_consent_status,
                 after_member.sms_suppression_status AS after_sms_suppression_status,
                 (SELECT status FROM reminder_outbox
                   WHERE assignment_id=e.assignment_id AND assignment_version=e.after_version
                     AND recipient_member_id=e.after_member_id AND occurrence_phase='evening')
                   AS after_evening_status,
                 (SELECT correction_needed FROM reminder_outbox
                   WHERE assignment_id=e.assignment_id AND assignment_version=e.after_version
                     AND recipient_member_id=e.after_member_id AND occurrence_phase='evening')
                   AS after_evening_correction_needed,
                 (SELECT status FROM reminder_outbox
                   WHERE assignment_id=e.assignment_id AND assignment_version=e.after_version
                     AND recipient_member_id=e.after_member_id AND occurrence_phase='morning')
                   AS after_morning_status,
                 (SELECT correction_needed FROM reminder_outbox
                   WHERE assignment_id=e.assignment_id AND assignment_version=e.after_version
                     AND recipient_member_id=e.after_member_id AND occurrence_phase='morning')
                   AS after_morning_correction_needed
         FROM selected_operations AS selected
         INNER JOIN assignment_audit_events AS e ON e.operation_id = selected.operation_id
         INNER JOIN chores AS c ON c.id = e.chore_id AND c.household_id = e.household_id
         LEFT JOIN members AS actor ON actor.id = e.actor_member_id AND actor.household_id = e.household_id
         LEFT JOIN members AS before_member ON before_member.id = e.before_member_id AND before_member.household_id = e.household_id
         LEFT JOIN members AS after_member ON after_member.id = e.after_member_id AND after_member.household_id = e.household_id
         WHERE e.household_id = ?
         ORDER BY selected.latest DESC, selected.operation_id DESC,
                   e.local_period_start, c.name, e.chore_id, e.id`,
      )
      .bind(...values, household.id)
      .all<HistoryRow>();

    const grouped = new Map<string, HistoryOperation>();
    for (const row of result.results) {
      const operationId = stringValue(row.operation_id);
      const occurredAt = stringValue(row.occurred_at);
      const actor =
        row.actor_member_id === null
          ? null
          : historyMember(
              row.actor_member_id,
              row.actor_name,
              row.actor_active,
            );
      let operation = grouped.get(operationId);
      if (operation === undefined) {
        operation = {
          operationId,
          requestId: stringValue(row.request_id),
          kind: operationKind(row.operation_kind),
          occurredAt,
          localOccurredAt: localDateTimeAt(occurredAt, household.timeZone),
          actorType: actor === null ? "system" : "member",
          actor,
          changes: [],
        };
        grouped.set(operationId, operation);
      } else if (
        operation.requestId !== row.request_id ||
        operation.kind !== row.operation_kind ||
        operation.occurredAt !== occurredAt
      ) {
        unavailable();
      }
      const before =
        row.before_member_id === null
          ? null
          : {
              member: historyMember(
                row.before_member_id,
                row.before_name,
                row.before_active,
              ),
              version: integerValue(row.before_version),
              source: stringValue(row.before_source),
              reminder: reminderStatus({
                hasPhone: row.before_sms_has_phone,
                consent: row.before_sms_consent_status,
                suppression: row.before_sms_suppression_status,
                eveningStatus: row.before_evening_status,
                eveningCorrection: row.before_evening_correction_needed,
                morningStatus: row.before_morning_status,
                morningCorrection: row.before_morning_correction_needed,
              }),
            };
      operation.changes.push({
        eventId: stringValue(row.event_id),
        assignmentId: stringValue(row.assignment_id),
        period: chorePeriodRange(
          household.id,
          stringValue(row.local_period_start),
          household.timeZone,
          weekdayValue(row.ownership_start_weekday),
        ),
        chore: {
          id: stringValue(row.chore_id),
          name: stringValue(row.chore_name),
        },
        before,
        after: {
          member: historyMember(
            row.after_member_id,
            row.after_name,
            row.after_active,
          ),
          version: integerValue(row.after_version),
          source: stringValue(row.after_source),
          reminder: reminderStatus({
            hasPhone: row.after_sms_has_phone,
            consent: row.after_sms_consent_status,
            suppression: row.after_sms_suppression_status,
            eveningStatus: row.after_evening_status,
            eveningCorrection: row.after_evening_correction_needed,
            morningStatus: row.after_morning_status,
            morningCorrection: row.after_morning_correction_needed,
          }),
        },
      });
    }
    const allOperations = [...grouped.values()];
    const hasMore = allOperations.length > page.limit;
    const operations = allOperations.slice(0, page.limit);
    return {
      state: operations.length === 0 ? "empty" : "ready",
      operations,
      page: {
        ...page,
        nextOffset: hasMore ? page.offset + page.limit : null,
      },
    };
  } catch (error) {
    if (error instanceof ReadModelError) throw error;
    unavailable();
  }
}
