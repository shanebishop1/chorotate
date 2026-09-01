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

const expectedMemberIds = ["jack", "joe", "dylan", "shane"];
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const e164Pattern = /^\+[1-9]\d{1,14}$/;
const consentStatuses = new Set(["not_recorded", "consented", "revoked"]);
const suppressionStatuses = new Set(["not_suppressed", "suppressed"]);
const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));

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
    documentKeys.join(",") !== "householdId,members,recordedAt" ||
    document.householdId !== "chorotate"
  ) {
    failures.push("document contract");
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
  const ids = [];
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
      "consent,email,id,phoneE164,suppression"
    ) {
      failures.push("member fields");
    }
    if (typeof member.id === "string") ids.push(member.id);
    else failures.push("member id");

    if (
      typeof member.email !== "string" ||
      member.email !== member.email.trim().toLowerCase() ||
      !emailPattern.test(member.email) ||
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
  if (
    ids.length !== expectedMemberIds.length ||
    [...ids].sort().join(",") !== [...expectedMemberIds].sort().join(",") ||
    new Set(ids).size !== ids.length
  ) {
    failures.push("exact member set");
  }
  if (failures.length > 0) {
    throw new Error(
      `Invalid operator contact input: ${[...new Set(failures)].sort().join(", ")}`,
    );
  }
  return /** @type {{householdId: string, recordedAt: string, members: Array<{id: string, email: string, phoneE164: string | null, consent: string, suppression: string}>}} */ (
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
export function buildContactSql(input) {
  const members = [...input.members].sort(
    (left, right) =>
      expectedMemberIds.indexOf(left.id) - expectedMemberIds.indexOf(right.id),
  );
  const ids = members.map((member) => sqlString(member.id)).join(", ");
  const emailCases = members
    .map(
      (member) =>
        `    WHEN ${sqlString(member.id)} THEN ${sqlString(member.email)}`,
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

  return `-- PRIVATE OPERATOR INPUT. Contains sensitive contact data. Do not commit or log.\nPRAGMA foreign_keys = ON;\nCREATE TEMP TABLE operator_identity_assert (matched_rows INTEGER CHECK (matched_rows = 4));\nUPDATE allowlisted_identities\nSET email_normalized = CASE member_id\n${emailCases}\n  END\nWHERE household_id = ${sqlString(input.householdId)} AND member_id IN (${ids});\nINSERT INTO operator_identity_assert VALUES (changes());\nCREATE TEMP TABLE operator_contact_assert (matched_rows INTEGER CHECK (matched_rows = 4));\nUPDATE members\nSET sms_phone_e164 = CASE id\n${memberCases("phoneE164")}\n  END,\n    sms_consent_status = CASE id\n${memberCases("consent")}\n  END,\n    sms_suppression_status = CASE id\n${memberCases("suppression")}\n  END,\n    sms_contact_updated_at = ${sqlString(input.recordedAt)}\nWHERE household_id = ${sqlString(input.householdId)} AND id IN (${ids});\nINSERT INTO operator_contact_assert VALUES (changes());\nDROP TABLE operator_contact_assert;\nDROP TABLE operator_identity_assert;\n`;
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

async function main() {
  const args = process.argv.slice(2);
  const inputIndex = args.indexOf("--input");
  const outputIndex = args.indexOf("--output");
  if (
    inputIndex === -1 ||
    outputIndex === -1 ||
    !args[inputIndex + 1] ||
    !args[outputIndex + 1]
  ) {
    throw new Error(
      "Usage: node scripts/operator-contact-config.mjs --input <private-json-path> --output <new-private-sql-path>",
    );
  }
  const inputPath = await realpath(resolve(args[inputIndex + 1]));
  const outputParent = await realpath(dirname(resolve(args[outputIndex + 1])));
  const outputPath = join(outputParent, basename(args[outputIndex + 1]));
  if (!outsideRepository(inputPath) || !outsideRepository(outputPath)) {
    throw new Error(
      "Operator input and output paths must be outside the repository",
    );
  }
  const inputStat = await stat(inputPath);
  if ((inputStat.mode & 0o077) !== 0) {
    throw new Error("Operator input must not grant group or other permissions");
  }
  const input = validateContactInput(
    JSON.parse(await readFile(inputPath, "utf8")),
  );
  const output = await open(
    outputPath,
    constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
    0o600,
  );
  try {
    await output.writeFile(buildContactSql(input), "utf8");
  } finally {
    await output.close();
  }
  const summary = summarizeContactReadiness(input);
  console.log(
    `Prepared private D1 input without printing values: total=${summary.total}, sendable=${summary.sendable}, missing=${summary.missing}, unconsented=${summary.unconsented}, suppressed=${summary.suppressed}.`,
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
