-- How far back a member's Lounge shows what their friends did, in days.
-- Empty means everything, which is how it begins.
ALTER TABLE users ADD COLUMN lounge_days INTEGER;
