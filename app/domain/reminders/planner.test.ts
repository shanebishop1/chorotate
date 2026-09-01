import { describe, expect, it } from "vitest";

import {
  occurrenceInstant,
  parseReminderLocalTime,
  planReminders,
} from "./planner";
import {
  insertAssignment,
  outboxRows,
  reassign,
  reminderDatabase,
} from "./test-support";

describe("SMS occurrence planning", () => {
  it("validates household reminder wall-clock values", () => {
    expect(parseReminderLocalTime("08:05")).toBe("08:05");
    expect(() => parseReminderLocalTime("24:00")).toThrow(/HH:mm/);
  });

  it("resolves both local clocks safely across spring and fall DST", () => {
    expect(
      occurrenceInstant("2026-03-09", "evening", "20:00", "America/New_York"),
    ).toBe("2026-03-09T00:00:00.000Z");
    expect(
      occurrenceInstant("2026-03-09", "morning", "08:00", "America/New_York"),
    ).toBe("2026-03-09T12:00:00.000Z");
    expect(
      occurrenceInstant("2026-11-02", "evening", "20:00", "America/New_York"),
    ).toBe("2026-11-02T01:00:00.000Z");
    expect(
      occurrenceInstant("2026-11-02", "morning", "08:00", "America/New_York"),
    ).toBe("2026-11-02T13:00:00.000Z");
  });

  it("plans Dishwasher Sunday/Monday and Trash Thursday/Friday exactly once", async () => {
    const database = reminderDatabase("UTC");
    insertAssignment(database, "dish", "2026-03-09", "m1", "dishwasher");
    insertAssignment(database, "bins", "2026-03-13", "m2", "trash");
    const input = { now: new Date("2026-03-01T12:00:00.000Z") };

    await planReminders(database, input);
    await planReminders(database, input);

    expect(
      outboxRows(database).map((row) => ({
        assignment: row.assignment_id,
        phase: row.occurrence_phase,
        recipient: row.recipient_member_id,
        availableAt: row.available_at,
      })),
    ).toEqual([
      {
        assignment: "bins",
        phase: "evening",
        recipient: "m2",
        availableAt: "2026-03-12T20:00:00.000Z",
      },
      {
        assignment: "bins",
        phase: "morning",
        recipient: "m2",
        availableAt: "2026-03-13T08:00:00.000Z",
      },
      {
        assignment: "dish",
        phase: "evening",
        recipient: "m1",
        availableAt: "2026-03-08T20:00:00.000Z",
      },
      {
        assignment: "dish",
        phase: "morning",
        recipient: "m1",
        availableAt: "2026-03-09T08:00:00.000Z",
      },
    ]);
  });

  it("uses separately configured evening and morning times", async () => {
    const database = reminderDatabase("UTC");
    database.database
      .prepare(
        `UPDATE households
         SET reminder_evening_local_time = ?, reminder_morning_local_time = ?
         WHERE id = 'h'`,
      )
      .run("17:45", "06:30");
    insertAssignment(database, "dish", "2026-03-09", "m1");

    await planReminders(database, {
      now: new Date("2026-03-01T12:00:00.000Z"),
    });

    expect(outboxRows(database).map((row) => row.available_at)).toEqual([
      "2026-03-08T17:45:00.000Z",
      "2026-03-09T06:30:00.000Z",
    ]);
  });

  it.each([
    ["missing_contact", null, "consented", "not_suppressed"],
    ["invalid_contact", "15555550100", "consented", "not_suppressed"],
    ["contact_unconsented", "+15555550100", "revoked", "not_suppressed"],
    ["contact_suppressed", "+15555550100", "consented", "suppressed"],
  ] as const)(
    "records terminal %s evidence without sendable work",
    async (category, phone, consent, suppression) => {
      const database = reminderDatabase("UTC");
      if (category === "invalid_contact") {
        database.database.exec("PRAGMA ignore_check_constraints = ON");
      }
      database.database
        .prepare(
          `UPDATE members
           SET sms_phone_e164 = ?, sms_consent_status = ?,
               sms_suppression_status = ?
           WHERE id = 'm1'`,
        )
        .run(phone, consent, suppression);
      database.database.exec("PRAGMA ignore_check_constraints = OFF");
      insertAssignment(database, "dish", "2026-03-09", "m1");

      await planReminders(database, {
        now: new Date("2026-03-01T12:00:00.000Z"),
      });

      expect(outboxRows(database)).toEqual([
        expect.objectContaining({
          occurrence_phase: "evening",
          status: "failed",
          sanitized_error_category: category,
          terminal_at: "2026-03-01T12:00:00.000Z",
        }),
        expect.objectContaining({
          occurrence_phase: "morning",
          status: "failed",
          sanitized_error_category: category,
          terminal_at: "2026-03-01T12:00:00.000Z",
        }),
      ]);
    },
  );

  it("supersedes stale pending and expired-leased occurrences for a reassignment", async () => {
    const database = reminderDatabase("UTC");
    insertAssignment(database, "dish", "2026-03-09", "m1");
    await planReminders(database, {
      now: new Date("2026-03-01T12:00:00.000Z"),
    });
    database.database
      .prepare(
        `UPDATE reminder_outbox
         SET status = 'leased', lease_owner = 'old-cron',
             lease_expires_at = '2026-03-02T11:59:00.000Z'
         WHERE occurrence_phase = 'evening'`,
      )
      .run();
    reassign(database, "dish", "m2", 2);

    await planReminders(database, {
      now: new Date("2026-03-02T12:00:00.000Z"),
    });

    const rows = outboxRows(database);
    expect(rows.filter((row) => row.assignment_version === 1)).toEqual([
      expect.objectContaining({
        occurrence_phase: "evening",
        status: "failed",
        sanitized_error_category: "superseded",
      }),
      expect.objectContaining({
        occurrence_phase: "morning",
        status: "failed",
        sanitized_error_category: "superseded",
      }),
    ]);
    expect(rows.filter((row) => row.assignment_version === 2)).toEqual([
      expect.objectContaining({
        occurrence_phase: "evening",
        recipient_member_id: "m2",
        status: "pending",
      }),
      expect.objectContaining({
        occurrence_phase: "morning",
        recipient_member_id: "m2",
        status: "pending",
      }),
    ]);
  });

  it.each(["accepted", "delivery_unknown"] as const)(
    "marks a prior %s occurrence correction-needed and plans no immediate correction SMS",
    async (terminalStatus) => {
      const database = reminderDatabase("UTC");
      insertAssignment(database, "dish", "2026-03-09", "m1");
      await planReminders(database, {
        now: new Date("2026-03-08T12:00:00.000Z"),
      });
      database.database
        .prepare(
          `UPDATE reminder_outbox
           SET status = ?, terminal_at = ?
           WHERE occurrence_phase = 'evening'`,
        )
        .run(terminalStatus, "2026-03-08T20:01:00.000Z");
      reassign(database, "dish", "m2", 2);

      const input = { now: new Date("2026-03-08T21:00:00.000Z") };
      await planReminders(database, input);
      await planReminders(database, input);

      const rows = outboxRows(database);
      expect(rows).toHaveLength(3);
      expect(rows).toContainEqual(
        expect.objectContaining({
          assignment_version: 1,
          occurrence_phase: "evening",
          status: terminalStatus,
          correction_needed: 1,
        }),
      );
      expect(rows).toContainEqual(
        expect.objectContaining({
          assignment_version: 2,
          occurrence_phase: "morning",
          recipient_member_id: "m2",
          status: "pending",
          correction_needed: 0,
        }),
      );
      expect(
        rows.some(
          (row) =>
            row.assignment_version === 2 && row.occurrence_phase === "evening",
        ),
      ).toBe(false);
    },
  );

  it("records missed occurrences terminally instead of catching up next day", async () => {
    const database = reminderDatabase("UTC");
    insertAssignment(database, "dish", "2026-03-09", "m1");

    await planReminders(database, {
      now: new Date("2026-03-01T07:00:00.000Z"),
    });

    await planReminders(database, {
      now: new Date("2026-03-10T07:00:00.000Z"),
    });

    expect(outboxRows(database)).toEqual([
      expect.objectContaining({
        occurrence_phase: "evening",
        status: "failed",
        sanitized_error_category: "missed_occurrence",
        available_at: "2026-03-08T20:00:00.000Z",
      }),
      expect.objectContaining({
        occurrence_phase: "morning",
        status: "failed",
        sanitized_error_category: "missed_occurrence",
        available_at: "2026-03-09T08:00:00.000Z",
      }),
    ]);
  });
});
