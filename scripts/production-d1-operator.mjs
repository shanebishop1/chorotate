import { spawnSync } from "node:child_process";
import { realpath, stat } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildProductionD1OperatorConfig,
  buildProductionD1WranglerArgs,
  productionD1DatabaseIdFromEnvironment,
  productionWranglerEnvironment,
  redactPrivateValues,
  withTemporaryWranglerConfig,
} from "./production-d1-wrangler.mjs";

const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const usage =
  "Usage: node scripts/production-d1-operator.mjs migrations-list | migrations-apply | execute --file <private-sql-path>";

/**
 * @param {string[]} args
 * @returns {Promise<{operation: "migrations-list" | "migrations-apply"} | {operation: "execute", sqlPath: string}>}
 */
export async function parseProductionD1OperatorArgs(args) {
  if (
    args.length === 1 &&
    (args[0] === "migrations-list" || args[0] === "migrations-apply")
  ) {
    return {
      operation: /** @type {"migrations-list" | "migrations-apply"} */ (
        args[0]
      ),
    };
  }
  if (args.length !== 3 || args[0] !== "execute" || args[1] !== "--file") {
    throw new Error(usage);
  }
  const sqlPath = await realpath(resolve(args[2]));
  const relation = relative(repositoryRoot, sqlPath);
  if (
    !(
      isAbsolute(relation) ||
      relation === ".." ||
      relation.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)
    )
  ) {
    throw new Error("Private SQL path must be outside the repository");
  }
  const sqlStat = await stat(sqlPath);
  if (
    extname(sqlPath).toLowerCase() !== ".sql" ||
    !sqlStat.isFile() ||
    (sqlStat.mode & 0o077) !== 0
  ) {
    throw new Error(
      "Private SQL must be a regular file without group or other permissions",
    );
  }
  return { operation: "execute", sqlPath };
}

async function main() {
  const request = await parseProductionD1OperatorArgs(process.argv.slice(2));
  const sqlPath = "sqlPath" in request ? request.sqlPath : undefined;
  const databaseId = productionD1DatabaseIdFromEnvironment(process.env);
  const config = buildProductionD1OperatorConfig(databaseId);
  await withTemporaryWranglerConfig(config, ({ configPath }) => {
    const commandArgs = buildProductionD1WranglerArgs(request.operation, {
      configPath,
      sqlPath,
    });
    const result = spawnSync(
      process.execPath,
      [resolve("node_modules/wrangler/bin/wrangler.js"), ...commandArgs],
      {
        cwd: repositoryRoot,
        encoding: "utf8",
        maxBuffer: 1024 * 1024,
        env: productionWranglerEnvironment(process.env),
        stdio: ["inherit", "pipe", "pipe"],
      },
    );
    if (result.status !== 0) {
      throw new Error(
        "Production D1 operation failed; provider output was withheld. Confirm Cloudflare credentials, account access, and the requested operation.",
      );
    }
    if (request.operation === "execute") {
      console.log(
        "Production private SQL execution completed; provider output was withheld.",
      );
      return;
    }
    const privateValues = [databaseId, sqlPath ?? "", configPath];
    process.stdout.write(redactPrivateValues(result.stdout, privateValues));
    process.stderr.write(redactPrivateValues(result.stderr, privateValues));
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(
      error instanceof Error ? error.message : "Production D1 operation failed",
    );
    process.exitCode = 1;
  });
}
