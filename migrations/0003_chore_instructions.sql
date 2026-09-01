ALTER TABLE chores
ADD COLUMN instructions TEXT NOT NULL DEFAULT 'Follow the documented steps for this chore.'
CHECK (length(trim(instructions)) > 0);

UPDATE chores
SET instructions = 'Take the trash out and replace bags.'
WHERE lower(id) = 'trash' OR lower(name) = 'trash';

UPDATE chores
SET instructions = 'Empty the completed dishwasher.'
WHERE lower(id) IN ('dishwasher', 'dishes')
   OR lower(name) IN ('dishwasher', 'dishes');
