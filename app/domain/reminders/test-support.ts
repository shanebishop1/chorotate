/// <reference types="node" />

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  DatabaseSync,
  type SQLInputValue,
  type StatementSync,
} from "node:sqlite";
import { fileURLToPath } from "node:url";

import type { D1DatabaseLike, D1StatementLike } from "../storage/d1";

interface LocalResult<T = unknown> {
  results: T[];
  success: true;
  meta: { changes: number };
}

export class LocalStatement implements D1StatementLike {
  private values: unknown[] = [];

  constructor(
    private readonly database: DatabaseSync,
    private readonly sql: string,
  ) {}

  bind(...values: unknown[]): LocalStatement {
    this.values = values;
    return this;
  }

  async run(): Promise<LocalResult> {
    const result = this.statement().run(...this.sqliteValues());
    return {
      success: true,
      results: [],
      meta: { changes: Number(result.changes) },
    };
  }

  async all<T>(): Promise<LocalResult<T>> {
    return {
      success: true,
      results: this.statement().all(...this.sqliteValues()) as T[],
      meta: { changes: 0 },
    };
  }

  private statement(): StatementSync {
    return this.database.prepare(this.sql);
  }

  private sqliteValues(): SQLInputValue[] {
    return this.values.map((value) => {
      if (
        value === null ||
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "bigint"
      ) {
        return value;
      }
      throw new TypeError("Unsupported local D1 binding");
    });
  }
}

export class LocalD1 implements D1DatabaseLike {
  constructor(readonly database: DatabaseSync) {}

  prepare(sql: string): LocalStatement {
    return new LocalStatement(this.database, sql);
  }

  async batch(statements: LocalStatement[]): Promise<LocalResult[]> {
    this.database.exec("BEGIN");
    try {
      const results: LocalResult[] = [];
      for (const statement of statements) results.push(await statement.run());
      this.database.exec("COMMIT");
      return results;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

export function reminderDatabase(timeZone = "America/New_York"): LocalD1 {
  const database = new DatabaseSync(":memory:");
  const localDatabase = new LocalD1(database);
  database.exec("PRAGMA foreign_keys = ON");
  for (const file of [
    "migrations/0001_domain_schema.sql",
    "migrations/0002_assignment_audit_triggers.sql",
    "migrations/0003_chore_instructions.sql",
    "migrations/0004_better_auth.sql",
    "migrations/0005_reminder_reliability.sql",
    "migrations/0006_assignment_integrity.sql",
    "migrations/0007_sms_contact_period_outbox.sql",
    "migrations/0008_sms_occurrence_times.sql",
  ]) {
    database.exec(readFileSync(resolve(root, file), "utf8"));
  }
  database
    .prepare(
      `INSERT INTO households
       (id, name, time_zone, week_start, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run("h", "Home", timeZone, 1, "2026-01-01T00:00:00.000Z");
  for (const [id, name, email] of [
    ["m1", "Alice", "alice@example.test"],
    ["m2", "Bob", "bob@example.test"],
    ["m3", "Cara", "cara@example.test"],
  ]) {
    database
      .prepare(
        `INSERT INTO members
         (id,household_id,display_name,active,created_at,sms_phone_e164,
          sms_consent_status,sms_suppression_status,sms_contact_updated_at)
         VALUES (?, 'h', ?, 1, ?, ?, 'consented', 'not_suppressed', ?)`,
      )
      .run(
        id,
        name,
        "2026-01-01T00:00:00.000Z",
        `+1555555010${id.slice(1)}`,
        "2026-01-01T00:00:00.000Z",
      );
    database
      .prepare(
        "INSERT INTO allowlisted_identities VALUES (?, 'h', ?, ?, NULL, 1, ?)",
      )
      .run(`identity-${id}`, id, email, "2026-01-01T00:00:00.000Z");
  }
  insertChore(localDatabase, "dishwasher", "Dishwasher", 1);
  insertChore(localDatabase, "trash", "Trash", 5);
  return localDatabase;
}

export function insertChore(
  database: LocalD1,
  id: string,
  name: string,
  ownershipStartWeekday: number,
): void {
  database.database
    .prepare(
      `INSERT INTO chores
       (id,household_id,name,active,created_at,instructions,
        ownership_start_weekday)
       VALUES (?, 'h', ?, 1, ?, ?, ?)`,
    )
    .run(
      id,
      name,
      "2026-01-01T00:00:00.000Z",
      `Complete ${name}.`,
      ownershipStartWeekday,
    );
}

export function insertAssignment(
  database: LocalD1,
  id: string,
  periodStart: string,
  memberId: string,
  choreId = "dishwasher",
): void {
  database.database
    .prepare(
      `INSERT INTO weekly_assignments
      (id, household_id, local_week_start, chore_id, member_id, version, source,
       actor_member_id, request_id, operation_id, operation_kind, occurred_at)
       VALUES (?, 'h', ?, ?, ?, 1, 'rotation', NULL, ?, ?, 'materialize', ?)`,
    )
    .run(
      id,
      periodStart,
      choreId,
      memberId,
      `request-${id}`,
      `operation-${id}`,
      "2026-01-01T00:00:00.000Z",
    );
}

export function reassign(
  database: LocalD1,
  assignmentId: string,
  memberId: string,
  version: number,
): void {
  database.database
    .prepare(
      `UPDATE weekly_assignments
      SET member_id = ?, version = ?, source = 'reassignment', actor_member_id = 'm1',
          request_id = ?, operation_id = ?, operation_kind = 'reassign', occurred_at = ?
      WHERE id = ?`,
    )
    .run(
      memberId,
      version,
      `request-v${version}`,
      `operation-v${version}`,
      "2026-01-02T00:00:00.000Z",
      assignmentId,
    );
}

export function outboxRows(database: LocalD1): Array<Record<string, unknown>> {
  return database.database
    .prepare("SELECT * FROM reminder_outbox ORDER BY id")
    .all() as Array<Record<string, unknown>>;
}
