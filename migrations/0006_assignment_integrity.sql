CREATE TRIGGER IF NOT EXISTS weekly_assignments_no_delete
BEFORE DELETE ON weekly_assignments
BEGIN SELECT RAISE(ABORT, 'assignments cannot be deleted'); END;

CREATE TRIGGER IF NOT EXISTS weekly_assignments_assignee_change_guard
BEFORE UPDATE ON weekly_assignments
WHEN NEW.member_id = OLD.member_id
BEGIN SELECT RAISE(ABORT, 'assignment update must change assignee'); END;

CREATE TRIGGER IF NOT EXISTS weekly_assignments_audit_context_insert_guard
BEFORE INSERT ON weekly_assignments
WHEN NOT (
  (NEW.source = 'rotation' AND NEW.operation_kind = 'materialize' AND NEW.actor_member_id IS NULL)
  OR (NEW.source = 'reassignment' AND NEW.operation_kind IN ('reassign', 'correct') AND NEW.actor_member_id IS NOT NULL)
  OR (NEW.source = 'swap' AND NEW.operation_kind = 'swap' AND NEW.actor_member_id IS NOT NULL)
)
BEGIN SELECT RAISE(ABORT, 'invalid assignment audit context'); END;

CREATE TRIGGER IF NOT EXISTS weekly_assignments_audit_context_update_guard
BEFORE UPDATE ON weekly_assignments
WHEN NOT (
  (NEW.source = 'reassignment' AND NEW.operation_kind IN ('reassign', 'correct') AND NEW.actor_member_id IS NOT NULL)
  OR (NEW.source = 'swap' AND NEW.operation_kind = 'swap' AND NEW.actor_member_id IS NOT NULL)
)
BEGIN SELECT RAISE(ABORT, 'invalid assignment audit context'); END;

DROP TRIGGER IF EXISTS weekly_assignments_audit_update;
CREATE TRIGGER weekly_assignments_audit_update
AFTER UPDATE OF member_id ON weekly_assignments
WHEN NEW.member_id <> OLD.member_id
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
