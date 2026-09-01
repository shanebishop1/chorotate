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
  "PRODUCTION_REMINDER_EVENING_LOCAL_TIME",
  "PRODUCTION_REMINDER_MORNING_LOCAL_TIME",
];

/** @param {string} value */
const sqlString = (value) => `'${value.replaceAll("'", "''")}'`;

/**
 * @param {unknown} input
 * @returns {{timeZone: string, weekStart: string, weekStartNumber: number, eveningTime: string, morningTime: string}}
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
  };
}

/** @param {NodeJS.ProcessEnv | Record<string, string | undefined>} environment */
export function productionD1SettingsFromEnvironment(environment) {
  return validateSettings({
    timeZone: environment.PRODUCTION_HOUSEHOLD_TIME_ZONE,
    weekStart: environment.PRODUCTION_HOUSEHOLD_WEEK_START,
    eveningTime: environment.PRODUCTION_REMINDER_EVENING_LOCAL_TIME,
    morningTime: environment.PRODUCTION_REMINDER_MORNING_LOCAL_TIME,
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
      AND name = 'ChoRotate'
      AND time_zone = ${sqlString(settings.timeZone)}
      AND week_start = ${settings.weekStartNumber}
      AND reminder_evening_local_time = ${sqlString(settings.eveningTime)}
      AND reminder_morning_local_time = ${sqlString(settings.morningTime)}) AS exact_household_configuration,
  (SELECT count(*) FROM members) AS members,
  (SELECT count(*) FROM members WHERE active = 1) AS active_members,
  (SELECT count(*) FROM members
    WHERE household_id = 'chorotate' AND active = 1
      AND id IN ('jack', 'joe', 'dylan', 'shane')) AS exact_active_members,
  (SELECT count(*) FROM members
    WHERE household_id = 'chorotate' AND (
      (id = 'jack' AND display_name = 'Jack') OR
      (id = 'joe' AND display_name = 'Joe') OR
      (id = 'dylan' AND display_name = 'Dylan') OR
      (id = 'shane' AND display_name = 'Shane')
    )) AS exact_member_profiles,
  (SELECT count(*) FROM allowlisted_identities) AS identities,
  (SELECT count(*) FROM allowlisted_identities WHERE active = 1) AS active_identities,
  (SELECT count(*) FROM allowlisted_identities
    WHERE household_id = 'chorotate' AND active = 1 AND (
      (id = 'identity-jack' AND member_id = 'jack') OR
      (id = 'identity-joe' AND member_id = 'joe') OR
      (id = 'identity-dylan' AND member_id = 'dylan') OR
      (id = 'identity-shane' AND member_id = 'shane')
    )) AS exact_active_identities,
  (SELECT count(DISTINCT member_id) FROM allowlisted_identities
    WHERE active = 1
      AND household_id = 'chorotate'
      AND member_id IN ('jack', 'joe', 'dylan', 'shane')) AS exact_identity_members,
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
  (SELECT count(*) FROM rotation_config_members
    WHERE household_id = 'chorotate' AND (
      (rotation_config_id = 'rotation-trash-2026-08-28' AND (
        (member_id = 'jack' AND position = 0) OR
        (member_id = 'joe' AND position = 1) OR
        (member_id = 'dylan' AND position = 2) OR
        (member_id = 'shane' AND position = 3)
      )) OR
      (rotation_config_id = 'rotation-dishwasher-2026-08-31' AND (
        (member_id = 'jack' AND position = 0) OR
        (member_id = 'joe' AND position = 1) OR
        (member_id = 'dylan' AND position = 2) OR
        (member_id = 'shane' AND position = 3)
      ))
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

export const expectedProductionD1Result = {
  migrations: expectedMigrations,
  households: 1,
  exact_household_configuration: 1,
  members: 4,
  active_members: 4,
  exact_active_members: 4,
  exact_member_profiles: 4,
  identities: 4,
  active_identities: 4,
  exact_active_identities: 4,
  exact_identity_members: 4,
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
  rotation_members: 8,
  expected_rotation_members: 8,
  duplicate_occurrences: 0,
};
