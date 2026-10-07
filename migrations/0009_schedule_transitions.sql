-- Schedule changes are effective-dated. Never reinterpret old Friday periods
-- when a chore's default weekday is moved to Monday.
ALTER TABLE rotation_configs ADD COLUMN ownership_start_weekday INTEGER
  CHECK (ownership_start_weekday BETWEEN 0 AND 6);
UPDATE rotation_configs SET ownership_start_weekday = (
  SELECT ownership_start_weekday FROM chores WHERE id = rotation_configs.chore_id
);
CREATE TRIGGER rotation_configs_snapshot_weekday
AFTER INSERT ON rotation_configs WHEN NEW.ownership_start_weekday IS NULL
BEGIN
  UPDATE rotation_configs SET ownership_start_weekday = (
    SELECT ownership_start_weekday FROM chores WHERE id = NEW.chore_id
  ) WHERE id = NEW.id;
END;

-- Opt-in: assignment commands must not give an already-busy member another
-- chore in the same synchronized week. Whole-week swaps remain supported.
ALTER TABLE households ADD COLUMN balanced_rotation_from TEXT
  CHECK (balanced_rotation_from IS NULL OR
    balanced_rotation_from GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]');

-- Superseded plans stay in the immutable assignment/audit ledger, but are not
-- active duties, edit candidates, or SMS occurrences.
CREATE TABLE assignment_schedule_retirements (
  assignment_id TEXT PRIMARY KEY REFERENCES weekly_assignments(id),
  retired_at TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (length(trim(reason)) BETWEEN 1 AND 500)
) STRICT;
CREATE TRIGGER assignment_schedule_retirements_no_update
BEFORE UPDATE ON assignment_schedule_retirements
BEGIN SELECT RAISE(ABORT, 'schedule retirements are immutable'); END;
CREATE TRIGGER assignment_schedule_retirements_no_delete
BEFORE DELETE ON assignment_schedule_retirements
BEGIN SELECT RAISE(ABORT, 'schedule retirements are immutable'); END;
