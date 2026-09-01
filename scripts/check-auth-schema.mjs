import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const expectedPath = resolve("migrations/0004_better_auth.sql");
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
      "scripts/better-auth-schema.ts",
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
    readFileSync(generatedPath, "utf8") !== readFileSync(expectedPath, "utf8")
  ) {
    console.error(
      "Better Auth schema is stale. Run `npm run auth:schema:generate` and review the generated migration.",
    );
    process.exitCode = 1;
  } else {
    console.log(
      "Better Auth 1.7.2 SQLite schema regeneration is deterministic.",
    );
  }
} finally {
  rmSync(temporaryDirectory, { force: true, recursive: true });
}
