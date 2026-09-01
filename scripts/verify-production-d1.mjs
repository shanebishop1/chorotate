import { spawnSync } from "node:child_process";

import {
  buildProductionD1VerificationQuery,
  expectedProductionD1Result,
  productionD1SettingsFromEnvironment,
} from "./production-d1-contract.mjs";

const dryRun = process.argv.includes("--dry-run");
const unexpectedArgs = process.argv
  .slice(2)
  .filter((argument) => argument !== "--dry-run");
if (unexpectedArgs.length > 0) {
  console.error("Usage: node scripts/verify-production-d1.mjs [--dry-run]");
  process.exit(1);
}

if (dryRun) {
  console.log(
    "Remote D1 verification dry-run passed: command shape is fixed; checks cover migrations 0001-0008, exact household/member/identity/chore/rotation structure, contact readiness, and outbox duplicates; no remote request was made and no values were printed.",
  );
  process.exit(0);
}

/** @type {string} */
let verificationQuery;
try {
  verificationQuery = buildProductionD1VerificationQuery(
    productionD1SettingsFromEnvironment(process.env),
  );
} catch (error) {
  console.error(
    error instanceof Error
      ? error.message
      : "Invalid production D1 verification settings",
  );
  process.exit(1);
}

const result = spawnSync(
  process.execPath,
  [
    "node_modules/wrangler/bin/wrangler.js",
    "d1",
    "execute",
    "chorotate-production",
    "--remote",
    "--json",
    "--command",
    verificationQuery,
  ],
  { encoding: "utf8", maxBuffer: 1024 * 1024 },
);
if (result.status !== 0) {
  console.error(
    "Remote D1 verification unavailable or failed; confirm Cloudflare credentials, account access, and the chorotate-production database. Provider output was withheld.",
  );
  process.exit(result.status ?? 1);
}

/** @type {Record<string, unknown> | undefined} */
let row;
try {
  const payload = JSON.parse(result.stdout);
  row = payload?.[0]?.results?.[0];
} catch {
  // Do not include raw provider output: it can contain resource identifiers.
}
if (row === null || typeof row !== "object") {
  console.error(
    "Remote D1 verification returned an unreadable redacted result.",
  );
  process.exit(1);
}

const failures = Object.entries(expectedProductionD1Result)
  .filter(([name, value]) => row[name] !== value)
  .map(([name]) => name);
if (failures.length > 0) {
  console.error(
    `Remote D1 verification failed safe checks: ${failures.sort().join(", ")}. Values were not printed.`,
  );
  process.exit(1);
}

console.log(
  "Remote D1 verification passed: migrations 0001-0008, exact household/member/identity/contact/chore/rotation structure, and outbox uniqueness; Cloudflare D1 was queried, no values were printed, and no Textbelt request was made.",
);
