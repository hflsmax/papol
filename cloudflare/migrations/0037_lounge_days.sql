-- How far back a member's friends see what the member did, in days.
-- Empty means everything, which is how it begins.
ALTER TABLE users ADD COLUMN lounge_days INTEGER;
