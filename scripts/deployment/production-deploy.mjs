import { access } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { experimental_readRawConfig } from "wrangler";

import {
  productionD1DatabaseIdFromEnvironment,
  productionWranglerEnvironment,
  withTemporaryWranglerConfig,
} from "./production-d1-wrangler.mjs";
import {
  fixedProductionDeployFailure,
  runWithSuppressedChildOutput,
  successfulProductionDeployChecks,
  withEmittedDeployConfigCleanup,
} from "./production-deploy-output.mjs";

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
  "PRODUCTION_REMINDER_SMS_ENABLED",
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
try {
  productionD1DatabaseIdFromEnvironment(values);
} catch {
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
const reminderSmsEnabled = values.PRODUCTION_REMINDER_SMS_ENABLED;
if (reminderSmsEnabled !== "true" && reminderSmsEnabled !== "false") {
  invalid.add("PRODUCTION_REMINDER_SMS_ENABLED");
}
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

const builtConfigPath = resolve("build/server/wrangler.json");
try {
  await withEmittedDeployConfigCleanup(builtConfigPath, async () => {
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
      REMINDER_SMS_ENABLED: reminderSmsEnabled,
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
    await withTemporaryWranglerConfig(rawConfig, async ({ configPath }) => {
      const environment = productionWranglerEnvironment({
        ...process.env,
        CLOUDFLARE_ENV: "production",
        CLOUDFLARE_VITE_WRANGLER_CONFIG_PATH: configPath,
      });
      const repositoryRoot = resolve(
        fileURLToPath(new URL("../..", import.meta.url)),
      );
      await runWithSuppressedChildOutput("npm", ["run", "build"], {
        cwd: repositoryRoot,
        env: environment,
        category: "build",
      });
      await access(builtConfigPath);
      /** @type {NodeJS.ProcessEnv} */
      const deployEnvironment = { ...environment };
      delete deployEnvironment.CLOUDFLARE_ENV;
      delete deployEnvironment.CLOUDFLARE_VITE_WRANGLER_CONFIG_PATH;
      await runWithSuppressedChildOutput(
        resolve("node_modules/.bin/wrangler"),
        [
          "deploy",
          "--config",
          builtConfigPath,
          ...(mode === "dry-run" ? ["--dry-run"] : []),
        ],
        {
          cwd: repositoryRoot,
          env: deployEnvironment,
          category: mode,
        },
      );
    });
  });
  for (const check of successfulProductionDeployChecks(
    mode,
    reminderSmsEnabled,
  )) {
    console.log(check);
  }
} catch (error) {
  console.error(fixedProductionDeployFailure(error));
  process.exitCode = 1;
}
