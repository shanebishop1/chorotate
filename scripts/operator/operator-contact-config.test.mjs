import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  rmdirSync,
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
} from "../deployment/production-d1-contract.mjs";

const validInput = {
  householdId: "chorotate",
  householdName: "Test Household",
  recordedAt: "2026-09-01T00:00:00.000Z",
  members: ["member-c", "member-a", "member-b"].map((id, index) => ({
    id,
    displayName: `Member ${id.at(-1)?.toUpperCase()}`,
    email: `${id}@example.com`,
    phoneE164: `+1555000000${index}`,
    consent: "consented",
    suppression: "not_suppressed",
  })),
};

const customInput = {
  ...validInput,
  chores: [
    {
      id: "recycling",
      name: "Recycling",
      instructions: "Rinse containers; don't leave bags outside.",
      ownershipStartWeekday: "wednesday",
      rotation: {
        id: "rotation-recycling-2026-09-02",
        effectiveFrom: "2026-09-02",
        offset: 1,
        memberIds: ["member-b", "member-c", "member-a"],
      },
    },
    {
      id: "kitchen-reset",
      name: "Kitchen Reset",
      instructions: "Wipe the counters and reset the kitchen.",
      ownershipStartWeekday: "saturday",
      rotation: {
        id: "rotation-kitchen-reset-2026-09-05",
        effectiveFrom: "2026-09-05",
        offset: 0,
        memberIds: ["member-a", "member-b", "member-c"],
      },
    },
  ],
};

/** @param {DatabaseSync} database @param {string} sql */
function execAtomic(database, sql) {
  database.exec("BEGIN");
  try {
    database.exec(sql);
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

/** @param {DatabaseSync} database */
function assertionTableCount(database) {
  return database
    .prepare(
      `SELECT count(*) AS count FROM sqlite_schema
       WHERE type = 'table' AND name LIKE 'operator_%_assert'`,
    )
    .get()?.count;
}

test("validates an ordered arbitrary production roster and contact contract", () => {
  assert.deepEqual(validateContactInput(validInput), validInput);

  for (const patch of [
    { phoneE164: null },
    { consent: "not_recorded" },
    { suppression: "suppressed" },
  ]) {
    const input = structuredClone(validInput);
    Object.assign(input.members[0], patch);
    const validated = validateContactInput(input);
    assert.equal(summarizeContactReadiness(validated).sendable, 2);
  }

  const malformed = structuredClone(validInput);
  malformed.members[0].phoneE164 = "+0123";
  assert.throws(() => validateContactInput(malformed));
});

test("rejects unsafe, duplicate, empty, and oversized roster profiles", () => {
  /** @type {Array<(input: typeof validInput) => void>} */
  const mutations = [
    (input) => (input.members = []),
    (input) =>
      (input.members = Array.from({ length: 51 }, (_, index) => ({
        ...input.members[0],
        id: `member-${index}`,
        displayName: `Member ${index}`,
        email: `member-${index}@example.com`,
      }))),
    (input) => (input.members[0].id = "Member A"),
    (input) => (input.members[0].id = "member--a"),
    (input) => (input.members[0].displayName = " Member C"),
    (input) => (input.members[0].displayName = input.members[1].displayName),
    (input) => (input.members[0].displayName = "x".repeat(101)),
    (input) => (input.householdName = ""),
  ];
  for (const mutate of mutations) {
    const input = structuredClone(validInput);
    mutate(input);
    assert.throws(
      () => validateContactInput(input),
      /^Error: Invalid operator contact input:/,
    );
  }
});

test("rejects unsafe identity and malformed contact configuration without values", () => {
  /** @type {Array<(input: typeof validInput) => void>} */
  const mutations = [
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
  assert.equal(sql.match(/CHECK \(matched_rows = 3\)/g)?.length, 2);
  assert.match(sql, /CREATE TABLE operator_identity_assert/);
  assert.match(sql, /CREATE TABLE operator_contact_assert/);
  assert.doesNotMatch(sql, /CREATE TEMP(?:ORARY)? TABLE/i);
  assert.match(sql, /DROP TABLE operator_contact_assert/);
  assert.match(sql, /DROP TABLE operator_identity_assert/);
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

  assert.match(sql, /CREATE TABLE operator_bootstrap_assert/);
  assert.doesNotMatch(sql, /CREATE TEMP(?:ORARY)? TABLE/i);
  assert.doesNotMatch(sql, /^\s*(?:BEGIN|COMMIT)\b/im);
  execAtomic(database, sql);
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
      members: 3,
      identities: 3,
      chores: 2,
      rotations: 2,
      rotation_members: 6,
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
  assert.equal(assertionTableCount(database), 0);
  assert.throws(() => execAtomic(database, sql));
  assert.equal(assertionTableCount(database), 0);
  assert.deepEqual(
    {
      ...database
        .prepare(
          `SELECT
             (SELECT count(*) FROM households) AS households,
             (SELECT count(*) FROM members) AS members,
             (SELECT count(*) FROM allowlisted_identities) AS identities,
             (SELECT count(*) FROM chores) AS chores,
             (SELECT count(*) FROM rotation_configs) AS rotations,
             (SELECT count(*) FROM rotation_config_members) AS rotation_members`,
        )
        .get(),
    },
    {
      households: 1,
      members: 3,
      identities: 3,
      chores: 2,
      rotations: 2,
      rotation_members: 6,
    },
  );
  assert.doesNotMatch(sql, /INSERT INTO weekly_assignments/);
  assert.deepEqual(
    database
      .prepare(
        "SELECT member_id,position FROM rotation_config_members WHERE rotation_config_id = 'rotation-trash-2026-08-28' ORDER BY position",
      )
      .all()
      .map((row) => ({ ...row })),
    validInput.members.map((member, position) => ({
      member_id: member.id,
      position,
    })),
  );
  assert.equal(
    database.prepare("SELECT name FROM households WHERE id = 'chorotate'").get()
      ?.name,
    validInput.householdName,
  );
});

test("bootstraps explicitly configured chores and preserves rotation order safely", () => {
  const input = validateContactInput(customInput);
  const sql = buildBootstrapSql(input, {
    timeZone: "America/New_York",
    weekStart: "monday",
    eveningTime: "20:00",
    morningTime: "08:00",
  });
  assert.doesNotMatch(
    sql,
    /Trash|Dishwasher|rotation-trash|rotation-dishwasher/,
  );
  assert.match(sql, /Rinse containers; don''t leave bags outside\./);

  const database = new DatabaseSync(":memory:");
  for (const migration of readdirSync(resolve("migrations")).sort()) {
    database.exec(readFileSync(resolve("migrations", migration), "utf8"));
  }
  execAtomic(database, sql);

  assert.deepEqual(
    database
      .prepare(
        `SELECT id,name,instructions,ownership_start_weekday
         FROM chores ORDER BY id`,
      )
      .all()
      .map((row) => ({ ...row })),
    [
      {
        id: "kitchen-reset",
        name: "Kitchen Reset",
        instructions: "Wipe the counters and reset the kitchen.",
        ownership_start_weekday: 6,
      },
      {
        id: "recycling",
        name: "Recycling",
        instructions: "Rinse containers; don't leave bags outside.",
        ownership_start_weekday: 3,
      },
    ],
  );
  assert.deepEqual(
    database
      .prepare(
        `SELECT id,chore_id,effective_from,rotation_offset
         FROM rotation_configs ORDER BY id`,
      )
      .all()
      .map((row) => ({ ...row })),
    [
      {
        id: "rotation-kitchen-reset-2026-09-05",
        chore_id: "kitchen-reset",
        effective_from: "2026-09-05",
        rotation_offset: 0,
      },
      {
        id: "rotation-recycling-2026-09-02",
        chore_id: "recycling",
        effective_from: "2026-09-02",
        rotation_offset: 1,
      },
    ],
  );
  assert.deepEqual(
    database
      .prepare(
        `SELECT member_id,position FROM rotation_config_members
         WHERE rotation_config_id = 'rotation-recycling-2026-09-02'
         ORDER BY position`,
      )
      .all()
      .map((row) => ({ ...row })),
    [
      { member_id: "member-b", position: 0 },
      { member_id: "member-c", position: 1 },
      { member_id: "member-a", position: 2 },
    ],
  );
  assert.equal(assertionTableCount(database), 0);
});

test("exact-row assertion failures roll back updates and assertion tables", () => {
  const database = new DatabaseSync(":memory:");
  for (const migration of readdirSync(resolve("migrations")).sort()) {
    database.exec(readFileSync(resolve("migrations", migration), "utf8"));
  }
  execAtomic(
    database,
    buildBootstrapSql(validateContactInput(validInput), {
      timeZone: "America/New_York",
      weekStart: "monday",
      eveningTime: "20:00",
      morningTime: "08:00",
    }),
  );
  database.exec(
    "DELETE FROM allowlisted_identities WHERE member_id = 'member-b'",
  );
  const changed = structuredClone(validInput);
  for (const member of changed.members) {
    member.email = `${member.id}.changed@example.com`;
    member.phoneE164 = `+1555000001${changed.members.indexOf(member)}`;
  }

  assert.throws(() =>
    execAtomic(database, buildContactSql(validateContactInput(changed))),
  );
  assert.deepEqual(
    database
      .prepare(
        `SELECT member_id,email_normalized FROM allowlisted_identities
         ORDER BY member_id`,
      )
      .all()
      .map((row) => ({ ...row })),
    ["member-a", "member-c"].map((memberId) => ({
      member_id: memberId,
      email_normalized: `${memberId}@example.com`,
    })),
  );
  assert.equal(assertionTableCount(database), 0);

  database.exec(`
    INSERT INTO allowlisted_identities
      (id,household_id,member_id,email_normalized,active,created_at)
    VALUES
      ('identity-member-a-extra','chorotate','member-a','member-a-extra@example.com',1,'2026-09-01');
  `);
  assert.throws(() =>
    execAtomic(database, buildContactSql(validateContactInput(changed))),
  );
  assert.equal(
    database
      .prepare("SELECT display_name FROM members WHERE id = ?")
      .get(validInput.members[0].id)?.display_name,
    validInput.members[0].displayName,
  );
  assert.equal(assertionTableCount(database), 0);
});

test("contact updates change display names and revoke sessions only for changed emails", () => {
  const database = new DatabaseSync(":memory:");
  for (const migration of readdirSync(resolve("migrations")).sort()) {
    database.exec(readFileSync(resolve("migrations", migration), "utf8"));
  }
  execAtomic(
    database,
    buildBootstrapSql(validateContactInput(validInput), {
      timeZone: "America/New_York",
      weekStart: "monday",
      eveningTime: "20:00",
      morningTime: "08:00",
    }),
  );
  database.exec(`
    INSERT INTO "user" (id,name,email,emailVerified,createdAt,updatedAt) VALUES
      ('auth-a','Member A','member-a@example.com',1,'2026-09-01','2026-09-01'),
      ('auth-b','Member B','member-b@example.com',1,'2026-09-01','2026-09-01');
    UPDATE allowlisted_identities SET auth_user_id = 'auth-a' WHERE member_id = 'member-a';
    UPDATE allowlisted_identities SET auth_user_id = 'auth-b' WHERE member_id = 'member-b';
    INSERT INTO "session" (id,expiresAt,token,createdAt,updatedAt,userId) VALUES
      ('session-a','2026-10-01','token-a','2026-09-01','2026-09-01','auth-a'),
      ('session-b','2026-10-01','token-b','2026-09-01','2026-09-01','auth-b');
  `);
  const changed = structuredClone(validInput);
  const memberA = changed.members.find((member) => member.id === "member-a");
  const memberB = changed.members.find((member) => member.id === "member-b");
  assert.ok(memberA);
  assert.ok(memberB);
  memberA.email = "member-a-new@example.com";
  memberA.displayName = "Updated Member A";
  memberB.displayName = "Updated Member B";

  execAtomic(database, buildContactSql(validateContactInput(changed)));

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
        email_normalized: "member-a-new@example.com",
        auth_user_id: null,
      },
      {
        member_id: "member-b",
        email_normalized: "member-b@example.com",
        auth_user_id: "auth-b",
      },
    ],
  );
  assert.deepEqual(
    database
      .prepare('SELECT userId FROM "session" ORDER BY userId')
      .all()
      .map((row) => ({ ...row })),
    [{ userId: "auth-b" }],
  );
  assert.deepEqual(
    database
      .prepare(
        "SELECT id,display_name FROM members WHERE id IN ('member-a','member-b') ORDER BY id",
      )
      .all()
      .map((row) => ({ ...row })),
    [
      { id: "member-a", display_name: "Updated Member A" },
      { id: "member-b", display_name: "Updated Member B" },
    ],
  );
});

test("contact updates reject extra household members and identities atomically", () => {
  const database = new DatabaseSync(":memory:");
  for (const migration of readdirSync(resolve("migrations")).sort()) {
    database.exec(readFileSync(resolve("migrations", migration), "utf8"));
  }
  execAtomic(
    database,
    buildBootstrapSql(validateContactInput(validInput), {
      timeZone: "America/New_York",
      weekStart: "monday",
      eveningTime: "20:00",
      morningTime: "08:00",
    }),
  );
  database.exec(`
    INSERT INTO members (id,household_id,display_name,active,created_at) VALUES
      ('member-extra','chorotate','Member Extra',1,'2026-09-01');
    INSERT INTO allowlisted_identities (id,household_id,member_id,email_normalized,active,created_at) VALUES
      ('identity-member-extra','chorotate','member-extra','member-extra@example.com',1,'2026-09-01');
  `);
  const changed = structuredClone(validInput);
  changed.members[0].displayName = "Should Roll Back";
  assert.throws(() =>
    execAtomic(database, buildContactSql(validateContactInput(changed))),
  );
  assert.equal(
    database
      .prepare("SELECT display_name FROM members WHERE id = ?")
      .get(validInput.members[0].id)?.display_name,
    validInput.members[0].displayName,
  );
  assert.equal(assertionTableCount(database), 0);
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
  execAtomic(
    database,
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
    memberCount: validInput.members.length,
  });

  assert.deepEqual(
    { ...database.prepare(query).get() },
    expectedProductionD1Result(validInput.members.length),
  );

  database.exec(
    "UPDATE households SET time_zone = 'UTC' WHERE id = 'chorotate'",
  );
  const drifted = database.prepare(query).get();
  assert.ok(drifted);
  assert.equal(drifted.exact_household_configuration, 0);

  database.exec(
    "UPDATE households SET time_zone = 'America/New_York' WHERE id = 'chorotate'",
  );
  database.exec(
    "UPDATE rotation_config_members SET position = 4 WHERE rotation_config_id = 'rotation-trash-2026-08-28' AND position = 2",
  );
  const incompleteRotation = database.prepare(query).get();
  assert.ok(incompleteRotation);
  assert.equal(incompleteRotation.expected_rotation_members, 1);
});

test("the remote verification query follows configured chore identities and counts", () => {
  const input = validateContactInput(customInput);
  const database = new DatabaseSync(":memory:");
  database.exec(
    `CREATE TABLE d1_migrations
      (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL);`,
  );
  for (const [index, migration] of readdirSync(resolve("migrations"))
    .sort()
    .entries()) {
    database.exec(readFileSync(resolve("migrations", migration), "utf8"));
    database
      .prepare("INSERT INTO d1_migrations (id,name,applied_at) VALUES (?,?,?)")
      .run(index + 1, migration, input.recordedAt);
  }
  execAtomic(
    database,
    buildBootstrapSql(input, {
      timeZone: "America/New_York",
      weekStart: "monday",
      eveningTime: "20:00",
      morningTime: "08:00",
    }),
  );
  const settings = {
    timeZone: "America/New_York",
    weekStart: "monday",
    eveningTime: "20:00",
    morningTime: "08:00",
    memberCount: input.members.length,
    chores: input.chores,
  };
  const query = buildProductionD1VerificationQuery(settings);
  assert.doesNotMatch(
    query,
    /Trash|Dishwasher|rotation-trash|rotation-dishwasher/,
  );
  assert.deepEqual(
    { ...database.prepare(query).get() },
    expectedProductionD1Result(input.members.length, input.chores),
  );
  database.exec(
    `UPDATE rotation_config_members
     SET position = position + 3
     WHERE rotation_config_id = 'rotation-recycling-2026-09-02';
     UPDATE rotation_config_members
     SET position = CASE position
       WHEN 3 THEN 1 WHEN 4 THEN 0 ELSE position END
     WHERE rotation_config_id = 'rotation-recycling-2026-09-02'`,
  );
  const reordered = database.prepare(query).get();
  assert.ok(reordered);
  assert.equal(reordered.expected_rotation_order, 1);
});

test("allows opt-outs and missing phones when SMS is disabled but validates states", () => {
  const database = new DatabaseSync(":memory:");
  const migrations = readdirSync(resolve("migrations")).sort();
  database.exec(
    `CREATE TABLE d1_migrations
      (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL);`,
  );
  for (const [index, migration] of migrations.entries()) {
    database.exec(readFileSync(resolve("migrations", migration), "utf8"));
    database
      .prepare("INSERT INTO d1_migrations (id,name,applied_at) VALUES (?,?,?)")
      .run(index + 1, migration, validInput.recordedAt);
  }
  execAtomic(
    database,
    buildBootstrapSql(validateContactInput(validInput), {
      timeZone: "America/New_York",
      weekStart: "monday",
      eveningTime: "20:00",
      morningTime: "08:00",
    }),
  );
  database.exec(`
    UPDATE members
    SET sms_phone_e164 = NULL,
        sms_consent_status = 'not_recorded',
        sms_suppression_status = 'suppressed'
    WHERE id = 'member-a';
  `);
  const disabledQuery = buildProductionD1VerificationQuery({
    timeZone: "America/New_York",
    weekStart: "monday",
    eveningTime: "20:00",
    morningTime: "08:00",
    memberCount: validInput.members.length,
    smsEnabled: false,
  });
  const disabledResult = database.prepare(disabledQuery).get();
  assert.ok(disabledResult);
  assert.deepEqual(
    { ...disabledResult },
    expectedProductionD1Result(validInput.members.length, undefined, {
      smsEnabled: false,
      contactCounts: {
        missing: 1,
        malformed: 0,
        unconsented: 1,
        suppressed: 1,
      },
    }),
  );

  const enabledExpected = expectedProductionD1Result(
    validInput.members.length,
    undefined,
    { smsEnabled: true },
  );
  assert.equal(enabledExpected.missing_contacts, 0);
  assert.notEqual(
    disabledResult.missing_contacts,
    enabledExpected.missing_contacts,
  );
  assert.notEqual(
    disabledResult.unconsented_contacts,
    enabledExpected.unconsented_contacts,
  );
  assert.notEqual(
    disabledResult.suppressed_contacts,
    enabledExpected.suppressed_contacts,
  );

  database.exec(`
    PRAGMA ignore_check_constraints = ON;
    UPDATE members SET sms_consent_status = 'invalid' WHERE id = 'member-b';
    PRAGMA ignore_check_constraints = OFF;
  `);
  const invalidState = database.prepare(disabledQuery).get();
  assert.ok(invalidState);
  assert.equal(invalidState.invalid_contact_states, 1);
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
        resolve("scripts/operator/operator-contact-config.mjs"),
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
    assert.match(result.stdout, /total=3, sendable=3/);
    assert.ok(!result.stdout.includes("@example.com"));
    assert.ok(!result.stdout.includes("+1555"));
    assert.equal(statSync(outputPath).mode & 0o777, 0o600);

    const invalid = run(invalidOutputPath, "Not/AZone");
    assert.notEqual(invalid.status, 0);
    assert.equal(existsSync(invalidOutputPath), false);

    chmodSync(inputPath, 0o400);
    const wrongMode = run(invalidOutputPath, "America/New_York");
    assert.notEqual(wrongMode.status, 0);
    assert.match(wrongMode.stderr, /mode 0600/);
    assert.equal(existsSync(invalidOutputPath), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("CLI accepts only outside-repository or ignored .chorotate private paths", () => {
  const privateRoot = resolve(".chorotate");
  const createdRoot = !existsSync(privateRoot);
  if (createdRoot) mkdirSync(privateRoot, { mode: 0o700 });
  const directory = mkdtempSync(join(privateRoot, "operator-test-"));
  const inputPath = join(directory, "contacts.json");
  const outputPath = join(directory, "contacts.sql");
  writeFileSync(inputPath, `${JSON.stringify(validInput)}\n`, { mode: 0o600 });
  try {
    const result = spawnSync(
      process.execPath,
      [
        resolve("scripts/operator/operator-contact-config.mjs"),
        "--input",
        inputPath,
        "--output",
        outputPath,
      ],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(statSync(outputPath).mode & 0o777, 0o600);

    rmSync(outputPath);
    writeFileSync(outputPath, "existing", { mode: 0o600 });
    const exclusive = spawnSync(
      process.execPath,
      [
        resolve("scripts/operator/operator-contact-config.mjs"),
        "--input",
        inputPath,
        "--output",
        outputPath,
      ],
      { encoding: "utf8" },
    );
    assert.notEqual(exclusive.status, 0);
    assert.equal(readFileSync(outputPath, "utf8"), "existing");
  } finally {
    rmSync(directory, { recursive: true, force: true });
    if (createdRoot) rmdirSync(privateRoot);
  }
});
