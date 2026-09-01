-- Member SMS contact is sensitive delivery data, never an identity key. Null is
-- the safe migration default until an operator supplies a normalized contact.
ALTER TABLE members ADD COLUMN sms_phone_e164 TEXT
  CHECK (
    sms_phone_e164 IS NULL OR (
      sms_phone_e164 = trim(sms_phone_e164)
      AND length(sms_phone_e164) BETWEEN 3 AND 16
      AND substr(sms_phone_e164, 1, 1) = '+'
      AND substr(sms_phone_e164, 2, 1) BETWEEN '1' AND '9'
      AND substr(sms_phone_e164, 2) NOT GLOB '*[^0-9]*'
    )
  );
ALTER TABLE members ADD COLUMN sms_consent_status TEXT NOT NULL DEFAULT 'not_recorded'
  CHECK (sms_consent_status IN ('not_recorded', 'consented', 'revoked'));
ALTER TABLE members ADD COLUMN sms_suppression_status TEXT NOT NULL DEFAULT 'not_suppressed'
  CHECK (sms_suppression_status IN ('not_suppressed', 'suppressed'));
ALTER TABLE members ADD COLUMN sms_contact_updated_at TEXT;

-- Preserve the former household weekday for every existing chore while making
-- the boundary an explicit property of each chore going forward.
ALTER TABLE chores ADD COLUMN ownership_start_weekday INTEGER NOT NULL DEFAULT 1
  CHECK (ownership_start_weekday BETWEEN 0 AND 6);
UPDATE chores
SET ownership_start_weekday = (
  SELECT household.week_start
  FROM households AS household
  WHERE household.id = chores.household_id
);

-- Keep the legacy column available to pre-migration readers while exposing the
-- authoritative chore-period name without duplicating mutable state.
ALTER TABLE weekly_assignments ADD COLUMN local_period_start TEXT
  GENERATED ALWAYS AS (local_week_start) VIRTUAL;
ALTER TABLE assignment_audit_events ADD COLUMN local_period_start TEXT
  GENERATED ALWAYS AS (local_week_start) VIRTUAL;
CREATE UNIQUE INDEX weekly_assignments_period_identity_uq
  ON weekly_assignments(household_id, chore_id, local_period_start);
CREATE INDEX assignment_audit_period_idx
  ON assignment_audit_events(household_id, chore_id, local_period_start, occurred_at);

DROP TRIGGER IF EXISTS reminder_outbox_assertion_insert;
DROP TRIGGER IF EXISTS reminder_outbox_meaning_immutable;

-- Rebuild both outbox tables together so legacy rows survive while email-era
-- message kinds and generic provider-message fields leave the active schema.
ALTER TABLE reminder_delivery_attempts
  RENAME TO reminder_delivery_attempts_legacy;
ALTER TABLE reminder_outbox RENAME TO reminder_outbox_legacy;

CREATE TABLE reminder_outbox (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id),
  assignment_id TEXT NOT NULL REFERENCES weekly_assignments(id),
  assignment_version INTEGER NOT NULL CHECK (assignment_version >= 1),
  local_period_start TEXT NOT NULL
    CHECK (local_period_start GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  chore_id TEXT NOT NULL,
  recipient_member_id TEXT NOT NULL REFERENCES members(id),
  occurrence_phase TEXT NOT NULL
    CHECK (occurrence_phase IN ('evening', 'morning', 'legacy_primary', 'legacy_secondary')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'leased', 'accepted', 'failed', 'delivery_unknown')),
  available_at TEXT NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  lease_owner TEXT,
  lease_expires_at TEXT,
  textbelt_text_id TEXT,
  textbelt_quota_remaining INTEGER CHECK (textbelt_quota_remaining >= 0),
  sanitized_error_category TEXT CHECK (
    sanitized_error_category IS NULL OR (
      length(sanitized_error_category) BETWEEN 1 AND 64
      AND sanitized_error_category = lower(trim(sanitized_error_category))
      AND sanitized_error_category NOT GLOB '*[^a-z0-9_:-]*'
    )
  ),
  provider_status TEXT CHECK (
    provider_status IS NULL OR (
      length(provider_status) BETWEEN 1 AND 64
      AND provider_status = lower(trim(provider_status))
      AND provider_status NOT GLOB '*[^a-z0-9_:-]*'
    )
  ),
  provider_status_checked_at TEXT,
  correction_needed INTEGER NOT NULL DEFAULT 0 CHECK (correction_needed IN (0, 1)),
  created_at TEXT NOT NULL,
  terminal_at TEXT,
  FOREIGN KEY (household_id, chore_id) REFERENCES chores(household_id, id),
  CHECK ((status = 'leased' AND lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL)
         OR status <> 'leased'),
  CHECK (status = 'leased' OR (lease_owner IS NULL AND lease_expires_at IS NULL)),
  CHECK ((status IN ('accepted', 'failed', 'delivery_unknown') AND terminal_at IS NOT NULL)
         OR (status IN ('pending', 'leased') AND terminal_at IS NULL)),
  UNIQUE (
    household_id, assignment_id, assignment_version, local_period_start,
    chore_id, occurrence_phase, recipient_member_id
  )
) STRICT;

INSERT INTO reminder_outbox (
  id, household_id, assignment_id, assignment_version, local_period_start,
  chore_id, recipient_member_id, occurrence_phase, status, available_at,
  attempt_count, lease_owner, lease_expires_at, textbelt_text_id,
  correction_needed, created_at, terminal_at
)
SELECT
  legacy.id,
  assignment.household_id,
  legacy.assignment_id,
  legacy.assignment_version,
  assignment.local_period_start,
  assignment.chore_id,
  legacy.recipient_member_id,
  CASE legacy.kind
    WHEN 'assignment' THEN 'legacy_primary'
    ELSE 'legacy_secondary'
  END,
  CASE legacy.status
    WHEN 'sent' THEN 'accepted'
    ELSE legacy.status
  END,
  legacy.available_at,
  legacy.attempt_count,
  legacy.lease_owner,
  legacy.lease_expires_at,
  legacy.provider_message_id,
  CASE legacy.kind WHEN 'correction' THEN 1 ELSE 0 END,
  legacy.created_at,
  CASE
    WHEN legacy.status IN ('sent', 'failed')
      THEN COALESCE(legacy.sent_at, legacy.created_at)
    ELSE NULL
  END
FROM reminder_outbox_legacy AS legacy
JOIN weekly_assignments AS assignment ON assignment.id = legacy.assignment_id;

CREATE TABLE reminder_delivery_attempts (
  id TEXT PRIMARY KEY,
  outbox_id TEXT NOT NULL REFERENCES reminder_outbox(id),
  attempt_number INTEGER NOT NULL CHECK (attempt_number >= 1),
  attempted_at TEXT NOT NULL,
  outcome TEXT NOT NULL
    CHECK (outcome IN ('accepted', 'failed', 'delivery_unknown', 'pre_submit_failure')),
  textbelt_text_id TEXT,
  textbelt_quota_remaining INTEGER CHECK (textbelt_quota_remaining >= 0),
  sanitized_error_category TEXT CHECK (
    sanitized_error_category IS NULL OR (
      length(sanitized_error_category) BETWEEN 1 AND 64
      AND sanitized_error_category = lower(trim(sanitized_error_category))
      AND sanitized_error_category NOT GLOB '*[^a-z0-9_:-]*'
    )
  ),
  provider_status TEXT CHECK (
    provider_status IS NULL OR (
      length(provider_status) BETWEEN 1 AND 64
      AND provider_status = lower(trim(provider_status))
      AND provider_status NOT GLOB '*[^a-z0-9_:-]*'
    )
  ),
  provider_status_checked_at TEXT,
  UNIQUE (outbox_id, attempt_number)
) STRICT;

INSERT INTO reminder_delivery_attempts (
  id, outbox_id, attempt_number, attempted_at, outcome, textbelt_text_id,
  sanitized_error_category
)
SELECT
  id,
  outbox_id,
  attempt_number,
  attempted_at,
  CASE outcome
    WHEN 'accepted' THEN 'accepted'
    WHEN 'retryable_failure' THEN 'pre_submit_failure'
    ELSE 'failed'
  END,
  provider_message_id,
  CASE WHEN sanitized_error IS NULL THEN NULL ELSE 'legacy_failure' END
FROM reminder_delivery_attempts_legacy;

DROP TABLE reminder_delivery_attempts_legacy;
DROP TABLE reminder_outbox_legacy;

CREATE INDEX outbox_claim_idx
  ON reminder_outbox(status, available_at, lease_expires_at);
CREATE UNIQUE INDEX outbox_textbelt_text_id_uq
  ON reminder_outbox(textbelt_text_id) WHERE textbelt_text_id IS NOT NULL;
CREATE INDEX delivery_attempt_outbox_idx
  ON reminder_delivery_attempts(outbox_id, attempted_at);
CREATE UNIQUE INDEX delivery_attempt_textbelt_text_id_uq
  ON reminder_delivery_attempts(textbelt_text_id) WHERE textbelt_text_id IS NOT NULL;

CREATE TRIGGER reminder_outbox_assignment_identity_insert
BEFORE INSERT ON reminder_outbox
WHEN NOT EXISTS (
  SELECT 1
  FROM weekly_assignments AS assignment
  WHERE assignment.id = NEW.assignment_id
    AND assignment.household_id = NEW.household_id
    AND assignment.chore_id = NEW.chore_id
    AND assignment.local_period_start = NEW.local_period_start
)
BEGIN
  SELECT RAISE(ABORT, 'invalid reminder assignment identity');
END;

CREATE TRIGGER reminder_outbox_meaning_immutable
BEFORE UPDATE OF
  id, household_id, assignment_id, assignment_version, local_period_start,
  chore_id, recipient_member_id, occurrence_phase
ON reminder_outbox
BEGIN
  SELECT RAISE(ABORT, 'SMS occurrence meaning is immutable');
END;

CREATE TRIGGER reminder_outbox_terminal_status_immutable
BEFORE UPDATE OF status ON reminder_outbox
WHEN OLD.status IN ('accepted', 'failed', 'delivery_unknown')
  AND NEW.status <> OLD.status
BEGIN
  SELECT RAISE(ABORT, 'terminal SMS result is immutable');
END;

CREATE TRIGGER reminder_delivery_attempts_no_update
BEFORE UPDATE ON reminder_delivery_attempts
BEGIN
  SELECT RAISE(ABORT, 'SMS delivery attempt evidence is immutable');
END;

CREATE TRIGGER reminder_delivery_attempts_no_delete
BEFORE DELETE ON reminder_delivery_attempts
BEGIN
  SELECT RAISE(ABORT, 'SMS delivery attempt evidence is immutable');
END;
