/// <reference types="node" />

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const priorMigrations = [
  "migrations/0001_domain_schema.sql",
  "migrations/0002_assignment_audit_triggers.sql",
  "migrations/0003_chore_instructions.sql",
  "migrations/0004_better_auth.sql",
  "migrations/0005_reminder_reliability.sql",
  "migrations/0006_assignment_integrity.sql",
];
const contactPeriodMigration = "migrations/0007_sms_contact_period_outbox.sql";
const occurrenceTimeMigration = "migrations/0008_sms_occurrence_times.sql";

function apply(database: DatabaseSync, files: readonly string[]): void {
  database.exec("PRAGMA foreign_keys = ON");
  for (const file of files) {
    database.exec(readFileSync(resolve(root, file), "utf8"));
  }
}

function seedLegacyData(database: DatabaseSync): void {
  database
    .prepare(
      `INSERT INTO households
       (id,name,time_zone,week_start,created_at,reminder_send_local_time)
       VALUES (?,?,?,?,?,?)`,
    )
    .run("h", "Home", "UTC", 1, "2026-08-31T00:00:00Z", "09:00");
  database
    .prepare(
      `INSERT INTO members (id,household_id,display_name,active,created_at)
       VALUES (?,?,?,?,?)`,
    )
    .run("m1", "h", "One", 1, "2026-08-31T00:00:00Z");
  database
    .prepare(
      `INSERT INTO chores
       (id,household_id,name,active,created_at,instructions)
       VALUES (?,?,?,?,?,?)`,
    )
    .run("c1", "h", "Bins", 1, "2026-08-31T00:00:00Z", "Take out bins.");
  database
    .prepare(
      `INSERT INTO weekly_assignments
       (id,household_id,local_week_start,chore_id,member_id,version,source,
        actor_member_id,request_id,operation_id,operation_kind,occurred_at)
       VALUES (?,?,?,?,?,1,'rotation',NULL,?,?,'materialize',?)`,
    )
    .run(
      "a1",
      "h",
      "2026-08-31",
      "c1",
      "m1",
      "request-a1",
      "operation-a1",
      "2026-08-31T00:00:00Z",
    );
  database
    .prepare(
      `INSERT INTO reminder_outbox
       (id,assignment_id,assignment_version,recipient_member_id,kind,status,
        available_at,provider_message_id,created_at,sent_at)
       VALUES (?,?,?,?,?,'sent',?,?,?,?)`,
    )
    .run(
      "o1",
      "a1",
      1,
      "m1",
      "assignment",
      "2026-08-30T20:00:00Z",
      "text-legacy",
      "2026-08-30T19:00:00Z",
      "2026-08-30T20:00:01Z",
    );
  database
    .prepare(
      `INSERT INTO reminder_delivery_attempts
       (id,outbox_id,attempt_number,attempted_at,outcome,provider_message_id)
       VALUES (?,?,1,?,'accepted',?)`,
    )
    .run("d1", "o1", "2026-08-30T20:00:00Z", "text-legacy");
}

function migratedDatabase(): DatabaseSync {
  const database = new DatabaseSync(":memory:");
  apply(database, priorMigrations);
  seedLegacyData(database);
  apply(database, [contactPeriodMigration, occurrenceTimeMigration]);
  return database;
}

describe("SMS contact, chore-period, and outbox migration", () => {
  it("adds separate validated evening and morning household times", () => {
    const database = migratedDatabase();

    expect(
      database
        .prepare(
          `SELECT reminder_evening_local_time,reminder_morning_local_time,
                  reminder_send_local_time
           FROM households WHERE id = ?`,
        )
        .get("h"),
    ).toEqual({
      reminder_evening_local_time: "20:00",
      reminder_morning_local_time: "08:00",
      reminder_send_local_time: "09:00",
    });
    expect(() =>
      database
        .prepare(
          "UPDATE households SET reminder_evening_local_time = ? WHERE id = ?",
        )
        .run("24:00", "h"),
    ).toThrow();
    expect(() =>
      database
        .prepare(
          "UPDATE households SET reminder_morning_local_time = ? WHERE id = ?",
        )
        .run("8:00", "h"),
    ).toThrow();
  });

  it("preserves legacy rows and immutable assignment audit evidence", () => {
    const database = migratedDatabase();

    expect(
      database
        .prepare(
          `SELECT local_period_start
           FROM weekly_assignments WHERE id = ?`,
        )
        .get("a1"),
    ).toEqual({ local_period_start: "2026-08-31" });
    expect(
      database
        .prepare(
          `SELECT occurrence_phase,status,textbelt_text_id
           FROM reminder_outbox WHERE id = ?`,
        )
        .get("o1"),
    ).toEqual({
      occurrence_phase: "legacy_primary",
      status: "accepted",
      textbelt_text_id: "text-legacy",
    });
    expect(
      database
        .prepare(
          `SELECT outcome,textbelt_text_id
           FROM reminder_delivery_attempts WHERE id = ?`,
        )
        .get("d1"),
    ).toEqual({ outcome: "accepted", textbelt_text_id: "text-legacy" });
    expect(() =>
      database
        .prepare(
          `UPDATE assignment_audit_events SET request_id = ?
           WHERE assignment_id = ?`,
        )
        .run("changed", "a1"),
    ).toThrow(/immutable/);
  });

  it("enforces normalized E.164 contact and explicit consent/suppression state", () => {
    const database = migratedDatabase();

    database
      .prepare(
        `UPDATE members
         SET sms_phone_e164 = ?, sms_consent_status = ?,
             sms_suppression_status = ?
         WHERE id = ?`,
      )
      .run("+15555550100", "consented", "not_suppressed", "m1");
    expect(
      database
        .prepare(
          `SELECT sms_phone_e164 = ? AS contact_matches,
                  sms_consent_status,sms_suppression_status
           FROM members WHERE id = ?`,
        )
        .get("+15555550100", "m1"),
    ).toEqual({
      contact_matches: 1,
      sms_consent_status: "consented",
      sms_suppression_status: "not_suppressed",
    });
    expect(() =>
      database
        .prepare("UPDATE members SET sms_phone_e164 = ? WHERE id = ?")
        .run("+15555550100 ", "m1"),
    ).toThrow();
    expect(() =>
      database
        .prepare("UPDATE members SET sms_consent_status = ? WHERE id = ?")
        .run("implicit", "m1"),
    ).toThrow();
    expect(() =>
      database
        .prepare("UPDATE members SET sms_suppression_status = ? WHERE id = ?")
        .run("unknown", "m1"),
    ).toThrow();
  });

  it("stores per-chore ownership start weekdays and chore-period identity", () => {
    const database = migratedDatabase();

    database
      .prepare("UPDATE chores SET ownership_start_weekday = ? WHERE id = ?")
      .run(5, "c1");
    expect(
      database
        .prepare(`SELECT ownership_start_weekday FROM chores WHERE id = ?`)
        .get("c1"),
    ).toEqual({ ownership_start_weekday: 5 });
    expect(() =>
      database
        .prepare("UPDATE chores SET ownership_start_weekday = ? WHERE id = ?")
        .run(7, "c1"),
    ).toThrow();
    expect(() =>
      database
        .prepare(
          `UPDATE weekly_assignments SET local_period_start = ? WHERE id = ?`,
        )
        .run("2026-09-01", "a1"),
    ).toThrow(/generated column/);
  });

  it("deduplicates quota-safe SMS occurrences and stores terminal provider evidence", () => {
    const database = migratedDatabase();
    const insert = database.prepare(
      `INSERT INTO reminder_outbox
       (id,household_id,assignment_id,assignment_version,local_period_start,
        chore_id,recipient_member_id,occurrence_phase,status,available_at,
        created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    );
    insert.run(
      "o2",
      "h",
      "a1",
      1,
      "2026-08-31",
      "c1",
      "m1",
      "morning",
      "pending",
      "2026-08-31T08:00:00Z",
      "2026-08-30T00:00:00Z",
    );
    expect(() =>
      insert.run(
        "o3",
        "h",
        "a1",
        1,
        "2026-08-31",
        "c1",
        "m1",
        "morning",
        "pending",
        "2026-08-31T08:00:00Z",
        "2026-08-30T00:00:00Z",
      ),
    ).toThrow();

    database
      .prepare(
        `UPDATE reminder_outbox
         SET status = ?, textbelt_text_id = ?, textbelt_quota_remaining = ?,
             sanitized_error_category = ?, provider_status = ?,
             provider_status_checked_at = ?, terminal_at = ?
         WHERE id = ?`,
      )
      .run(
        "delivery_unknown",
        "text-unknown",
        0,
        "ambiguous_timeout",
        "unknown",
        "2026-08-31T08:00:30Z",
        "2026-08-31T08:00:30Z",
        "o2",
      );
    expect(
      database
        .prepare(
          `SELECT status,textbelt_text_id,textbelt_quota_remaining,
                  sanitized_error_category,provider_status
           FROM reminder_outbox WHERE id = ?`,
        )
        .get("o2"),
    ).toEqual({
      status: "delivery_unknown",
      textbelt_text_id: "text-unknown",
      textbelt_quota_remaining: 0,
      sanitized_error_category: "ambiguous_timeout",
      provider_status: "unknown",
    });
    expect(() =>
      database
        .prepare("UPDATE reminder_outbox SET status = ? WHERE id = ?")
        .run("pending", "o2"),
    ).toThrow(/terminal/);

    const columns = database
      .prepare("PRAGMA table_info(reminder_outbox)")
      .all() as Array<{ name: string }>;
    expect(columns.map(({ name }) => name)).not.toContain("kind");
    expect(columns.map(({ name }) => name)).not.toContain(
      "provider_message_id",
    );
  });
});
