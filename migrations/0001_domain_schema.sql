PRAGMA foreign_keys = ON;

-- Better Auth owns and migrates its own tables. Domain rows intentionally do not
-- foreign-key into that versioned schema; auth_user_id is the integration key.
CREATE TABLE IF NOT EXISTS households (
  id TEXT PRIMARY KEY, name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  time_zone TEXT NOT NULL, week_start INTEGER NOT NULL CHECK (week_start BETWEEN 0 AND 6),
  created_at TEXT NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS members (
  id TEXT PRIMARY KEY, household_id TEXT NOT NULL REFERENCES households(id),
  display_name TEXT NOT NULL CHECK (length(trim(display_name)) > 0),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)), created_at TEXT NOT NULL,
  UNIQUE (household_id, id)
) STRICT;
CREATE INDEX IF NOT EXISTS members_household_active_idx ON members(household_id, active);
CREATE TABLE IF NOT EXISTS allowlisted_identities (
  id TEXT PRIMARY KEY, household_id TEXT NOT NULL, member_id TEXT NOT NULL,
  email_normalized TEXT NOT NULL CHECK (email_normalized = lower(trim(email_normalized)) AND length(email_normalized) > 0),
  auth_user_id TEXT, active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)), created_at TEXT NOT NULL,
  FOREIGN KEY (household_id, member_id) REFERENCES members(household_id, id)
) STRICT;
CREATE UNIQUE INDEX IF NOT EXISTS allowlisted_identity_active_email_uq
  ON allowlisted_identities(household_id, email_normalized) WHERE active = 1;
CREATE UNIQUE INDEX IF NOT EXISTS allowlisted_identity_auth_user_uq
  ON allowlisted_identities(auth_user_id) WHERE auth_user_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS chores (
  id TEXT PRIMARY KEY, household_id TEXT NOT NULL REFERENCES households(id),
  name TEXT NOT NULL CHECK (length(trim(name)) > 0), active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at TEXT NOT NULL, UNIQUE (household_id, id)
) STRICT;
CREATE INDEX IF NOT EXISTS chores_household_active_idx ON chores(household_id, active);
CREATE TABLE IF NOT EXISTS rotation_configs (
  id TEXT PRIMARY KEY, household_id TEXT NOT NULL, chore_id TEXT NOT NULL,
  effective_from TEXT NOT NULL CHECK (effective_from GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  rotation_offset INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL,
  FOREIGN KEY (household_id, chore_id) REFERENCES chores(household_id, id),
  UNIQUE (household_id, chore_id, effective_from), UNIQUE (household_id, id)
) STRICT;
CREATE INDEX IF NOT EXISTS rotation_configs_effective_idx ON rotation_configs(household_id, chore_id, effective_from DESC);
CREATE TABLE IF NOT EXISTS rotation_config_members (
  household_id TEXT NOT NULL, rotation_config_id TEXT NOT NULL, member_id TEXT NOT NULL,
  position INTEGER NOT NULL CHECK (position >= 0),
  PRIMARY KEY (rotation_config_id, position), UNIQUE (rotation_config_id, member_id),
  FOREIGN KEY (household_id, rotation_config_id) REFERENCES rotation_configs(household_id, id),
  FOREIGN KEY (household_id, member_id) REFERENCES members(household_id, id)
) STRICT;
CREATE TABLE IF NOT EXISTS weekly_assignments (
  id TEXT PRIMARY KEY, household_id TEXT NOT NULL, local_week_start TEXT NOT NULL CHECK (local_week_start GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  chore_id TEXT NOT NULL, member_id TEXT NOT NULL, version INTEGER NOT NULL CHECK (version >= 1),
  source TEXT NOT NULL CHECK (source IN ('rotation','reassignment','swap')),
  actor_member_id TEXT, request_id TEXT NOT NULL CHECK (length(trim(request_id)) > 0),
  operation_id TEXT NOT NULL CHECK (length(trim(operation_id)) > 0),
  operation_kind TEXT NOT NULL CHECK (operation_kind IN ('materialize','reassign','swap','correct')),
  occurred_at TEXT NOT NULL,
  FOREIGN KEY (household_id, chore_id) REFERENCES chores(household_id, id),
  FOREIGN KEY (household_id, member_id) REFERENCES members(household_id, id),
  FOREIGN KEY (household_id, actor_member_id) REFERENCES members(household_id, id),
  UNIQUE (household_id, local_week_start, chore_id), UNIQUE (id, version)
) STRICT;
CREATE INDEX IF NOT EXISTS assignments_member_week_idx ON weekly_assignments(household_id, member_id, local_week_start);
CREATE INDEX IF NOT EXISTS assignments_operation_idx ON weekly_assignments(operation_id);
CREATE TABLE IF NOT EXISTS assignment_audit_events (
  id TEXT PRIMARY KEY, assignment_id TEXT NOT NULL, household_id TEXT NOT NULL,
  local_week_start TEXT NOT NULL, chore_id TEXT NOT NULL,
  actor_member_id TEXT, request_id TEXT NOT NULL, operation_id TEXT NOT NULL, operation_kind TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  before_member_id TEXT, before_version INTEGER, before_source TEXT,
  after_member_id TEXT NOT NULL, after_version INTEGER NOT NULL, after_source TEXT NOT NULL,
  CHECK ((before_member_id IS NULL AND before_version IS NULL AND before_source IS NULL) OR
         (before_member_id IS NOT NULL AND before_version IS NOT NULL AND before_source IS NOT NULL))
) STRICT;
CREATE INDEX IF NOT EXISTS audit_assignment_idx ON assignment_audit_events(assignment_id, after_version);
CREATE INDEX IF NOT EXISTS audit_operation_idx ON assignment_audit_events(operation_id, occurred_at);
CREATE TABLE IF NOT EXISTS reminder_outbox (
  id TEXT PRIMARY KEY, assignment_id TEXT NOT NULL, assignment_version INTEGER NOT NULL,
  recipient_member_id TEXT NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('assignment','correction')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','leased','sent','failed')),
  available_at TEXT NOT NULL, attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  lease_owner TEXT, lease_expires_at TEXT, provider_message_id TEXT, created_at TEXT NOT NULL, sent_at TEXT,
  FOREIGN KEY (assignment_id) REFERENCES weekly_assignments(id),
  FOREIGN KEY (recipient_member_id) REFERENCES members(id),
  CHECK ((status = 'leased' AND lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL) OR status <> 'leased'),
  CHECK (status = 'leased' OR (lease_owner IS NULL AND lease_expires_at IS NULL)),
  CHECK (status <> 'sent' OR (provider_message_id IS NOT NULL AND sent_at IS NOT NULL)),
  UNIQUE (assignment_id, assignment_version, recipient_member_id, kind)
) STRICT;
CREATE INDEX IF NOT EXISTS outbox_claim_idx ON reminder_outbox(status, available_at, lease_expires_at);
CREATE UNIQUE INDEX IF NOT EXISTS outbox_provider_message_uq ON reminder_outbox(provider_message_id) WHERE provider_message_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS reminder_delivery_attempts (
  id TEXT PRIMARY KEY, outbox_id TEXT NOT NULL REFERENCES reminder_outbox(id),
  attempt_number INTEGER NOT NULL CHECK (attempt_number >= 1), attempted_at TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('accepted','retryable_failure','permanent_failure')),
  provider_message_id TEXT, sanitized_error TEXT, UNIQUE (outbox_id, attempt_number)
) STRICT;
CREATE INDEX IF NOT EXISTS delivery_attempt_outbox_idx ON reminder_delivery_attempts(outbox_id, attempted_at);
CREATE UNIQUE INDEX IF NOT EXISTS delivery_attempt_provider_uq ON reminder_delivery_attempts(provider_message_id) WHERE provider_message_id IS NOT NULL;
