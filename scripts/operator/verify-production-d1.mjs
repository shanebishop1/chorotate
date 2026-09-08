import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

import {
  readOperatorInput,
  summarizeContactReadiness,
} from "./operator-contact-config.mjs";

import {
  buildProductionD1VerificationQuery,
  expectedProductionD1Result,
  parseProductionD1VerificationOutput,
  productionD1SettingsFromEnvironment,
} from "../deployment/production-d1-contract.mjs";
import {
  buildProductionD1OperatorConfig,
  buildProductionD1WranglerArgs,
  productionD1DatabaseIdFromEnvironment,
  productionWranglerEnvironment,
  withTemporaryWranglerConfig,
} from "../deployment/production-d1-wrangler.mjs";
import { loadProductionEnvironment } from "../deployment/load-production-environment.mjs";

loadProductionEnvironment();

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const inputIndex = args.indexOf("--input");
const unexpectedArgs = args.filter(
  (argument, index) =>
    argument !== "--dry-run" &&
    argument !== "--input" &&
    !(inputIndex !== -1 && index === inputIndex + 1),
);
if (
  unexpectedArgs.length > 0 ||
  (inputIndex !== -1 && !args[inputIndex + 1]) ||
  args.filter((argument) => argument === "--input").length > 1
) {
  console.error(
    "Usage: node scripts/operator/verify-production-d1.mjs [--dry-run] [--input <private-json-path>]",
  );
  process.exit(1);
}

if (dryRun && inputIndex === -1) {
  console.log(
    "Remote D1 verification dry-run passed: command shape is fixed; checks cover migrations 0001-0008, exact household/member/identity/chore/rotation structure, contact-state integrity, SMS sendability only when enabled, and outbox duplicates; no remote request was made and no values were printed.",
  );
  process.exit(0);
}

async function main() {
  const input =
    inputIndex === -1
      ? undefined
      : await readOperatorInput(args[inputIndex + 1]);
  let settings;
  try {
    settings = productionD1SettingsFromEnvironment(
      process.env,
      input === undefined
        ? undefined
        : { memberCount: input.members.length, chores: input.chores },
    );
  } catch (error) {
    throw new Error(
      error instanceof Error
        ? error.message
        : "Invalid production D1 verification settings",
      { cause: error },
    );
  }
  const verificationQuery = buildProductionD1VerificationQuery(settings);
  const contactReadiness =
    input === undefined ? undefined : summarizeContactReadiness(input);
  const contactCounts =
    contactReadiness === undefined
      ? undefined
      : { ...contactReadiness, malformed: 0 };
  const expectedResult = expectedProductionD1Result(
    settings.memberCount,
    settings.chores,
    {
      smsEnabled: settings.smsEnabled,
      contactCounts,
    },
  );

  if (dryRun) {
    console.log(
      "Remote D1 verification dry-run passed: private input, settings, query, and expected result were validated; no remote request was made and no values were printed.",
    );
    return;
  }

  const databaseId = productionD1DatabaseIdFromEnvironment(process.env);
  const result = await withTemporaryWranglerConfig(
    buildProductionD1OperatorConfig(databaseId),
    ({ configPath }) =>
      spawnSync(
        process.execPath,
        [
          resolve("node_modules/wrangler/bin/wrangler.js"),
          ...buildProductionD1WranglerArgs("verify", {
            configPath,
            verificationQuery,
          }),
        ],
        {
          encoding: "utf8",
          maxBuffer: 1024 * 1024,
          env: productionWranglerEnvironment(process.env),
        },
      ),
  );
  if (result.status !== 0) {
    throw new Error(
      "Remote D1 verification unavailable or failed; confirm Cloudflare credentials, account access, and the chorotate-production database. Provider output was withheld.",
    );
  }

  const row = parseProductionD1VerificationOutput(result.stdout);
  if (row === undefined) {
    throw new Error(
      "Remote D1 verification returned an unreadable redacted result.",
    );
  }

  const failures = Object.entries(expectedResult)
    .filter(([name, value]) => value !== undefined && row[name] !== value)
    .map(([name]) => name);
  if (failures.length > 0) {
    throw new Error(
      `Remote D1 verification failed safe checks: ${failures.sort().join(", ")}. Values were not printed.`,
    );
  }

  console.log(
    "Remote D1 verification passed: migrations 0001-0008, exact household/member/identity/contact/configured-chore/rotation structure, and outbox uniqueness; Cloudflare D1 was queried, no values were printed, and no Textbelt request was made.",
  );
}

main().catch((error) => {
  console.error(
    error instanceof Error
      ? error.message
      : "Production D1 verification failed",
  );
  process.exitCode = 1;
});
