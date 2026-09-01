import { applyD1Migrations, env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

function d1(): D1Database {
  if (env.DB === undefined)
    throw new Error("Workerd D1 test binding is missing");
  return env.DB;
}

beforeEach(async () => {
  await applyD1Migrations(d1(), env.TEST_MIGRATIONS);
});

describe("SMS period schema on workerd D1", () => {
  it("matches local contact, period, occurrence, and provider constraints", async () => {
    const database = d1();
    await database
      .prepare(
        `INSERT INTO households
         (id,name,time_zone,week_start,created_at,reminder_send_local_time)
         VALUES (?,?,?,?,?,?)`,
      )
      .bind("h", "Home", "UTC", 1, "2026-08-31T00:00:00Z", "09:00")
      .run();
    await database
      .prepare(
        `INSERT INTO members
         (id,household_id,display_name,active,created_at,sms_phone_e164,
          sms_consent_status,sms_suppression_status)
         VALUES (?,?,?,?,?,?,?,?)`,
      )
      .bind(
        "m1",
        "h",
        "One",
        1,
        "2026-08-31T00:00:00Z",
        "+15555550100",
        "consented",
        "not_suppressed",
      )
      .run();
    await database
      .prepare(
        `INSERT INTO chores
         (id,household_id,name,active,created_at,instructions,
          ownership_start_weekday)
         VALUES (?,?,?,?,?,?,?)`,
      )
      .bind("c1", "h", "Bins", 1, "2026-08-31T00:00:00Z", "Take out bins.", 5)
      .run();
    await database
      .prepare(
        `INSERT INTO weekly_assignments
         (id,household_id,local_week_start,chore_id,member_id,version,source,
          actor_member_id,request_id,operation_id,operation_kind,occurred_at)
         VALUES (?,?,?,?,?,1,'rotation',NULL,?,?,'materialize',?)`,
      )
      .bind(
        "a1",
        "h",
        "2026-08-29",
        "c1",
        "m1",
        "request-a1",
        "operation-a1",
        "2026-08-29T00:00:00Z",
      )
      .run();
    await database
      .prepare(
        `INSERT INTO reminder_outbox
         (id,household_id,assignment_id,assignment_version,
          local_period_start,chore_id,recipient_member_id,occurrence_phase,
          status,available_at,created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .bind(
        "o1",
        "h",
        "a1",
        1,
        "2026-08-29",
        "c1",
        "m1",
        "evening",
        "pending",
        "2026-08-28T20:00:00Z",
        "2026-08-28T00:00:00Z",
      )
      .run();

    await expect(
      database
        .prepare(
          `SELECT m.sms_phone_e164 = ? AS contact_matches,
                   m.sms_consent_status,m.sms_suppression_status,
                   h.reminder_evening_local_time,
                   h.reminder_morning_local_time,
                   c.ownership_start_weekday,a.local_period_start,
                   o.occurrence_phase
           FROM members AS m
           JOIN households AS h ON h.id = m.household_id
           JOIN chores AS c ON c.household_id = m.household_id
           JOIN weekly_assignments AS a ON a.chore_id = c.id
           JOIN reminder_outbox AS o ON o.assignment_id = a.id
           WHERE m.id = ?`,
        )
        .bind("+15555550100", "m1")
        .first(),
    ).resolves.toEqual({
      contact_matches: 1,
      sms_consent_status: "consented",
      sms_suppression_status: "not_suppressed",
      reminder_evening_local_time: "20:00",
      reminder_morning_local_time: "08:00",
      ownership_start_weekday: 5,
      local_period_start: "2026-08-29",
      occurrence_phase: "evening",
    });
    await expect(
      database
        .prepare("UPDATE members SET sms_phone_e164 = ? WHERE id = ?")
        .bind("+15555550100 ", "m1")
        .run(),
    ).rejects.toThrow();
    await expect(
      database
        .prepare(
          `INSERT INTO reminder_outbox
           (id,household_id,assignment_id,assignment_version,
            local_period_start,chore_id,recipient_member_id,occurrence_phase,
            status,available_at,created_at)
           SELECT ?,household_id,assignment_id,assignment_version,
                  local_period_start,chore_id,recipient_member_id,
                  occurrence_phase,status,available_at,created_at
           FROM reminder_outbox WHERE id = ?`,
        )
        .bind("o2", "o1")
        .run(),
    ).rejects.toThrow();

    await database
      .prepare(
        `UPDATE reminder_outbox
         SET status = ?, textbelt_text_id = ?, textbelt_quota_remaining = ?,
             sanitized_error_category = ?, terminal_at = ?
         WHERE id = ?`,
      )
      .bind(
        "failed",
        "text-failed",
        0,
        "provider_rejected",
        "2026-08-28T20:00:01Z",
        "o1",
      )
      .run();
    await expect(
      database
        .prepare(
          `SELECT status,textbelt_text_id,textbelt_quota_remaining,
                  sanitized_error_category
           FROM reminder_outbox WHERE id = ?`,
        )
        .bind("o1")
        .first(),
    ).resolves.toEqual({
      status: "failed",
      textbelt_text_id: "text-failed",
      textbelt_quota_remaining: 0,
      sanitized_error_category: "provider_rejected",
    });
    await expect(
      database
        .prepare("UPDATE reminder_outbox SET status = ? WHERE id = ?")
        .bind("pending", "o1")
        .run(),
    ).rejects.toThrow(/terminal/);
  });
});
