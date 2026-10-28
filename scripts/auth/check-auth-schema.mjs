import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const expectedPath = resolve("scripts/auth/better-auth-schema.sql");
const temporaryDirectory = mkdtempSync(
  join(tmpdir(), "chorotate-auth-schema-"),
);
const generatedPath = join(temporaryDirectory, "0004_better_auth.sql");

try {
  const result = spawnSync(
    resolve("node_modules/.bin/auth"),
    [
      "generate",
      "--config",
      "scripts/auth/better-auth-schema.ts",
      "--output",
      generatedPath,
      "--adapter",
      "kysely",
      "--dialect",
      "sqlite",
      "--yes",
    ],
    { encoding: "utf8" },
  );

  if (result.status !== 0) {
    process.stderr.write(
      result.stderr || result.stdout || "Schema generation failed\n",
    );
    process.exitCode = result.status ?? 1;
  } else if (
    readFileSync(generatedPath, "utf8").trim() !==
    readFileSync(expectedPath, "utf8").trim()
  ) {
    console.error(
      "Better Auth schema is stale. Run `npm run auth:schema:generate` and add a forward migration; never rewrite applied migrations.",
    );
    process.exitCode = 1;
  } else {
    const expected = new DatabaseSync(":memory:");
    const actual = new DatabaseSync(":memory:");
    expected.exec(readFileSync(expectedPath, "utf8"));
    actual.exec(readFileSync("migrations/0004_better_auth.sql", "utf8"));
    actual.exec(
      readFileSync(
        "migrations/0010_better_auth_account_compatibility.sql",
        "utf8",
      ),
    );
    for (const table of ["user", "session", "account", "verification"]) {
      /** @param {DatabaseSync} db */
      const columns = (db) =>
        /** @type {Array<{cid: number; name: string; type: string; notnull: number; dflt_value: unknown; pk: number}>} */ (
          db.prepare(`PRAGMA table_info("${table}")`).all()
        ).map(({ cid: _cid, type, ...column }) => ({
          ...column,
          type: type.toUpperCase(),
        }));
      const actualColumns = columns(actual);
      const legacyIssuer = actualColumns.find(
        ({ name }) => table === "account" && name === "issuer",
      );
      if (
        (legacyIssuer && legacyIssuer.notnull !== 0) ||
        JSON.stringify(
          actualColumns.filter(
            ({ name }) => !(table === "account" && name === "issuer"),
          ),
        ) !== JSON.stringify(columns(expected))
      ) {
        throw new Error(
          `Migrated Better Auth ${table} columns do not match the current schema`,
        );
      }
    }
    expected.close();
    actual.close();
    const { dependencies } = JSON.parse(readFileSync("package.json", "utf8"));
    console.log(
      `Better Auth ${dependencies["better-auth"]} schema and forward migrations are compatible.`,
    );
  }
} finally {
  rmSync(temporaryDirectory, { force: true, recursive: true });
}
