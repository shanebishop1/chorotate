import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { validateContactInput } from "./operator-contact-config.mjs";
import {
  buildLocalBootstrapSql,
  runLocalBootstrap,
} from "./local-bootstrap.mjs";

const input = validateContactInput({
  householdId: "chorotate",
  householdName: "Local Bootstrap Household",
  recordedAt: "2026-09-01T00:00:00.000Z",
  members: [
    {
      id: "member-a",
      displayName: "Member A",
      email: "member-a@example.com",
      phoneE164: null,
      consent: "not_recorded",
      suppression: "not_suppressed",
    },
    {
      id: "member-b",
      displayName: "Member B",
      email: "member-b@example.com",
      phoneE164: null,
      consent: "not_recorded",
      suppression: "not_suppressed",
    },
  ],
});

const settings = {
  timeZone: "UTC",
  weekStart: "monday",
  eveningTime: "20:00",
  morningTime: "08:00",
};

test("local bootstrap binds local-dev-user to the first configured member", () => {
  const sql = buildLocalBootstrapSql(input, settings);
  assert.match(sql, /INSERT INTO "user"/);
  assert.match(sql, /'local-dev-user', 'Member A', 'member-a@example.com'/);
  assert.match(sql, /SET auth_user_id = 'local-dev-user'/);
  assert.doesNotMatch(sql, /--remote|chorotate-production/);

  const database = new DatabaseSync(":memory:");
  for (const migration of readdirSync(resolve("migrations")).sort()) {
    database.exec(readFileSync(resolve("migrations", migration), "utf8"));
  }
  database.exec(sql);

  assert.deepEqual(
    {
      ...database
        .prepare(
          `SELECT u.id AS user_id, u.email, ai.member_id, ai.auth_user_id
           FROM "user" AS u
           INNER JOIN allowlisted_identities AS ai ON ai.auth_user_id = u.id
           WHERE u.id = 'local-dev-user'`,
        )
        .get(),
    },
    {
      user_id: "local-dev-user",
      email: "member-a@example.com",
      member_id: "member-a",
      auth_user_id: "local-dev-user",
    },
  );
});

test("local bootstrap refuses production execution before reading input", async () => {
  const previousEnvironment = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    await assert.rejects(
      runLocalBootstrap([]),
      /Local bootstrap refuses production execution/,
    );
  } finally {
    if (previousEnvironment === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousEnvironment;
  }
});

test("CLI accepts valid arguments, executes --file, suppresses child output, and cleans up", () => {
  const directory = mkdtempSync(
    join(tmpdir(), "chorotate-local-bootstrap-test-"),
  );
  const inputPath = join(directory, "input.json");
  const fakeWranglerPath = join(directory, "fake-wrangler.mjs");
  const markerPath = join(directory, "marker.jsonl");
  const privateSentinel = "private-child-output-must-not-escape";
  writeFileSync(inputPath, `${JSON.stringify(input)}\n`, { mode: 0o600 });
  writeFileSync(
    fakeWranglerPath,
    `import { appendFileSync, readFileSync, statSync } from "node:fs";
const args = process.argv.slice(2);
const fileIndex = args.indexOf("--file");
const sqlPath = fileIndex >= 0 ? args[fileIndex + 1] : undefined;
appendFileSync(process.env.LOCAL_BOOTSTRAP_MARKER, JSON.stringify({ args, fileIndex, logsDisabled: process.env.WRANGLER_WRITE_LOGS === "false", sqlContainsPrivateEmail: sqlPath !== undefined && readFileSync(sqlPath, "utf8").includes("member-a@example.com"), sqlMode: sqlPath === undefined ? null : statSync(sqlPath).mode & 0o777 }) + "\\n");
console.log(process.env.PRIVATE_SENTINEL);
console.error(process.env.PRIVATE_SENTINEL);
if (process.env.LOCAL_BOOTSTRAP_FAIL === "true" && fileIndex >= 0) process.exit(1);
`,
    { mode: 0o700 },
  );
  chmodSync(inputPath, 0o600);
  chmodSync(fakeWranglerPath, 0o700);

  try {
    const cliPath = fileURLToPath(
      new URL("./local-bootstrap.mjs", import.meta.url),
    );
    const cliArgs = [
      "--input",
      inputPath,
      "--time-zone",
      "UTC",
      "--week-start",
      "monday",
      "--evening-time",
      "20:00",
      "--morning-time",
      "08:00",
    ];
    const result = spawnSync(process.execPath, [cliPath, ...cliArgs], {
      cwd: resolve("."),
      encoding: "utf8",
      env: {
        ...process.env,
        NODE_ENV: "test",
        LOCAL_BOOTSTRAP_WRANGLER: fakeWranglerPath,
        LOCAL_BOOTSTRAP_MARKER: markerPath,
        PRIVATE_SENTINEL: privateSentinel,
      },
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Local D1 bootstrap completed/);
    assert.doesNotMatch(
      `${result.stdout}${result.stderr}`,
      /private-child-output/,
    );
    const invocations = readFileSync(markerPath, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.equal(invocations.length, 2);
    assert.deepEqual(invocations[0].args, [
      "d1",
      "migrations",
      "apply",
      "chorotate-local",
      "--local",
    ]);
    assert.equal(invocations[1].args.includes("--command"), false);
    assert.equal(invocations[1].fileIndex >= 0, true);
    assert.equal(invocations[0].logsDisabled, true);
    assert.equal(invocations[1].logsDisabled, true);
    assert.equal(invocations[1].sqlContainsPrivateEmail, true);
    assert.equal(invocations[1].sqlMode, 0o600);
    assert.equal(
      existsSync(invocations[1].args[invocations[1].fileIndex + 1]),
      false,
    );

    const failedResult = spawnSync(process.execPath, [cliPath, ...cliArgs], {
      cwd: resolve("."),
      encoding: "utf8",
      env: {
        ...process.env,
        NODE_ENV: "test",
        LOCAL_BOOTSTRAP_WRANGLER: fakeWranglerPath,
        LOCAL_BOOTSTRAP_MARKER: markerPath,
        LOCAL_BOOTSTRAP_FAIL: "true",
        PRIVATE_SENTINEL: privateSentinel,
      },
    });
    assert.notEqual(failedResult.status, 0);
    assert.match(failedResult.stderr, /Local D1 bootstrap failed/);
    assert.doesNotMatch(
      `${failedResult.stdout}${failedResult.stderr}`,
      /private-child-output/,
    );
    const failedInvocation = readFileSync(markerPath, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line))[2];
    assert.equal(
      existsSync(failedInvocation.args[failedInvocation.fileIndex + 1]),
      false,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("CLI rejects malformed argument shapes with usage without invoking Wrangler", () => {
  const result = spawnSync(
    process.execPath,
    [
      fileURLToPath(new URL("./local-bootstrap.mjs", import.meta.url)),
      "--input",
      "input.json",
      "--time-zone",
      "UTC",
      "--week-start",
      "monday",
      "--evening-time",
      "20:00",
      "--morning-time",
      "08:00",
      "--unexpected",
      "value",
    ],
    { cwd: resolve("."), encoding: "utf8" },
  );
  assert.notEqual(result.status, 0);
  assert.match(
    result.stderr,
    /Usage: node scripts\/operator\/local-bootstrap\.mjs/,
  );
});
