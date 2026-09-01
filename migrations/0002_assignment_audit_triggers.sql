CREATE TRIGGER IF NOT EXISTS weekly_assignments_version_guard
BEFORE UPDATE ON weekly_assignments
WHEN NEW.version <> OLD.version + 1
BEGIN SELECT RAISE(ABORT, 'assignment version must increment by one'); END;

CREATE TRIGGER IF NOT EXISTS weekly_assignments_identity_guard
BEFORE UPDATE ON weekly_assignments
WHEN NEW.id <> OLD.id OR NEW.household_id <> OLD.household_id
  OR NEW.local_week_start <> OLD.local_week_start OR NEW.chore_id <> OLD.chore_id
BEGIN SELECT RAISE(ABORT, 'assignment identity is immutable'); END;

CREATE TRIGGER IF NOT EXISTS weekly_assignments_audit_insert
AFTER INSERT ON weekly_assignments
BEGIN
  INSERT INTO assignment_audit_events (
    id, assignment_id, household_id, local_week_start, chore_id, actor_member_id,
    request_id, operation_id, operation_kind, occurred_at,
    before_member_id, before_version, before_source,
    after_member_id, after_version, after_source
  ) VALUES (
    lower(hex(randomblob(16))), NEW.id, NEW.household_id, NEW.local_week_start, NEW.chore_id, NEW.actor_member_id,
    NEW.request_id, NEW.operation_id, NEW.operation_kind, NEW.occurred_at,
    NULL, NULL, NULL, NEW.member_id, NEW.version, NEW.source
  );
END;
CREATE TRIGGER IF NOT EXISTS weekly_assignments_audit_update
AFTER UPDATE ON weekly_assignments
BEGIN
  INSERT INTO assignment_audit_events (
    id, assignment_id, household_id, local_week_start, chore_id, actor_member_id,
    request_id, operation_id, operation_kind, occurred_at,
    before_member_id, before_version, before_source,
    after_member_id, after_version, after_source
  ) VALUES (
    lower(hex(randomblob(16))), NEW.id, NEW.household_id, NEW.local_week_start, NEW.chore_id, NEW.actor_member_id,
    NEW.request_id, NEW.operation_id, NEW.operation_kind, NEW.occurred_at,
    OLD.member_id, OLD.version, OLD.source, NEW.member_id, NEW.version, NEW.source
  );
END;
CREATE TRIGGER IF NOT EXISTS assignment_audit_events_no_update
BEFORE UPDATE ON assignment_audit_events BEGIN SELECT RAISE(ABORT, 'assignment audit events are immutable'); END;
CREATE TRIGGER IF NOT EXISTS assignment_audit_events_no_delete
BEFORE DELETE ON assignment_audit_events BEGIN SELECT RAISE(ABORT, 'assignment audit events are immutable'); END;
