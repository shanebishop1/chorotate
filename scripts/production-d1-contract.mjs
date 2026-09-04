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

export const productionD1SettingNames = [
  "PRODUCTION_HOUSEHOLD_TIME_ZONE",
  "PRODUCTION_HOUSEHOLD_WEEK_START",
  "PRODUCTION_HOUSEHOLD_MEMBER_COUNT",
  "PRODUCTION_REMINDER_EVENING_LOCAL_TIME",
  "PRODUCTION_REMINDER_MORNING_LOCAL_TIME",
];

/** @param {string} value */
const sqlString = (value) => `'${value.replaceAll("'", "''")}'`;

/**
 * @param {unknown} input
 * @returns {{timeZone: string, weekStart: string, weekStartNumber: number, eveningTime: string, morningTime: string, memberCount: number}}
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
  };
}

/** @param {NodeJS.ProcessEnv | Record<string, string | undefined>} environment */
export function productionD1SettingsFromEnvironment(environment) {
  const memberCountValue = environment.PRODUCTION_HOUSEHOLD_MEMBER_COUNT;
  return validateSettings({
    timeZone: environment.PRODUCTION_HOUSEHOLD_TIME_ZONE,
    weekStart: environment.PRODUCTION_HOUSEHOLD_WEEK_START,
    eveningTime: environment.PRODUCTION_REMINDER_EVENING_LOCAL_TIME,
    morningTime: environment.PRODUCTION_REMINDER_MORNING_LOCAL_TIME,
    memberCount:
      typeof memberCountValue === "string" && /^\d+$/.test(memberCountValue)
        ? Number(memberCountValue)
        : undefined,
  });
}

/** @param {unknown} input */
export function buildProductionD1VerificationQuery(input) {
  const settings = validateSettings(input);
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
  (SELECT count(*) FROM chores) AS chores,
  (SELECT count(*) FROM chores WHERE active = 1) AS active_chores,
  (SELECT count(*) FROM chores
    WHERE household_id = 'chorotate' AND active = 1 AND (
      (id = 'trash' AND name = 'Trash'
        AND instructions = 'Take the trash out and replace bags.'
        AND ownership_start_weekday = 5) OR
      (id = 'dishwasher' AND name = 'Dishwasher'
        AND instructions = 'Empty the completed dishwasher.'
        AND ownership_start_weekday = 1)
    )) AS expected_chores,
  (SELECT count(*) FROM rotation_configs
    WHERE household_id = 'chorotate') AS rotation_configs,
  (SELECT count(*) FROM rotation_configs
    WHERE household_id = 'chorotate' AND (
      (id = 'rotation-trash-2026-08-28' AND chore_id = 'trash'
        AND effective_from = '2026-08-28' AND rotation_offset = 0) OR
      (id = 'rotation-dishwasher-2026-08-31' AND chore_id = 'dishwasher'
        AND effective_from = '2026-08-31' AND rotation_offset = 2)
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
      AND rotation_config_members.rotation_config_id IN (
        'rotation-trash-2026-08-28', 'rotation-dishwasher-2026-08-31'
      )
    GROUP BY rotation_config_members.rotation_config_id
    HAVING count(*) = ${settings.memberCount}
      AND count(DISTINCT rotation_config_members.member_id) = ${settings.memberCount}
      AND count(DISTINCT rotation_config_members.position) = ${settings.memberCount}
      AND min(rotation_config_members.position) = 0
      AND max(rotation_config_members.position) = ${settings.memberCount - 1}
  )) AS expected_rotation_members,
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

/** @param {number} memberCount */
export function expectedProductionD1Result(memberCount) {
  if (!Number.isInteger(memberCount) || memberCount < 1 || memberCount > 50) {
    throw new Error("Invalid expected production household member count");
  }
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
    missing_contacts: 0,
    malformed_contacts: 0,
    unconsented_contacts: 0,
    suppressed_contacts: 0,
    chores: 2,
    active_chores: 2,
    expected_chores: 2,
    rotation_configs: 2,
    expected_rotation_configs: 2,
    rotation_members: memberCount * 2,
    expected_rotation_members: 2,
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
