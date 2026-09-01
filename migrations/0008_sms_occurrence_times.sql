-- Keep the email-era send time for backwards-compatible readers while making
-- the two SMS occurrence clocks explicit household configuration.
ALTER TABLE households ADD COLUMN reminder_evening_local_time TEXT NOT NULL DEFAULT '20:00'
  CHECK (
    reminder_evening_local_time GLOB '[01][0-9]:[0-5][0-9]' OR
    reminder_evening_local_time GLOB '2[0-3]:[0-5][0-9]'
  );

ALTER TABLE households ADD COLUMN reminder_morning_local_time TEXT NOT NULL DEFAULT '08:00'
  CHECK (
    reminder_morning_local_time GLOB '[01][0-9]:[0-5][0-9]' OR
    reminder_morning_local_time GLOB '2[0-3]:[0-5][0-9]'
  );
