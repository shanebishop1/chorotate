/// <reference types="node" />

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  DatabaseSync,
  type SQLInputValue,
  type StatementSync,
} from "node:sqlite";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import type { AuthorizedMember } from "../../auth/access";
import {
  createAssignmentCommandService,
  type AssignmentCommandContext,
} from "./assignment-commands";
import { swapAssignments } from "./assignment-persistence";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const migrations = [
  "migrations/0001_domain_schema.sql",
  "migrations/0002_assignment_audit_triggers.sql",
  "migrations/0003_chore_instructions.sql",
  "migrations/0004_better_auth.sql",
  "migrations/0005_reminder_reliability.sql",
  "migrations/0006_assignment_integrity.sql",
  "migrations/0007_sms_contact_period_outbox.sql",
  "migrations/0009_schedule_transitions.sql",
];

class LocalStatement {
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
    return this.runSync();
  }

  async all<T>(): Promise<LocalResult<T>> {
    return this.allSync<T>();
  }

  runSync(): LocalResult {
    const statement = this.statement();
    const values = this.sqliteValues();
    const result = this.usesNumberedParameters()
      ? statement.run(this.numberedValues(values))
      : statement.run(...values);
    return {
      success: true,
      results: [],
      meta: { changes: Number(result.changes) },
    };
  }

  allSync<T>(): LocalResult<T> {
    const statement = this.statement();
    const values = this.sqliteValues();
    return {
      success: true,
      results: (this.usesNumberedParameters()
        ? statement.all(this.numberedValues(values))
        : statement.all(...values)) as T[],
      meta: { changes: 0 },
    };
  }

  private statement(): StatementSync {
    return this.database.prepare(this.sql);
  }

  private usesNumberedParameters(): boolean {
    return /\?\d+/.test(this.sql);
  }

  private numberedValues(
    values: SQLInputValue[],
  ): Record<string, SQLInputValue> {
    return Object.fromEntries(
      values.map((value, index) => [String(index + 1), value]),
    );
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

interface LocalResult<T = unknown> {
  success: true;
  results: T[];
  meta: { changes: number };
}

class LocalD1 {
  constructor(readonly database: DatabaseSync) {}

  prepare(sql: string): LocalStatement {
    return new LocalStatement(this.database, sql);
  }

  async batch(statements: LocalStatement[]): Promise<LocalResult[]> {
    this.database.exec("BEGIN");
    try {
      const results = statements.map((statement) => statement.runSync());
      this.database.exec("COMMIT");
      return results;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  withSession(): LocalD1 {
    return this;
  }
}

const actor: AuthorizedMember = {
  id: "m1",
  householdId: "h",
  displayName: "One",
};

const context: AssignmentCommandContext = {
  actor,
  timeZone: "America/New_York",
  occurredAt: "2026-08-31T12:00:00.000Z",
};

function createDatabase(): LocalD1 {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  for (const migration of migrations) {
    database.exec(readFileSync(resolve(root, migration), "utf8"));
  }
  database.exec(`
    INSERT INTO households (id,name,time_zone,week_start,created_at)
      VALUES ('h','Home','America/New_York',1,'2026-08-01T00:00:00Z');
    INSERT INTO households (id,name,time_zone,week_start,created_at)
      VALUES ('other','Other','UTC',1,'2026-08-01T00:00:00Z');
    INSERT INTO members (id,household_id,display_name,active,created_at) VALUES
      ('m1','h','One',1,'2026-08-01T00:00:00Z'),
      ('m2','h','Two',1,'2026-08-01T00:00:00Z'),
      ('m3','h','Three',1,'2026-08-01T00:00:00Z'),
      ('inactive','h','Inactive',0,'2026-08-01T00:00:00Z'),
      ('outsider','other','Outsider',1,'2026-08-01T00:00:00Z');
    INSERT INTO chores
      (id,household_id,name,active,created_at,instructions,ownership_start_weekday)
      VALUES
      ('c1','h','Trash',1,'2026-08-01T00:00:00Z','Take out bins.',5),
      ('c2','h','Dishwasher',1,'2026-08-01T00:00:00Z','Empty dishwasher.',1);
  `);
  insertAssignment(database, "a1", "c1", "m1", "2026-08-28");
  insertAssignment(database, "a2", "c2", "m2", "2026-08-31");
  return new LocalD1(database);
}

function insertAssignment(
  database: DatabaseSync,
  id: string,
  choreId: string,
  memberId: string,
  week: string,
): void {
  database
    .prepare(
      `INSERT INTO weekly_assignments
      (id, household_id, local_week_start, chore_id, member_id, version, source,
       actor_member_id, request_id, operation_id, operation_kind, occurred_at)
      VALUES (?, 'h', ?, ?, ?, 1, 'rotation', NULL, ?, ?, 'materialize', ?)`,
    )
    .run(
      id,
      week,
      choreId,
      memberId,
      `materialize-${id}`,
      `materialize-op-${id}`,
      "2026-08-01T00:00:00Z",
    );
}

function assignment(database: LocalD1, id: string): Record<string, unknown> {
  return database.database
    .prepare("SELECT * FROM weekly_assignments WHERE id = ?")
    .get(id) as Record<string, unknown>;
}

function audits(
  database: LocalD1,
  operationId: string,
): Array<Record<string, unknown>> {
  return database.database
    .prepare(
      "SELECT * FROM assignment_audit_events WHERE operation_id = ? ORDER BY assignment_id",
    )
    .all(operationId) as Array<Record<string, unknown>>;
}

describe("assignment command service", () => {
  let database: LocalD1;

  beforeEach(() => {
    database = createDatabase();
  });

  it("directly reassigns with trusted actor and request audit context", async () => {
    const service = createAssignmentCommandService(database);
    const result = await service.reassign(
      {
        assignmentId: "a1",
        recipientMemberId: "m3",
        expectedVersion: 1,
        requestId: "request-reassign",
        operationId: "operation-reassign",
      },
      context,
    );

    expect(result).toEqual({
      status: "success",
      replayed: false,
      assignments: [{ assignmentId: "a1", memberId: "m3", version: 2 }],
    });
    expect(assignment(database, "a1")).toMatchObject({
      member_id: "m3",
      version: 2,
      source: "reassignment",
      actor_member_id: "m1",
      request_id: "request-reassign",
      operation_id: "operation-reassign",
      occurred_at: context.occurredAt,
    });
    expect(audits(database, "operation-reassign")).toEqual([
      expect.objectContaining({
        assignment_id: "a1",
        actor_member_id: "m1",
        request_id: "request-reassign",
        before_member_id: "m1",
        before_version: 1,
        after_member_id: "m3",
        after_version: 2,
        local_period_start: "2026-08-28",
      }),
    ]);
  });

  it("atomically swaps both legs under one operation group", async () => {
    insertAssignment(
      database.database,
      "future-trash",
      "c1",
      "m2",
      "2026-09-04",
    );
    const result = await createAssignmentCommandService(database).swap(
      {
        first: { assignmentId: "a1", expectedVersion: 1 },
        second: { assignmentId: "future-trash", expectedVersion: 1 },
        requestId: "request-swap",
        operationId: "operation-swap",
      },
      context,
    );

    expect(result).toEqual({
      status: "success",
      replayed: false,
      assignments: [
        { assignmentId: "a1", memberId: "m2", version: 2 },
        { assignmentId: "future-trash", memberId: "m1", version: 2 },
      ],
    });
    expect(audits(database, "operation-swap")).toEqual([
      expect.objectContaining({
        assignment_id: "a1",
        actor_member_id: "m1",
        request_id: "request-swap",
        operation_id: "operation-swap",
        before_member_id: "m1",
        after_member_id: "m2",
        local_period_start: "2026-08-28",
      }),
      expect.objectContaining({
        assignment_id: "future-trash",
        actor_member_id: "m1",
        request_id: "request-swap",
        operation_id: "operation-swap",
        before_member_id: "m2",
        after_member_id: "m1",
        local_period_start: "2026-09-04",
      }),
    ]);
  });

  it.each([false, true])(
    "rejects cross-chore swaps without moving either leg (reversed: %s)",
    async (reversed) => {
      const legs = [
        { assignmentId: "a1", expectedVersion: 1 },
        { assignmentId: "a2", expectedVersion: 1 },
      ];
      if (reversed) legs.reverse();
      await expect(
        createAssignmentCommandService(database).swap(
          {
            first: legs[0],
            second: legs[1],
            requestId: "mismatch",
            operationId: "mismatch",
          },
          context,
        ),
      ).resolves.toEqual({ status: "rejected", reason: "chore_mismatch" });
      expect(assignment(database, "a1")).toMatchObject({
        member_id: "m1",
        version: 1,
      });
      expect(assignment(database, "a2")).toMatchObject({
        member_id: "m2",
        version: 1,
      });
      expect(audits(database, "mismatch")).toHaveLength(0);
    },
  );

  it.each([false, true])(
    "allows a balanced household to trade current and future Trash turns (reversed: %s)",
    async (reversed) => {
      database.database.exec(
        "UPDATE households SET balanced_rotation_from = '2026-08-28' WHERE id = 'h'",
      );
      insertAssignment(
        database.database,
        "busy-current",
        "c2",
        "m2",
        "2026-08-28",
      );
      insertAssignment(
        database.database,
        "future-trash",
        "c1",
        "m2",
        "2026-09-04",
      );
      insertAssignment(
        database.database,
        "busy-future",
        "c2",
        "m1",
        "2026-09-04",
      );
      const legs = [
        { assignmentId: "a1", expectedVersion: 1 },
        { assignmentId: "future-trash", expectedVersion: 1 },
      ];
      if (reversed) legs.reverse();
      const command = {
        first: legs[0],
        second: legs[1],
        requestId: "request-trash-trade",
        operationId: "operation-trash-trade",
      };
      const service = createAssignmentCommandService(database);

      await expect(service.swap(command, context)).resolves.toMatchObject({
        status: "success",
        replayed: false,
      });
      expect(assignment(database, "a1")).toMatchObject({
        member_id: "m2",
        version: 2,
      });
      expect(assignment(database, "future-trash")).toMatchObject({
        member_id: "m1",
        version: 2,
      });
      expect(assignment(database, "busy-current")).toMatchObject({
        member_id: "m2",
        version: 1,
      });
      expect(assignment(database, "busy-future")).toMatchObject({
        member_id: "m1",
        version: 1,
      });
      expect(audits(database, command.operationId)).toHaveLength(2);
      await expect(service.swap(command, context)).resolves.toMatchObject({
        status: "success",
        replayed: true,
      });
      expect(audits(database, command.operationId)).toHaveLength(2);
      await expect(
        service.swap(
          { ...command, requestId: "stale-trade", operationId: "stale-trade" },
          context,
        ),
      ).resolves.toMatchObject({ status: "conflict" });
      expect(audits(database, "stale-trade")).toHaveLength(0);
    },
  );

  it("also blocks cross-chore trades in the atomic persistence statement", async () => {
    await expect(
      swapAssignments(database, {
        actorMemberId: "m1",
        householdId: "h",
        firstMemberId: "m1",
        secondMemberId: "m2",
        firstAssignmentId: "a1",
        firstExpectedVersion: 1,
        firstLocalPeriodStart: "2026-08-28",
        firstOwnershipStartWeekday: 5,
        secondAssignmentId: "a2",
        secondExpectedVersion: 1,
        secondLocalPeriodStart: "2026-08-31",
        secondOwnershipStartWeekday: 1,
        timeZone: context.timeZone,
        requestId: "storage-mismatch",
        operationId: "storage-mismatch",
        occurredAt: context.occurredAt,
      }),
    ).resolves.toBe(0);
    expect(assignment(database, "a1")).toMatchObject({
      member_id: "m1",
      version: 1,
    });
    expect(assignment(database, "a2")).toMatchObject({
      member_id: "m2",
      version: 1,
    });
    expect(audits(database, "storage-mismatch")).toHaveLength(0);
  });

  it("rejects a swap involving an inactive owner without changing either turn", async () => {
    database.database.exec("UPDATE members SET active = 0 WHERE id = 'm2'");
    await expect(
      createAssignmentCommandService(database).swap(
        {
          first: { assignmentId: "a1", expectedVersion: 1 },
          second: { assignmentId: "a2", expectedVersion: 1 },
          requestId: "inactive-swap",
          operationId: "inactive-swap",
        },
        context,
      ),
    ).resolves.toEqual({ status: "rejected", reason: "recipient_ineligible" });
    expect(assignment(database, "a1")).toMatchObject({
      member_id: "m1",
      version: 1,
    });
    expect(assignment(database, "a2")).toMatchObject({
      member_id: "m2",
      version: 1,
    });
    expect(audits(database, "inactive-swap")).toHaveLength(0);
  });

  it.each([
    ["missing trusted actor", { ...context, actor: null }],
    [
      "inactive trusted actor",
      {
        ...context,
        actor: { id: "inactive", householdId: "h", displayName: "Inactive" },
      },
    ],
    [
      "actor from another household",
      {
        ...context,
        actor: {
          id: "outsider",
          householdId: "other",
          displayName: "Outsider",
        },
      },
    ],
  ])("rejects %s without writing", async (_name, unauthorizedContext) => {
    const result = await createAssignmentCommandService(database).reassign(
      {
        assignmentId: "a1",
        recipientMemberId: "m2",
        expectedVersion: 1,
        requestId: "unauthorized",
        operationId: "unauthorized-op",
      },
      unauthorizedContext,
    );

    expect(result).toEqual({ status: "unauthorized" });
    expect(assignment(database, "a1")).toMatchObject({ version: 1 });
    expect(audits(database, "unauthorized-op")).toHaveLength(0);
  });

  it.each([
    ["Trash Friday boundary", "a1", "2026-09-04T04:00:00.000Z"],
    ["Dishwasher Monday boundary", "a2", "2026-09-07T04:00:00.000Z"],
  ])(
    "rejects ended %s independently",
    async (_name, assignmentId, occurredAt) => {
      const service = createAssignmentCommandService(database);

      await expect(
        service.reassign(
          {
            assignmentId,
            recipientMemberId: "m3",
            expectedVersion: 1,
            requestId: `past-${assignmentId}`,
            operationId: `past-op-${assignmentId}`,
          },
          { ...context, occurredAt },
        ),
      ).resolves.toEqual({ status: "rejected", reason: "past_assignment" });
      expect(assignment(database, assignmentId)).toMatchObject({ version: 1 });
      expect(audits(database, `past-op-${assignmentId}`)).toHaveLength(0);
    },
  );

  it("accepts a current chore period immediately before its own boundary", async () => {
    await expect(
      createAssignmentCommandService(database).reassign(
        {
          assignmentId: "a1",
          recipientMemberId: "m3",
          expectedVersion: 1,
          requestId: "trash-before-boundary",
          operationId: "trash-before-boundary-op",
        },
        { ...context, occurredAt: "2026-09-04T03:59:59.999Z" },
      ),
    ).resolves.toMatchObject({ status: "success" });
  });

  it("keeps a future chore-specific period editable", async () => {
    insertAssignment(
      database.database,
      "future-trash",
      "c1",
      "m1",
      "2026-09-04",
    );

    await expect(
      createAssignmentCommandService(database).reassign(
        {
          assignmentId: "future-trash",
          recipientMemberId: "m3",
          expectedVersion: 1,
          requestId: "future-trash",
          operationId: "future-trash-op",
        },
        context,
      ),
    ).resolves.toMatchObject({ status: "success" });
    expect(audits(database, "future-trash-op")[0]).toMatchObject({
      local_period_start: "2026-09-04",
    });
  });

  it("rejects a cross-chore swap when Trash has ended but Dishwasher has not", async () => {
    const result = await createAssignmentCommandService(database).swap(
      {
        first: { assignmentId: "a1", expectedVersion: 1 },
        second: { assignmentId: "a2", expectedVersion: 1 },
        requestId: "mixed-boundary-swap",
        operationId: "mixed-boundary-swap-op",
      },
      { ...context, occurredAt: "2026-09-04T04:00:00.000Z" },
    );

    expect(result).toEqual({ status: "rejected", reason: "past_assignment" });
    expect(assignment(database, "a1")).toMatchObject({
      member_id: "m1",
      version: 1,
    });
    expect(assignment(database, "a2")).toMatchObject({
      member_id: "m2",
      version: 1,
    });
    expect(audits(database, "mixed-boundary-swap-op")).toHaveLength(0);
  });

  it("rejects an inactive recipient without writing", async () => {
    await expect(
      createAssignmentCommandService(database).reassign(
        {
          assignmentId: "a1",
          recipientMemberId: "inactive",
          expectedVersion: 1,
          requestId: "inactive-recipient",
          operationId: "inactive-recipient-op",
        },
        context,
      ),
    ).resolves.toEqual({
      status: "rejected",
      reason: "recipient_ineligible",
    });
    expect(assignment(database, "a1")).toMatchObject({ version: 1 });
  });

  it("rejects direct and swap no-ops without false audit", async () => {
    database.database
      .prepare(
        `UPDATE weekly_assignments
         SET member_id = 'm1', version = 2, source = 'reassignment',
             actor_member_id = 'm1', request_id = 'setup-noop',
             operation_id = 'setup-noop', operation_kind = 'reassign',
             occurred_at = '2026-08-31T11:00:00Z'
         WHERE id = 'a2'`,
      )
      .run();
    const service = createAssignmentCommandService(database);

    await expect(
      service.reassign(
        {
          assignmentId: "a1",
          recipientMemberId: "m1",
          expectedVersion: 1,
          requestId: "noop",
          operationId: "noop-op",
        },
        context,
      ),
    ).resolves.toEqual({ status: "rejected", reason: "no_op" });
    await expect(
      service.swap(
        {
          first: { assignmentId: "a1", expectedVersion: 1 },
          second: { assignmentId: "a2", expectedVersion: 2 },
          requestId: "noop-swap",
          operationId: "noop-swap-op",
        },
        context,
      ),
    ).resolves.toEqual({ status: "rejected", reason: "no_op" });
    expect(audits(database, "noop-op")).toHaveLength(0);
    expect(audits(database, "noop-swap-op")).toHaveLength(0);
  });

  it("maps a stale expected version to safe current assignment values", async () => {
    const result = await createAssignmentCommandService(database).reassign(
      {
        assignmentId: "a1",
        recipientMemberId: "m3",
        expectedVersion: 7,
        requestId: "stale",
        operationId: "stale-op",
      },
      context,
    );

    expect(result).toEqual({
      status: "conflict",
      current: [{ assignmentId: "a1", memberId: "m1", version: 1 }],
    });
    expect(audits(database, "stale-op")).toHaveLength(0);
  });

  it("treats an exact retry as a replay without another version or audit", async () => {
    const command = {
      assignmentId: "a1",
      recipientMemberId: "m3",
      expectedVersion: 1,
      requestId: "retry",
      operationId: "retry-op",
    };
    const service = createAssignmentCommandService(database);

    await expect(service.reassign(command, context)).resolves.toMatchObject({
      status: "success",
      replayed: false,
    });
    await expect(service.reassign(command, context)).resolves.toEqual({
      status: "success",
      replayed: true,
      assignments: [{ assignmentId: "a1", memberId: "m3", version: 2 }],
    });
    expect(assignment(database, "a1")).toMatchObject({ version: 2 });
    expect(audits(database, "retry-op")).toHaveLength(1);
  });

  it("rejects assignment deletion at the storage boundary", () => {
    expect(() =>
      database.database
        .prepare("DELETE FROM weekly_assignments WHERE id = 'a1'")
        .run(),
    ).toThrow(/cannot be deleted/);
  });

  it("rolls back both swap legs and trigger audits when either trigger fails", async () => {
    insertAssignment(
      database.database,
      "future-trash",
      "c1",
      "m2",
      "2026-09-04",
    );
    database.database.exec(`CREATE TRIGGER fail_second_swap
      BEFORE UPDATE ON weekly_assignments WHEN OLD.id = 'future-trash'
      BEGIN SELECT RAISE(ABORT, 'private database detail'); END;`);
    const reported: string[] = [];
    const service = createAssignmentCommandService(database, {
      reportError: (message) => reported.push(message),
    });

    const result = await service.swap(
      {
        first: { assignmentId: "a1", expectedVersion: 1 },
        second: { assignmentId: "future-trash", expectedVersion: 1 },
        requestId: "rollback",
        operationId: "rollback-op",
      },
      context,
    );

    expect(result).toEqual({ status: "error" });
    expect(assignment(database, "a1")).toMatchObject({
      member_id: "m1",
      version: 1,
    });
    expect(assignment(database, "future-trash")).toMatchObject({
      member_id: "m2",
      version: 1,
    });
    expect(audits(database, "rollback-op")).toHaveLength(0);
    expect(reported).toEqual(["Assignment command failed"]);
  });
});
