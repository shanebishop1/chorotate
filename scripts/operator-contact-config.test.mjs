import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  buildBootstrapSql,
  buildContactSql,
  summarizeContactReadiness,
  validateContactInput,
} from "./operator-contact-config.mjs";
import {
  buildProductionD1VerificationQuery,
  expectedProductionD1Result,
} from "./production-d1-contract.mjs";

const validInput = {
  householdId: "chorotate",
  recordedAt: "2026-09-01T00:00:00.000Z",
  members: ["member-a", "member-b", "member-c", "member-d"].map((id, index) => ({
    id,
    email: `${id}@example.com`,
    phoneE164: `+1555000000${index}`,
    consent: "consented",
    suppression: "not_suppressed",
  })),
};

test("validates the exact production member and contact contract", () => {
  assert.deepEqual(validateContactInput(validInput), validInput);

  for (const patch of [
    { phoneE164: null },
    { consent: "not_recorded" },
    { suppression: "suppressed" },
  ]) {
    const input = structuredClone(validInput);
    Object.assign(input.members[0], patch);
    const validated = validateContactInput(input);
    assert.equal(summarizeContactReadiness(validated).sendable, 3);
  }

  const malformed = structuredClone(validInput);
  malformed.members[0].phoneE164 = "+0123";
  assert.throws(() => validateContactInput(malformed));
});

test("rejects unsafe identity and malformed contact configuration without values", () => {
  /** @type {Array<(input: typeof validInput) => void>} */
  const mutations = [
    (input) => input.members.pop(),
    (input) => (input.members[0].email = "Upper@Example.com"),
    (input) => (input.members[0].email = input.members[1].email),
    (input) => (input.members[0].phoneE164 = "555-0000"),
    (input) => (input.members[0].consent = "yes"),
    (input) => (input.members[0].suppression = "no"),
  ];
  for (const mutate of mutations) {
    const input = structuredClone(validInput);
    mutate(input);
    assert.throws(
      () => validateContactInput(input),
      (error) => {
        if (!(error instanceof Error)) return false;
        assert.match(error.message, /^Invalid operator contact input:/);
        assert.ok(!error.message.includes("@example.com"));
        assert.ok(!error.message.includes("+1555"));
        return true;
      },
    );
  }
});

test("generates private D1-only updates with row-count assertions", () => {
  const sql = buildContactSql(validateContactInput(validInput));

  assert.match(sql, /UPDATE allowlisted_identities/);
  assert.match(sql, /UPDATE members/);
  assert.match(sql, /CHECK \(matched_rows = 4\)/);
  assert.doesNotMatch(sql, /SELECT .*email_normalized/i);
  assert.doesNotMatch(sql, /SELECT .*sms_phone_e164/i);
});

test("bootstraps a fresh migrated D1 database exactly once", () => {
  const sql = buildBootstrapSql(validateContactInput(validInput), {
    timeZone: "America/New_York",
    weekStart: "monday",
    eveningTime: "20:00",
    morningTime: "08:00",
  });
  const database = new DatabaseSync(":memory:");
  for (const migration of readdirSync(resolve("migrations")).sort()) {
    database.exec(readFileSync(resolve("migrations", migration), "utf8"));
  }

  database.exec(sql);
  const household = database
    .prepare(
      `SELECT time_zone,week_start,reminder_evening_local_time,
              reminder_morning_local_time
       FROM households WHERE id = 'chorotate'`,
    )
    .get();
  assert.deepEqual(
    { ...household },
    {
      time_zone: "America/New_York",
      week_start: 1,
      reminder_evening_local_time: "20:00",
      reminder_morning_local_time: "08:00",
    },
  );
  const counts = database
    .prepare(
      `SELECT
         (SELECT count(*) FROM members) AS members,
         (SELECT count(*) FROM allowlisted_identities) AS identities,
         (SELECT count(*) FROM chores) AS chores,
         (SELECT count(*) FROM rotation_configs) AS rotations,
         (SELECT count(*) FROM rotation_config_members) AS rotation_members`,
    )
    .get();
  assert.deepEqual(
    { ...counts },
    {
      members: 4,
      identities: 4,
      chores: 2,
      rotations: 2,
      rotation_members: 8,
    },
  );
  assert.deepEqual(
    database
      .prepare("SELECT id,ownership_start_weekday FROM chores ORDER BY id")
      .all()
      .map((row) => ({ ...row })),
    [
      { id: "dishwasher", ownership_start_weekday: 1 },
      { id: "trash", ownership_start_weekday: 5 },
    ],
  );
  assert.throws(() => database.exec(sql));
  assert.doesNotMatch(sql, /INSERT INTO weekly_assignments/);
});

test("an exact-email change revokes sessions and releases only that auth binding", () => {
  const database = new DatabaseSync(":memory:");
  for (const migration of readdirSync(resolve("migrations")).sort()) {
    database.exec(readFileSync(resolve("migrations", migration), "utf8"));
  }
  database.exec(
    buildBootstrapSql(validateContactInput(validInput), {
      timeZone: "America/New_York",
      weekStart: "monday",
      eveningTime: "20:00",
      morningTime: "08:00",
    }),
  );
  database.exec(`
    INSERT INTO "user" (id,name,email,emailVerified,createdAt,updatedAt) VALUES
      ('auth-member-a','Member A','member-a@example.com',1,'2026-09-01','2026-09-01'),
      ('auth-member-b','Member B','member-b@example.com',1,'2026-09-01','2026-09-01');
    UPDATE allowlisted_identities SET auth_user_id = 'auth-member-a' WHERE member_id = 'member-a';
    UPDATE allowlisted_identities SET auth_user_id = 'auth-member-b' WHERE member_id = 'member-b';
    INSERT INTO "session" (id,expiresAt,token,createdAt,updatedAt,userId) VALUES
      ('session-member-a','2026-10-01','token-member-a','2026-09-01','2026-09-01','auth-member-a'),
      ('session-member-b','2026-10-01','token-member-b','2026-09-01','2026-09-01','auth-member-b');
  `);
  const changed = structuredClone(validInput);
  const member-a = changed.members.find((member) => member.id === "member-a");
  assert.ok(member-a);
  member-a.email = "member-a.new@example.com";

  database.exec(buildContactSql(validateContactInput(changed)));

  assert.deepEqual(
    database
      .prepare(
        `SELECT member_id,email_normalized,auth_user_id
         FROM allowlisted_identities WHERE member_id IN ('member-a','member-b')
         ORDER BY member_id`,
      )
      .all()
      .map((row) => ({ ...row })),
    [
      {
        member_id: "member-a",
        email_normalized: "member-a.new@example.com",
        auth_user_id: null,
      },
      {
        member_id: "member-b",
        email_normalized: "member-b@example.com",
        auth_user_id: "auth-member-b",
      },
    ],
  );
  assert.deepEqual(
    database
      .prepare('SELECT userId FROM "session" ORDER BY userId')
      .all()
      .map((row) => ({ ...row })),
    [{ userId: "auth-member-b" }],
  );
});

test("the remote verification query proves the exact generated bootstrap", () => {
  const database = new DatabaseSync(":memory:");
  const migrations = readdirSync(resolve("migrations")).sort();
  database.exec(
    `CREATE TABLE d1_migrations
      (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL);`,
  );
  migrations.forEach((migration, index) => {
    database.exec(readFileSync(resolve("migrations", migration), "utf8"));
    database
      .prepare("INSERT INTO d1_migrations (id,name,applied_at) VALUES (?,?,?)")
      .run(index + 1, migration, validInput.recordedAt);
  });
  database.exec(
    buildBootstrapSql(validateContactInput(validInput), {
      timeZone: "America/New_York",
      weekStart: "monday",
      eveningTime: "20:00",
      morningTime: "08:00",
    }),
  );
  const query = buildProductionD1VerificationQuery({
    timeZone: "America/New_York",
    weekStart: "monday",
    eveningTime: "20:00",
    morningTime: "08:00",
  });

  assert.deepEqual(
    { ...database.prepare(query).get() },
    expectedProductionD1Result,
  );

  database.exec(
    "UPDATE households SET time_zone = 'UTC' WHERE id = 'chorotate'",
  );
  const drifted = database.prepare(query).get();
  assert.ok(drifted);
  assert.equal(drifted.exact_household_configuration, 0);
});

test("rejects malformed production bootstrap settings without private values", () => {
  for (const patch of [
    { timeZone: "Not/AZone" },
    { weekStart: "funday" },
    { eveningTime: "24:00" },
    { morningTime: "8:00" },
  ]) {
    assert.throws(
      () =>
        buildBootstrapSql(validateContactInput(validInput), {
          timeZone: "America/New_York",
          weekStart: "monday",
          eveningTime: "20:00",
          morningTime: "08:00",
          ...patch,
        }),
      (error) => {
        if (!(error instanceof Error)) return false;
        assert.match(error.message, /^Invalid production bootstrap settings:/);
        assert.ok(!error.message.includes("@example.com"));
        assert.ok(!error.message.includes("+1555"));
        return true;
      },
    );
  }
});

test("CLI writes a new mode-0600 bootstrap without exposing values", () => {
  const directory = mkdtempSync(join(tmpdir(), "chorotate-bootstrap-test-"));
  const inputPath = join(directory, "contacts.json");
  const outputPath = join(directory, "bootstrap.sql");
  const invalidOutputPath = join(directory, "invalid.sql");
  writeFileSync(inputPath, `${JSON.stringify(validInput)}\n`, { mode: 0o600 });
  /** @param {string} output @param {string} timeZone */
  const run = (output, timeZone) =>
    spawnSync(
      process.execPath,
      [
        resolve("scripts/operator-contact-config.mjs"),
        "--bootstrap",
        "--input",
        inputPath,
        "--output",
        output,
        "--time-zone",
        timeZone,
        "--week-start",
        "monday",
        "--evening-time",
        "20:00",
        "--morning-time",
        "08:00",
      ],
      { encoding: "utf8" },
    );
  try {
    const result = run(outputPath, "America/New_York");
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /total=4, sendable=4/);
    assert.ok(!result.stdout.includes("@example.com"));
    assert.ok(!result.stdout.includes("+1555"));
    assert.equal(statSync(outputPath).mode & 0o777, 0o600);

    const invalid = run(invalidOutputPath, "Not/AZone");
    assert.notEqual(invalid.status, 0);
    assert.equal(existsSync(invalidOutputPath), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
