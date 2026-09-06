import { constants } from "node:fs";
import { open, readFile, realpath, stat } from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";
import { fileURLToPath } from "node:url";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const memberIdPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const maximumRosterSize = 50;
const e164Pattern = /^\+[1-9]\d{1,14}$/;
const consentStatuses = new Set(["not_recorded", "consented", "revoked"]);
const suppressionStatuses = new Set(["not_suppressed", "suppressed"]);
const weekdays = new Map([
  ["sunday", 0],
  ["monday", 1],
  ["tuesday", 2],
  ["wednesday", 3],
  ["thursday", 4],
  ["friday", 5],
  ["saturday", 6],
]);
const localTimePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const repositoryRoot = resolve(
  fileURLToPath(new URL("../..", import.meta.url)),
);

/** @param {unknown} input */
export function validateContactInput(input) {
  /** @type {string[]} */
  const failures = [];
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Invalid operator contact input: document shape");
  }
  const document = /** @type {Record<string, unknown>} */ (input);
  const documentKeys = Object.keys(document).sort();
  if (
    documentKeys.join(",") !== "householdId,householdName,members,recordedAt" ||
    document.householdId !== "chorotate"
  ) {
    failures.push("document contract");
  }
  if (
    typeof document.householdName !== "string" ||
    document.householdName !== document.householdName.trim() ||
    document.householdName.length === 0 ||
    document.householdName.length > 100
  ) {
    failures.push("household name");
  }
  if (
    typeof document.recordedAt !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(
      document.recordedAt,
    ) ||
    Number.isNaN(Date.parse(document.recordedAt))
  ) {
    failures.push("recorded-at timestamp");
  }
  if (!Array.isArray(document.members)) {
    failures.push("member list");
  }

  const members = Array.isArray(document.members) ? document.members : [];
  const emails = new Set();
  const ids = new Set();
  const displayNames = new Set();
  if (members.length === 0 || members.length > maximumRosterSize) {
    failures.push("bounded member list");
  }
  for (const candidate of members) {
    if (
      candidate === null ||
      typeof candidate !== "object" ||
      Array.isArray(candidate)
    ) {
      failures.push("member shape");
      continue;
    }
    const member = /** @type {Record<string, unknown>} */ (candidate);
    if (
      Object.keys(member).sort().join(",") !==
      "consent,displayName,email,id,phoneE164,suppression"
    ) {
      failures.push("member fields");
    }
    if (
      typeof member.id !== "string" ||
      member.id.length > 64 ||
      !memberIdPattern.test(member.id) ||
      ids.has(member.id)
    ) {
      failures.push("unique safe member id");
    } else {
      ids.add(member.id);
    }
    if (
      typeof member.displayName !== "string" ||
      member.displayName !== member.displayName.trim() ||
      member.displayName.length === 0 ||
      member.displayName.length > 100 ||
      displayNames.has(member.displayName)
    ) {
      failures.push("unique trimmed display name");
    } else {
      displayNames.add(member.displayName);
    }

    if (
      typeof member.email !== "string" ||
      member.email !== member.email.trim().toLowerCase() ||
      !emailPattern.test(member.email) ||
      member.email.length > 254 ||
      member.email.endsWith(".invalid") ||
      member.email.includes("*") ||
      emails.has(member.email)
    ) {
      failures.push("exact normalized unique email");
    } else {
      emails.add(member.email);
    }
    if (
      member.phoneE164 !== null &&
      (typeof member.phoneE164 !== "string" ||
        !e164Pattern.test(member.phoneE164))
    ) {
      failures.push("E.164 contact");
    }
    if (
      typeof member.consent !== "string" ||
      !consentStatuses.has(member.consent)
    ) {
      failures.push("consent state");
    }
    if (
      typeof member.suppression !== "string" ||
      !suppressionStatuses.has(member.suppression)
    ) {
      failures.push("suppression state");
    }
  }
  if (failures.length > 0) {
    throw new Error(
      `Invalid operator contact input: ${[...new Set(failures)].sort().join(", ")}`,
    );
  }
  return /** @type {{householdId: string, householdName: string, recordedAt: string, members: Array<{id: string, displayName: string, email: string, phoneE164: string | null, consent: string, suppression: string}>}} */ (
    input
  );
}

/** @param {ReturnType<typeof validateContactInput>} input */
export function summarizeContactReadiness(input) {
  const summary = {
    total: input.members.length,
    sendable: 0,
    missing: 0,
    unconsented: 0,
    suppressed: 0,
  };
  for (const member of input.members) {
    if (member.phoneE164 === null) summary.missing += 1;
    if (member.consent !== "consented") summary.unconsented += 1;
    if (member.suppression === "suppressed") summary.suppressed += 1;
    if (
      member.phoneE164 !== null &&
      member.consent === "consented" &&
      member.suppression === "not_suppressed"
    ) {
      summary.sendable += 1;
    }
  }
  return summary;
}

/** @param {string} value */
const sqlString = (value) => `'${value.replaceAll("'", "''")}'`;

/** @param {ReturnType<typeof validateContactInput>} input */
function buildContactSqlTemplate(input) {
  const members = input.members;
  const memberCount = members.length;
  const ids = members.map((member) => sqlString(member.id)).join(", ");
  const emailCases = members
    .map(
      (member) =>
        `    WHEN ${sqlString(member.id)} THEN ${sqlString(member.email)}`,
    )
    .join("\n");
  const displayNameCases = members
    .map(
      (member) =>
        `    WHEN ${sqlString(member.id)} THEN ${sqlString(member.displayName)}`,
    )
    .join("\n");
  /** @param {"phoneE164" | "consent" | "suppression"} field */
  const memberCases = (field) =>
    members
      .map((member) => {
        const value = member[field];
        return `    WHEN ${sqlString(member.id)} THEN ${value === null ? "NULL" : sqlString(value)}`;
      })
      .join("\n");

  return `-- PRIVATE OPERATOR INPUT. Contains sensitive contact data. Do not commit or log.\nPRAGMA foreign_keys = ON;\nCREATE TABLE operator_identity_assert (matched_rows INTEGER CHECK (matched_rows = ${memberCount}));\nINSERT INTO operator_identity_assert SELECT count(*) FROM allowlisted_identities WHERE household_id = ${sqlString(input.householdId)};\n-- An exact-email change invalidates the old authorization binding and sessions.\nDELETE FROM "session"\nWHERE "userId" IN (\n  SELECT auth_user_id\n  FROM allowlisted_identities\n  WHERE household_id = ${sqlString(input.householdId)}\n    AND member_id IN (${ids})\n    AND auth_user_id IS NOT NULL\n    AND email_normalized <> CASE member_id\n${emailCases}\n      END\n);\nUPDATE allowlisted_identities\nSET auth_user_id = CASE\n      WHEN email_normalized <> CASE member_id\n${emailCases}\n        END THEN NULL\n      ELSE auth_user_id\n    END,\n    email_normalized = CASE member_id\n${emailCases}\n  END\nWHERE household_id = ${sqlString(input.householdId)} AND member_id IN (${ids});\nINSERT INTO operator_identity_assert VALUES (changes());\nCREATE TABLE operator_contact_assert (matched_rows INTEGER CHECK (matched_rows = ${memberCount}));\nINSERT INTO operator_contact_assert SELECT count(*) FROM members WHERE household_id = ${sqlString(input.householdId)};\nUPDATE members\nSET display_name = CASE id\n${displayNameCases}\n  END,\n    sms_phone_e164 = CASE id\n${memberCases("phoneE164")}\n  END,\n    sms_consent_status = CASE id\n${memberCases("consent")}\n  END,\n    sms_suppression_status = CASE id\n${memberCases("suppression")}\n  END,\n    sms_contact_updated_at = ${sqlString(input.recordedAt)}\nWHERE household_id = ${sqlString(input.householdId)} AND id IN (${ids});\nINSERT INTO operator_contact_assert VALUES (changes());\nDROP TABLE operator_contact_assert;\nDROP TABLE operator_identity_assert;\n`;
}

/** @param {ReturnType<typeof validateContactInput>} input */
export function buildContactSql(input) {
  const identityDistinctAssertion = `INSERT INTO operator_identity_assert SELECT count(DISTINCT member_id) FROM allowlisted_identities WHERE household_id = ${sqlString(input.householdId)};`;
  return buildContactSqlTemplate(input).replace(
    "-- An exact-email change",
    `${identityDistinctAssertion}\n-- An exact-email change`,
  );
}

/**
 * @param {unknown} settings
 * @returns {{timeZone: string, weekStart: string, weekStartNumber: number, eveningTime: string, morningTime: string}}
 */
function validateBootstrapSettings(settings) {
  /** @type {string[]} */
  const failures = [];
  if (settings === null || typeof settings !== "object") {
    throw new Error("Invalid production bootstrap settings: document shape");
  }
  const input = /** @type {Record<string, unknown>} */ (settings);
  const timeZone = input.timeZone;
  const weekStart = input.weekStart;
  const eveningTime = input.eveningTime;
  const morningTime = input.morningTime;
  if (
    typeof timeZone !== "string" ||
    timeZone !== timeZone.trim() ||
    timeZone.length === 0 ||
    timeZone.length > 100
  ) {
    failures.push("IANA time zone");
  } else {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone }).format();
    } catch {
      failures.push("IANA time zone");
    }
  }
  if (typeof weekStart !== "string" || !weekdays.has(weekStart)) {
    failures.push("household week start");
  }
  if (typeof eveningTime !== "string" || !localTimePattern.test(eveningTime)) {
    failures.push("evening reminder time");
  }
  if (typeof morningTime !== "string" || !localTimePattern.test(morningTime)) {
    failures.push("morning reminder time");
  }
  if (failures.length > 0) {
    throw new Error(
      `Invalid production bootstrap settings: ${[...new Set(failures)].sort().join(", ")}`,
    );
  }
  return {
    timeZone: /** @type {string} */ (timeZone),
    weekStart: /** @type {string} */ (weekStart),
    weekStartNumber: /** @type {number} */ (
      weekdays.get(/** @type {string} */ (weekStart))
    ),
    eveningTime: /** @type {string} */ (eveningTime),
    morningTime: /** @type {string} */ (morningTime),
  };
}

/**
 * @param {ReturnType<typeof validateContactInput>} input
 * @param {unknown} settings
 */
function buildBootstrapSqlTemplate(input, settings) {
  const bootstrap = validateBootstrapSettings(settings);
  const members = input.members;
  const memberRows = members
    .map(
      (member) =>
        `  (${sqlString(member.id)}, ${sqlString(input.householdId)}, ${sqlString(member.displayName)}, 1, ${sqlString(input.recordedAt)}, ${member.phoneE164 === null ? "NULL" : sqlString(member.phoneE164)}, ${sqlString(member.consent)}, ${sqlString(member.suppression)}, ${sqlString(input.recordedAt)})`,
    )
    .join(",\n");
  const identityRows = members
    .map(
      (member) =>
        `  (${sqlString(`identity-${member.id}`)}, ${sqlString(input.householdId)}, ${sqlString(member.id)}, ${sqlString(member.email)}, NULL, 1, ${sqlString(input.recordedAt)})`,
    )
    .join(",\n");
  const rotationMemberRows = [
    ...members.map(
      (member, position) =>
        `  (${sqlString(input.householdId)}, 'rotation-trash-2026-08-28', ${sqlString(member.id)}, ${position})`,
    ),
    ...members.map(
      (member, position) =>
        `  (${sqlString(input.householdId)}, 'rotation-dishwasher-2026-08-31', ${sqlString(member.id)}, ${position})`,
    ),
  ].join(",\n");

  return `-- PRIVATE OPERATOR INPUT. Contains sensitive identity/contact data. Do not commit or log.\n-- First-run only: refuses any pre-existing ChoRotate production structure.\nPRAGMA foreign_keys = ON;\nCREATE TABLE operator_bootstrap_assert (existing_rows INTEGER CHECK (existing_rows = 0));\nINSERT INTO operator_bootstrap_assert\nSELECT\n+  (SELECT count(*) FROM households WHERE id = ${sqlString(input.householdId)})\n+  (SELECT count(*) FROM members WHERE household_id = ${sqlString(input.householdId)})\n+  (SELECT count(*) FROM allowlisted_identities WHERE household_id = ${sqlString(input.householdId)})\n+  (SELECT count(*) FROM chores WHERE household_id = ${sqlString(input.householdId)})\n+  (SELECT count(*) FROM rotation_configs WHERE household_id = ${sqlString(input.householdId)});\nINSERT INTO households\n  (id,name,time_zone,week_start,created_at,reminder_evening_local_time,reminder_morning_local_time)\nVALUES\n  (${sqlString(input.householdId)}, 'ChoRotate', ${sqlString(bootstrap.timeZone)}, ${bootstrap.weekStartNumber}, ${sqlString(input.recordedAt)}, ${sqlString(bootstrap.eveningTime)}, ${sqlString(bootstrap.morningTime)});\nINSERT INTO members\n  (id,household_id,display_name,active,created_at,sms_phone_e164,sms_consent_status,sms_suppression_status,sms_contact_updated_at)\nVALUES\n${memberRows};\nINSERT INTO allowlisted_identities\n  (id,household_id,member_id,email_normalized,auth_user_id,active,created_at)\nVALUES\n${identityRows};\nINSERT INTO chores\n  (id,household_id,name,active,created_at,instructions,ownership_start_weekday)\nVALUES\n  ('trash', ${sqlString(input.householdId)}, 'Trash', 1, ${sqlString(input.recordedAt)}, 'Take the trash out and replace bags.', 5),\n  ('dishwasher', ${sqlString(input.householdId)}, 'Dishwasher', 1, ${sqlString(input.recordedAt)}, 'Empty the completed dishwasher.', 1);\nINSERT INTO rotation_configs\n  (id,household_id,chore_id,effective_from,rotation_offset,created_at)\nVALUES\n  ('rotation-trash-2026-08-28', ${sqlString(input.householdId)}, 'trash', '2026-08-28', 0, ${sqlString(input.recordedAt)}),\n  ('rotation-dishwasher-2026-08-31', ${sqlString(input.householdId)}, 'dishwasher', '2026-08-31', 2, ${sqlString(input.recordedAt)});\nINSERT INTO rotation_config_members\n  (household_id,rotation_config_id,member_id,position)\nVALUES\n${rotationMemberRows};\nDROP TABLE operator_bootstrap_assert;\n`;
}

/**
 * @param {ReturnType<typeof validateContactInput>} input
 * @param {unknown} settings
 */
export function buildBootstrapSql(input, settings) {
  return buildBootstrapSqlTemplate(input, settings).replace(
    `(${sqlString(input.householdId)}, 'ChoRotate',`,
    `(${sqlString(input.householdId)}, ${sqlString(input.householdName)},`,
  );
}

/** @param {string} path */
function outsideRepository(path) {
  const relation = relative(repositoryRoot, resolve(path));
  return (
    isAbsolute(relation) ||
    relation === ".." ||
    relation.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)
  );
}

/** @param {string} path */
function inLocalPrivateDirectory(path) {
  const relation = relative(join(repositoryRoot, ".chorotate"), resolve(path));
  return (
    relation === "" ||
    (!isAbsolute(relation) &&
      relation !== ".." &&
      !relation.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`))
  );
}

/** @param {string} path */
function allowedPrivatePath(path) {
  return outsideRepository(path) || inLocalPrivateDirectory(path);
}

async function main() {
  const args = process.argv.slice(2);
  const bootstrap = args.includes("--bootstrap");
  const inputIndex = args.indexOf("--input");
  const outputIndex = args.indexOf("--output");
  const timeZoneIndex = args.indexOf("--time-zone");
  const weekStartIndex = args.indexOf("--week-start");
  const eveningTimeIndex = args.indexOf("--evening-time");
  const morningTimeIndex = args.indexOf("--morning-time");
  const expectedLength = bootstrap ? 13 : 4;
  if (
    args.length !== expectedLength ||
    args.filter((argument) => argument === "--bootstrap").length !==
      (bootstrap ? 1 : 0) ||
    args.filter((argument) => argument === "--input").length !== 1 ||
    args.filter((argument) => argument === "--output").length !== 1 ||
    inputIndex === -1 ||
    outputIndex === -1 ||
    !args[inputIndex + 1] ||
    !args[outputIndex + 1] ||
    (bootstrap &&
      (timeZoneIndex === -1 ||
        weekStartIndex === -1 ||
        eveningTimeIndex === -1 ||
        morningTimeIndex === -1 ||
        !args[timeZoneIndex + 1] ||
        !args[weekStartIndex + 1] ||
        !args[eveningTimeIndex + 1] ||
        !args[morningTimeIndex + 1]))
  ) {
    throw new Error(
      bootstrap
        ? "Usage: node scripts/operator/operator-contact-config.mjs --bootstrap --input <private-json-path> --output <new-private-sql-path> --time-zone <iana-zone> --week-start <weekday> --evening-time <HH:mm> --morning-time <HH:mm>"
        : "Usage: node scripts/operator/operator-contact-config.mjs --input <private-json-path> --output <new-private-sql-path>",
    );
  }
  const inputPath = await realpath(resolve(args[inputIndex + 1]));
  const outputParent = await realpath(dirname(resolve(args[outputIndex + 1])));
  const outputPath = join(outputParent, basename(args[outputIndex + 1]));
  if (!allowedPrivatePath(inputPath) || !allowedPrivatePath(outputPath)) {
    throw new Error(
      "Operator input and output paths must be outside the repository or under .chorotate",
    );
  }
  const inputStat = await stat(inputPath);
  if (!inputStat.isFile() || (inputStat.mode & 0o777) !== 0o600) {
    throw new Error("Operator input must be a regular file with mode 0600");
  }
  const input = validateContactInput(
    JSON.parse(await readFile(inputPath, "utf8")),
  );
  const sql = bootstrap
    ? buildBootstrapSql(input, {
        timeZone: args[timeZoneIndex + 1],
        weekStart: args[weekStartIndex + 1],
        eveningTime: args[eveningTimeIndex + 1],
        morningTime: args[morningTimeIndex + 1],
      })
    : buildContactSql(input);
  const output = await open(
    outputPath,
    constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
    0o600,
  );
  try {
    await output.chmod(0o600);
    await output.writeFile(sql, "utf8");
  } finally {
    await output.close();
  }
  const summary = summarizeContactReadiness(input);
  console.log(
    `Prepared private D1 ${bootstrap ? "bootstrap" : "contact update"} without printing values: total=${summary.total}, sendable=${summary.sendable}, missing=${summary.missing}, unconsented=${summary.unconsented}, suppressed=${summary.suppressed}.`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(
      error instanceof Error ? error.message : "Operator preparation failed",
    );
    process.exitCode = 1;
  });
}
