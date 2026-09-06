import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { parseProductionD1OperatorArgs } from "./production-d1-operator.mjs";
import {
  buildProductionD1VerificationQuery,
  expectedProductionD1Result,
  parseProductionD1VerificationOutput,
  productionD1SettingsFromEnvironment,
} from "./production-d1-contract.mjs";
import {
  buildProductionD1OperatorConfig,
  buildProductionD1WranglerArgs,
  productionD1DatabaseIdFromEnvironment,
  productionWranglerEnvironment,
  redactPrivateValues,
  withTemporaryWranglerConfig,
} from "./production-d1-wrangler.mjs";

const databaseId = "12345678-1234-4123-8123-123456789abc";

test("requires a bounded expected production household member count", () => {
  const base = {
    PRODUCTION_HOUSEHOLD_TIME_ZONE: "America/New_York",
    PRODUCTION_HOUSEHOLD_WEEK_START: "monday",
    PRODUCTION_REMINDER_EVENING_LOCAL_TIME: "20:00",
    PRODUCTION_REMINDER_MORNING_LOCAL_TIME: "08:00",
  };
  assert.equal(
    productionD1SettingsFromEnvironment({
      ...base,
      PRODUCTION_HOUSEHOLD_MEMBER_COUNT: "3",
    }).memberCount,
    3,
  );
  for (const memberCount of [undefined, "0", "51", "3.5", "three"]) {
    assert.throws(() =>
      productionD1SettingsFromEnvironment({
        ...base,
        PRODUCTION_HOUSEHOLD_MEMBER_COUNT: memberCount,
      }),
    );
  }
});

test("builds only fixed binding-based production D1 commands", () => {
  const configPath = "/private/wrangler.json";
  const sqlPath = "/private/bootstrap.sql";
  const verificationQuery = buildProductionD1VerificationQuery({
    timeZone: "America/New_York",
    weekStart: "monday",
    eveningTime: "20:00",
    morningTime: "08:00",
    memberCount: 3,
  });
  assert.doesNotMatch(verificationQuery, /member-[abc]|Member [ABC]/);
  assert.deepEqual(
    buildProductionD1WranglerArgs("migrations-list", { configPath }),
    ["d1", "migrations", "list", "DB", "--remote", "--config", configPath],
  );
  assert.deepEqual(
    buildProductionD1WranglerArgs("migrations-apply", { configPath }),
    ["d1", "migrations", "apply", "DB", "--remote", "--config", configPath],
  );
  assert.deepEqual(
    buildProductionD1WranglerArgs("execute", { configPath, sqlPath }),
    [
      "d1",
      "execute",
      "DB",
      "--remote",
      "--config",
      configPath,
      "--file",
      sqlPath,
    ],
  );
  assert.deepEqual(
    buildProductionD1WranglerArgs("verify", {
      configPath,
      verificationQuery,
    }),
    [
      "d1",
      "execute",
      "DB",
      "--remote",
      "--config",
      configPath,
      "--json",
      "--command",
      verificationQuery,
    ],
  );
  assert.throws(() => buildProductionD1WranglerArgs("execute", { configPath }));
  assert.throws(() => buildProductionD1WranglerArgs("verify", { configPath }));
  assert.throws(() =>
    buildProductionD1WranglerArgs("arbitrary", { configPath }),
  );
  for (const args of [
    buildProductionD1WranglerArgs("migrations-list", { configPath }),
    buildProductionD1WranglerArgs("migrations-apply", { configPath }),
    buildProductionD1WranglerArgs("execute", { configPath, sqlPath }),
  ]) {
    assert.ok(!args.includes(databaseId));
    assert.ok(!args.includes("chorotate-production"));
  }
});

test("validates the injected id and keeps it only in the temporary config", async () => {
  assert.equal(
    productionD1DatabaseIdFromEnvironment({
      PRODUCTION_D1_DATABASE_ID: databaseId,
    }),
    databaseId,
  );
  for (const value of [
    undefined,
    "not-an-id",
    "00000000-0000-0000-0000-000000000000",
  ]) {
    assert.throws(() =>
      productionD1DatabaseIdFromEnvironment({
        PRODUCTION_D1_DATABASE_ID: value,
      }),
    );
  }

  const config = buildProductionD1OperatorConfig(databaseId);
  let temporaryDirectory = "";
  await assert.rejects(
    withTemporaryWranglerConfig(config, ({ configPath }) => {
      temporaryDirectory = resolve(configPath, "..");
      assert.equal(statSync(configPath).mode & 0o777, 0o600);
      assert.equal(
        JSON.parse(readFileSync(configPath, "utf8")).d1_databases[0]
          .database_id,
        databaseId,
      );
      assert.ok(!configPath.includes(databaseId));
      throw new Error("forced cleanup");
    }),
    /forced cleanup/,
  );
  assert.equal(existsSync(temporaryDirectory), false);
});

test("accepts clean command JSON and rejects file-import result shapes", () => {
  const expectedResult = expectedProductionD1Result(3);
  const commandOutput = JSON.stringify([
    { results: [expectedResult], success: true },
  ]);
  const importOutput = JSON.stringify([
    {
      results: [
        {
          "Total queries executed": 12,
          "Rows read": 4,
          "Rows written": 4,
        },
      ],
      success: true,
    },
  ]);

  assert.deepEqual(
    parseProductionD1VerificationOutput(commandOutput),
    expectedResult,
  );
  assert.equal(parseProductionD1VerificationOutput(importOutput), undefined);
  assert.equal(
    parseProductionD1VerificationOutput(
      JSON.stringify([{ results: [expectedResult], success: false }]),
    ),
    undefined,
  );
  assert.equal(
    parseProductionD1VerificationOutput(
      JSON.stringify([
        {
          results: [expectedResult, expectedResult],
          success: true,
        },
      ]),
    ),
    undefined,
  );
  assert.equal(
    parseProductionD1VerificationOutput(`provider envelope\n${importOutput}`),
    undefined,
  );
});

test("strictly accepts only private mode-restricted SQL files", async () => {
  const directory = mkdtempSync(join(tmpdir(), "chorotate-d1-operator-test-"));
  mkdirSync(resolve(".chorotate"), { recursive: true, mode: 0o700 });
  const localDirectory = mkdtempSync(resolve(".chorotate/d1-operator-test-"));
  const sqlPath = join(directory, "bootstrap.sql");
  const localSqlPath = join(localDirectory, "bootstrap.sql");
  const textPath = join(directory, "bootstrap.txt");
  writeFileSync(sqlPath, "SELECT 1;\n", { mode: 0o600 });
  writeFileSync(localSqlPath, "SELECT 1;\n", { mode: 0o600 });
  writeFileSync(textPath, "SELECT 1;\n", { mode: 0o600 });
  try {
    assert.deepEqual(await parseProductionD1OperatorArgs(["migrations-list"]), {
      operation: "migrations-list",
    });
    assert.deepEqual(
      await parseProductionD1OperatorArgs(["migrations-apply"]),
      {
        operation: "migrations-apply",
      },
    );
    assert.deepEqual(
      await parseProductionD1OperatorArgs(["execute", "--file", sqlPath]),
      { operation: "execute", sqlPath: realpathSync(sqlPath) },
    );
    assert.deepEqual(
      await parseProductionD1OperatorArgs(["execute", "--file", localSqlPath]),
      { operation: "execute", sqlPath: realpathSync(localSqlPath) },
    );
    for (const args of [
      [],
      ["deploy"],
      ["execute"],
      ["execute", "--command", "SELECT 1"],
      ["migrations-apply", "--yes"],
    ]) {
      await assert.rejects(parseProductionD1OperatorArgs(args));
    }
    await assert.rejects(
      parseProductionD1OperatorArgs([
        "execute",
        "--file",
        resolve("migrations/0001_domain_schema.sql"),
      ]),
      /outside the repository/,
    );
    await assert.rejects(
      parseProductionD1OperatorArgs(["execute", "--file", textPath]),
      /regular file/,
    );
    chmodSync(sqlPath, 0o644);
    await assert.rejects(
      parseProductionD1OperatorArgs(["execute", "--file", sqlPath]),
      /permissions/,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
    rmSync(localDirectory, { recursive: true, force: true });
  }
});

test("redacts private boundaries and disables Wrangler disk logs", () => {
  assert.equal(
    redactPrivateValues(`id=${databaseId} path=/private/bootstrap.sql`, [
      databaseId,
      "/private/bootstrap.sql",
    ]),
    "id=[REDACTED] path=[REDACTED]",
  );
  const environment = productionWranglerEnvironment({
    WRANGLER_WRITE_LOGS: "true",
    PRODUCTION_D1_DATABASE_ID: databaseId,
  });
  assert.equal(environment.WRANGLER_WRITE_LOGS, "false");
  assert.equal(environment.PRODUCTION_D1_DATABASE_ID, undefined);
});

test("maps the project Cloudflare token name for Wrangler", () => {
  const environment = productionWranglerEnvironment({
    CHOROTATE_CF_API_TOKEN: "project-token",
  });
  assert.equal(environment.CLOUDFLARE_API_TOKEN, "project-token");
  assert.equal(environment.CHOROTATE_CF_API_TOKEN, undefined);
});

test("credential-free dry-runs and refusals make no remote request", () => {
  const verify = spawnSync(
    process.execPath,
    [resolve("scripts/verify-production-d1.mjs"), "--dry-run"],
    { encoding: "utf8", env: {} },
  );
  assert.equal(verify.status, 0, verify.stderr);
  assert.match(verify.stdout, /no remote request was made/);

  const refused = spawnSync(
    process.execPath,
    [resolve("scripts/production-d1-operator.mjs"), "deploy"],
    { encoding: "utf8", env: { PRODUCTION_D1_DATABASE_ID: databaseId } },
  );
  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr, /^Usage:/);
  assert.ok(!refused.stdout.includes(databaseId));
  assert.ok(!refused.stderr.includes(databaseId));
});
