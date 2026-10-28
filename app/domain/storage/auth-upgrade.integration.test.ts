import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

const legacy = readFileSync("migrations/0004_better_auth.sql", "utf8");
const upgrade = readFileSync(
  "migrations/0010_better_auth_account_compatibility.sql",
  "utf8",
);

describe("Better Auth forward compatibility migration", () => {
  it("preserves legacy accounts, credentials, and sessions while accepting new accounts without issuer", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys=ON");
    db.exec(legacy);
    db.exec(`INSERT INTO user VALUES ('u','Member','fixture@example.invalid',1,NULL,'now','now');
      INSERT INTO account (id,issuer,accountId,providerId,userId,accessToken,refreshToken,createdAt,updatedAt)
        VALUES ('a','https://accounts.google.com','subject','google','u','encrypted-access','encrypted-refresh','now','now');
      INSERT INTO session (id,expiresAt,token,createdAt,updatedAt,userId)
        VALUES ('s','later','private-session','now','now','u');`);
    const before = db.prepare("SELECT * FROM account").all();
    const sessions = db.prepare("SELECT * FROM session").all();
    db.exec(upgrade);
    expect(db.prepare("SELECT * FROM account").all()).toEqual(before);
    expect(db.prepare("SELECT * FROM session").all()).toEqual(sessions);
    db.exec(`INSERT INTO account (id,accountId,providerId,userId,createdAt,updatedAt)
      VALUES ('new','another-subject','google','u','now','now');`);
    expect(
      db.prepare("SELECT issuer FROM account WHERE id='new'").get(),
    ).toEqual({ issuer: null });
    expect(() =>
      db.exec(`INSERT INTO account (id,accountId,providerId,userId,createdAt,updatedAt)
      VALUES ('duplicate','subject','google','u','now','now');`),
    ).toThrow(/UNIQUE/);
    // The previous Worker can still write issuer during the deployment cutover.
    db.exec(`INSERT INTO account (id,issuer,accountId,providerId,userId,createdAt,updatedAt)
      VALUES ('old-worker','https://accounts.google.com','third-subject','google','u','now','now');`);
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    db.close();
  });

  it("fails closed and rolls back ambiguous provider identities without deleting data", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(legacy);
    db.exec(`INSERT INTO user VALUES ('u','Member','fixture@example.invalid',1,NULL,'now','now');
      INSERT INTO account (id,issuer,accountId,providerId,userId,createdAt,updatedAt) VALUES
        ('a','issuer-a','same-subject','google','u','now','now'),
        ('b','issuer-b','same-subject','google','u','now','now');`);
    const before = db.prepare("SELECT * FROM account ORDER BY id").all();
    db.exec("BEGIN");
    expect(() => db.exec(upgrade)).toThrow(/UNIQUE/);
    db.exec("ROLLBACK");
    expect(db.prepare("SELECT * FROM account ORDER BY id").all()).toEqual(
      before,
    );
    db.close();
  });
});
