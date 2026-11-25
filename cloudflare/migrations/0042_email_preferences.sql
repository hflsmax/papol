-- What Papol emails a user is chosen in one place.
--
-- `email_off` lists the kinds of email the user turned off, as a JSON
-- list of the kinds src/emails.ts declares; empty, every kind is sent.
-- A kind of email added later is on for everyone without a migration.
--
-- The one choice there was, the weekly suggestions' own column, becomes
-- an entry in the list.
ALTER TABLE users ADD COLUMN email_off TEXT DEFAULT '[]' NOT NULL;
UPDATE users SET email_off = '["friend_suggestions"]' WHERE suggestion_email = 0;
ALTER TABLE users DROP COLUMN suggestion_email;
