import { spawn } from "node:child_process";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { experimental_readRawConfig } from "wrangler";

const mode = process.argv[2];
if (mode !== "dry-run" && mode !== "deploy") {
  console.error(
    "Unqualified deployment is disabled. Use `npm run deploy:production:dry-run` or `npm run deploy:production`.",
  );
  process.exit(1);
}

const inputNames = [
  "PRODUCTION_D1_DATABASE_ID",
  "PRODUCTION_CANONICAL_ORIGIN",
  "PRODUCTION_HOUSEHOLD_TIME_ZONE",
  "PRODUCTION_HOUSEHOLD_WEEK_START",
  "PRODUCTION_OWNER_EMAIL",
  "PRODUCTION_ALLOWED_EMAILS",
  "PRODUCTION_REMINDER_BATCH_SIZE",
  "PRODUCTION_REMINDER_LEASE_MILLISECONDS",
  "PRODUCTION_REMINDER_MAX_ATTEMPTS",
  "PRODUCTION_REMINDER_PROVIDER_TIMEOUT_MILLISECONDS",
  "PRODUCTION_REMINDER_RETRY_BASE_MILLISECONDS",
  "PRODUCTION_REMINDER_RETRY_MAX_MILLISECONDS",
];

const values = Object.fromEntries(
  inputNames.map((name) => [name, process.env[name]?.trim() ?? ""]),
);
const invalid = new Set(inputNames.filter((name) => values[name] === ""));
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const databaseIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

if (
  !databaseIdPattern.test(values.PRODUCTION_D1_DATABASE_ID) ||
  values.PRODUCTION_D1_DATABASE_ID === "00000000-0000-0000-0000-000000000000"
) {
  invalid.add("PRODUCTION_D1_DATABASE_ID");
}

try {
  const origin = new URL(values.PRODUCTION_CANONICAL_ORIGIN);
  if (
    origin.protocol !== "https:" ||
    origin.origin !== values.PRODUCTION_CANONICAL_ORIGIN ||
    origin.hostname === "localhost"
  ) {
    invalid.add("PRODUCTION_CANONICAL_ORIGIN");
  }
} catch {
  invalid.add("PRODUCTION_CANONICAL_ORIGIN");
}

try {
  new Intl.DateTimeFormat("en-US", {
    timeZone: values.PRODUCTION_HOUSEHOLD_TIME_ZONE,
  }).format();
} catch {
  invalid.add("PRODUCTION_HOUSEHOLD_TIME_ZONE");
}

if (
  ![
    "sunday",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
  ].includes(values.PRODUCTION_HOUSEHOLD_WEEK_START)
) {
  invalid.add("PRODUCTION_HOUSEHOLD_WEEK_START");
}

const ownerEmail = values.PRODUCTION_OWNER_EMAIL.toLowerCase();
const allowedEmails = values.PRODUCTION_ALLOWED_EMAILS.split(",")
  .map((email) => email.trim().toLowerCase())
  .filter(Boolean);
if (
  values.PRODUCTION_OWNER_EMAIL !== ownerEmail ||
  !emailPattern.test(ownerEmail) ||
  ownerEmail.endsWith(".invalid")
) {
  invalid.add("PRODUCTION_OWNER_EMAIL");
}
if (
  allowedEmails.length === 0 ||
  !allowedEmails.includes(ownerEmail) ||
  allowedEmails.some(
    (email) => !emailPattern.test(email) || email.endsWith(".invalid"),
  )
) {
  invalid.add("PRODUCTION_ALLOWED_EMAILS");
}
/** @param {string} name @param {number} minimum @param {number} maximum */
function boundedInteger(name, minimum, maximum) {
  const value = values[name];
  if (!/^\d+$/.test(value)) {
    invalid.add(name);
    return minimum;
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    invalid.add(name);
    return minimum;
  }
  return parsed;
}
const reminderBatchSize = boundedInteger(
  "PRODUCTION_REMINDER_BATCH_SIZE",
  1,
  100,
);
const reminderLeaseMilliseconds = boundedInteger(
  "PRODUCTION_REMINDER_LEASE_MILLISECONDS",
  6_000,
  3_600_000,
);
const reminderMaxAttempts = boundedInteger(
  "PRODUCTION_REMINDER_MAX_ATTEMPTS",
  1,
  20,
);
const reminderProviderTimeoutMilliseconds = boundedInteger(
  "PRODUCTION_REMINDER_PROVIDER_TIMEOUT_MILLISECONDS",
  1_000,
  30_000,
);
const reminderRetryBaseMilliseconds = boundedInteger(
  "PRODUCTION_REMINDER_RETRY_BASE_MILLISECONDS",
  1_000,
  3_600_000,
);
const reminderRetryMaxMilliseconds = boundedInteger(
  "PRODUCTION_REMINDER_RETRY_MAX_MILLISECONDS",
  1_000,
  86_400_000,
);
if (reminderRetryMaxMilliseconds < reminderRetryBaseMilliseconds) {
  invalid.add("PRODUCTION_REMINDER_RETRY_MAX_MILLISECONDS");
}
if (
  reminderLeaseMilliseconds <
  reminderBatchSize * reminderProviderTimeoutMilliseconds + 5_000
) {
  invalid.add("PRODUCTION_REMINDER_LEASE_MILLISECONDS");
}
if (
  mode === "deploy" &&
  process.env.PRODUCTION_DEPLOY_CONFIRM !== "chorotate-production"
) {
  invalid.add("PRODUCTION_DEPLOY_CONFIRM");
}

if (invalid.size > 0) {
  console.error(
    `Production ${mode} refused before build/deploy; missing or invalid inputs: ${[
      ...invalid,
    ]
      .sort()
      .join(", ")}`,
  );
  process.exit(1);
}

const redactedValues = Object.values(values)
  .filter(Boolean)
  .sort((left, right) => right.length - left.length);
/** @param {string} output */
function redact(output) {
  let redacted = output;
  for (const value of redactedValues)
    redacted = redacted.replaceAll(value, "[REDACTED]");
  return redacted;
}

/**
 * @param {string} command
 * @param {string[]} args
 * @param {NodeJS.ProcessEnv} environment
 */
async function run(command, args, environment) {
  const child = spawn(command, args, {
    cwd: resolve(fileURLToPath(new URL("..", import.meta.url))),
    env: environment,
    stdio: ["inherit", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => (stdout += chunk));
  child.stderr.on("data", (chunk) => (stderr += chunk));
  const exitCode = await new Promise((complete, reject) => {
    child.once("error", reject);
    child.once("close", complete);
  });
  process.stdout.write(redact(stdout));
  process.stderr.write(redact(stderr));
  if (exitCode !== 0)
    throw new Error(`${command} exited with status ${exitCode}`);
}

const temporaryDirectory = await mkdtemp(
  join(tmpdir(), "chorotate-production-"),
);
const generatedConfigPath = join(
  temporaryDirectory,
  "wrangler.production.json",
);
const builtConfigPath = resolve("build/server/wrangler.json");
try {
  const { rawConfig } = await experimental_readRawConfig({
    config: resolve("wrangler.jsonc"),
  });
  delete rawConfig.$schema;
  rawConfig.main = resolve("workers/app.ts");
  rawConfig.env ??= {};
  rawConfig.env.production ??= {};
  rawConfig.env.production.vars = {
    APP_ENV: "production",
    CANONICAL_ORIGIN: values.PRODUCTION_CANONICAL_ORIGIN,
    HOUSEHOLD_TIME_ZONE: values.PRODUCTION_HOUSEHOLD_TIME_ZONE,
    HOUSEHOLD_WEEK_START: values.PRODUCTION_HOUSEHOLD_WEEK_START,
    OWNER_EMAIL: ownerEmail,
    ALLOWED_EMAILS: allowedEmails.join(","),
    REMINDER_BATCH_SIZE: String(reminderBatchSize),
    REMINDER_LEASE_MILLISECONDS: String(reminderLeaseMilliseconds),
    REMINDER_MAX_ATTEMPTS: String(reminderMaxAttempts),
    REMINDER_PROVIDER_TIMEOUT_MILLISECONDS: String(
      reminderProviderTimeoutMilliseconds,
    ),
    REMINDER_RETRY_BASE_MILLISECONDS: String(reminderRetryBaseMilliseconds),
    REMINDER_RETRY_MAX_MILLISECONDS: String(reminderRetryMaxMilliseconds),
  };
  rawConfig.env.production.d1_databases = [
    {
      binding: "DB",
      database_name: "chorotate-production",
      database_id: values.PRODUCTION_D1_DATABASE_ID,
      migrations_dir: resolve("migrations"),
    },
  ];
  await writeFile(
    generatedConfigPath,
    `${JSON.stringify(rawConfig, null, 2)}\n`,
    {
      mode: 0o600,
    },
  );

  const environment = {
    ...process.env,
    CLOUDFLARE_ENV: "production",
    CLOUDFLARE_VITE_WRANGLER_CONFIG_PATH: generatedConfigPath,
  };
  await run("npm", ["run", "build"], environment);
  await access(builtConfigPath);
  /** @type {NodeJS.ProcessEnv} */
  const deployEnvironment = { ...environment };
  delete deployEnvironment.CLOUDFLARE_ENV;
  delete deployEnvironment.CLOUDFLARE_VITE_WRANGLER_CONFIG_PATH;
  await run(
    resolve("node_modules/.bin/wrangler"),
    [
      "deploy",
      "--config",
      builtConfigPath,
      ...(mode === "dry-run" ? ["--dry-run"] : []),
    ],
    deployEnvironment,
  );
} catch (error) {
  console.error(
    redact(
      error instanceof Error ? error.message : "Production command failed",
    ),
  );
  process.exitCode = 1;
} finally {
  // Vite's deploy config contains the injected resource id and operator vars.
  // It is intentionally short-lived even though build/ is gitignored.
  await rm(builtConfigPath, { force: true });
  await rm(temporaryDirectory, { recursive: true, force: true });
}
