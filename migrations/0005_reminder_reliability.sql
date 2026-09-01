ALTER TABLE households ADD COLUMN reminder_send_local_time TEXT NOT NULL DEFAULT '09:00'
  CHECK (
    reminder_send_local_time GLOB '[01][0-9]:[0-5][0-9]' OR
    reminder_send_local_time GLOB '2[0-3]:[0-5][0-9]'
  );

ALTER TABLE reminder_outbox ADD COLUMN recipient_assigned INTEGER NOT NULL DEFAULT 1
  CHECK (recipient_assigned IN (0, 1));

-- Preserve the meaning of any correction rows created by the earlier schema.
UPDATE reminder_outbox
SET recipient_assigned = CASE
  WHEN recipient_member_id = (
    SELECT COALESCE(
      (
        SELECT audit.after_member_id
        FROM assignment_audit_events AS audit
        WHERE audit.assignment_id = reminder_outbox.assignment_id
          AND audit.after_version = reminder_outbox.assignment_version
        LIMIT 1
      ),
      assignment.member_id
    )
    FROM weekly_assignments AS assignment
    WHERE assignment.id = reminder_outbox.assignment_id
  ) THEN 1
  ELSE 0
END
WHERE kind = 'correction';

CREATE TRIGGER reminder_outbox_assertion_insert
BEFORE INSERT ON reminder_outbox
WHEN NEW.kind = 'assignment' AND NEW.recipient_assigned <> 1
BEGIN
  SELECT RAISE(ABORT, 'assignment reminder must assert assigned recipient');
END;

CREATE TRIGGER reminder_outbox_meaning_immutable
BEFORE UPDATE OF id, assignment_id, assignment_version, recipient_member_id, kind, recipient_assigned
ON reminder_outbox
BEGIN
  SELECT RAISE(ABORT, 'reminder message meaning is immutable');
END;
