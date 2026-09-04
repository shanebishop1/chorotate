import { applyD1Migrations, env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

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
