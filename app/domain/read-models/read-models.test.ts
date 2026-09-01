/// <reference types="node" />

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { AuthorizationError, type AuthorizedMember } from "../../auth/access";
import type { D1DatabaseLike, D1StatementLike } from "../storage/d1";
import {
  ReadModelError,
  getActiveMembers,
  getCurrentAndNext,
  getGroupedHistory,
  getHouseholdCalendar,
  getHouseholdList,
  getPersonalAgenda,
  type ReadModelContext,
} from "./index";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const request = new Request("https://app.example.test/schedule");
const signedInMember: AuthorizedMember = {
  id: "m1",
  householdId: "h1",
  displayName: "Alice",
};

function database(): DatabaseSync {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  for (const file of [
    "migrations/0001_domain_schema.sql",
    "migrations/0002_assignment_audit_triggers.sql",
    "migrations/0003_chore_instructions.sql",
    "migrations/0004_better_auth.sql",
    "migrations/0005_reminder_reliability.sql",
    "migrations/0006_assignment_integrity.sql",
    "migrations/0007_sms_contact_period_outbox.sql",
  ]) {
    database.exec(readFileSync(resolve(root, file), "utf8"));
  }
  return database;
}

function d1(database: DatabaseSync): D1DatabaseLike {
  return {
    prepare(sql) {
      const statement = database.prepare(sql);
      let values: SQLInputValue[] = [];
      const wrapped: D1StatementLike = {
        bind(...bound) {
          values = bound as SQLInputValue[];
          return wrapped;
        },
        async run() {
          return statement.run(...values);
        },
        async all<T>() {
          return { results: statement.all(...values) as T[] };
        },
      };
      return wrapped;
    },
    async batch() {
      throw new Error("not used by read models");
    },
  };
}

function context(database: DatabaseSync): ReadModelContext {
  return {
    database: d1(database),
    authorizer: {
      async requireAuthorizedMember() {
        return signedInMember;
      },
    },
  };
}

function insertAssignment(
  database: DatabaseSync,
  id: string,
  periodStart: string,
  choreId: string,
  memberId: string,
): void {
  database
    .prepare(
      `INSERT INTO weekly_assignments
      (id,household_id,local_week_start,chore_id,member_id,version,source,
       actor_member_id,request_id,operation_id,operation_kind,occurred_at)
      VALUES (?,?,?,?,?,1,'rotation',NULL,?,?, 'materialize',?)`,
    )
    .run(
      id,
      "h1",
      periodStart,
      choreId,
      memberId,
      `request-${id}`,
      `materialize-${id}`,
      `${periodStart}T12:00:00Z`,
    );
}

function insertReminder(
  database: DatabaseSync,
  input: {
    id: string;
    assignmentId: string;
    periodStart: string;
    choreId: string;
    memberId: string;
    phase: "evening" | "morning";
    status: "pending" | "accepted" | "failed" | "delivery_unknown";
    correctionNeeded?: boolean;
  },
): void {
  const terminalAt = ["accepted", "failed", "delivery_unknown"].includes(
    input.status,
  )
    ? "2026-08-28T12:00:00Z"
    : null;
  database
    .prepare(
      `INSERT INTO reminder_outbox
       (id,household_id,assignment_id,assignment_version,local_period_start,chore_id,
        recipient_member_id,occurrence_phase,status,available_at,correction_needed,
        created_at,terminal_at)
       VALUES (?,'h1',?,1,?,?,?,?,?,'2026-08-28T10:00:00Z',?,
               '2026-08-28T09:00:00Z',?)`,
    )
    .run(
      input.id,
      input.assignmentId,
      input.periodStart,
      input.choreId,
      input.memberId,
      input.phase,
      input.status,
      input.correctionNeeded ? 1 : 0,
      terminalAt,
    );
}

function seedSchedule(database: DatabaseSync): void {
  database.exec(`
    INSERT INTO households (id,name,time_zone,week_start,created_at)
      VALUES ('h1','Home','America/New_York',1,'2026-08-01T00:00:00Z');
    INSERT INTO households (id,name,time_zone,week_start,created_at)
      VALUES ('h2','Other','UTC',1,'2026-08-01T00:00:00Z');
    INSERT INTO members (id,household_id,display_name,active,created_at,sms_phone_e164,sms_consent_status)
      VALUES ('m1','h1','Alice',1,'2026-08-01T00:00:00Z','+15550000001','consented');
    INSERT INTO members (id,household_id,display_name,active,created_at,sms_consent_status)
      VALUES ('m2','h1','Bob',1,'2026-08-01T00:00:00Z','consented');
    INSERT INTO members (id,household_id,display_name,active,created_at,sms_phone_e164,sms_consent_status,sms_suppression_status)
      VALUES ('m3','h1','Former member',1,'2026-08-01T00:00:00Z','+15550000003','consented','suppressed');
    INSERT INTO members (id,household_id,display_name,active,created_at)
      VALUES ('other','h2','Outsider',1,'2026-08-01T00:00:00Z');
    INSERT INTO chores (id,household_id,name,active,created_at,instructions,ownership_start_weekday)
      VALUES ('trash','h1','Trash',1,'2026-08-01T00:00:00Z','Take the trash out and replace bags.',5);
    INSERT INTO chores (id,household_id,name,active,created_at,instructions,ownership_start_weekday)
      VALUES ('dishes','h1','Dishwasher',1,'2026-08-01T00:00:00Z','Empty the completed dishwasher.',1);
    INSERT INTO chores (id,household_id,name,active,created_at,instructions,ownership_start_weekday)
      VALUES ('secret','h2','Secret',1,'2026-08-01T00:00:00Z','Private instructions.',1);
  `);
  const rows = [
    ["a0", "2026-08-21", "trash", "m3"],
    ["a1", "2026-08-28", "trash", "m1"],
    ["a2", "2026-08-31", "dishes", "m2"],
    ["a3", "2026-09-04", "trash", "m2"],
    ["a4", "2026-09-07", "dishes", "m1"],
    ["a5", "2026-09-11", "trash", "m1"],
    ["a6", "2026-09-14", "dishes", "m2"],
  ] as const;
  for (const row of rows)
    insertAssignment(database, row[0], row[1], row[2], row[3]);
}

describe("authorized schedule read models", () => {
  it("derives Friday Trash and Monday Dishwasher periods independently at one instant", async () => {
    const db = database();
    seedSchedule(db);

    const beforeBoundary = await getCurrentAndNext(context(db), {
      request,
      now: new Date("2026-08-31T03:59:59Z"),
    });
    const atBoundary = await getCurrentAndNext(context(db), {
      request,
      now: new Date("2026-08-31T04:00:00Z"),
    });

    expect(beforeBoundary).not.toHaveProperty("week");
    expect(atBoundary).not.toHaveProperty("week");
    expect(atBoundary).not.toHaveProperty("nextWeek");
    expect(atBoundary.state).toBe("ready");
    expect(atBoundary.handoffs).toEqual([
      expect.objectContaining({
        chore: {
          id: "dishes",
          name: "Dishwasher",
          instructions: "Empty the completed dishwasher.",
          ownershipStartWeekday: 1,
        },
        current: expect.objectContaining({
          assignmentId: "a2",
          period: expect.objectContaining({
            localStartDate: "2026-08-31",
            localEndDateInclusive: "2026-09-06",
          }),
          member: { id: "m2", displayName: "Bob", active: true },
          reminder: {
            contactStatus: "missing_contact",
            correctionNeeded: false,
            occurrences: [],
          },
        }),
        next: expect.objectContaining({
          assignmentId: "a4",
          member: { id: "m1", displayName: "Alice", active: true },
        }),
      }),
      expect.objectContaining({
        chore: {
          id: "trash",
          name: "Trash",
          instructions: "Take the trash out and replace bags.",
          ownershipStartWeekday: 5,
        },
        currentPeriod: expect.objectContaining({
          localStartDate: "2026-08-28",
          localEndDateInclusive: "2026-09-03",
        }),
        nextPeriod: expect.objectContaining({
          localStartDate: "2026-09-04",
          localEndDateInclusive: "2026-09-10",
        }),
        current: expect.objectContaining({ assignmentId: "a1" }),
        next: expect.objectContaining({ assignmentId: "a3" }),
      }),
    ]);

    const mine = await getPersonalAgenda(context(db), {
      request,
      now: new Date("2026-08-31T04:00:00Z"),
      limit: 10,
    });
    expect(mine.items.map(({ assignmentId }) => assignmentId)).toEqual([
      "a1",
      "a4",
      "a5",
    ]);
    expect(mine).not.toHaveProperty("activeWeek");
    expect(mine.items.map(({ period }) => period.localStartDate)).toEqual([
      "2026-08-28",
      "2026-09-07",
      "2026-09-11",
    ]);

    const household = await getHouseholdList(context(db), {
      request,
      now: new Date("2026-08-31T04:00:00Z"),
      fromDate: "2026-08-28",
      toDate: "2026-09-06",
    });
    const calendar = await getHouseholdCalendar(context(db), {
      request,
      now: new Date("2026-08-31T04:00:00Z"),
      fromDate: "2026-08-28",
      toDate: "2026-09-06",
    });
    expect(household.items.map(({ assignmentId }) => assignmentId)).toEqual([
      "a1",
      "a2",
      "a3",
    ]);
    expect(calendar.periods.flatMap(({ assignments }) => assignments)).toEqual(
      household.items,
    );
    expect(await getActiveMembers(context(db), { request })).toEqual([
      { id: "m1", displayName: "Alice", active: true },
      { id: "m2", displayName: "Bob", active: true },
      { id: "m3", displayName: "Former member", active: true },
    ]);
  });

  it("keeps DST-adjacent chore ranges as seven inclusive local dates", async () => {
    const db = database();
    seedSchedule(db);
    insertAssignment(db, "dst-trash-current", "2027-03-12", "trash", "m1");
    insertAssignment(db, "dst-trash-next", "2027-03-19", "trash", "m2");
    insertAssignment(db, "dst-dishes-current", "2027-03-08", "dishes", "m2");
    insertAssignment(db, "dst-dishes-next", "2027-03-15", "dishes", "m1");

    const result = await getCurrentAndNext(context(db), {
      request,
      now: new Date("2027-03-14T16:00:00Z"),
    });

    expect(
      result.handoffs.map(({ chore, currentPeriod, nextPeriod }) => ({
        chore: chore.id,
        currentPeriod,
        nextPeriod,
      })),
    ).toEqual([
      {
        chore: "dishes",
        currentPeriod: {
          householdId: "h1",
          localStartDate: "2027-03-08",
          localEndDateInclusive: "2027-03-14",
        },
        nextPeriod: {
          householdId: "h1",
          localStartDate: "2027-03-15",
          localEndDateInclusive: "2027-03-21",
        },
      },
      {
        chore: "trash",
        currentPeriod: {
          householdId: "h1",
          localStartDate: "2027-03-12",
          localEndDateInclusive: "2027-03-18",
        },
        nextPeriod: {
          householdId: "h1",
          localStartDate: "2027-03-19",
          localEndDateInclusive: "2027-03-25",
        },
      },
    ]);
  });

  it("projects only redacted contact and reminder result evidence", async () => {
    const db = database();
    seedSchedule(db);
    insertReminder(db, {
      id: "reminder-evening",
      assignmentId: "a1",
      periodStart: "2026-08-28",
      choreId: "trash",
      memberId: "m1",
      phase: "evening",
      status: "accepted",
      correctionNeeded: true,
    });
    insertReminder(db, {
      id: "reminder-morning",
      assignmentId: "a1",
      periodStart: "2026-08-28",
      choreId: "trash",
      memberId: "m1",
      phase: "morning",
      status: "delivery_unknown",
    });
    insertReminder(db, {
      id: "reminder-pending",
      assignmentId: "a3",
      periodStart: "2026-09-04",
      choreId: "trash",
      memberId: "m2",
      phase: "evening",
      status: "pending",
    });
    insertReminder(db, {
      id: "reminder-missed",
      assignmentId: "a4",
      periodStart: "2026-09-07",
      choreId: "dishes",
      memberId: "m1",
      phase: "morning",
      status: "failed",
    });
    db.exec(`
      INSERT INTO members
        (id,household_id,display_name,active,created_at,sms_phone_e164)
        VALUES ('m4','h1','No consent',1,'2026-08-01T00:00:00Z','+15550000004');
      INSERT INTO chores
        (id,household_id,name,active,created_at,instructions,ownership_start_weekday)
        VALUES ('yard','h1','Yard',1,'2026-08-01T00:00:00Z','Tidy the yard.',1);
    `);
    insertAssignment(db, "unconsented", "2026-08-31", "yard", "m4");

    const list = await getHouseholdList(context(db), {
      request,
      fromDate: "2026-08-21",
      toDate: "2026-09-07",
      limit: 20,
    });
    const byId = Object.fromEntries(
      list.items.map((assignment) => [assignment.assignmentId, assignment]),
    );

    expect(byId.a1.reminder).toEqual({
      contactStatus: "ready",
      correctionNeeded: true,
      occurrences: [
        { phase: "evening", result: "accepted", correctionNeeded: true },
        {
          phase: "morning",
          result: "delivery_unknown",
          correctionNeeded: false,
        },
      ],
    });
    expect(byId.a2.reminder.contactStatus).toBe("missing_contact");
    expect(byId.a0.reminder.contactStatus).toBe("suppressed");
    expect(byId.unconsented.reminder.contactStatus).toBe("unconsented");
    expect(byId.a3.reminder.occurrences[0].result).toBe("pending");
    expect(byId.a4.reminder.occurrences[0].result).toBe("missed");
    expect(JSON.stringify(list)).not.toContain("+1555");
    expect(JSON.stringify(list)).not.toContain("textbelt");

    const history = await getGroupedHistory(context(db), {
      request,
      kinds: ["materialize"],
    });
    const historical = history.operations
      .flatMap(({ changes }) => changes)
      .find(({ assignmentId }) => assignmentId === "a1");
    expect(historical).toMatchObject({
      period: {
        localStartDate: "2026-08-28",
        localEndDateInclusive: "2026-09-03",
      },
      after: {
        reminder: {
          contactStatus: "ready",
          correctionNeeded: true,
          occurrences: [
            {
              phase: "evening",
              result: "accepted",
              correctionNeeded: true,
            },
            {
              phase: "morning",
              result: "delivery_unknown",
              correctionNeeded: false,
            },
          ],
        },
      },
    });
    expect(JSON.stringify(history)).not.toContain("+1555");

    db.prepare(
      `UPDATE weekly_assignments SET member_id='m2',version=2,source='reassignment',
       actor_member_id='m1',request_id='post-send',operation_id='post-send-op',
       operation_kind='reassign',occurred_at='2026-08-29T12:00:00Z' WHERE id='a1'`,
    ).run();
    const reassigned = await getHouseholdList(context(db), {
      request,
      fromDate: "2026-08-28",
      toDate: "2026-08-28",
    });
    expect(reassigned.items[0]?.reminder).toEqual({
      contactStatus: "missing_contact",
      correctionNeeded: true,
      occurrences: [],
    });
  });

  it("filters chronological household list/calendar without leaking or mutating data", async () => {
    const db = database();
    seedSchedule(db);
    const before = db
      .prepare("SELECT count(*) AS count FROM weekly_assignments")
      .get();

    const list = await getHouseholdList(context(db), {
      request,
      fromDate: "2026-08-28",
      toDate: "2026-09-14",
      memberIds: ["m1"],
      choreIds: ["trash"],
      limit: 10,
    });
    const calendar = await getHouseholdCalendar(context(db), {
      request,
      fromDate: "2026-08-28",
      toDate: "2026-09-14",
      memberIds: ["m1"],
    });

    expect(list.items.map(({ assignmentId }) => assignmentId)).toEqual([
      "a1",
      "a5",
    ]);
    expect(calendar.periods.map(({ period }) => period.localStartDate)).toEqual(
      ["2026-08-28", "2026-09-07", "2026-09-11"],
    );
    expect(
      calendar.periods
        .flatMap(({ assignments }) => assignments)
        .map(({ assignmentId }) => assignmentId),
    ).toEqual(["a1", "a4", "a5"]);
    expect(
      db.prepare("SELECT count(*) AS count FROM weekly_assignments").get(),
    ).toEqual(before);
  });

  it("paginates list results and enforces date, page, and calendar bounds", async () => {
    const db = database();
    seedSchedule(db);
    const first = await getHouseholdList(context(db), {
      request,
      fromDate: "2026-08-28",
      toDate: "2026-09-14",
      limit: 2,
    });
    expect(first.items).toHaveLength(2);
    expect(first.page).toEqual({ limit: 2, offset: 0, nextOffset: 2 });

    await expect(
      getHouseholdList(context(db), {
        request,
        fromDate: "2026-09-14",
        toDate: "2026-08-31",
      }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      getPersonalAgenda(context(db), { request, limit: 101 }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      getHouseholdList(context(db), { request, offset: 10_001 }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      getHouseholdCalendar(context(db), {
        request,
        fromDate: "2026-08-31",
        toDate: "2026-11-24",
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("returns explicit empty and unavailable projection states", async () => {
    const emptyDb = database();
    emptyDb.exec(`
      INSERT INTO households (id,name,time_zone,week_start,created_at)
        VALUES ('h1','Home','UTC',1,'2026-08-01T00:00:00Z');
      INSERT INTO members (id,household_id,display_name,active,created_at)
        VALUES ('m1','h1','Alice',1,'2026-08-01T00:00:00Z');
    `);
    expect(
      await getCurrentAndNext(context(emptyDb), {
        request,
        now: new Date("2026-08-31T12:00:00Z"),
      }),
    ).toMatchObject({ state: "empty", handoffs: [] });

    emptyDb.exec(
      "INSERT INTO chores (id,household_id,name,active,created_at,instructions,ownership_start_weekday) VALUES ('trash','h1','Trash',1,'2026-08-01T00:00:00Z','Take the trash out and replace bags.',5)",
    );
    expect(
      await getCurrentAndNext(context(emptyDb), {
        request,
        now: new Date("2026-08-31T12:00:00Z"),
      }),
    ).toMatchObject({
      state: "unavailable",
      handoffs: [{ current: null, next: null }],
    });
    expect(
      await getPersonalAgenda(context(emptyDb), { request }),
    ).toMatchObject({ state: "empty", items: [] });
    expect(
      await getGroupedHistory(context(emptyDb), { request }),
    ).toMatchObject({ state: "empty", operations: [] });
  });
});

describe("grouped immutable history projection", () => {
  it("groups both swap legs and preserves active/inactive names and local operation time", async () => {
    const db = database();
    seedSchedule(db);
    db.prepare(
      `UPDATE weekly_assignments SET member_id='m3',version=2,source='reassignment',
      actor_member_id='m1',request_id='direct',operation_id='direct-op',operation_kind='reassign',
      occurred_at='2026-08-31T13:00:00Z' WHERE id='a1'`,
    ).run();
    db.prepare(
      `UPDATE weekly_assignments SET member_id='m1',version=2,source='swap',
      actor_member_id='m2',request_id='swap',operation_id='swap-op',operation_kind='swap',
      occurred_at='2026-08-31T14:00:00Z' WHERE id='a2'`,
    ).run();
    db.prepare(
      `UPDATE weekly_assignments SET member_id='m2',version=2,source='swap',
      actor_member_id='m2',request_id='swap',operation_id='swap-op',operation_kind='swap',
      occurred_at='2026-08-31T14:00:00Z' WHERE id='a4'`,
    ).run();
    db.prepare("UPDATE members SET active=0 WHERE id='m3'").run();

    const result = await getGroupedHistory(context(db), {
      request,
      kinds: ["reassign", "swap"],
      limit: 10,
    });
    const swap = result.operations.find(
      ({ operationId }) => operationId === "swap-op",
    );
    const direct = result.operations.find(
      ({ operationId }) => operationId === "direct-op",
    );
    expect(swap).toMatchObject({
      kind: "swap",
      actorType: "member",
      actor: { id: "m2", displayName: "Bob", active: true },
      occurredAt: "2026-08-31T14:00:00Z",
      localOccurredAt: "2026-08-31T10:00:00",
    });
    expect(swap?.changes).toHaveLength(2);
    expect(
      swap?.changes.map(({ period }) => period.localStartDate).sort(),
    ).toEqual(["2026-08-31", "2026-09-07"]);
    expect(
      swap?.changes.map(({ assignmentId }) => assignmentId).sort(),
    ).toEqual(["a2", "a4"]);
    expect(direct?.changes[0].after.member).toEqual({
      id: "m3",
      displayName: "Former member",
      active: false,
    });

    const choreFiltered = await getGroupedHistory(context(db), {
      request,
      kinds: ["swap"],
      choreIds: ["dishes"],
    });
    expect(choreFiltered.operations[0].changes).toHaveLength(2);

    const timeFiltered = await getGroupedHistory(context(db), {
      request,
      kinds: ["reassign", "swap"],
      fromOccurredAt: "2026-08-31T14:00:00Z",
    });
    expect(
      timeFiltered.operations.map(({ operationId }) => operationId),
    ).toEqual(["swap-op"]);

    const firstPage = await getGroupedHistory(context(db), {
      request,
      kinds: ["reassign", "swap"],
      limit: 1,
    });
    expect(firstPage.operations).toHaveLength(1);
    expect(firstPage.page).toEqual({ limit: 1, offset: 0, nextOffset: 1 });
  });
});

describe("read model authorization boundary", () => {
  it("authorizes every projection locally and fails closed on denial or D1 failure", async () => {
    const db = database();
    seedSchedule(db);
    const denied: ReadModelContext = {
      database: d1(db),
      authorizer: {
        async requireAuthorizedMember() {
          throw new AuthorizationError(403);
        },
      },
    };
    const deniedReads = [
      () => getCurrentAndNext(denied, { request }),
      () => getPersonalAgenda(denied, { request }),
      () => getHouseholdList(denied, { request }),
      () => getHouseholdCalendar(denied, { request }),
      () => getGroupedHistory(denied, { request }),
      () => getActiveMembers(denied, { request }),
    ];
    for (const read of deniedReads)
      await expect(read()).rejects.toMatchObject({ status: 403 });

    const failed: ReadModelContext = {
      database: {
        prepare() {
          throw new Error("D1 secret failure");
        },
        async batch() {
          throw new Error("not used");
        },
      },
      authorizer: context(db).authorizer,
    };
    const failedReads = [
      () => getCurrentAndNext(failed, { request }),
      () => getPersonalAgenda(failed, { request }),
      () => getHouseholdList(failed, { request }),
      () => getHouseholdCalendar(failed, { request }),
      () => getGroupedHistory(failed, { request }),
      () => getActiveMembers(failed, { request }),
    ];
    for (const read of failedReads) {
      await expect(read()).rejects.toEqual(
        expect.objectContaining({
          name: "ReadModelError",
          status: 503,
          message: expect.not.stringContaining("secret"),
        }),
      );
      await expect(read()).rejects.toBeInstanceOf(ReadModelError);
    }
  });
});
