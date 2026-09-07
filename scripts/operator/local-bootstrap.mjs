import { spawnSync } from "node:child_process";
import { constants } from "node:fs";
import { mkdtemp, open, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildBootstrapSql,
  readOperatorInput,
} from "./operator-contact-config.mjs";

const localDatabaseName = "chorotate-local";
const localAuthUserId = "local-dev-user";

const usage =
  "Usage: node scripts/operator/local-bootstrap.mjs --input <private-json-path> --time-zone <iana-zone> --week-start <weekday> --evening-time <HH:mm> --morning-time <HH:mm>";

/** @param {string[]} args @param {string} name @returns {string} */
function option(args, name) {
  const index = args.indexOf(name);
  if (index === -1 || !args[index + 1] || args[index + 1].startsWith("--")) {
    throw new Error(usage);
  }
  if (args.filter((argument) => argument === name).length !== 1) {
    throw new Error(usage);
  }
  return args[index + 1];
}

/** @param {string[]} args @returns {Record<string, string>} */
function parseArgs(args) {
  const names = [
    "--input",
    "--time-zone",
    "--week-start",
    "--evening-time",
    "--morning-time",
  ];
  if (
    args.length !== names.length * 2 ||
    args.some((argument, index) =>
      index % 2 === 0 ? !names.includes(argument) : names.includes(argument),
    )
  ) {
    throw new Error(usage);
  }
  return Object.fromEntries(names.map((name) => [name, option(args, name)]));
}

/** @param {string} value */
function sqlString(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

/**
 * Add the credential-free local identity to the otherwise shared bootstrap
 * contract. This function is deliberately exported only from this local
 * wrapper; production bootstrap SQL never calls it.
 *
 * @param {Awaited<ReturnType<typeof readOperatorInput>>} input
 * @param {Record<string, string>} settings
 */
export function buildLocalBootstrapSql(input, settings) {
  const firstMember = input.members[0];
  if (firstMember === undefined)
    throw new Error("Local bootstrap needs a member");
  const bootstrapSql = buildBootstrapSql(input, settings);
  const recordedAt = sqlString(input.recordedAt);
  return `${bootstrapSql}
-- Local-only Better Auth identity; never use this SQL for a remote database.
INSERT INTO "user" (id,name,email,emailVerified,image,createdAt,updatedAt)
VALUES (${sqlString(localAuthUserId)}, ${sqlString(firstMember.displayName)}, ${sqlString(firstMember.email)}, 1, NULL, ${recordedAt}, ${recordedAt});
CREATE TABLE local_auth_assert (matched_rows INTEGER CHECK (matched_rows = 1));
UPDATE allowlisted_identities
SET auth_user_id = ${sqlString(localAuthUserId)}
WHERE id = ${sqlString(`identity-${firstMember.id}`)}
  AND member_id = ${sqlString(firstMember.id)}
  AND email_normalized = ${sqlString(firstMember.email)};
INSERT INTO local_auth_assert VALUES (changes());
DROP TABLE local_auth_assert;
`;
}

/** @param {string[]} args */
export async function runLocalBootstrap(args) {
  if (
    process.env.CLOUDFLARE_ENV === "production" ||
    process.env.NODE_ENV === "production"
  ) {
    throw new Error("Local bootstrap refuses production execution");
  }
  const parsed = parseArgs(args);
  const input = await readOperatorInput(parsed["--input"]);
  const sql = buildLocalBootstrapSql(input, {
    timeZone: parsed["--time-zone"],
    weekStart: parsed["--week-start"],
    eveningTime: parsed["--evening-time"],
    morningTime: parsed["--morning-time"],
  });
  const wrangler =
    process.env.NODE_ENV === "test" &&
    process.env.LOCAL_BOOTSTRAP_WRANGLER !== undefined
      ? resolve(process.env.LOCAL_BOOTSTRAP_WRANGLER)
      : resolve("node_modules/wrangler/bin/wrangler.js");
  const wranglerEnvironment = {
    ...process.env,
    WRANGLER_WRITE_LOGS: "false",
  };
  const migrations = spawnSync(
    process.execPath,
    [wrangler, "d1", "migrations", "apply", localDatabaseName, "--local"],
    {
      cwd: resolve("."),
      encoding: "utf8",
      env: wranglerEnvironment,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  if (migrations.status !== 0) {
    throw new Error("Local D1 migrations failed");
  }

  const temporaryDirectory = await mkdtemp(
    join(tmpdir(), "chorotate-local-bootstrap-"),
  );
  try {
    const sqlPath = join(temporaryDirectory, "bootstrap.sql");
    const sqlFile = await open(
      sqlPath,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
      0o600,
    );
    try {
      await sqlFile.chmod(0o600);
      await sqlFile.writeFile(sql, "utf8");
    } finally {
      await sqlFile.close();
    }

    const execution = spawnSync(
      process.execPath,
      [
        wrangler,
        "d1",
        "execute",
        localDatabaseName,
        "--local",
        "--file",
        sqlPath,
      ],
      {
        cwd: resolve("."),
        encoding: "utf8",
        env: wranglerEnvironment,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    if (execution.status !== 0) {
      throw new Error(
        "Local D1 bootstrap failed; the first-run assertion rejects pre-existing household data",
      );
    }
  } finally {
    try {
      await rm(temporaryDirectory, { recursive: true, force: true });
    } catch {
      // The SQL file contains private identity/contact values. Never expose a
      // cleanup path or filesystem error after the operation has completed.
    }
  }
  console.log("Local D1 bootstrap completed; no contact values were printed.");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runLocalBootstrap(process.argv.slice(2)).catch((error) => {
    console.error(
      error instanceof Error ? error.message : "Local bootstrap failed",
    );
    process.exitCode = 1;
  });
}
