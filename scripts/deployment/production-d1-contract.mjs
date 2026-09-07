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

import {
  defaultChoreConfig,
  validateChoreConfig,
  weekdays,
} from "../operator/chore-config.mjs";

const localTimePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

export const productionD1SettingNames = [
  "PRODUCTION_HOUSEHOLD_TIME_ZONE",
  "PRODUCTION_HOUSEHOLD_WEEK_START",
  "PRODUCTION_HOUSEHOLD_MEMBER_COUNT",
  "PRODUCTION_REMINDER_EVENING_LOCAL_TIME",
  "PRODUCTION_REMINDER_MORNING_LOCAL_TIME",
  "PRODUCTION_REMINDER_SMS_ENABLED",
];

/** @param {string} value */
const sqlString = (value) => `'${value.replaceAll("'", "''")}'`;

/**
 * @param {unknown} input
 * @returns {{timeZone: string, weekStart: string, weekStartNumber: number, eveningTime: string, morningTime: string, memberCount: number, smsEnabled: boolean, chores: Array<{id: string, name: string, instructions: string, ownershipStartWeekday: string, ownershipStartWeekdayNumber: number, rotation: {id: string, effectiveFrom: string, offset: number, memberIds: string[]}}>, explicitChoreConfig: boolean}}
 */
function validateSettings(input) {
  /** @type {string[]} */
  const failures = [];
  if (input === null || typeof input !== "object") {
    throw new Error("Invalid production D1 verification settings: input");
  }
  const settings = /** @type {Record<string, unknown>} */ (input);
  const timeZone = settings.timeZone;
  const weekStart = settings.weekStart;
  const eveningTime = settings.eveningTime;
  const morningTime = settings.morningTime;
  const memberCount = settings.memberCount;
  const smsEnabled = settings.smsEnabled;
  if (
    typeof timeZone !== "string" ||
    timeZone !== timeZone.trim() ||
    timeZone.length === 0 ||
    timeZone.length > 100
  ) {
    failures.push("PRODUCTION_HOUSEHOLD_TIME_ZONE");
  } else {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone }).format();
    } catch {
      failures.push("PRODUCTION_HOUSEHOLD_TIME_ZONE");
    }
  }
  if (typeof weekStart !== "string" || !weekdays.has(weekStart)) {
    failures.push("PRODUCTION_HOUSEHOLD_WEEK_START");
  }
  if (typeof eveningTime !== "string" || !localTimePattern.test(eveningTime)) {
    failures.push("PRODUCTION_REMINDER_EVENING_LOCAL_TIME");
  }
  if (typeof morningTime !== "string" || !localTimePattern.test(morningTime)) {
    failures.push("PRODUCTION_REMINDER_MORNING_LOCAL_TIME");
  }
  if (
    typeof memberCount !== "number" ||
    !Number.isInteger(memberCount) ||
    memberCount < 1 ||
    memberCount > 50
  ) {
    failures.push("PRODUCTION_HOUSEHOLD_MEMBER_COUNT");
  }
  if (smsEnabled !== undefined && typeof smsEnabled !== "boolean") {
    failures.push("PRODUCTION_REMINDER_SMS_ENABLED");
  }
  let chores;
  try {
    const configuredMemberIds = /** @type {string[] | undefined} */ (
      Array.isArray(settings.chores) &&
      settings.chores[0]?.rotation !== null &&
      typeof settings.chores[0]?.rotation === "object" &&
      Array.isArray(settings.chores[0]?.rotation?.memberIds)
        ? settings.chores[0].rotation.memberIds
        : undefined
    );
    const members =
      configuredMemberIds?.map((id) => ({ id })) ??
      Array.from(
        { length: typeof memberCount === "number" ? memberCount : 0 },
        (_, index) => ({
          id: `member-${index}`,
        }),
      );
    if (members.length !== memberCount) {
      throw new Error("member count");
    }
    chores = validateChoreConfig(
      settings.chores === undefined
        ? defaultChoreConfig(members)
        : settings.chores,
      members,
      { allowDerivedWeekday: true },
    );
  } catch {
    failures.push("PRODUCTION_CHORE_CONFIG");
  }
  if (failures.length > 0) {
    throw new Error(
      `Invalid production D1 verification settings: ${[...new Set(failures)].sort().join(", ")}`,
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
    memberCount: /** @type {number} */ (memberCount),
    smsEnabled: smsEnabled === true,
    chores: /** @type {NonNullable<typeof chores>} */ (chores),
    explicitChoreConfig: settings.chores !== undefined,
  };
}

/**
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} environment
 * @param {{memberCount?: number, chores?: unknown}} [overrides]
 */
export function productionD1SettingsFromEnvironment(
  environment,
  overrides = {},
) {
  const memberCountValue = environment.PRODUCTION_HOUSEHOLD_MEMBER_COUNT;
  const smsEnabledValue = environment.PRODUCTION_REMINDER_SMS_ENABLED;
  if (
    smsEnabledValue !== undefined &&
    smsEnabledValue !== "true" &&
    smsEnabledValue !== "false"
  ) {
    throw new Error(
      "Invalid production D1 verification settings: PRODUCTION_REMINDER_SMS_ENABLED",
    );
  }
  const parsedMemberCount =
    typeof memberCountValue === "string" && /^\d+$/.test(memberCountValue)
      ? Number(memberCountValue)
      : undefined;
  if (
    overrides.memberCount !== undefined &&
    parsedMemberCount !== undefined &&
    overrides.memberCount !== parsedMemberCount
  ) {
    throw new Error(
      "Invalid production D1 verification settings: PRODUCTION_HOUSEHOLD_MEMBER_COUNT",
    );
  }
  return validateSettings({
    timeZone: environment.PRODUCTION_HOUSEHOLD_TIME_ZONE,
    weekStart: environment.PRODUCTION_HOUSEHOLD_WEEK_START,
    eveningTime: environment.PRODUCTION_REMINDER_EVENING_LOCAL_TIME,
    morningTime: environment.PRODUCTION_REMINDER_MORNING_LOCAL_TIME,
    memberCount: overrides.memberCount ?? parsedMemberCount,
    smsEnabled: smsEnabledValue === "true",
    chores: overrides.chores,
  });
}

/** @param {unknown} input */
export function buildProductionD1VerificationQuery(input) {
  const settings = validateSettings(input);
  const expectedChores = settings.chores
    .map(
      (chore) =>
        `      (id = ${sqlString(chore.id)} AND name = ${sqlString(chore.name)}
        AND instructions = ${sqlString(chore.instructions)}
        AND ownership_start_weekday = ${chore.ownershipStartWeekdayNumber})`,
    )
    .join(" OR\n");
  const expectedRotations = settings.chores
    .map(
      (chore) =>
        `      (id = ${sqlString(chore.rotation.id)}
        AND chore_id = ${sqlString(chore.id)}
        AND effective_from = ${sqlString(chore.rotation.effectiveFrom)}
        AND rotation_offset = ${chore.rotation.offset})`,
    )
    .join(" OR\n");
  const rotationIds = settings.chores
    .map((chore) => sqlString(chore.rotation.id))
    .join(", ");
  const expectedRotationOrders = settings.explicitChoreConfig
    ? settings.chores
        .map(
          (chore) =>
            `      (id = ${sqlString(chore.rotation.id)} AND
        (SELECT group_concat(member_id, '|') FROM (
          SELECT member_id FROM rotation_config_members
          WHERE household_id = 'chorotate'
            AND rotation_config_id = ${sqlString(chore.rotation.id)}
          ORDER BY position
        )) = ${sqlString(chore.rotation.memberIds.join("|"))})`,
        )
        .join(" OR\n")
    : "      0 = 1";
  return `
SELECT
  (SELECT group_concat(name, '|') FROM (SELECT name FROM d1_migrations ORDER BY id)) AS migrations,
  (SELECT count(*) FROM households) AS households,
  (SELECT count(*) FROM households
    WHERE id = 'chorotate'
      AND name = trim(name)
      AND name <> ''
      AND time_zone = ${sqlString(settings.timeZone)}
      AND week_start = ${settings.weekStartNumber}
      AND reminder_evening_local_time = ${sqlString(settings.eveningTime)}
      AND reminder_morning_local_time = ${sqlString(settings.morningTime)}) AS exact_household_configuration,
  (SELECT count(*) FROM members) AS members,
  (SELECT count(*) FROM members WHERE active = 1) AS active_members,
  (SELECT count(*) FROM members
    WHERE household_id = 'chorotate' AND active = 1) AS exact_active_members,
  (SELECT count(*) FROM members
    WHERE household_id = 'chorotate' AND active = 1
      AND id = trim(id) AND id <> ''
      AND display_name = trim(display_name) AND display_name <> '') AS exact_member_profiles,
  (SELECT count(*) FROM allowlisted_identities) AS identities,
  (SELECT count(*) FROM allowlisted_identities WHERE active = 1) AS active_identities,
  (SELECT count(*) FROM allowlisted_identities
    JOIN members
      ON members.household_id = allowlisted_identities.household_id
     AND members.id = allowlisted_identities.member_id
    WHERE allowlisted_identities.household_id = 'chorotate'
      AND allowlisted_identities.active = 1
      AND members.active = 1) AS exact_active_identities,
  (SELECT count(*) FROM members
    WHERE members.household_id = 'chorotate' AND members.active = 1
      AND 1 = (SELECT count(*) FROM allowlisted_identities
        WHERE allowlisted_identities.household_id = members.household_id
          AND allowlisted_identities.member_id = members.id
          AND allowlisted_identities.active = 1)) AS exact_identity_members,
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
  (SELECT count(*) FROM members
    WHERE active = 1 AND (
      sms_consent_status NOT IN ('not_recorded', 'consented', 'revoked') OR
      sms_suppression_status NOT IN ('not_suppressed', 'suppressed') OR
      (sms_phone_e164 IS NOT NULL AND NOT (
        sms_phone_e164 = trim(sms_phone_e164) AND
        length(sms_phone_e164) BETWEEN 3 AND 16 AND
        substr(sms_phone_e164, 1, 1) = '+' AND
        substr(sms_phone_e164, 2, 1) BETWEEN '1' AND '9' AND
        substr(sms_phone_e164, 2) NOT GLOB '*[^0-9]*'
      ))
    )) AS invalid_contact_states,
  (SELECT count(*) FROM chores) AS chores,
  (SELECT count(*) FROM chores WHERE active = 1) AS active_chores,
  (SELECT count(*) FROM chores
     WHERE household_id = 'chorotate' AND active = 1 AND (
${expectedChores}
     )) AS expected_chores,
  (SELECT count(*) FROM rotation_configs
    WHERE household_id = 'chorotate') AS rotation_configs,
  (SELECT count(*) FROM rotation_configs
     WHERE household_id = 'chorotate' AND (
${expectedRotations}
     )) AS expected_rotation_configs,
  (SELECT count(*) FROM rotation_config_members
    WHERE household_id = 'chorotate') AS rotation_members,
  (SELECT count(*) FROM (
    SELECT rotation_config_members.rotation_config_id
    FROM rotation_config_members
    JOIN members
       ON members.household_id = rotation_config_members.household_id
      AND members.id = rotation_config_members.member_id
     AND members.active = 1
    WHERE rotation_config_members.household_id = 'chorotate'
       AND rotation_config_members.rotation_config_id IN (${rotationIds})
    GROUP BY rotation_config_members.rotation_config_id
    HAVING count(*) = ${settings.memberCount}
      AND count(DISTINCT rotation_config_members.member_id) = ${settings.memberCount}
      AND count(DISTINCT rotation_config_members.position) = ${settings.memberCount}
      AND min(rotation_config_members.position) = 0
      AND max(rotation_config_members.position) = ${settings.memberCount - 1}
  )) AS expected_rotation_members,
  (SELECT count(*) FROM rotation_configs
     WHERE household_id = 'chorotate' AND (
${expectedRotationOrders}
     )) AS expected_rotation_order,
  (SELECT count(*) FROM (
    SELECT household_id, assignment_id, assignment_version, local_period_start,
      chore_id, occurrence_phase, recipient_member_id
    FROM reminder_outbox
    GROUP BY household_id, assignment_id, assignment_version, local_period_start,
      chore_id, occurrence_phase, recipient_member_id
    HAVING count(*) > 1
  )) AS duplicate_occurrences;
`;
}

/**
 * @param {number} memberCount
 * @param {unknown} [choreInput]
 * @param {{smsEnabled?: boolean, contactCounts?: {missing: number, malformed: number, unconsented: number, suppressed: number}}} [options]
 */
export function expectedProductionD1Result(
  memberCount,
  choreInput,
  options = {},
) {
  if (!Number.isInteger(memberCount) || memberCount < 1 || memberCount > 50) {
    throw new Error("Invalid expected production household member count");
  }
  const defaultMembers = Array.from({ length: memberCount }, (_, index) => ({
    id: `member-${index}`,
  }));
  const configuredMemberIds = /** @type {string[] | undefined} */ (
    Array.isArray(choreInput) &&
    choreInput[0]?.rotation !== null &&
    typeof choreInput[0]?.rotation === "object" &&
    Array.isArray(choreInput[0]?.rotation?.memberIds)
      ? choreInput[0].rotation.memberIds
      : undefined
  );
  const members = configuredMemberIds?.map((id) => ({ id })) ?? defaultMembers;
  if (members.length !== memberCount) {
    throw new Error("Invalid expected production chore configuration");
  }
  const chores = validateChoreConfig(
    choreInput === undefined ? defaultChoreConfig(defaultMembers) : choreInput,
    members,
    { allowDerivedWeekday: true },
  );
  const choreCount = chores.length;
  const contactCounts = options.contactCounts;
  const smsEnabled = options.smsEnabled ?? true;
  return {
    migrations: expectedMigrations,
    households: 1,
    exact_household_configuration: 1,
    members: memberCount,
    active_members: memberCount,
    exact_active_members: memberCount,
    exact_member_profiles: memberCount,
    identities: memberCount,
    active_identities: memberCount,
    exact_active_identities: memberCount,
    exact_identity_members: memberCount,
    invalid_identities: 0,
    missing_contacts: smsEnabled ? 0 : contactCounts?.missing,
    malformed_contacts: smsEnabled ? 0 : contactCounts?.malformed,
    unconsented_contacts: smsEnabled ? 0 : contactCounts?.unconsented,
    suppressed_contacts: smsEnabled ? 0 : contactCounts?.suppressed,
    invalid_contact_states: 0,
    chores: choreCount,
    active_chores: choreCount,
    expected_chores: choreCount,
    rotation_configs: choreCount,
    expected_rotation_configs: choreCount,
    rotation_members: memberCount * choreCount,
    expected_rotation_members: choreCount,
    expected_rotation_order: choreInput === undefined ? 0 : choreCount,
    duplicate_occurrences: 0,
  };
}

const productionD1ResultNames = Object.keys(expectedProductionD1Result(1));

/** @param {string} output */
export function parseProductionD1VerificationOutput(output) {
  try {
    const payload = JSON.parse(output);
    if (
      !Array.isArray(payload) ||
      payload.length !== 1 ||
      payload[0]?.success !== true ||
      !Array.isArray(payload[0].results) ||
      payload[0].results.length !== 1
    ) {
      return undefined;
    }
    const row = payload[0].results[0];
    if (
      row !== null &&
      typeof row === "object" &&
      productionD1ResultNames.every((name) => Object.hasOwn(row, name))
    ) {
      return /** @type {Record<string, unknown>} */ (row);
    }
  } catch {
    // Raw provider output can contain resource identifiers; callers get no detail.
  }
  return undefined;
}
