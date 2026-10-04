import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { buildAddChoresSql } from "./add-chores.mjs";
import { buildBootstrapSql } from "./operator-contact-config.mjs";

const household = {
  householdId: "chorotate",
  householdName: "Test Household",
  recordedAt: "2026-10-04T22:00:00.000Z",
  members: ["a", "b", "c", "d"].map((id, index) => ({
    id,
    displayName: id.toUpperCase(),
    email: `${id}@example.com`,
    phoneE164: `+1555555010${index}`,
    consent: "consented",
    suppression: "not_suppressed",
  })),
};
const additions = {
  ...household,
  chores: ["wipe", "sweep"].map((id, index) => ({
    id,
    name: index === 0 ? "Wipe" : "Sweep",
    instructions:
      index === 0
        ? "Wipe counters at least once a week, then maintain them."
        : "Sweep and vacuum floors at least once a week, then maintain them.",
    ownershipStartWeekday: "friday",
    rotation: {
      id: `rotation-${id}-2026-10-02`,
      effectiveFrom: "2026-10-02",
      offset: index === 0 ? 0 : 2,
      memberIds: household.members.map(({ id }) => id),
    },
  })),
};

function database() {
  const db = new DatabaseSync(":memory:");
  for (const file of readdirSync("migrations")
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    db.exec(readFileSync(`migrations/${file}`, "utf8"));
  }
  db.exec(
    buildBootstrapSql(household, {
      timeZone: "America/New_York",
      weekStart: "monday",
      eveningTime: "20:00",
      morningTime: "09:00",
    }),
  );
  return db;
}

/** @param {DatabaseSync} db @param {string} sql */
function executeAtomic(db, sql) {
  db.exec("BEGIN");
  try {
    db.exec(sql);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

test("adds Wipe and Sweep without changing existing household data", () => {
  const db = database();
  try {
    const tables = [
      "households",
      "members",
      "allowlisted_identities",
      "chores",
      "rotation_configs",
      "rotation_config_members",
      "weekly_assignments",
      "assignment_audit_events",
      "reminder_outbox",
    ];
    const before = Object.fromEntries(
      tables.map((table) => [
        table,
        db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(),
      ]),
    );
    executeAtomic(db, buildAddChoresSql(additions));
    for (const table of tables) {
      const rows = db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all();
      assert.deepEqual(rows.slice(0, before[table].length), before[table]);
      if (
        !["chores", "rotation_configs", "rotation_config_members"].includes(
          table,
        )
      ) {
        assert.deepEqual(rows, before[table]);
      }
    }
    assert.equal(db.prepare("SELECT count(*) AS n FROM chores").get()?.n, 4);
    assert.equal(
      db.prepare("SELECT count(*) AS n FROM rotation_config_members").get()?.n,
      16,
    );
    assert.equal(
      db
        .prepare(
          "SELECT count(*) AS n FROM sqlite_schema WHERE name LIKE 'operator_%_assert'",
        )
        .get()?.n,
      0,
    );
    assert.throws(() => executeAtomic(db, buildAddChoresSql(additions)));
    assert.equal(db.prepare("SELECT count(*) AS n FROM chores").get()?.n, 4);
  } finally {
    db.close();
  }
});

test("rejects missing explicit chores and invalid rotation member lists", () => {
  assert.throws(() => buildAddChoresSql(household), /explicit new-chore list/);
  const input = structuredClone(additions);
  input.chores[0].rotation.memberIds.pop();
  assert.throws(() => buildAddChoresSql(input), /chore configuration/);
});

test("rolls additions back for wrong rosters and existing chore or rotation collisions", () => {
  /** @type {Array<(db: DatabaseSync) => void>} */
  const mutations = [
    (db) => db.exec("UPDATE members SET active = 0 WHERE id = 'a'"),
    (db) => db.exec("UPDATE members SET id = 'unknown' WHERE id = 'a'"),
    (db) => db.exec("UPDATE households SET id = 'other'"),
    (db) => db.exec("UPDATE chores SET name = 'wipe' WHERE id = 'trash'"),
    (db) => db.exec("UPDATE chores SET id = 'wipe' WHERE id = 'trash'"),
    (db) =>
      db.exec(
        "UPDATE rotation_configs SET id = 'rotation-sweep-2026-10-02' WHERE chore_id = 'trash'",
      ),
  ];
  for (const mutation of mutations) {
    const db = database();
    try {
      // ID-collision fixtures need to update referenced rows as a unit.
      db.exec("PRAGMA foreign_keys = OFF");
      mutation(db);
      db.exec("PRAGMA foreign_keys = ON");
      assert.throws(() => executeAtomic(db, buildAddChoresSql(additions)));
      assert.equal(db.prepare("SELECT count(*) AS n FROM chores").get()?.n, 2);
      assert.equal(
        db.prepare("SELECT count(*) AS n FROM rotation_configs").get()?.n,
        2,
      );
      assert.equal(
        db
          .prepare(
            "SELECT count(*) AS n FROM sqlite_schema WHERE name LIKE 'operator_%_assert'",
          )
          .get()?.n,
        0,
      );
    } finally {
      db.close();
    }
  }
});

test("rejects additions exceeding the active chore limit", () => {
  const db = database();
  try {
    const insert = db.prepare(
      "INSERT INTO chores (id,household_id,name,active,created_at,instructions,ownership_start_weekday) VALUES (?,'chorotate',?,1,?,'Maintain it.',5)",
    );
    for (let index = 0; index < 48; index += 1) {
      insert.run(`extra-${index}`, `Extra ${index}`, household.recordedAt);
    }
    assert.throws(() => executeAtomic(db, buildAddChoresSql(additions)));
    assert.equal(db.prepare("SELECT count(*) AS n FROM chores").get()?.n, 50);
  } finally {
    db.close();
  }
});

test("quotes instructions rather than interpreting them as SQL", () => {
  const input = structuredClone(additions);
  input.chores[0].instructions = "Don't skip counters'; DROP TABLE members; --";
  const db = database();
  try {
    executeAtomic(db, buildAddChoresSql(input));
    assert.equal(
      db.prepare("SELECT instructions FROM chores WHERE id = 'wipe'").get()
        ?.instructions,
      input.chores[0].instructions,
    );
    assert.equal(db.prepare("SELECT count(*) AS n FROM members").get()?.n, 4);
  } finally {
    db.close();
  }
});
