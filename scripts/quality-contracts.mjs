import { readFileSync, readdirSync } from "node:fs";
import { extname } from "node:path";

import { repositoryFiles, textFile } from "./repository-files.mjs";

/** @type {string[]} */
const failures = [];
/** @param {string} label @param {boolean} condition @param {string} [detail] */
function check(label, condition, detail = "") {
  if (condition) console.log(`PASS ${label}${detail ? ` — ${detail}` : ""}`);
  else failures.push(`${label}${detail ? ` — ${detail}` : ""}`);
}

/** @param {string} path */
const read = (path) => readFileSync(path, "utf8");
const packageJson = JSON.parse(read("package.json"));
const lock = JSON.parse(read("package-lock.json"));
const ci = read(".github/workflows/ci.yml");
const environment = read("app/runtime/environment.ts");
const productionDeploy = read("scripts/production-deploy.mjs");
const productionDeployOutput = read("scripts/production-deploy-output.mjs");
const releaseGate = read("scripts/release-gate.mjs");
const textbelt = read("app/domain/reminders/textbelt.ts");
const workerBindings = read("worker-configuration.d.ts");

check("exact Node engine pin", packageJson.engines?.node === "24.20.0");
check("exact npm pin", packageJson.packageManager === "npm@11.19.0");
check(
  "lockfile toolchain metadata",
  lock.packages?.[""]?.engines?.node === packageJson.engines.node,
);
check(
  "CI action references are immutable",
  [...ci.matchAll(/^\s*- uses:\s*(\S+)/gm)].every(([, reference]) =>
    /@[0-9a-f]{40}$/.test(reference),
  ),
);
check(
  "CI does not persist checkout credentials",
  /persist-credentials:\s*false/.test(ci),
);
check("CI installs the lockfile", /run:\s*npm ci\b/.test(ci));
check(
  "CI runs the complete release gate",
  /run:\s*npm run check:release\b/.test(ci),
);
const requiredReleaseChecks = [
  "doctor",
  "format:check",
  "lint",
  "auth:schema:check",
  "cf-typegen:check",
  "typecheck",
  "test",
  "test:workerd",
  "planning:check",
  "operator:contacts:test",
  "operator:d1:test",
  "deploy:production:test",
  "operator:d1:verify:dry-run",
  "build",
  "test:browser",
  "audit",
  "scan:secrets",
];
check(
  "release gate contains every credential-free check",
  requiredReleaseChecks.every((script) => releaseGate.includes(`"${script}"`)),
  requiredReleaseChecks.join(", "),
);
check(
  "release gate checks working-tree drift",
  /git[\s\S]*status[\s\S]*--porcelain=v1[\s\S]*Release gate detected working-tree drift/.test(
    releaseGate,
  ),
);

const migrations = readdirSync("migrations")
  .filter((name) => name.endsWith(".sql"))
  .sort();
const migrationNumbers = migrations.map((name) => Number(name.slice(0, 4)));
check(
  "current ordered migration set",
  migrations.at(-1) === "0008_sms_occurrence_times.sql" &&
    migrationNumbers.every((number, index) => number === index + 1),
  migrations.join(", "),
);
check(
  "production D1 uses canonical migrations",
  /migrations_dir:\s*resolve\("migrations"\)/.test(productionDeploy),
);
check(
  "production deploy withholds child output and emits fixed summaries",
  /runWithSuppressedChildOutput/.test(productionDeploy) &&
    /withEmittedDeployConfigCleanup/.test(productionDeploy) &&
    !/redactPrivateValues|process\.(?:stdout|stderr)\.write/.test(
      productionDeploy,
    ) &&
    /stdio:\s*\["ignore",\s*"ignore",\s*"ignore"\]/.test(
      productionDeployOutput,
    ) &&
    /PASS production Worker name chorotate-production/.test(
      productionDeployOutput,
    ) &&
    /PASS deployment provider output withheld/.test(productionDeployOutput),
);
check(
  "generated bindings contain no removed provider or contact inputs",
  !/RESEND_|(?:TEXTBELT|TEXT_BELT)[A-Z0-9_]*(?:KEY|SECRET|TOKEN)|(?:PHONE|E164|CONTACT)/i.test(
    workerBindings.slice(0, workerBindings.indexOf("// Begin runtime types")),
  ),
);

const productionExtensions = new Set([".js", ".mjs", ".ts", ".tsx"]);
/** @type {Array<[string, string]>} */
const productionSources = [];
for (const path of repositoryFiles({ includeUntracked: true })) {
  const included =
    !path.startsWith(".beads/") &&
    !path.startsWith(".exaskill/") &&
    (path.startsWith("app/") ||
      path.startsWith("workers/") ||
      path === "package.json" ||
      path === "wrangler.jsonc" ||
      path === ".dev.vars.example" ||
      path === "scripts/production-deploy.mjs") &&
    (productionExtensions.has(extname(path)) ||
      ["package.json", "wrangler.jsonc", ".dev.vars.example"].includes(path)) &&
    !path.includes(".test.") &&
    !path.includes("test-support") &&
    !path.includes("test-fixtures");
  if (!included) continue;
  const source = textFile(path);
  if (source !== null) productionSources.push([path, source]);
}
const removedProviderFindings = productionSources.filter(([, source]) =>
  /RESEND_|\bresend\b/i.test(source),
);
check(
  "removed Resend runtime and configuration paths",
  removedProviderFindings.length === 0,
  removedProviderFindings.map(([path]) => path).join(", "),
);

const reminderRuntime = productionSources.filter(([path]) =>
  path.startsWith("app/domain/reminders/"),
);
const emailTransportFindings = reminderRuntime.filter(([, source]) =>
  /\bemail\b|mailto:|smtp/i.test(source),
);
check(
  "SMS-only reminder runtime",
  emailTransportFindings.length === 0,
  emailTransportFindings.map(([path]) => path).join(", "),
);

const environmentContract = `${environment}\n${productionDeploy}\n${read("wrangler.jsonc")}\n${read(".dev.vars.example")}`;
const scriptConfigurationContract = repositoryFiles({ includeUntracked: true })
  .filter(
    (path) =>
      path.startsWith("scripts/") &&
      path.endsWith(".mjs") &&
      !["scripts/quality-contracts.mjs", "scripts/secret-scan.mjs"].includes(
        path,
      ),
  )
  .map((path) => textFile(path) ?? "")
  .join("\n");
check(
  "removed Resend scripts",
  !/RESEND_|\bresend\b/i.test(scriptConfigurationContract),
);
const operatorSurfaces = [
  "README.md",
  ".dev.vars.example",
  "package.json",
  "scripts/production-deploy.mjs",
  ...repositoryFiles({ includeUntracked: true }).filter(
    (path) => path.startsWith("docs/operations/") && path.endsWith(".md"),
  ),
]
  .map((path) => textFile(path) ?? "")
  .join("\n");
check(
  "operator surfaces contain no removed provider instructions or variables",
  !/RESEND_|\bresend\b/i.test(operatorSurfaces),
);
check(
  "no Textbelt secret or API-key environment input",
  !/(?:TEXTBELT|TEXT_BELT)[A-Z0-9_]*(?:KEY|SECRET|TOKEN)|(?:KEY|SECRET|TOKEN)[A-Z0-9_]*(?:TEXTBELT|TEXT_BELT)/i.test(
    `${environmentContract}\n${scriptConfigurationContract}`,
  ),
);
check(
  "fixed public Textbelt transport",
  /TEXTBELT_SMS_ENDPOINT\s*=\s*"https:\/\/textbelt\.com\/text"/.test(
    textbelt,
  ) &&
    /TEXTBELT_PUBLIC_KEY\s*=\s*"textbelt"/.test(textbelt) &&
    /key:\s*TEXTBELT_PUBLIC_KEY/.test(textbelt),
);

check(
  "contacts are not runtime or deploy environment inputs",
  !/(?:PHONE|E164|CONTACT)/.test(environmentContract),
);
const operatorContactTool = read("scripts/operator-contact-config.mjs");
const remoteD1Verification = `${read("scripts/verify-production-d1.mjs")}\n${read("scripts/production-d1-contract.mjs")}\n${read("scripts/production-d1-wrangler.mjs")}`;
const scheduledReminders = read("app/domain/reminders/scheduled.ts");
check(
  "operator contact preparation restricts private files to safe locations",
  /allowedPrivatePath\(inputPath\)/.test(operatorContactTool) &&
    /allowedPrivatePath\(outputPath\)/.test(operatorContactTool) &&
    /inLocalPrivateDirectory/.test(operatorContactTool) &&
    read(".gitignore").includes(".chorotate/") &&
    /O_EXCL/.test(operatorContactTool) &&
    /0o600/.test(operatorContactTool),
);
check(
  "fresh production bootstrap is explicit, complete, and assignment-safe",
  packageJson.scripts?.["operator:bootstrap:prepare"] ===
    "node scripts/operator-contact-config.mjs --bootstrap" &&
    /buildBootstrapSql/.test(operatorContactTool) &&
    /operator_bootstrap_assert/.test(operatorContactTool) &&
    /CREATE TABLE operator_bootstrap_assert/.test(operatorContactTool) &&
    /DROP TABLE operator_bootstrap_assert/.test(operatorContactTool) &&
    !/CREATE TEMP(?:ORARY)? TABLE/i.test(operatorContactTool) &&
    [
      "INSERT INTO households",
      "INSERT INTO members",
      "INSERT INTO allowlisted_identities",
      "INSERT INTO chores",
      "INSERT INTO rotation_configs",
      "INSERT INTO rotation_config_members",
    ].every((statement) => operatorContactTool.includes(statement)) &&
    !operatorContactTool.includes("INSERT INTO weekly_assignments"),
);
check(
  "SMS rollout is fail-closed until an explicit production enable",
  /"REMINDER_SMS_ENABLED":\s*"false"/.test(read("wrangler.jsonc")) &&
    /PRODUCTION_REMINDER_SMS_ENABLED/.test(productionDeploy) &&
    /if \(!runtime\.config\.reminders\.smsEnabled\) return/.test(
      scheduledReminders,
    ),
);
check(
  "remote D1 verification is contact-redacted and non-sending",
  /--remote/.test(remoteD1Verification) &&
    /operation === "verify"/.test(remoteD1Verification) &&
    /"--command"/.test(remoteD1Verification) &&
    /operation === "execute"/.test(remoteD1Verification) &&
    /"--file"/.test(remoteD1Verification) &&
    /exact_active_identities/.test(remoteD1Verification) &&
    /exact_active_members/.test(remoteD1Verification) &&
    /exact_identity_members/.test(remoteD1Verification) &&
    /expected_rotation_members/.test(remoteD1Verification) &&
    /PRODUCTION_HOUSEHOLD_MEMBER_COUNT/.test(remoteD1Verification) &&
    /count\(DISTINCT rotation_config_members\.position\)/.test(
      remoteD1Verification,
    ) &&
    !/member-[abc]|Member [ABC]/.test(remoteD1Verification) &&
    /missing_contacts/.test(remoteD1Verification) &&
    /duplicate_occurrences/.test(remoteD1Verification) &&
    !/textbelt\.com\/text/.test(remoteD1Verification),
);
const dispatcherTests = read("app/domain/reminders/dispatcher.test.ts");
check(
  "dispatcher fails closed for unusable contacts",
  [
    "missing_contact",
    "invalid_contact",
    "contact_unconsented",
    "contact_suppressed",
  ].every((category) => dispatcherTests.includes(category)) &&
    /transport\.send\)\.not\.toHaveBeenCalled/.test(dispatcherTests),
);
const contactSourceFindings = productionSources
  .filter(([, source]) => source.includes("sms_phone_e164"))
  .map(([path]) => path)
  .filter(
    (path) =>
      ![
        "app/domain/read-models/index.ts",
        "app/domain/reminders/dispatcher.ts",
        "app/domain/reminders/planner.ts",
      ].includes(path),
  );
check(
  "E.164 access is limited to D1 reminder and redacted projection paths",
  contactSourceFindings.length === 0,
  contactSourceFindings.join(", "),
);
check(
  "scheduled failure log is constant and sanitized",
  /reportScheduledFailure\("Reminder scheduled dispatch failed"\)/.test(
    read("workers/app.ts"),
  ),
);

if (failures.length > 0) {
  console.error("\nQuality contract checks failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(
    "\nQuality contract checks passed without printing configuration or contact values.",
  );
}
