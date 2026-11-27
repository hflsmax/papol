-- The email of the Lounge (src/jobs/lounge.ts): what a user's friends
-- did there since the last, sent once a day to begin with. When Papol
-- last looked for a user is kept on their row, so the next email starts
-- where that one stopped and nothing is told twice.
ALTER TABLE users ADD COLUMN lounge_mailed_at DATETIME;
