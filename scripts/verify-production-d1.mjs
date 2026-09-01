import { spawnSync } from "node:child_process";

const dryRun = process.argv.includes("--dry-run");
const unexpectedArgs = process.argv
  .slice(2)
  .filter((argument) => argument !== "--dry-run");
if (unexpectedArgs.length > 0) {
  console.error("Usage: node scripts/verify-production-d1.mjs [--dry-run]");
  process.exit(1);
}

const expectedMigrations = [
  "0001_domain_schema.sql",
  "0002_assignment_audit_triggers.sql",
  "0003_chore_instructions.sql",
  "0004_better_auth.sql",
  "0005_reminder_reliability.sql",
  "0006_assignment_integrity.sql",
  "0007_sms_contact_period_outbox.sql",
  "0008_sms_occurrence_times.sql",
].join("|");

// This query deliberately returns only counts and booleans. It never selects an
// email address, phone number, auth identifier, provider receipt, or secret.
const verificationQuery = `
SELECT
  (SELECT group_concat(name, '|') FROM (SELECT name FROM d1_migrations ORDER BY id)) AS migrations,
  (SELECT count(*) FROM members WHERE active = 1) AS active_members,
  (SELECT count(*) FROM allowlisted_identities WHERE active = 1) AS active_identities,
  (SELECT count(*) FROM allowlisted_identities
    WHERE active = 1
      AND household_id = 'chorotate'
      AND member_id IN ('jack', 'joe', 'dylan', 'shane')) AS exact_active_identities,
  (SELECT count(*) FROM allowlisted_identities
    WHERE active = 1 AND (
      email_normalized <> lower(trim(email_normalized)) OR
      email_normalized NOT LIKE '%_@_%._%' OR
      email_normalized LIKE '%.invalid' OR
      email_normalized LIKE '%*%'
    )) AS invalid_identities,
  (SELECT count(*) FROM members
    WHERE active = 1 AND sms_phone_e164 IS NULL) AS missing_contacts,
  (SELECT count(*) FROM members
    WHERE active = 1 AND sms_phone_e164 IS NOT NULL AND NOT (
      sms_phone_e164 = trim(sms_phone_e164) AND
      length(sms_phone_e164) BETWEEN 3 AND 16 AND
      substr(sms_phone_e164, 1, 1) = '+' AND
      substr(sms_phone_e164, 2, 1) BETWEEN '1' AND '9' AND
      substr(sms_phone_e164, 2) NOT GLOB '*[^0-9]*'
    )) AS malformed_contacts,
  (SELECT count(*) FROM members
    WHERE active = 1 AND sms_consent_status <> 'consented') AS unconsented_contacts,
  (SELECT count(*) FROM members
    WHERE active = 1 AND sms_suppression_status <> 'not_suppressed') AS suppressed_contacts,
  (SELECT count(*) FROM chores
    WHERE active = 1 AND ((id = 'trash' AND ownership_start_weekday = 5) OR
      (id = 'dishwasher' AND ownership_start_weekday = 1))) AS expected_chore_boundaries,
  (SELECT count(*) FROM (
    SELECT household_id, assignment_id, assignment_version, local_period_start,
      chore_id, occurrence_phase, recipient_member_id
    FROM reminder_outbox
    GROUP BY household_id, assignment_id, assignment_version, local_period_start,
      chore_id, occurrence_phase, recipient_member_id
    HAVING count(*) > 1
  )) AS duplicate_occurrences;
`;

if (dryRun) {
  console.log(
    "Remote D1 verification dry-run passed: command shape is fixed; checks cover migrations 0001-0008, exact identities, contact readiness, chore boundaries, and outbox duplicates; no remote request was made and no values were printed.",
  );
  process.exit(0);
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

const expected = {
  migrations: expectedMigrations,
  active_members: 4,
  active_identities: 4,
  exact_active_identities: 4,
  invalid_identities: 0,
  missing_contacts: 0,
  malformed_contacts: 0,
  unconsented_contacts: 0,
  suppressed_contacts: 0,
  expected_chore_boundaries: 2,
  duplicate_occurrences: 0,
};
const failures = Object.entries(expected)
  .filter(([name, value]) => row[name] !== value)
  .map(([name]) => name);
if (failures.length > 0) {
  console.error(
    `Remote D1 verification failed safe checks: ${failures.sort().join(", ")}. Values were not printed.`,
  );
  process.exit(1);
}

console.log(
  "Remote D1 verification passed: migrations 0001-0008, four exact active identities/contacts, chore boundaries, and outbox uniqueness; Cloudflare D1 was queried, no values were printed, and no Textbelt request was made.",
);
