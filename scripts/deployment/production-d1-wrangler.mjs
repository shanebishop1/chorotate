import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const databaseIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** @param {NodeJS.ProcessEnv | Record<string, string | undefined>} environment */
export function productionD1DatabaseIdFromEnvironment(environment) {
  const databaseId = environment.PRODUCTION_D1_DATABASE_ID?.trim() ?? "";
  if (
    !databaseIdPattern.test(databaseId) ||
    databaseId === "00000000-0000-0000-0000-000000000000"
  ) {
    throw new Error(
      "Missing or invalid production input: PRODUCTION_D1_DATABASE_ID",
    );
  }
  return databaseId;
}

/** @param {string} databaseId */
export function buildProductionD1OperatorConfig(databaseId) {
  if (
    !databaseIdPattern.test(databaseId) ||
    databaseId === "00000000-0000-0000-0000-000000000000"
  ) {
    throw new Error("Invalid production D1 database id");
  }
  return {
    name: "chorotate-production-operator",
    compatibility_date: "2026-08-25",
    d1_databases: [
      {
        binding: "DB",
        database_name: "chorotate-production",
        database_id: databaseId,
        migrations_dir: resolve("migrations"),
      },
    ],
  };
}

/**
 * @template T
 * @param {Record<string, unknown>} config
 * @param {(paths: {configPath: string}) => Promise<T> | T} operation
 */
export async function withTemporaryWranglerConfig(config, operation) {
  const directory = await mkdtemp(join(tmpdir(), "chorotate-production-"));
  const configPath = join(directory, "wrangler.production.json");
  try {
    await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, {
      mode: 0o600,
    });
    return await operation({ configPath });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

/** @param {NodeJS.ProcessEnv} environment */
export function productionWranglerEnvironment(environment) {
  /** @type {NodeJS.ProcessEnv} */
  const safeEnvironment = {
    ...environment,
    CLOUDFLARE_API_TOKEN:
      environment.CLOUDFLARE_API_TOKEN ?? environment.CHOROTATE_CF_API_TOKEN,
    WRANGLER_WRITE_LOGS: "false",
  };
  for (const name of Object.keys(safeEnvironment)) {
    if (name.startsWith("PRODUCTION_")) delete safeEnvironment[name];
  }
  delete safeEnvironment.CHOROTATE_CF_API_TOKEN;
  return safeEnvironment;
}

/**
 * @param {string} operation
 * @param {{configPath: string, sqlPath?: string, verificationQuery?: string}} paths
 */
export function buildProductionD1WranglerArgs(operation, paths) {
  const common = ["DB", "--remote", "--config", paths.configPath];
  if (operation === "migrations-list")
    return ["d1", "migrations", "list", ...common];
  if (operation === "migrations-apply")
    return ["d1", "migrations", "apply", ...common];
  if (operation === "execute" && paths.sqlPath) {
    return ["d1", "execute", ...common, "--file", paths.sqlPath];
  }
  if (operation === "verify" && paths.verificationQuery) {
    return [
      "d1",
      "execute",
      ...common,
      "--json",
      "--command",
      paths.verificationQuery,
    ];
  }
  throw new Error("Unsupported production D1 operation or arguments");
}

/** @param {string} output @param {string[]} privateValues */
export function redactPrivateValues(output, privateValues) {
  return privateValues
    .filter(Boolean)
    .sort((left, right) => right.length - left.length)
    .reduce(
      (redacted, privateValue) =>
        redacted.replaceAll(privateValue, "[REDACTED]"),
      output,
    );
}
