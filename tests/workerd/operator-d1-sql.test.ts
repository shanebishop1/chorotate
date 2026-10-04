import { applyD1Migrations, env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { prepareCurrentSchedule } from "../../app/domain/rotation/prepare";
import { getCurrentAndNext } from "../../app/domain/read-models";
import { createScheduledReminderDispatcher } from "../../app/domain/reminders/scheduled";
import { createCloudflareRuntimeContext } from "../../app/runtime/context";
import { validTestEnvironment } from "../../app/runtime/test-fixtures";
import type { TextbeltSmsInput } from "../../app/domain/reminders/textbelt";

function d1(): D1Database {
  if (env.DB === undefined)
    throw new Error("Workerd D1 test binding is missing");
  return env.DB;
}

async function reset(): Promise<void> {
  const database = d1();
  const existing = await database
    .prepare(
      `SELECT name FROM sqlite_schema
       WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'
       ORDER BY rowid DESC`,
    )
    .all<{ name: string }>();
  if (existing.results.length > 0) {
    await database.exec("PRAGMA foreign_keys = OFF");
    await database.batch(
      existing.results.map(({ name }) =>
        database.prepare(`DROP TABLE "${name.replaceAll('"', '""')}"`),
      ),
    );
    await database.exec("PRAGMA foreign_keys = ON");
  }
  await applyD1Migrations(database, env.TEST_MIGRATIONS);
}

async function assertionTables(): Promise<string[]> {
  const result = await d1()
    .prepare(
      `SELECT name FROM sqlite_schema
       WHERE type = 'table' AND name LIKE 'operator_%_assert'
       ORDER BY name`,
    )
    .all<{ name: string }>();
  return result.results.map(({ name }) => name);
}

async function executeAtomicFile(sql: string): Promise<D1Result<unknown>[]> {
  const database = d1();
  const statements = sql
    .split(";\n")
    .map((statement) => statement.trim())
    .filter(Boolean);
  return database.batch(
    statements.map((statement) => database.prepare(statement)),
  );
}

beforeEach(reset);

describe("generated operator SQL on workerd D1", () => {
  it("adds two chores and uses the existing schedule, read models, audit, and SMS pipeline for all four", async () => {
    await executeAtomicFile(env.TEST_FOUR_MEMBER_BOOTSTRAP_SQL);
    const actor = {
      id: "member-a",
      householdId: "chorotate",
      displayName: "Member A",
    };
    const now = new Date("2026-09-07T13:01:00.000Z");
    await prepareCurrentSchedule(d1(), actor, { now });
    const before = await d1()
      .prepare("SELECT * FROM weekly_assignments ORDER BY id")
      .all();
    await executeAtomicFile(env.TEST_ADD_CHORES_SQL);
    await prepareCurrentSchedule(d1(), actor, { now });
    await prepareCurrentSchedule(d1(), actor, { now });
    expect(
      (
        await d1()
          .prepare(
            "SELECT * FROM weekly_assignments WHERE chore_id IN ('trash','dishwasher') ORDER BY id",
          )
          .all()
      ).results,
    ).toEqual(before.results);
    await expect(
      d1().prepare("SELECT count(*) AS n FROM weekly_assignments").first(),
    ).resolves.toEqual({ n: 212 });
    await expect(
      d1().prepare("SELECT count(*) AS n FROM assignment_audit_events").first(),
    ).resolves.toEqual({ n: 212 });
    const context = {
      database: d1(),
      authorizer: {
        async requireAuthorizedMember() {
          return actor;
        },
      },
    };
    for (const instant of [
      "2026-09-07T13:01:00Z",
      "2026-09-14T13:01:00Z",
      "2026-09-21T13:01:00Z",
      "2026-09-28T13:01:00Z",
    ]) {
      const projection = await getCurrentAndNext(context, {
        request: new Request("https://example.com"),
        now: new Date(instant),
      });
      expect(projection.state).toBe("ready");
      expect(projection.handoffs.map(({ chore }) => chore.name)).toEqual([
        "Dishwasher",
        "Sweep",
        "Trash",
        "Wipe",
      ]);
      expect(
        new Set(projection.handoffs.map(({ current }) => current?.member.id))
          .size,
      ).toBe(4);
      for (const handoff of projection.handoffs) {
        expect(handoff.current).not.toBeNull();
        expect(handoff.next?.member.id).not.toBe(handoff.current?.member.id);
        expect(handoff.chore.instructions).not.toBe("");
      }
    }
    const sent: TextbeltSmsInput[] = [];
    let clock = now;
    const scheduled = createScheduledReminderDispatcher({
      now: () => clock,
      createTransport: () => ({
        async send(input) {
          sent.push(input);
          return {
            success: true as const,
            textId: sent.length,
            quotaRemaining: 100,
          };
        },
      }),
    });
    const runtime = createCloudflareRuntimeContext(
      validTestEnvironment({ DB: d1() }),
      {} as ExecutionContext,
    );
    for (const instant of ["2026-09-07T13:01:00Z", "2026-09-11T13:01:00Z"]) {
      clock = new Date(instant);
      const controller = {
        scheduledTime: clock.valueOf(),
      } as ScheduledController;
      await scheduled(controller, runtime);
      await scheduled(controller, runtime);
    }
    expect(sent).toHaveLength(4);
    expect(sent.map(({ message }) => message).sort()).toEqual([
      "You're on Dishwasher this week- Sep 7 to Sep 13",
      "You're on Sweep this week- Sep 11 to Sep 17",
      "You're on Trash this week- Sep 11 to Sep 17",
      "You're on Wipe this week- Sep 11 to Sep 17",
    ]);
    await expect(executeAtomicFile(env.TEST_ADD_CHORES_SQL)).rejects.toThrow();
    await expect(assertionTables()).resolves.toEqual([]);
    await expect(
      d1().prepare("SELECT count(*) AS n FROM chores").first(),
    ).resolves.toEqual({ n: 4 });
  });

  it("uses transaction-scoped ordinary assertions and remains first-run safe", async () => {
    expect(env.TEST_OPERATOR_BOOTSTRAP_SQL).toContain(
      "CREATE TABLE operator_bootstrap_assert",
    );
    expect(env.TEST_OPERATOR_BOOTSTRAP_SQL).not.toMatch(
      /CREATE TEMP(?:ORARY)? TABLE/i,
    );

    await executeAtomicFile(env.TEST_OPERATOR_BOOTSTRAP_SQL);

    await expect(assertionTables()).resolves.toEqual([]);
    await expect(
      d1().prepare("SELECT count(*) AS count FROM members").first(),
    ).resolves.toEqual({ count: 3 });

    await expect(
      executeAtomicFile(env.TEST_OPERATOR_BOOTSTRAP_SQL),
    ).rejects.toThrow();
    await expect(assertionTables()).resolves.toEqual([]);
    await expect(
      d1()
        .prepare(
          `SELECT
             (SELECT count(*) FROM households) AS households,
             (SELECT count(*) FROM members) AS members,
             (SELECT count(*) FROM allowlisted_identities) AS identities,
             (SELECT count(*) FROM chores) AS chores,
             (SELECT count(*) FROM rotation_configs) AS rotations,
             (SELECT count(*) FROM rotation_config_members) AS rotation_members`,
        )
        .first(),
    ).resolves.toEqual({
      households: 1,
      members: 3,
      identities: 3,
      chores: 2,
      rotations: 2,
      rotation_members: 6,
    });
  });

  it("rolls dynamic-cardinality assertion failures back without persistent schema", async () => {
    await executeAtomicFile(env.TEST_OPERATOR_BOOTSTRAP_SQL);
    await d1()
      .prepare("DELETE FROM allowlisted_identities WHERE member_id = ?")
      .bind("member-b")
      .run();

    await expect(
      executeAtomicFile(env.TEST_OPERATOR_CONTACT_SQL),
    ).rejects.toThrow();

    await expect(assertionTables()).resolves.toEqual([]);
    await expect(
      d1()
        .prepare(
          `SELECT email_normalized,sms_phone_e164
           FROM allowlisted_identities AS identity
           JOIN members AS member
             ON member.household_id = identity.household_id
            AND member.id = identity.member_id
           WHERE identity.member_id = ?`,
        )
        .bind("member-a")
        .first(),
    ).resolves.toEqual({
      email_normalized: "member-a@example.com",
      sms_phone_e164: "+15550000001",
    });
  });
});
