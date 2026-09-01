/// <reference types="node" />

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const migrationFiles = [
  "migrations/0001_domain_schema.sql",
  "migrations/0002_assignment_audit_triggers.sql",
  "migrations/0003_chore_instructions.sql",
  "migrations/0004_better_auth.sql",
  "migrations/0005_reminder_reliability.sql",
  "migrations/0006_assignment_integrity.sql",
];

function migratedDatabase(): DatabaseSync {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  for (const file of migrationFiles) {
    database.exec(readFileSync(resolve(root, file), "utf8"));
  }
  return database;
}

function seed(database: DatabaseSync): void {
  database.exec(`
    INSERT INTO households (id,name,time_zone,week_start,created_at)
      VALUES ('h','Home','UTC',1,'2026-08-31T00:00:00Z');
    INSERT INTO members VALUES ('m1','h','One',1,'2026-08-31T00:00:00Z');
    INSERT INTO members VALUES ('m2','h','Two',1,'2026-08-31T00:00:00Z');
    INSERT INTO chores VALUES ('c1','h','Bins',1,'2026-08-31T00:00:00Z','Take out bins.');
    INSERT INTO chores VALUES ('c2','h','Dishes',1,'2026-08-31T00:00:00Z','Empty dishwasher.');
  `);
}

function insertAssignment(
  database: DatabaseSync,
  id: string,
  chore: string,
): void {
  database
    .prepare(
      `INSERT INTO weekly_assignments
      (id,household_id,local_week_start,chore_id,member_id,version,source,actor_member_id,request_id,operation_id,operation_kind,occurred_at)
      VALUES (?,?,?,?,?,1,'rotation',NULL,?,?, 'materialize',?)`,
    )
    .run(
      id,
      "h",
      "2026-08-31",
      chore,
      "m1",
      `request-${id}`,
      `operation-${id}`,
      "2026-08-31T00:00:00Z",
    );
}

describe("D1 domain schema", () => {
  it("applies the ordered migrations", () => {
    const database = migratedDatabase();
    const tables = database
      .prepare(
        "SELECT count(*) AS count FROM sqlite_schema WHERE type = 'table'",
      )
      .get() as { count: number };
    expect(tables.count).toBe(14);
  });

  it("migrates existing Trash and Dishwasher rows to authoritative instructions", () => {
    const database = new DatabaseSync(":memory:");
    database.exec("PRAGMA foreign_keys = ON");
    for (const file of migrationFiles.slice(0, 2)) {
      database.exec(readFileSync(resolve(root, file), "utf8"));
    }
    database.exec(`
      INSERT INTO households (id,name,time_zone,week_start,created_at)
        VALUES ('h','Home','UTC',1,'2026-08-31T00:00:00Z');
      INSERT INTO chores VALUES ('trash','h','Trash',1,'2026-08-31T00:00:00Z');
      INSERT INTO chores VALUES ('dishwasher','h','Dishwasher',1,'2026-08-31T00:00:00Z');
    `);
    database.exec(readFileSync(resolve(root, migrationFiles[2]), "utf8"));

    expect(
      database
        .prepare("SELECT name,instructions FROM chores ORDER BY name")
        .all(),
    ).toEqual([
      {
        name: "Dishwasher",
        instructions: "Empty the completed dishwasher.",
      },
      {
        name: "Trash",
        instructions: "Take the trash out and replace bags.",
      },
    ]);
  });

  it("enforces normalized active identities and assignment identity/version", () => {
    const database = migratedDatabase();
    seed(database);
    database
      .prepare("INSERT INTO allowlisted_identities VALUES (?,?,?,?,NULL,1,?)")
      .run("i1", "h", "m1", "one@example.com", "now");
    expect(() =>
      database
        .prepare("INSERT INTO allowlisted_identities VALUES (?,?,?,?,NULL,1,?)")
        .run("i2", "h", "m2", "one@example.com", "now"),
    ).toThrow();
    expect(() =>
      database
        .prepare("INSERT INTO allowlisted_identities VALUES (?,?,?,?,NULL,1,?)")
        .run("i3", "h", "m2", " One@Example.com ", "now"),
    ).toThrow();
    insertAssignment(database, "a1", "c1");
    expect(() => insertAssignment(database, "a2", "c1")).toThrow();
    expect(() =>
      database
        .prepare("UPDATE weekly_assignments SET version=3 WHERE id='a1'")
        .run(),
    ).toThrow();
  });

  it("rejects assignment deletion, version-only updates, and invalid audit context", () => {
    const database = migratedDatabase();
    seed(database);
    insertAssignment(database, "a1", "c1");

    expect(() =>
      database.prepare("DELETE FROM weekly_assignments WHERE id='a1'").run(),
    ).toThrow(/cannot be deleted/);
    expect(() =>
      database
        .prepare(
          "UPDATE weekly_assignments SET version=2,source='reassignment',actor_member_id='m1',request_id='version-only',operation_id='version-only',operation_kind='reassign' WHERE id='a1'",
        )
        .run(),
    ).toThrow(/must change assignee/);
    expect(() =>
      database
        .prepare(
          "UPDATE weekly_assignments SET member_id='m2',version=2,source='swap',actor_member_id=NULL,request_id='invalid',operation_id='invalid',operation_kind='materialize' WHERE id='a1'",
        )
        .run(),
    ).toThrow(/invalid assignment audit context/);
    expect(
      database
        .prepare("SELECT count(*) AS count FROM assignment_audit_events")
        .get(),
    ).toEqual({ count: 1 });
  });

  it("appends complete immutable before/after audit rows", () => {
    const database = migratedDatabase();
    seed(database);
    insertAssignment(database, "a1", "c1");
    database
      .prepare(
        `UPDATE weekly_assignments SET member_id=?, version=2, source='reassignment',
      actor_member_id=?, request_id=?, operation_id=?, operation_kind='reassign', occurred_at=? WHERE id=?`,
      )
      .run(
        "m2",
        "m1",
        "request-change",
        "operation-change",
        "2026-08-31T01:00:00Z",
        "a1",
      );
    const rows = database
      .prepare("SELECT * FROM assignment_audit_events ORDER BY after_version")
      .all() as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      before_member_id: null,
      after_member_id: "m1",
      after_version: 1,
    });
    expect(rows[1]).toMatchObject({
      before_member_id: "m1",
      before_version: 1,
      after_member_id: "m2",
      after_version: 2,
      actor_member_id: "m1",
      request_id: "request-change",
      operation_id: "operation-change",
    });
    expect(() =>
      database
        .prepare("UPDATE assignment_audit_events SET request_id='x'")
        .run(),
    ).toThrow(/immutable/);
    expect(() =>
      database.prepare("DELETE FROM assignment_audit_events").run(),
    ).toThrow(/immutable/);
  });

  it("rolls back both assignment and audit legs when a swap leg fails", () => {
    const database = migratedDatabase();
    seed(database);
    insertAssignment(database, "a1", "c1");
    insertAssignment(database, "a2", "c2");
    expect(() =>
      database.exec(`BEGIN;
      UPDATE weekly_assignments SET member_id='m2',version=2,source='swap',actor_member_id='m1',request_id='swap',operation_id='swap-op',operation_kind='swap',occurred_at='now' WHERE id='a1';
      UPDATE weekly_assignments SET member_id='missing',version=2,source='swap',actor_member_id='m1',request_id='swap',operation_id='swap-op',operation_kind='swap',occurred_at='now' WHERE id='a2';
      COMMIT;`),
    ).toThrow();
    if (database.isTransaction) database.exec("ROLLBACK");
    expect(
      database
        .prepare(
          "SELECT group_concat(version) AS versions FROM weekly_assignments ORDER BY id",
        )
        .get(),
    ).toMatchObject({ versions: "1,1" });
    expect(
      database
        .prepare(
          "SELECT count(*) AS count FROM assignment_audit_events WHERE operation_id='swap-op'",
        )
        .get(),
    ).toMatchObject({ count: 0 });
  });

  it("deduplicates logical outbox events and supports expired lease recovery", () => {
    const database = migratedDatabase();
    seed(database);
    insertAssignment(database, "a1", "c1");
    const insert = database.prepare(`INSERT INTO reminder_outbox
      (id,assignment_id,assignment_version,recipient_member_id,kind,status,available_at,created_at)
      VALUES (?,?,?,?,?,'pending',?,?)`);
    insert.run(
      "o1",
      "a1",
      1,
      "m1",
      "assignment",
      "2026-08-31T00:00:00Z",
      "now",
    );
    expect(() =>
      insert.run(
        "o2",
        "a1",
        1,
        "m1",
        "assignment",
        "2026-08-31T00:00:00Z",
        "now",
      ),
    ).toThrow();
    database
      .prepare(
        "UPDATE reminder_outbox SET status='leased',lease_owner=?,lease_expires_at=?,attempt_count=attempt_count+1 WHERE id=?",
      )
      .run("worker-1", "2026-08-31T00:01:00Z", "o1");
    database
      .prepare(
        `UPDATE reminder_outbox SET lease_owner=?,lease_expires_at=?,attempt_count=attempt_count+1
      WHERE id=? AND status='leased' AND lease_expires_at <= ?`,
      )
      .run("worker-2", "2026-08-31T00:03:00Z", "o1", "2026-08-31T00:02:00Z");
    expect(
      database
        .prepare(
          "SELECT lease_owner,attempt_count FROM reminder_outbox WHERE id='o1'",
        )
        .get(),
    ).toMatchObject({ lease_owner: "worker-2", attempt_count: 2 });
    const attempt = database.prepare(`INSERT INTO reminder_delivery_attempts
      (id,outbox_id,attempt_number,attempted_at,outcome,provider_message_id)
      VALUES (?,?,1,?,'accepted',?)`);
    attempt.run("d1", "o1", "2026-08-31T00:02:00Z", "provider-1");
    expect(() =>
      attempt.run("d2", "o1", "2026-08-31T00:03:00Z", "provider-2"),
    ).toThrow();
    expect(() =>
      database
        .prepare(
          "UPDATE reminder_outbox SET status='pending',lease_owner='stale' WHERE id='o1'",
        )
        .run(),
    ).toThrow();
  });

  it("persists bounded household send time and immutable recipient meaning", () => {
    const database = migratedDatabase();
    seed(database);
    insertAssignment(database, "a1", "c1");

    expect(
      database
        .prepare(
          "SELECT reminder_send_local_time FROM households WHERE id = 'h'",
        )
        .get(),
    ).toEqual({ reminder_send_local_time: "09:00" });
    expect(() =>
      database
        .prepare(
          "UPDATE households SET reminder_send_local_time = ? WHERE id = 'h'",
        )
        .run("24:00"),
    ).toThrow();

    database
      .prepare(
        `INSERT INTO reminder_outbox
        (id,assignment_id,assignment_version,recipient_member_id,kind,
         recipient_assigned,status,available_at,created_at)
        VALUES (?,?,?,?,? ,?,'pending',?,?)`,
      )
      .run("correction", "a1", 1, "m2", "correction", 0, "now", "now");
    expect(() =>
      database
        .prepare(
          "UPDATE reminder_outbox SET recipient_assigned = 1 WHERE id = 'correction'",
        )
        .run(),
    ).toThrow(/immutable/);
    expect(() =>
      database
        .prepare(
          `INSERT INTO reminder_outbox
          (id,assignment_id,assignment_version,recipient_member_id,kind,
           recipient_assigned,status,available_at,created_at)
          VALUES ('invalid','a1',1,'m1','assignment',0,'pending','now','now')`,
        )
        .run(),
    ).toThrow();
  });
});
